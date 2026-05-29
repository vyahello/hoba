"""add spin_count to rooms

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-29

Best-of-N spins (cross-mode). Default 1 = single spin. Uses op.add_column
directly (not batch_alter_table) per the 0004/0005 lesson in
docs/deployment.md §9b.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("spin_count", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("rooms", "spin_count")
