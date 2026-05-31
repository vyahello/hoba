"""Input sanitization for user-supplied text (spec §14).

Applied at the service write boundary to every stored, user-facing string
(room/question/wheel titles, segment labels, report reasons). Pydantic
already bounds lengths at the schema edge; this is the content pass:

- NFKC-normalize (fold compatibility forms, width variants),
- drop control + format chars (Cc/Cf — includes zero-width + bidi tricks)
  and unassigned/surrogate/private-use code points,
- collapse internal whitespace runs to single spaces and trim.

Single-line by design: newlines/tabs become spaces. `max_length` is a
defensive truncation (post-normalize length can differ from the raw input).
"""

from __future__ import annotations

import re
import unicodedata

# Categories we strip entirely: control (Cc), format/zero-width (Cf),
# surrogate (Cs), private-use (Co), unassigned (Cn).
_STRIP_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co", "Cn"})
_WHITESPACE_RUN = re.compile(r"\s+")


def sanitize_text(value: str, *, max_length: int | None = None) -> str:
    """Clean one line of user text. Returns "" if nothing survives."""
    normalized = unicodedata.normalize("NFKC", value)
    # Drop control/format/zero-width chars, but keep real whitespace (\n, \t)
    # so word boundaries survive — the collapse below turns runs into spaces.
    cleaned = "".join(
        ch
        for ch in normalized
        if ch.isspace() or unicodedata.category(ch) not in _STRIP_CATEGORIES
    )
    collapsed = _WHITESPACE_RUN.sub(" ", cleaned).strip()
    if max_length is not None:
        collapsed = collapsed[:max_length]
    return collapsed
