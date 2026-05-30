"""punishment v4: per-player done counts + unique-bets flag

Additive columns only (safe SQLite path):
- punishment_done_counts  JSON nullable  per-player count of dares performed
- punishment_unique_bets  Boolean        when True, each player must pick a
                                          different segment before the game

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("punishment_done_counts", sa.JSON(), nullable=True),
    )
    op.add_column(
        "rooms",
        sa.Column(
            "punishment_unique_bets",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("rooms", "punishment_unique_bets")
    op.drop_column("rooms", "punishment_done_counts")
