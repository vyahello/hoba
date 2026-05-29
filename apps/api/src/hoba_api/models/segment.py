"""Segment model — polymorphic on `parent_type` (wheel | question)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from hoba_api.models._base import Base, TimestampMixin

SEGMENT_PARENT_TYPES = ("wheel", "question")


class Segment(Base, TimestampMixin):
    __tablename__ = "segments"
    __table_args__ = (
        CheckConstraint(
            f"parent_type IN {SEGMENT_PARENT_TYPES!r}",
            name="ck_segments_parent_type",
        ),
        CheckConstraint(
            "color_seed >= 0 AND color_seed < 12",
            name="ck_segments_color_seed",
        ),
        Index("ix_segments_parent", "parent_type", "parent_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Polymorphic — no FK because the parent table varies (`questions` or
    # `wheels`). Services own integrity.
    parent_id: Mapped[int] = mapped_column(nullable=False)
    parent_type: Mapped[str] = mapped_column(String(16), nullable=False)

    label: Mapped[str] = mapped_column(String(60), nullable=False)
    emoji: Mapped[str | None] = mapped_column(String(16))
    color_seed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    weight: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Set when this segment is eliminated (Elimination mode, spec §5.2).
    # NULL = living. Other modes never write it.
    eliminated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    @property
    def is_eliminated(self) -> bool:
        return self.eliminated_at is not None
