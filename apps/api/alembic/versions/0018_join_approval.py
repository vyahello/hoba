"""join approval: rooms.requires_approval + participants.approved

Spec §F11 extension — host approves who joins. Additive boolean columns
with server defaults (plain `op.add_column`, SQLite-safe; no rebuild).

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("requires_approval", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column(
        "participants",
        sa.Column("approved", sa.Boolean(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("participants", "approved")
    op.drop_column("rooms", "requires_approval")
