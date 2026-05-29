"""add bon_round_start_spin_id to rooms

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-29

Round boundary for best-of-N so _emit_settled can recompute attempts/tally
from the committed Spin rows (order-independent across the overlapping
background settle tasks) instead of incrementing shared counters. Uses
op.add_column directly per the 0004/0005 lesson in docs/deployment.md §9b.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("bon_round_start_spin_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "bon_round_start_spin_id")
