"""Social join tables for public wheels (Phase 10) — likes + reports.

Both are per-(wheel, user) unique so a user can't inflate a like or spam
reports. The denormalized counters live on `Wheel` (recomputed from these
rows on each mutation); these tables are the source of truth for *who*.
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from hoba_api.models._base import Base, TimestampMixin


class WheelLike(Base, TimestampMixin):
    __tablename__ = "wheel_likes"
    __table_args__ = (
        UniqueConstraint("wheel_id", "user_id", name="uq_wheel_likes_wheel_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    wheel_id: Mapped[int] = mapped_column(
        ForeignKey("wheels.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )


class WheelReport(Base, TimestampMixin):
    __tablename__ = "wheel_reports"
    __table_args__ = (
        UniqueConstraint("wheel_id", "user_id", name="uq_wheel_reports_wheel_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    wheel_id: Mapped[int] = mapped_column(
        ForeignKey("wheels.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
