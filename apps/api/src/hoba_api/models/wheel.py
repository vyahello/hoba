"""Wheel model — a saved, reusable wheel in a user's library (spec §8 / F10).

Options are stored as `Segment` rows with `parent_type="wheel"` (the Segment
model is polymorphic on parent_type), mirroring how a Question owns its
segments. "Use as room" copies these into a fresh room's active question.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from hoba_api.models._base import Base, TimestampMixin

if TYPE_CHECKING:
    from hoba_api.models.segment import Segment


class Wheel(Base, TimestampMixin):
    __tablename__ = "wheels"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    use_count: Mapped[int] = mapped_column(
        default=0, nullable=False, server_default="0",
    )
    # Phase 10 (public/trending) toggles this; Phase 9 always False.
    is_public: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0",
    )
    # Denormalized social counters (recomputed from wheel_likes / wheel_reports
    # on each mutation) so the trending sort runs off plain indexed columns.
    like_count: Mapped[int] = mapped_column(
        default=0, nullable=False, server_default="0",
    )
    report_count: Mapped[int] = mapped_column(
        default=0, nullable=False, server_default="0",
    )
    # Auto-set True once distinct reporters reach the threshold (spec §14).
    is_hidden: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0",
    )
    # Optional trending category (one of moderation.CATEGORIES) or NULL.
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    segments: Mapped[list[Segment]] = relationship(
        primaryjoin=(
            "and_(foreign(Segment.parent_id) == Wheel.id, "
            "Segment.parent_type == 'wheel')"
        ),
        order_by="Segment.position",
        cascade="all, delete-orphan",
        lazy="selectin",
        overlaps="segments",
    )
