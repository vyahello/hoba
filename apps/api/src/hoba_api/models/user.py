"""User model — see spec §4."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from hoba_api.models._base import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("language_code IN ('uk', 'en')", name="ck_users_language_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    # Telegram identity (immutable per Telegram account)
    tg_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, nullable=False)
    tg_username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str] = mapped_column(String(128), nullable=False)
    last_name: Mapped[str | None] = mapped_column(String(128))
    photo_url: Mapped[str | None] = mapped_column(String(512))

    # User preferences (mutable via PATCH /api/v1/me)
    language_code: Mapped[str] = mapped_column(String(2), default="en", nullable=False)
    sound_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    haptics_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    music_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False,
    )
    # Vestigial: the "Anonymous by default" setting was removed (anonymity is
    # now a per-room host control). Column kept to avoid a SQLite drop-column
    # rebuild; see docs/TODO.md to drop on the next Postgres consolidation.
    is_anonymous_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
