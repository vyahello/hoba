"""Participant model — composite PK (room_id, user_id) per spec §4."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from hoba_api.models._base import Base

if TYPE_CHECKING:
    from hoba_api.models.room import Room
    from hoba_api.models.user import User

PARTICIPANT_ROLES = ("host", "guest")


class Participant(Base):
    __tablename__ = "participants"
    __table_args__ = (
        CheckConstraint(
            f"role IN {PARTICIPANT_ROLES!r}", name="ck_participants_role",
        ),
    )

    room_id: Mapped[int] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(64))
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    kicked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Join-approval (spec §F11 extension): in a `requires_approval` room a
    # guest starts unapproved (pending) until the host approves; existing +
    # host participants are always approved.
    approved: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False,
    )

    room: Mapped[Room] = relationship(back_populates="participants")
    user: Mapped[User] = relationship(lazy="joined")
