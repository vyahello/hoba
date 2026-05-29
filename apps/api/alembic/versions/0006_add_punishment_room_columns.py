"""add punishment columns to rooms

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-29

Three columns for Punishment mode (spec §5.3). Uses op.add_column directly
(not batch_alter_table) per the 0004/0005 lesson in docs/deployment.md §9b.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column(
        "rooms", sa.Column("punishment_deck", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "rooms",
        sa.Column(
            "punishment_done_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "rooms", sa.Column("punishment_active_card", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "punishment_active_card")
    op.drop_column("rooms", "punishment_done_count")
    op.drop_column("rooms", "punishment_deck")
