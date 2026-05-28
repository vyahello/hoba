"""add current_turn_user_id to rooms

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-28

Adds a nullable cursor used only by the `turn_based` spin policy.
Existing rows stay NULL; rooms with policy != turn_based ignore it.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.add_column(
            sa.Column(
                "current_turn_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.drop_column("current_turn_user_id")
