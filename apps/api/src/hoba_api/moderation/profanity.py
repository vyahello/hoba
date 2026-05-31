"""Profanity filter for public-facing strings (spec §14).

Scope: EN + UK + transliterated Russian, applied to public wheel titles
and segment labels (and reusable for room titles). This is a curated
deny-list, not an exhaustive one — it exists to keep the trending feed
from obvious abuse, with the report flow as the backstop for the rest.

Matching is normalization-first: NFKC, lowercase, zero-width strip, and a
small leet map (0→o, 1→i, 3→e, 4→a, @→a, $→s, 5→s), then a word-root
substring scan on the de-spaced string so "f u c k" and "f.u.c.k" are
caught. Roots are chosen to minimize the Scunthorpe problem; add with care.
"""

from __future__ import annotations

import re
import unicodedata

# Zero-width + bidi control characters often used to smuggle text past filters.
_ZERO_WIDTH = dict.fromkeys(
    [0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x2060, 0xFEFF],
)
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "@": "a", "$": "s", "5": "s"})
_NON_ALNUM = re.compile(r"[^a-z0-9а-яіїєґ]+")

# Word roots (already normalized). Kept deliberately short + high-signal.
_PROFANITY_ROOTS: frozenset[str] = frozenset(
    {
        # EN
        "fuck",
        "shit",
        "bitch",
        "cunt",
        "asshole",
        "dick",
        "pussy",
        "nigger",
        "faggot",
        "retard",
        "whore",
        "slut",
        # UK
        "хуй",
        "хуя",
        "пизд",
        "бляд",
        "блять",
        "сука",
        "залупа",
        "єбан",
        "їбан",
        "довбойоб",
        "мудак",
        "гандон",
        # transliterated RU / mixed
        "blyad",
        "suka",
        "pizda",
        "huy",
        "ebal",
        "mudak",
        "gandon",
    },
)


def normalize(text: str) -> str:
    """NFKC + lowercase + strip zero-width + leet-fold + drop non-alphanumerics."""
    folded = unicodedata.normalize("NFKC", text).translate(_ZERO_WIDTH)
    folded = folded.lower().translate(_LEET)
    # Collapse everything that isn't a letter/digit so spacing tricks fail.
    return _NON_ALNUM.sub("", folded)


def find_profanity(*texts: str) -> str | None:
    """Return the first matched root across all inputs, or None if clean."""
    for text in texts:
        collapsed = normalize(text)
        for root in _PROFANITY_ROOTS:
            if root in collapsed:
                return root
    return None


def contains_profanity(*texts: str) -> bool:
    """True if any input contains a denied root after normalization."""
    return find_profanity(*texts) is not None
