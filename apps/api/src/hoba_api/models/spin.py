"""Spin model — server-authoritative per spec §7."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from hoba_api.models._base import Base

if TYPE_CHECKING:
    from hoba_api.models.segment import Segment


class Spin(Base):
    __tablename__ = "spins"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    triggered_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=False,
    )
    result_segment_id: Mapped[int] = mapped_column(
        ForeignKey("segments.id", ondelete="SET NULL"), nullable=False,
    )
    final_angle_deg: Mapped[float] = mapped_column(Float, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    mode_state_snapshot: Mapped[dict[str, object]] = mapped_column(
        JSON, default=dict, nullable=False,
    )

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    result_segment: Mapped[Segment] = relationship(lazy="joined")
