"""Question model — active in-room wheel state per spec §4."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from hoba_api.models._base import Base, TimestampMixin

if TYPE_CHECKING:
    from hoba_api.models.room import Room
    from hoba_api.models.segment import Segment


class Question(Base, TimestampMixin):
    __tablename__ = "questions"
    __table_args__ = (
        # Application-level constraint: at most one is_active=True per room.
        # Enforced in services/questions.py; SQLite partial indexes are
        # supported, but for portability we rely on service-layer guard.
        Index("ix_questions_room_active", "room_id", "is_active"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # `source_wheel_id` will FK into the `wheels` table when Phase 9 lands;
    # for now it's a free-form bigint or NULL.
    source_wheel_id: Mapped[int | None] = mapped_column(default=None)
    text: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    approved: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    room: Mapped[Room] = relationship(back_populates="questions")
    segments: Mapped[list[Segment]] = relationship(
        primaryjoin=(
            "and_(foreign(Segment.parent_id) == Question.id, "
            "Segment.parent_type == 'question')"
        ),
        order_by="Segment.position",
        cascade="all, delete-orphan",
        lazy="selectin",
        overlaps="segments",
    )
