from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest

from event_processor import clickhouse as clickhouse_module
from event_processor.clickhouse import ClickHouseEventWriter, ClickHouseUnavailable
from event_processor.settings import Settings
from shared.models import EnrichedGameEvent


def make_event() -> EnrichedGameEvent:
    now = datetime.now(timezone.utc)
    return EnrichedGameEvent(
        event_id="01HXYZTESTEVENTID0000000",
        event_type="level_completed",
        event_time=now,
        received_at=now,
        game_id="arena_escape",
        player_id="player_1",
        session_id="session_1",
        platform="android",
        app_version="1.0.0",
        country="RU",
        properties={"level_id": 4},
    )


class FakeClient:
    """Stands in for clickhouse_connect: fails a fixed number of times, then works."""

    def __init__(self, failures: int = 0) -> None:
        self.remaining_failures = failures
        self.insert_calls = 0
        self.closed = 0

    def insert(self, table, rows, column_names):  # noqa: ANN001 - mirrors driver signature
        self.insert_calls += 1
        if self.remaining_failures > 0:
            self.remaining_failures -= 1
            raise ConnectionError("clickhouse is down")

    def close(self) -> None:
        self.closed += 1


@pytest.fixture
def no_sleep(monkeypatch):
    """Record backoff delays instead of actually waiting for them."""
    delays: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        delays.append(seconds)

    monkeypatch.setattr(clickhouse_module.asyncio, "sleep", fake_sleep)
    return delays


def make_writer(client: FakeClient, **overrides) -> ClickHouseEventWriter:
    settings = Settings(
        clickhouse_insert_backoff_initial_seconds=0.5,
        clickhouse_insert_backoff_max_seconds=4.0,
        **overrides,
    )
    writer = ClickHouseEventWriter(settings)
    writer._client = client
    writer._connect = lambda: client  # avoid touching a real ClickHouse
    return writer


async def test_insert_succeeds_without_retry(no_sleep):
    client = FakeClient(failures=0)
    writer = make_writer(client)

    await writer.insert_events([make_event()])

    assert client.insert_calls == 1
    assert no_sleep == []


async def test_insert_retries_until_success(no_sleep):
    client = FakeClient(failures=2)
    writer = make_writer(client)

    await writer.insert_events([make_event()])

    assert client.insert_calls == 3
    assert no_sleep == [0.5, 1.0]
    assert client.closed == 2  # reconnected before each retry


async def test_backoff_is_exponential_and_capped(no_sleep):
    client = FakeClient(failures=99)
    writer = make_writer(client, clickhouse_insert_max_retries=5)

    with pytest.raises(ClickHouseUnavailable):
        await writer.insert_events([make_event()])

    assert client.insert_calls == 6  # initial attempt + 5 retries
    assert no_sleep == [0.5, 1.0, 2.0, 4.0, 4.0]  # capped at 4.0


async def test_gives_up_and_raises_so_offset_is_not_committed(no_sleep):
    client = FakeClient(failures=99)
    writer = make_writer(client, clickhouse_insert_max_retries=2)

    with pytest.raises(ClickHouseUnavailable):
        await writer.insert_events([make_event()])

    assert client.insert_calls == 3


async def test_shutdown_interrupts_backoff(no_sleep):
    client = FakeClient(failures=99)
    settings = Settings(clickhouse_insert_max_retries=10)
    stop_event = asyncio.Event()
    stop_event.set()
    writer = ClickHouseEventWriter(settings, should_stop=stop_event.is_set)
    writer._client = client
    writer._connect = lambda: client

    with pytest.raises(ClickHouseUnavailable):
        await writer.insert_events([make_event()])

    assert client.insert_calls == 1  # bailed out instead of waiting through 10 retries
    assert no_sleep == []


async def test_empty_batch_is_a_noop(no_sleep):
    client = FakeClient()
    writer = make_writer(client)

    await writer.insert_events([])

    assert client.insert_calls == 0
