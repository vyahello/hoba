"""Declarative base + shared mixins for all ORM models."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Project-wide declarative base. All ORM models inherit from this."""


class TimestampMixin:
    """Adds `created_at` (UTC) to a model.

    Sets BOTH a Python-side `default` and a DB `server_default`: the Python
    default means every ORM insert supplies the value explicitly, so the row
    is valid even if a hand-written migration forgot the server default (as
    0015/0016 did for the wheel tables — see migration 0017). The server
    default keeps raw SQL inserts honest too.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
