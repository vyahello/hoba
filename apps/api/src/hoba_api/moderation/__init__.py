"""Moderation utilities (spec §14) — profanity filter + public categories."""

from hoba_api.moderation.profanity import (
    contains_profanity,
    find_profanity,
    normalize,
)

# Allowed trending categories. A publish with anything else stores NULL.
CATEGORIES: tuple[str, ...] = (
    "food",
    "social",
    "fun",
    "party",
    "decide",
    "other",
)


def normalize_category(category: str | None) -> str | None:
    """Map an arbitrary category string to an allowed one, else None."""
    if category is None:
        return None
    c = category.strip().lower()
    return c if c in CATEGORIES else None


__all__ = [
    "CATEGORIES",
    "contains_profanity",
    "find_profanity",
    "normalize",
    "normalize_category",
]
