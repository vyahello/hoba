"""rigged mode: rigged_spin_count

Additive column only (safe SQLite path):
- rigged_spin_count  Integer  spins taken while rigged (shown in the reveal).

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column(
            "rigged_spin_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("rooms", "rigged_spin_count")
