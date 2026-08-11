from __future__ import annotations

import pytest

from analytics_api.clickhouse import parse_steps, validate_event_types


def test_parse_steps_trims_and_filters_empty_values() -> None:
    assert parse_steps("session_started, level_started,,level_completed") == [
        "session_started",
        "level_started",
        "level_completed",
    ]


def test_validate_event_types_rejects_sql_like_values() -> None:
    with pytest.raises(ValueError, match="invalid event_type"):
        validate_event_types(["session_started", "x'; DROP TABLE game_events; --"])

