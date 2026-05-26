"""spin_policy default: host_only → anyone

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-26

Party-game default: any participant can spin. Existing rows keep
their current value; this migration only flips the column DEFAULT
that the DB applies to inserts that omit `spin_policy`.

SQLite can't `ALTER COLUMN ... SET DEFAULT` directly, so we go
through `batch_alter_table` which rebuilds the table preserving
data + constraints.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.alter_column(
            "spin_policy",
            existing_type=sa.String(16),
            existing_nullable=False,
            server_default="anyone",
            existing_server_default="host_only",
        )


def downgrade() -> None:
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.alter_column(
            "spin_policy",
            existing_type=sa.String(16),
            existing_nullable=False,
            server_default="host_only",
            existing_server_default="anyone",
        )
