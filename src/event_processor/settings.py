from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    kafka_bootstrap_servers: str = "localhost:19092"
    kafka_topic: str = "game-events"
    kafka_group_id: str = "game-events-clickhouse-writer"
    batch_size: int = Field(default=500, ge=1, le=10_000)
    batch_flush_interval_seconds: float = Field(default=2.0, gt=0)

    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_database: str = "game_analytics"
    clickhouse_user: str = "default"
    clickhouse_password: str = ""

    # Retry policy for batch inserts. The offset is never committed until the
    # insert succeeds, so a retry costs nothing but time.
    clickhouse_insert_max_retries: int = Field(default=8, ge=0)
    clickhouse_insert_backoff_initial_seconds: float = Field(default=0.5, gt=0)
    clickhouse_insert_backoff_max_seconds: float = Field(default=30.0, gt=0)

    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_prefix="PROCESSOR_",
        env_file=".env",
        extra="ignore",
    )

