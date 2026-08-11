from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Any

from event_processor.settings import Settings
from shared.models import EnrichedGameEvent

logger = logging.getLogger(__name__)

COLUMNS = [
    "event_id",
    "event_type",
    "event_time",
    "received_at",
    "game_id",
    "player_id",
    "session_id",
    "platform",
    "app_version",
    "country",
    "properties",
]


class ClickHouseUnavailable(RuntimeError):
    """Raised when ClickHouse is still unreachable after every retry attempt."""


class ClickHouseEventWriter:
    def __init__(
        self,
        settings: Settings,
        *,
        should_stop: Callable[[], bool] | None = None,
    ) -> None:
        self._settings = settings
        self._client: Any | None = None
        # Lets a shutdown interrupt a long backoff instead of blocking SIGTERM.
        self._should_stop = should_stop or (lambda: False)

    def start(self) -> None:
        self._client = self._connect()

    async def insert_events(self, events: list[EnrichedGameEvent]) -> None:
        if not events:
            return

        if self._client is None:
            raise RuntimeError("ClickHouse client is not started")

        rows = [self._to_row(event) for event in events]
        await self._insert_with_retry(rows)

    async def _insert_with_retry(self, rows: list[list[Any]]) -> None:
        max_attempts = self._settings.clickhouse_insert_max_retries + 1
        delay = self._settings.clickhouse_insert_backoff_initial_seconds
        last_error: Exception | None = None

        for attempt in range(1, max_attempts + 1):
            try:
                await asyncio.to_thread(
                    self._client.insert,
                    "game_events",
                    rows,
                    column_names=COLUMNS,
                )
            except Exception as exc:  # noqa: BLE001 - any driver error is retryable
                last_error = exc
                logger.warning(
                    "clickhouse insert failed",
                    extra={
                        "attempt": attempt,
                        "max_attempts": max_attempts,
                        "rows": len(rows),
                        "error": str(exc),
                    },
                )
                if attempt == max_attempts or self._should_stop():
                    break

                await asyncio.sleep(delay)
                delay = min(delay * 2, self._settings.clickhouse_insert_backoff_max_seconds)
                self._reconnect()
            else:
                if attempt > 1:
                    logger.info(
                        "clickhouse insert recovered",
                        extra={"attempt": attempt, "rows": len(rows)},
                    )
                return

        raise ClickHouseUnavailable(
            f"failed to insert {len(rows)} rows after {max_attempts} attempts"
        ) from last_error

    def _connect(self) -> Any:
        import clickhouse_connect

        return clickhouse_connect.get_client(
            host=self._settings.clickhouse_host,
            port=self._settings.clickhouse_port,
            username=self._settings.clickhouse_user,
            password=self._settings.clickhouse_password,
            database=self._settings.clickhouse_database,
        )

    def _reconnect(self) -> None:
        """Drop a possibly broken connection and open a fresh one."""
        try:
            self.close()
        except Exception:  # noqa: BLE001 - closing a dead socket must not mask the retry
            pass

        try:
            self._client = self._connect()
        except Exception as exc:  # noqa: BLE001 - next attempt will retry anyway
            logger.warning("clickhouse reconnect failed", extra={"error": str(exc)})

    def close(self) -> None:
        if self._client is not None:
            self._client.close()

    @staticmethod
    def _to_row(event: EnrichedGameEvent) -> list[Any]:
        return [
            event.event_id,
            event.event_type,
            event.event_time,
            event.received_at,
            event.game_id,
            event.player_id,
            event.session_id,
            event.platform,
            event.app_version,
            event.country or "",
            json.dumps(event.properties, ensure_ascii=False, separators=(",", ":")),
        ]

