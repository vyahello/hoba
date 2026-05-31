"""SQLAlchemy ORM models — importing this package registers all tables."""

from hoba_api.models._base import Base
from hoba_api.models.participant import Participant
from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.models.spin import Spin
from hoba_api.models.user import User
from hoba_api.models.wheel import Wheel
from hoba_api.models.wheel_social import WheelLike, WheelReport

__all__ = [
    "Base",
    "Participant",
    "Question",
    "Room",
    "Segment",
    "Spin",
    "User",
    "Wheel",
    "WheelLike",
    "WheelReport",
]
