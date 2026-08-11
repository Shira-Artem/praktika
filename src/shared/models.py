from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from shared.ulid import new_ulid

MAX_PROPERTIES_BYTES = 16 * 1024
MAX_FUTURE_SKEW = timedelta(minutes=5)
MAX_PAST_AGE = timedelta(days=90)


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must include timezone")
    return value.astimezone(UTC)


class GameEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    event_id: str | None = Field(default=None, min_length=1, max_length=64)
    event_type: str = Field(..., min_length=1, max_length=128)
    event_time: datetime
    game_id: str = Field(..., min_length=1, max_length=128)
    player_id: str = Field(..., min_length=1, max_length=128)
    session_id: str = Field(..., min_length=1, max_length=128)
    platform: str = Field(default="unknown", min_length=1, max_length=64)
    app_version: str = Field(default="unknown", min_length=1, max_length=64)
    country: str | None = Field(default=None, max_length=2)
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator("event_time")
    @classmethod
    def event_time_must_be_timezone_aware(cls, value: datetime) -> datetime:
        return ensure_utc(value)

    @field_validator("country")
    @classmethod
    def normalize_country(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if len(value) != 2:
            raise ValueError("country must be an ISO 3166-1 alpha-2 code")
        return value.upper()

    @field_validator("properties")
    @classmethod
    def properties_must_be_json_serializable(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise ValueError("properties must be JSON serializable") from exc

        if len(encoded) > MAX_PROPERTIES_BYTES:
            raise ValueError(f"properties must be <= {MAX_PROPERTIES_BYTES} bytes")

        return value


class EnrichedGameEvent(GameEventIn):
    event_id: str = Field(..., min_length=1, max_length=64)
    received_at: datetime

    @field_validator("received_at")
    @classmethod
    def received_at_must_be_timezone_aware(cls, value: datetime) -> datetime:
        return ensure_utc(value)


def validate_event_time(event_time: datetime, received_at: datetime) -> None:
    if event_time > received_at + MAX_FUTURE_SKEW:
        raise ValueError("event_time is too far in the future")

    if event_time < received_at - MAX_PAST_AGE:
        raise ValueError("event_time is older than the allowed retention window")


def normalize_event(event: GameEventIn, *, received_at: datetime | None = None) -> EnrichedGameEvent:
    received_at = ensure_utc(received_at or datetime.now(UTC))
    validate_event_time(event.event_time, received_at)

    event_data = event.model_dump()
    event_data["event_id"] = event.event_id or new_ulid()
    event_data["received_at"] = received_at
    return EnrichedGameEvent.model_validate(event_data)


def serialize_event(event: EnrichedGameEvent) -> bytes:
    return json.dumps(
        event.model_dump(mode="json"),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

