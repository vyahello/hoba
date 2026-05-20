"""Runtime configuration loaded from environment variables.

See `.env.example` at repo root for the documented variable list.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    log_level: str = "INFO"
    database_url: str = "sqlite+aiosqlite:///./data/hoba.db"
    redis_url: str = "redis://redis:6379/0"

    # Bot token from BotFather — used to HMAC-validate Telegram initData
    # (spec §6, mandatory for any authenticated request). Empty in dev
    # disables auth verification and causes /api/v1/* to return 500.
    telegram_bot_token: str = ""

    # Reject Telegram initData older than this many seconds (replay
    # protection; spec §6 mandates 24h).
    init_data_max_age_seconds: int = 24 * 60 * 60

    # Run `alembic upgrade head` automatically on API startup. Default true
    # so `docker compose up` works out of the box; tests set this to false
    # and create schema via `Base.metadata.create_all` for speed.
    auto_migrate: bool = True


settings = Settings()
