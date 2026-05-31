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

    # Room-creation rate limit (spec §14): max creations per user per
    # window. Default 5/hour for prod abuse protection; raise on the VPS
    # (e.g. ROOM_CREATE_RATE_LIMIT_MAX=1000) for heavy manual testing.
    room_create_rate_limit_max: int = 5
    room_create_rate_limit_window_seconds: int = 60 * 60

    # Reaction flood guard: max reactions per user per window per room.
    # Generous by default so enthusiastic tapping never hits the wall;
    # still caps a misbehaving client. Override via REACTIONS_PER_WINDOW /
    # REACTIONS_WINDOW_SECONDS.
    reactions_per_window: int = 40
    reactions_window_seconds: int = 5

    # Chaos mode (spec §5.4): chance per spin that a chaos event fires.
    # Default 0.25 per spec. Bump on the VPS (e.g. CHAOS_PROBABILITY=1.0)
    # to force an event on every spin for manual verification, then revert.
    chaos_probability: float = 0.25


settings = Settings()
