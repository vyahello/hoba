"""punishment v3 turn-based personal-bet race state

Additive columns for Punishment v3 (each player bets a segment, spins in turn,
first to N matches wins; a miss = a dare). Uses op.add_column only (no
batch_alter_table) per the 0004/0005 FK-naming lesson — additive nullable
columns are the safe SQLite path. Reuses punishment_predictions (bets) and
spin_count (N) from earlier migrations.

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-30

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("punishment_match_counts", sa.JSON(), nullable=True),
    )
    op.add_column(
        "rooms",
        sa.Column("punishment_winner_user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "rooms",
        sa.Column("punishment_last_outcome", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "punishment_last_outcome")
    op.drop_column("rooms", "punishment_winner_user_id")
    op.drop_column("rooms", "punishment_match_counts")
