"""rigged mode: rigged_revealed flag

Additive column only (safe SQLite path):
- rigged_revealed  Boolean  False until the host reveals the rig (spec §5.5).
  Rig weights themselves live in the existing segments.weight column.

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column(
            "rigged_revealed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("rooms", "rigged_revealed")
