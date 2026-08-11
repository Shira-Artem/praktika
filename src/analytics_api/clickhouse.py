from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime
from typing import Any

from analytics_api.settings import Settings

EVENT_TYPE_PATTERN = re.compile(r"^[a-zA-Z0-9_.:-]{1,128}$")
GAME_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_.:-]{1,128}$")
DELIVERY_OUTCOME_EVENTS = ("delivery_started", "delivery_completed", "delivery_failed", "delivery_rejected")


class AnalyticsReader:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Any | None = None
        self._query_lock = asyncio.Lock()

    def start(self) -> None:
        import clickhouse_connect

        self._client = clickhouse_connect.get_client(
            host=self._settings.clickhouse_host,
            port=self._settings.clickhouse_port,
            username=self._settings.clickhouse_user,
            password=self._settings.clickhouse_password,
            database=self._settings.clickhouse_database,
        )

    def close(self) -> None:
        if self._client is not None:
            self._client.close()

    async def summary(self, *, since_hours: int) -> dict[str, Any]:
        rows = await self._query_dicts(
            f"""
            SELECT
                count() AS total_events,
                uniqExact(player_id) AS active_players,
                uniqExact(session_id) AS sessions,
                uniqExact(event_type) AS event_types,
                min(received_at) AS first_received_at,
                max(received_at) AS last_received_at
            FROM game_events
            WHERE received_at >= now() - INTERVAL {since_hours} HOUR
            """
        )
        return rows[0] if rows else {}

    async def event_types(self, *, since_hours: int, limit: int) -> list[dict[str, Any]]:
        return await self._query_dicts(
            f"""
            SELECT
                event_type,
                count() AS events,
                uniqExact(player_id) AS players,
                uniqExact(session_id) AS sessions
            FROM game_events
            WHERE received_at >= now() - INTERVAL {since_hours} HOUR
            GROUP BY event_type
            ORDER BY events DESC, event_type ASC
            LIMIT {limit}
            """
        )

    async def recent_events(self, *, limit: int) -> list[dict[str, Any]]:
        rows = await self._query_dicts(
            f"""
            SELECT
                event_id,
                event_type,
                game_id,
                player_id,
                session_id,
                platform,
                app_version,
                country,
                event_time,
                received_at,
                properties
            FROM game_events
            ORDER BY received_at DESC
            LIMIT {limit}
            """
        )
        for row in rows:
            row["properties"] = _safe_json_loads(row.get("properties"))
        return rows

    async def funnel(self, *, steps: list[str], since_hours: int) -> list[dict[str, Any]]:
        validate_event_types(steps)
        step_literals = ", ".join(_quote_sql_string(step) for step in steps)
        rows = await self._query_dicts(
            f"""
            SELECT
                event_type,
                uniqExact(player_id) AS players
            FROM game_events
            WHERE
                received_at >= now() - INTERVAL {since_hours} HOUR
                AND event_type IN ({step_literals})
            GROUP BY event_type
            """
        )
        players_by_step = {row["event_type"]: row["players"] for row in rows}
        first_step_players = players_by_step.get(steps[0], 0) if steps else 0

        result = []
        for index, step in enumerate(steps, start=1):
            players = players_by_step.get(step, 0)
            conversion = players / first_step_players if first_step_players else 0
            result.append(
                {
                    "step": index,
                    "event_type": step,
                    "players": players,
                    "conversion_from_first": round(conversion, 4),
                }
            )
        return result

    async def delivery_overview(self, *, since_hours: int, game_id: str) -> dict[str, Any]:
        """Lunar-dispatch delivery metrics: how many missions were launched, how many
        succeeded/failed/were rejected before launch, and the average risk/energy cost
        the game predicted for the missions it actually started."""
        validate_game_id(game_id)
        rows = await self._query_dicts(
            f"""
            SELECT
                countIf(event_type = 'delivery_started') AS deliveries_started,
                countIf(event_type = 'delivery_completed') AS deliveries_succeeded,
                countIf(event_type = 'delivery_failed') AS deliveries_failed,
                countIf(event_type = 'delivery_rejected') AS deliveries_rejected,
                round(avgIf(JSONExtractFloat(properties, 'risk'), event_type = 'delivery_started'), 4) AS avg_risk,
                round(avgIf(JSONExtractFloat(properties, 'energy_cost'), event_type = 'delivery_started'), 2) AS avg_energy_cost,
                round(sumIf(JSONExtractFloat(properties, 'reward'), event_type = 'delivery_completed'), 0) AS credits_from_deliveries
            FROM game_events
            WHERE game_id = {_quote_sql_string(game_id)}
                AND event_type IN {_quote_sql_tuple(DELIVERY_OUTCOME_EVENTS)}
                AND received_at >= now() - INTERVAL {since_hours} HOUR
            """
        )
        return rows[0] if rows else {}

    async def rover_efficiency(self, *, since_hours: int, game_id: str) -> list[dict[str, Any]]:
        """Success rate per rover_id, derived from delivery_completed/delivery_failed events."""
        validate_game_id(game_id)
        return await self._query_dicts(
            f"""
            SELECT
                JSONExtractString(properties, 'rover_id') AS rover_id,
                countIf(event_type = 'delivery_completed') AS succeeded,
                countIf(event_type = 'delivery_failed') AS failed
            FROM game_events
            WHERE game_id = {_quote_sql_string(game_id)}
                AND event_type IN ('delivery_completed', 'delivery_failed')
                AND received_at >= now() - INTERVAL {since_hours} HOUR
            GROUP BY rover_id
            HAVING rover_id != ''
            ORDER BY succeeded + failed DESC
            """
        )

    async def route_popularity(self, *, since_hours: int, game_id: str, limit: int) -> list[dict[str, Any]]:
        """How often each route_id was actually launched (delivery_started)."""
        validate_game_id(game_id)
        return await self._query_dicts(
            f"""
            SELECT
                JSONExtractString(properties, 'route_id') AS route_id,
                count() AS launches
            FROM game_events
            WHERE game_id = {_quote_sql_string(game_id)}
                AND event_type = 'delivery_started'
                AND received_at >= now() - INTERVAL {since_hours} HOUR
            GROUP BY route_id
            HAVING route_id != ''
            ORDER BY launches DESC
            LIMIT {limit}
            """
        )

    async def rejection_reasons(self, *, since_hours: int, game_id: str) -> list[dict[str, Any]]:
        """Why launches were blocked client-side (delivery_rejected.reason_code)."""
        validate_game_id(game_id)
        return await self._query_dicts(
            f"""
            SELECT
                JSONExtractString(properties, 'reason_code') AS reason_code,
                count() AS occurrences
            FROM game_events
            WHERE game_id = {_quote_sql_string(game_id)}
                AND event_type = 'delivery_rejected'
                AND received_at >= now() - INTERVAL {since_hours} HOUR
            GROUP BY reason_code
            HAVING reason_code != ''
            ORDER BY occurrences DESC
            """
        )

    async def _query_dicts(self, sql: str) -> list[dict[str, Any]]:
        if self._client is None:
            raise RuntimeError("ClickHouse client is not started")

        async with self._query_lock:
            result = await asyncio.to_thread(self._client.query, sql)
        return [
            {
                column: _json_value(value)
                for column, value in zip(result.column_names, row, strict=True)
            }
            for row in result.result_rows
        ]


def validate_event_types(steps: list[str]) -> None:
    if not steps:
        raise ValueError("at least one funnel step is required")

    invalid_steps = [step for step in steps if not EVENT_TYPE_PATTERN.fullmatch(step)]
    if invalid_steps:
        raise ValueError(f"invalid event_type values: {', '.join(invalid_steps)}")


def validate_game_id(game_id: str) -> None:
    if not GAME_ID_PATTERN.fullmatch(game_id):
        raise ValueError(f"invalid game_id value: {game_id}")


def parse_steps(raw_steps: str) -> list[str]:
    steps = [step.strip() for step in raw_steps.split(",") if step.strip()]
    validate_event_types(steps)
    return steps


def _quote_sql_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _quote_sql_tuple(values: tuple[str, ...]) -> str:
    return "(" + ", ".join(_quote_sql_string(value) for value in values) + ")"


def _safe_json_loads(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value
