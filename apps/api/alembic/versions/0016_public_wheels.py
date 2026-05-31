"""public wheels: trending counters + likes/reports (Phase 10)

Adds social columns to `wheels` and creates the `wheel_likes` /
`wheel_reports` join tables. Columns are added with `op.add_column`
(no batch rebuild) and all FKs/constraints are named explicitly to keep
the SQLite path happy (see docs/deployment.md § 9b).

Revision ID: 0016
Revises: 0015
Create Date: 2026-05-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "wheels",
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "wheels",
        sa.Column("report_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "wheels",
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column(
        "wheels",
        sa.Column("category", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "wheels",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "wheel_likes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("wheel_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["wheel_id"], ["wheels.id"], name="fk_wheel_likes_wheel_id_wheels",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_wheel_likes_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("wheel_id", "user_id", name="uq_wheel_likes_wheel_user"),
    )
    op.create_index("ix_wheel_likes_wheel_id", "wheel_likes", ["wheel_id"])
    op.create_index("ix_wheel_likes_user_id", "wheel_likes", ["user_id"])

    op.create_table(
        "wheel_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("wheel_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["wheel_id"], ["wheels.id"], name="fk_wheel_reports_wheel_id_wheels",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_wheel_reports_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("wheel_id", "user_id", name="uq_wheel_reports_wheel_user"),
    )
    op.create_index("ix_wheel_reports_wheel_id", "wheel_reports", ["wheel_id"])
    op.create_index("ix_wheel_reports_user_id", "wheel_reports", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_wheel_reports_user_id", table_name="wheel_reports")
    op.drop_index("ix_wheel_reports_wheel_id", table_name="wheel_reports")
    op.drop_table("wheel_reports")
    op.drop_index("ix_wheel_likes_user_id", table_name="wheel_likes")
    op.drop_index("ix_wheel_likes_wheel_id", table_name="wheel_likes")
    op.drop_table("wheel_likes")
    op.drop_column("wheels", "published_at")
    op.drop_column("wheels", "category")
    op.drop_column("wheels", "is_hidden")
    op.drop_column("wheels", "report_count")
    op.drop_column("wheels", "like_count")
