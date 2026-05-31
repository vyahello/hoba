"""saved wheels library (spec §8 / F10)

Creates the `wheels` table. A wheel's options are Segment rows with
parent_type="wheel" (no schema change to segments needed). FK is named
explicitly so the SQLite path stays happy (see docs/deployment.md § 9b).

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "wheels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name="fk_wheels_owner_id_users",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_wheels_owner_id", "wheels", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_wheels_owner_id", table_name="wheels")
    op.drop_table("wheels")
