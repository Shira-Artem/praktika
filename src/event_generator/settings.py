from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    event_api_url: str = "http://localhost:8000"
    total_events: int = Field(default=1000, ge=1, le=1_000_000)
    batch_size: int = Field(default=100, ge=1, le=1000)
    request_delay_seconds: float = Field(default=0.1, ge=0)
    request_timeout_seconds: float = Field(default=10.0, gt=0)
    max_retries: int = Field(default=5, ge=0)
    retry_backoff_seconds: float = Field(default=0.5, gt=0)

    game_id: str = "arena_escape"
    app_version: str = "1.0.0"
    players: int = Field(default=100, ge=1, le=1_000_000)
    events_per_session: int = Field(default=20, ge=1)
    max_level: int = Field(default=50, ge=1)
    max_event_age_seconds: int = Field(default=3600, ge=0)
    seed: int | None = None

    model_config = SettingsConfigDict(
        env_prefix="GENERATOR_",
        env_file=".env",
        extra="ignore",
    )

