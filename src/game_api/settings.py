from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    db_path: str = "game_api.db"
    log_level: str = "INFO"
    tick_interval_seconds: float = 1.0

    model_config = SettingsConfigDict(
        env_prefix="GAME_API_",
        env_file=".env",
        extra="ignore",
    )
