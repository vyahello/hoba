"""Room model — see spec §4."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from hoba_api.models._base import Base, TimestampMixin

if TYPE_CHECKING:
    from hoba_api.models.participant import Participant
    from hoba_api.models.question import Question
    from hoba_api.models.user import User

ROOM_STATUSES = ("lobby", "active", "closed")
GAME_MODES = ("classic", "elimination", "punishment", "chaos", "rigged")
SPIN_POLICIES = ("host_only", "anyone", "turn_based")
SUGGESTION_POLICIES = ("off", "approval", "free")


class Room(Base, TimestampMixin):
    __tablename__ = "rooms"
    __table_args__ = (
        CheckConstraint(
            f"status IN {ROOM_STATUSES!r}", name="ck_rooms_status",
        ),
        CheckConstraint(
            f"game_mode IN {GAME_MODES!r}", name="ck_rooms_game_mode",
        ),
        CheckConstraint(
            f"spin_policy IN {SPIN_POLICIES!r}", name="ck_rooms_spin_policy",
        ),
        CheckConstraint(
            f"suggestion_policy IN {SUGGESTION_POLICIES!r}",
            name="ck_rooms_suggestion_policy",
        ),
        Index("ix_rooms_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(6), nullable=False, unique=True, index=True)
    host_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    title: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(
        String(16), default="lobby", nullable=False, server_default="lobby",
    )
    game_mode: Mapped[str] = mapped_column(
        String(16), default="classic", nullable=False, server_default="classic",
    )
    spin_policy: Mapped[str] = mapped_column(
        String(16), default="anyone", nullable=False, server_default="anyone",
    )
    suggestion_policy: Mapped[str] = mapped_column(
        String(16), default="off", nullable=False, server_default="off",
    )
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    current_turn_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Punishment mode (spec §5.3). NULL/0 for other modes.
    punishment_deck: Mapped[str | None] = mapped_column(String(16))
    punishment_done_count: Mapped[int] = mapped_column(
        default=0, nullable=False, server_default="0",
    )
    # Pending card, room-shared (survives reconnects, gates spinning):
    # {"text", "deck", "victim_segment_id", "spin_id"} or NULL when none.
    # Deprecated: superseded by punishment_cards. Intentionally NOT dropped to
    # avoid a SQLite table-rebuild on the live DB; always NULL going forward.
    punishment_active_card: Mapped[dict[str, object] | None] = mapped_column(
        JSON, nullable=True,
    )
    # Punishment v3 BETS: {user_id(str): segment_id}. Each player's fixed bet,
    # placed before the game starts.
    punishment_predictions: Mapped[dict[str, int] | None] = mapped_column(
        JSON, nullable=True,
    )
    # Deprecated v2 columns (kept undropped for SQLite safety; always NULL now).
    punishment_cards: Mapped[dict[str, object] | None] = mapped_column(
        JSON, nullable=True,
    )
    punishment_result_segment_id: Mapped[int | None] = mapped_column(nullable=True)

    # Punishment v3 (turn-based personal-bet race). Reuses:
    #   punishment_predictions {uid: segment_id} = each player's fixed BET,
    #   spin_count = N matches needed to win, punishment_deck = dare deck.
    # New state below:
    #   match_counts {uid(str): int} — how many times each player's bet hit.
    #   winner_user_id — set when someone reaches N; game over.
    #   last_outcome — last spin result, shared to ALL players:
    #     {spinner_id, result_segment_id, kind: "lucky"|"punish",
    #      card: {text,deck,card_index}|None, resolved: bool}.
    #   While kind=="punish" and not resolved, the turn does NOT advance and
    #   spinning is blocked until the punished player resolves it.
    punishment_match_counts: Mapped[dict[str, int] | None] = mapped_column(
        JSON, nullable=True,
    )
    punishment_winner_user_id: Mapped[int | None] = mapped_column(nullable=True)
    punishment_last_outcome: Mapped[dict[str, object] | None] = mapped_column(
        JSON, nullable=True,
    )
    # Per-player count of dares performed (cumulative, not reset per game).
    punishment_done_counts: Mapped[dict[str, int] | None] = mapped_column(
        JSON, nullable=True,
    )
    # When True, each player must pick a unique segment before the game starts.
    punishment_unique_bets: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0",
    )

    # Best-of-N (Classic): number of MANUAL spin attempts per round.
    # 1 = single spin (current behavior).
    spin_count: Mapped[int] = mapped_column(
        default=1, nullable=False, server_default="1",
    )
    # Round progress for best-of-N. bon_winner_segment_id is set (and spinning
    # gated) once the round finalizes; host resets to start a new round.
    bon_attempts: Mapped[int] = mapped_column(
        default=0, nullable=False, server_default="0",
    )
    bon_tally: Mapped[dict[str, int] | None] = mapped_column(JSON, nullable=True)
    bon_winner_segment_id: Mapped[int | None] = mapped_column(nullable=True)
    # Round boundary: only spins with id > this count toward the current
    # round. Set to the latest spin id on "New round". Lets _emit_settled
    # recompute attempts/tally from the committed Spin rows (order-
    # independent) instead of incrementing shared counters across the
    # overlapping background settle tasks.
    bon_round_start_spin_id: Mapped[int | None] = mapped_column(nullable=True)

    # Rigged Mode 🎭 (spec §5.5): segment weights live in Segment.weight (fed
    # to compute_spin). For a rigged room the mode + weights are redacted to
    # non-host viewers (they see "classic" + uniform weights) UNTIL the host
    # reveals the rig, which flips this flag. Slice 1 keeps it False.
    rigged_revealed: Mapped[bool] = mapped_column(
        default=False, nullable=False, server_default="0",
    )
    # Count of spins taken while the room was rigged — surfaced in the reveal
    # ("the wheel was rigged for N spins"). Redacted to 0 for non-host viewers
    # until the reveal (a non-zero count would otherwise leak the rig).
    rigged_spin_count: Mapped[int] = mapped_column(
        default=0, nullable=False, server_default="0",
    )

    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    host: Mapped[User] = relationship(foreign_keys=[host_id], lazy="joined")
    participants: Mapped[list[Participant]] = relationship(
        back_populates="room",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    questions: Mapped[list[Question]] = relationship(
        back_populates="room",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


# placate `created_at` server-default ordering
_ = func.now
