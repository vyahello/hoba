"""add best-of-N round state to rooms

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-29

Round progress for best-of-N (manual attempts): attempts taken, per-round
tally, and the finalized winner. Uses op.add_column directly (not
batch_alter_table) per the 0004/0005 lesson in docs/deployment.md §9b.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("bon_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("rooms", sa.Column("bon_tally", sa.JSON(), nullable=True))
    op.add_column(
        "rooms", sa.Column("bon_winner_segment_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "bon_winner_segment_id")
    op.drop_column("rooms", "bon_tally")
    op.drop_column("rooms", "bon_attempts")
