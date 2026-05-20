"""rooms + participants + questions + segments + spins

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.create_table(
        "rooms",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(6), nullable=False),
        sa.Column(
            "host_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(80), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="lobby"),
        sa.Column("game_mode", sa.String(16), nullable=False, server_default="classic"),
        sa.Column("spin_policy", sa.String(16), nullable=False, server_default="host_only"),
        sa.Column("suggestion_policy", sa.String(16), nullable=False, server_default="off"),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_anonymous", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('lobby','active','closed')", name="ck_rooms_status",
        ),
        sa.CheckConstraint(
            "game_mode IN ('classic','elimination','punishment','chaos','rigged')",
            name="ck_rooms_game_mode",
        ),
        sa.CheckConstraint(
            "spin_policy IN ('host_only','anyone','turn_based')",
            name="ck_rooms_spin_policy",
        ),
        sa.CheckConstraint(
            "suggestion_policy IN ('off','approval','free')",
            name="ck_rooms_suggestion_policy",
        ),
    )
    op.create_index("ix_rooms_code", "rooms", ["code"], unique=True)
    op.create_index("ix_rooms_host_id", "rooms", ["host_id"])
    op.create_index("ix_rooms_status", "rooms", ["status"])

    op.create_table(
        "participants",
        sa.Column(
            "room_id",
            sa.Integer(),
            sa.ForeignKey("rooms.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("display_name", sa.String(64), nullable=True),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("kicked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('host','guest')", name="ck_participants_role",
        ),
    )

    op.create_table(
        "questions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "room_id",
            sa.Integer(),
            sa.ForeignKey("rooms.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_wheel_id", sa.Integer(), nullable=True),
        sa.Column("text", sa.String(120), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.true(),
        ),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "approved", sa.Boolean(), nullable=False, server_default=sa.true(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_questions_room_id", "questions", ["room_id"])
    op.create_index(
        "ix_questions_room_active", "questions", ["room_id", "is_active"],
    )

    op.create_table(
        "segments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("parent_id", sa.Integer(), nullable=False),
        sa.Column("parent_type", sa.String(16), nullable=False),
        sa.Column("label", sa.String(60), nullable=False),
        sa.Column("emoji", sa.String(16), nullable=True),
        sa.Column("color_seed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "parent_type IN ('wheel','question')",
            name="ck_segments_parent_type",
        ),
        sa.CheckConstraint(
            "color_seed >= 0 AND color_seed < 12", name="ck_segments_color_seed",
        ),
    )
    op.create_index(
        "ix_segments_parent", "segments", ["parent_type", "parent_id"],
    )

    op.create_table(
        "spins",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "question_id",
            sa.Integer(),
            sa.ForeignKey("questions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "triggered_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=False,
        ),
        sa.Column(
            "result_segment_id",
            sa.Integer(),
            sa.ForeignKey("segments.id", ondelete="SET NULL"),
            nullable=False,
        ),
        sa.Column("final_angle_deg", sa.Float(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column(
            "mode_state_snapshot", sa.JSON(), nullable=False, server_default="{}",
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_spins_question_id", "spins", ["question_id"])


def downgrade() -> None:
    op.drop_index("ix_spins_question_id", table_name="spins")
    op.drop_table("spins")
    op.drop_index("ix_segments_parent", table_name="segments")
    op.drop_table("segments")
    op.drop_index("ix_questions_room_active", table_name="questions")
    op.drop_index("ix_questions_room_id", table_name="questions")
    op.drop_table("questions")
    op.drop_table("participants")
    op.drop_index("ix_rooms_status", table_name="rooms")
    op.drop_index("ix_rooms_host_id", table_name="rooms")
    op.drop_index("ix_rooms_code", table_name="rooms")
    op.drop_table("rooms")
