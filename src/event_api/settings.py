from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    kafka_bootstrap_servers: str = "localhost:19092"
    kafka_topic: str = "game-events"
    request_timeout_seconds: float = Field(default=10.0, gt=0)
    max_batch_size: int = Field(default=500, ge=1, le=10_000)
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_prefix="EVENT_API_",
        env_file=".env",
        extra="ignore",
    )

