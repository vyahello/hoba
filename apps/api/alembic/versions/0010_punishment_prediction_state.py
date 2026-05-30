"""punishment prediction-wager round state

Adds prediction-wager round state to rooms. Uses op.add_column only (no
batch_alter_table) per the 0004/0005 FK-naming lesson. The deprecated
punishment_active_card column is intentionally NOT dropped: dropping a column on
SQLite forces a batch table-rebuild which already corrupted a live migration
once (docs/deployment.md). It is left always-NULL, superseded by
punishment_cards.

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-30

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("punishment_predictions", sa.JSON(), nullable=True),
    )
    op.add_column("rooms", sa.Column("punishment_cards", sa.JSON(), nullable=True))
    op.add_column(
        "rooms",
        sa.Column("punishment_result_segment_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "punishment_result_segment_id")
    op.drop_column("rooms", "punishment_cards")
    op.drop_column("rooms", "punishment_predictions")
