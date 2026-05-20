"""Runtime configuration loaded from environment variables.

See `.env.example` at repo root for the documented variable list. Fields
land here only when something actually reads them — Phase 1 uses log
level, database URL and Redis URL. `SECRET_KEY`, `SENTRY_DSN`, and
`WEBAPP_URL` join this model when Phase 2+ code starts consuming them.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    log_level: str = "INFO"
    database_url: str = "sqlite+aiosqlite:///./data/hoba.db"
    redis_url: str = "redis://redis:6379/0"


settings = Settings()
