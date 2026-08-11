from __future__ import annotations

import pytest

from analytics_api.clickhouse import parse_steps, validate_event_types, validate_game_id


def test_parse_steps_trims_and_filters_empty_values() -> None:
    assert parse_steps("session_started, level_started,,level_completed") == [
        "session_started",
        "level_started",
        "level_completed",
    ]


def test_validate_event_types_rejects_sql_like_values() -> None:
    with pytest.raises(ValueError, match="invalid event_type"):
        validate_event_types(["session_started", "x'; DROP TABLE game_events; --"])


def test_validate_game_id_accepts_lunar_dispatch() -> None:
    validate_game_id("lunar_dispatch")


def test_validate_game_id_rejects_sql_like_values() -> None:
    with pytest.raises(ValueError, match="invalid game_id"):
        validate_game_id("x'; DROP TABLE game_events; --")

