"""SQLAlchemy ORM models.

Importing this package registers all models with `Base.metadata`. Phase 2
ships only the `User` model; later phases add Room, Wheel, Segment,
Question, Spin, Participant via their own migrations.
"""

from hoba_api.models._base import Base
from hoba_api.models.user import User

__all__ = ["Base", "User"]
