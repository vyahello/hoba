"""The built-in template catalog — 8 curated, localized decision wheels.

Source of truth for the Home screen's "Quick decide" set. Each template
carries both locales' strings; the API resolves to one locale per request
(`?locale=`). Colours come from the shared 12-entry wheel palette via
`color_seed`; gradients are brand-palette hex pairs for the card art.

Keep this in sync with the curated copy — the six original presets were
hand-tuned with the owner; the last two (`drink`, `game`) round the set
out to the spec's "8+ built-in templates".
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

SUPPORTED_LOCALES: tuple[str, ...] = ("en", "uk")
DEFAULT_LOCALE = "en"


@dataclass(frozen=True, slots=True)
class TemplateSegmentDef:
    """One wheel option with per-locale labels."""

    key: str
    label: Mapping[str, str]
    color_seed: int
    emoji: str | None = None


@dataclass(frozen=True, slots=True)
class TemplateDef:
    """A built-in wheel: localized title + segments + card art."""

    key: str
    category: str
    emoji: str
    gradient: tuple[str, str]
    title: Mapping[str, str]
    segments: tuple[TemplateSegmentDef, ...]


def _loc(en: str, uk: str) -> Mapping[str, str]:
    # Frozen so a template definition can't be mutated at runtime.
    return MappingProxyType({"en": en, "uk": uk})


def resolve_locale(locale: str | None) -> str:
    """Map an arbitrary locale string to a supported one (default EN)."""
    if locale is None:
        return DEFAULT_LOCALE
    short = locale.strip().lower().split("-", 1)[0]
    return short if short in SUPPORTED_LOCALES else DEFAULT_LOCALE


_TEMPLATES: tuple[TemplateDef, ...] = (
    TemplateDef(
        key="eat",
        category="food",
        emoji="🍕",
        gradient=("#FFB84D", "#FF5C9C"),
        title=_loc("Where to eat?", "Що поїсти?"),
        segments=(
            TemplateSegmentDef("pizza", _loc("Pizza", "Піца"), 0, "🍕"),
            TemplateSegmentDef("sushi", _loc("Sushi", "Суші"), 1, "🍣"),
            TemplateSegmentDef("burger", _loc("Burger", "Бургер"), 2, "🍔"),
            TemplateSegmentDef("tacos", _loc("Tacos", "Тако"), 3, "🌮"),
            TemplateSegmentDef("ramen", _loc("Ramen", "Рамен"), 4, "🍜"),
            TemplateSegmentDef("shawarma", _loc("Shawarma", "Шаурма"), 5, "🌯"),
        ),
    ),
    TemplateDef(
        key="pays",
        category="social",
        emoji="💸",
        gradient=("#22C55E", "#5CE5FF"),
        title=_loc("Who pays?", "Хто платить?"),
        segments=(
            TemplateSegmentDef("you", _loc("You", "Ти"), 0, "🫵"),
            TemplateSegmentDef("me", _loc("Me", "Я"), 2, "😎"),
            TemplateSegmentDef("split", _loc("Split it", "Навпіл"), 4, "🤝"),
            TemplateSegmentDef("guys", _loc("Rock-paper-scissors", "Чувачі"), 6, "✊"),
            TemplateSegmentDef("next_time", _loc("Next time", "Наступного разу"), 9, "🔜"),
        ),
    ),
    TemplateDef(
        key="watch",
        category="fun",
        emoji="🎬",
        gradient=("#7C5CFF", "#FF5C9C"),
        title=_loc("What to watch?", "Що подивитись?"),
        segments=(
            TemplateSegmentDef("superhero", _loc("Superhero", "Супергерої"), 0, "🦸"),
            TemplateSegmentDef("crime", _loc("Crime", "Крайм"), 1, "🔪"),
            TemplateSegmentDef("comedy", _loc("Comedy", "Комедія"), 2, "😂"),
            TemplateSegmentDef("scifi", _loc("Sci-fi", "Sci-fi"), 3, "🚀"),
            TemplateSegmentDef("romance", _loc("Romance", "Романтік"), 4, "💘"),
            TemplateSegmentDef("horror", _loc("Horror", "Жахи"), 5, "👻"),
        ),
    ),
    TemplateDef(
        key="truth_dare",
        category="party",
        emoji="😈",
        gradient=("#FF3B6B", "#7C5CFF"),
        title=_loc("Truth or Dare", "Правда чи дія"),
        segments=(
            TemplateSegmentDef("truth", _loc("Truth", "Правда"), 6, "💬"),
            TemplateSegmentDef("dare", _loc("Dare", "Дія"), 10, "🔥"),
            TemplateSegmentDef("spicy_truth", _loc("Spicy truth", "Гостра правда"), 3, "🌶️"),
            TemplateSegmentDef("double_dare", _loc("Double dare", "Подвійна дія"), 4, "😈"),
        ),
    ),
    TemplateDef(
        key="yes_no",
        category="decide",
        emoji="✅",
        gradient=("#5CE5FF", "#7C5CFF"),
        title=_loc("Yes or No", "Так чи ні?"),
        segments=(
            TemplateSegmentDef("yes", _loc("Yes", "Так"), 4, "✅"),
            TemplateSegmentDef("no", _loc("No", "Ні"), 10, "❌"),
            TemplateSegmentDef("hell_yes", _loc("Hell yes", "Звісно так"), 0, "🔥"),
            TemplateSegmentDef("no_way", _loc("No way", "Та нізащо"), 7, "🙅"),
        ),
    ),
    TemplateDef(
        key="friday",
        category="social",
        emoji="🍻",
        gradient=("#FFB84D", "#FF9F1C"),
        title=_loc("Friday plans", "Плани на п'ятницю"),
        segments=(
            TemplateSegmentDef("rooftop", _loc("Rooftop drinks", "Бар на даху"), 0, "🌆"),
            TemplateSegmentDef("ps5", _loc("PS5", "PS5"), 1, "🎮"),
            TemplateSegmentDef("walk", _loc("Walk", "Прогулянка"), 2, "🚶"),
            TemplateSegmentDef("trip", _loc("Trip", "Поїздка"), 3, "🚗"),
            TemplateSegmentDef("party", _loc("Party", "Вечірка"), 5, "🎉"),
            TemplateSegmentDef("midnight_snack", _loc("Midnight snack run", "Нічний жор"), 7, "🍟"),
        ),
    ),
    TemplateDef(
        key="drink",
        category="food",
        emoji="🍹",
        gradient=("#FF5C9C", "#FFB84D"),
        title=_loc("What to drink?", "Що пити?"),
        segments=(
            TemplateSegmentDef("beer", _loc("Beer", "Пиво"), 0, "🍺"),
            TemplateSegmentDef("wine", _loc("Wine", "Вино"), 2, "🍷"),
            TemplateSegmentDef("cocktail", _loc("Cocktail", "Коктейль"), 4, "🍸"),
            TemplateSegmentDef("coffee", _loc("Coffee", "Кава"), 6, "☕"),
            TemplateSegmentDef("tea", _loc("Tea", "Чай"), 8, "🍵"),
            TemplateSegmentDef("shot", _loc("Shot", "Шот"), 10, "🥃"),
        ),
    ),
    TemplateDef(
        key="game",
        category="party",
        emoji="🎲",
        gradient=("#5CE5FF", "#22C55E"),
        title=_loc("Which game?", "У що граємо?"),
        segments=(
            TemplateSegmentDef("poker", _loc("Poker", "Покер"), 0, "🃏"),
            TemplateSegmentDef("fifa", _loc("FIFA", "FIFA"), 1, "⚽"),
            TemplateSegmentDef("mafia", _loc("Mafia", "Мафія"), 3, "🕵️"),
            TemplateSegmentDef("cards", _loc("Cards", "Карти"), 5, "🂡"),
            TemplateSegmentDef("board", _loc("Board game", "Настолка"), 7, "🎲"),
            TemplateSegmentDef("video", _loc("Video game", "Відеогра"), 9, "🎮"),
        ),
    ),
)

# Keyed lookup, built once. The tuple above preserves Home display order.
_BY_KEY: Mapping[str, TemplateDef] = MappingProxyType({t.key: t for t in _TEMPLATES})


def list_templates() -> tuple[TemplateDef, ...]:
    """All templates in Home display order."""
    return _TEMPLATES


def get_template(key: str) -> TemplateDef | None:
    """Look up a template by its stable key, or None if unknown."""
    return _BY_KEY.get(key)
