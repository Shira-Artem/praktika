from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from event_api.main import create_app
from event_api.producer import InMemoryEventProducer
from event_api.settings import Settings


def test_post_event_accepts_valid_event() -> None:
    producer = InMemoryEventProducer()
    app = create_app(settings=Settings(), producer=producer)

    with TestClient(app) as client:
        response = client.post(
            "/events",
            json={
                "event_type": "level_completed",
                "event_time": datetime.now(UTC).isoformat(),
                "game_id": "arena_escape",
                "player_id": "player_123",
                "session_id": "session_456",
                "platform": "android",
                "app_version": "1.0.0",
                "country": "RU",
                "properties": {"level_id": 4},
            },
        )

    assert response.status_code == 202
    assert len(producer.events) == 1
    assert producer.events[0].event_id


def test_batch_reports_invalid_event_index() -> None:
    producer = InMemoryEventProducer()
    app = create_app(settings=Settings(), producer=producer)

    with TestClient(app) as client:
        response = client.post(
            "/events/batch",
            json={
                "events": [
                    {
                        "event_type": "level_started",
                        "event_time": datetime.now(UTC).isoformat(),
                        "game_id": "arena_escape",
                        "player_id": "player_123",
                        "session_id": "session_456",
                    },
                    {
                        "event_type": "",
                        "event_time": datetime.now(UTC).isoformat(),
                        "game_id": "arena_escape",
                        "player_id": "player_123",
                        "session_id": "session_456",
                    },
                ]
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"]["errors"][0]["index"] == 1
    assert producer.events == []

