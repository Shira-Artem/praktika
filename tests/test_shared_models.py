from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from shared.models import GameEventIn, normalize_event


def make_event(**overrides):
    payload = {
        "event_type": "level_completed",
        "event_time": datetime.now(UTC),
        "game_id": "arena_escape",
        "player_id": "player_123",
        "session_id": "session_456",
        "platform": "android",
        "app_version": "1.0.0",
        "country": "ru",
        "properties": {"level_id": 4},
    }
    payload.update(overrides)
    return GameEventIn.model_validate(payload)


def test_normalize_event_generates_ulid_and_received_at() -> None:
    event = make_event()

    enriched = normalize_event(event)

    assert len(enriched.event_id) == 26
    assert enriched.received_at.tzinfo is not None
    assert enriched.country == "RU"


def test_normalize_event_rejects_far_future_event_time() -> None:
    received_at = datetime(2026, 7, 16, 12, 0, tzinfo=UTC)
    event = make_event(event_time=received_at + timedelta(minutes=6))

    with pytest.raises(ValueError, match="future"):
        normalize_event(event, received_at=received_at)

