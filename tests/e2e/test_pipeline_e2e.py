from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime
from pathlib import Path

import clickhouse_connect
import pytest
from fastapi.testclient import TestClient
from testcontainers.clickhouse import ClickHouseContainer
from testcontainers.kafka import RedpandaContainer

from event_api.main import create_app
from event_api.settings import Settings as ApiSettings
from event_processor.main import run as run_processor
from event_processor.settings import Settings as ProcessorSettings


pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(
        os.getenv("RUN_E2E") != "1",
        reason="set RUN_E2E=1 to run Docker-backed e2e tests",
    ),
]

TOPIC = "game-events"


@pytest.mark.asyncio
async def test_event_flows_from_api_to_clickhouse() -> None:
    with (
        RedpandaContainer("redpandadata/redpanda:v24.3.5").start(timeout=30) as redpanda,
        ClickHouseContainer(
            "clickhouse/clickhouse-server:24.8",
            username="default",
            password="",
            dbname="game_analytics",
        ) as clickhouse,
    ):
        bootstrap_servers = redpanda.get_bootstrap_server()
        create_redpanda_topic(redpanda)

        clickhouse_port = int(clickhouse.get_exposed_port(8123))
        clickhouse_client = clickhouse_connect.get_client(
            host=clickhouse.get_container_host_ip(),
            port=clickhouse_port,
            username=clickhouse.username,
            password=clickhouse.password,
            database="game_analytics",
        )
        create_clickhouse_schema(clickhouse_client)

        processor_stop_event = asyncio.Event()
        processor_task = asyncio.create_task(
            run_processor(
                ProcessorSettings(
                    kafka_bootstrap_servers=bootstrap_servers,
                    kafka_topic=TOPIC,
                    kafka_group_id="game-events-e2e-test",
                    batch_size=10,
                    batch_flush_interval_seconds=0.2,
                    clickhouse_host=clickhouse.get_container_host_ip(),
                    clickhouse_port=clickhouse_port,
                    clickhouse_database="game_analytics",
                    clickhouse_user=clickhouse.username,
                    clickhouse_password=clickhouse.password,
                ),
                stop_event=processor_stop_event,
                install_signal_handlers=False,
            )
        )

        try:
            await asyncio.sleep(1)

            app = create_app(
                settings=ApiSettings(
                    kafka_bootstrap_servers=bootstrap_servers,
                    kafka_topic=TOPIC,
                )
            )
            with TestClient(app) as client:
                response = client.post(
                    "/events",
                    json={
                        "event_id": "01KY9W5M9T8Z6V1Z9Z75Q0J8XK",
                        "event_type": "level_completed",
                        "event_time": datetime.now(UTC).isoformat(),
                        "game_id": "arena_escape",
                        "player_id": "player_e2e",
                        "session_id": "session_e2e",
                        "platform": "android",
                        "app_version": "1.0.0",
                        "country": "RU",
                        "properties": {
                            "level_id": 7,
                            "duration_seconds": 142,
                            "difficulty": "normal",
                        },
                    },
                )

            assert response.status_code == 202
            assert response.json()["event_id"] == "01KY9W5M9T8Z6V1Z9Z75Q0J8XK"

            row_count = await wait_for_clickhouse_event(clickhouse_client)
            assert row_count == 1
        finally:
            processor_stop_event.set()
            await asyncio.wait_for(processor_task, timeout=10)
            clickhouse_client.close()


def create_redpanda_topic(redpanda: RedpandaContainer) -> None:
    result = redpanda.exec(
        [
            "rpk",
            "topic",
            "create",
            TOPIC,
            "--partitions=6",
            "--replicas=1",
            "-X",
            "brokers=127.0.0.1:29092",
        ]
    )
    output = result.output.decode("utf-8", errors="replace")
    assert result.exit_code == 0, output


def create_clickhouse_schema(client) -> None:
    sql = Path("docker/clickhouse/init/001_create_game_events.sql").read_text(encoding="utf-8")
    for statement in sql.split(";"):
        statement = statement.strip()
        if statement:
            client.command(statement)


async def wait_for_clickhouse_event(client, *, timeout_seconds: float = 20) -> int:
    deadline = asyncio.get_running_loop().time() + timeout_seconds

    while asyncio.get_running_loop().time() < deadline:
        count = client.query("SELECT count() FROM game_events WHERE player_id = 'player_e2e'")
        row_count = count.result_rows[0][0]
        if row_count:
            return row_count
        await asyncio.sleep(0.5)

    return 0
