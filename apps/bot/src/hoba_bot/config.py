"""Runtime configuration for the Telegram bot.

See `.env.example` at repo root for the documented variable list.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    log_level: str = "INFO"
    telegram_bot_token: str = ""
    telegram_bot_username: str = "hobagame_bot"
    # Public HTTPS URL of the Mini App. None means the bot replies to
    # commands with plain text only (no Web App inline buttons / menu).
    webapp_url: str | None = None


settings = Settings()
