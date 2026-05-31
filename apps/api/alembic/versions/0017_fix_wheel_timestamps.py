"""fix wheel-table timestamps (drop phantom updated_at)

Migrations 0015/0016 hand-wrote `created_at` + `updated_at` as NOT NULL
without a server default and added an `updated_at` column the ORM never
maps (`TimestampMixin` only has `created_at`). Result: every insert into
`wheels` / `wheel_likes` / `wheel_reports` hit `NOT NULL constraint failed`
(500 on save / like / report).

Fix: drop the phantom `updated_at` from the three tables. `created_at` is
now also populated ORM-side (Python `default` on `TimestampMixin`), so the
missing server default no longer matters. SQLite-safe via batch (tables are
empty in practice; the named FKs/uniques survive the rebuild).

Revision ID: 0017
Revises: 0016
Create Date: 2026-06-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("wheels", "wheel_likes", "wheel_reports")


def upgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_column("updated_at")


def downgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            )
