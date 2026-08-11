from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_database: str = "game_analytics"
    clickhouse_user: str = "default"
    clickhouse_password: str = ""
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_prefix="ANALYTICS_",
        env_file=".env",
        extra="ignore",
    )

