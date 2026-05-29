"""Punishment deck integrity — 3 decks × 2 langs × 30 unique non-empty cards."""

from __future__ import annotations

import pytest

from hoba_api.modes.punishment_decks import (
    CARDS_PER_DECK,
    DECK_IDS,
    DECK_LANGS,
    DECKS,
    deck_cards,
)


@pytest.mark.parametrize("deck", DECK_IDS)
@pytest.mark.parametrize("lang", DECK_LANGS)
def test_each_deck_lang_has_30_unique_nonempty(deck: str, lang: str) -> None:
    cards = DECKS[deck][lang]
    assert len(cards) == CARDS_PER_DECK
    assert all(c.strip() for c in cards)
    assert len(set(cards)) == CARDS_PER_DECK


def test_deck_cards_helper_returns_cards() -> None:
    assert deck_cards("mild", "en")[0]
    assert len(deck_cards("spicy", "uk")) == CARDS_PER_DECK


def test_deck_cards_falls_back_for_unknown_deck_and_lang() -> None:
    assert deck_cards("mild", "fr") == DECKS["mild"]["en"]
    assert deck_cards("nonsense", "en") == DECKS["mild"]["en"]
