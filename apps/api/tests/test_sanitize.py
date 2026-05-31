"""Input sanitization (spec §14)."""

from __future__ import annotations

from hoba_api.sanitize import sanitize_text


def test_strips_zero_width_and_control() -> None:
    # Zero-width space + zero-width joiner + a bidi override smuggled in.
    dirty = "Pi​zz‍a‮!"
    assert sanitize_text(dirty) == "Pizza!"


def test_collapses_whitespace_and_newlines() -> None:
    assert sanitize_text("  hello\n\tthere   world  ") == "hello there world"


def test_nfkc_normalizes_compatibility_forms() -> None:
    # Fullwidth latin → ASCII under NFKC.
    assert sanitize_text("Ｈｏｂａ") == "Hoba"


def test_truncates_to_max_length() -> None:
    assert sanitize_text("x" * 50, max_length=10) == "x" * 10


def test_all_garbage_becomes_empty() -> None:
    assert sanitize_text("​‌‍﻿") == ""


def test_preserves_emoji_and_cyrillic() -> None:
    assert sanitize_text("Піца 🍕") == "Піца 🍕"
