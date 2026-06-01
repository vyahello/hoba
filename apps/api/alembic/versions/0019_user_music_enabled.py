"""user music preference: users.music_enabled

Background-music on/off, separate from SFX (`sound_enabled`). Additive
boolean with a server default (plain `op.add_column`, SQLite-safe; no
table rebuild).

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("music_enabled", sa.Boolean(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("users", "music_enabled")
