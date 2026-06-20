"""punishment wild spins: rooms.punishment_wild_spins

"Шалені оберти" — a Punishment-only modifier that layers Chaos's chaotic
spin antics on top of the dare flow. Additive boolean with a server default
(plain `op.add_column`, SQLite-safe; no table rebuild).

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column(
            "punishment_wild_spins",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("rooms", "punishment_wild_spins")
