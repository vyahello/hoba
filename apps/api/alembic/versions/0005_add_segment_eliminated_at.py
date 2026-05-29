"""add eliminated_at to segments

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-29

Nullable timestamp for Elimination mode (spec §5.2). NULL = living.
Uses op.add_column directly (not batch_alter_table) per the 0004 lesson
in docs/deployment.md §9b.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column(
        "segments",
        sa.Column("eliminated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("segments", "eliminated_at")
