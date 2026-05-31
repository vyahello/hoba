"""Anonymous-mode nickname generator (spec §14).

When a room is in anonymous mode, real Telegram names are replaced with a
deterministic adjective+animal nickname like "Spicy Falcon" / "Гострий
Сокіл". Deterministic per `(room_id, user_id)` so a player keeps the same
alias for the life of the room, and localized to the *viewer's* language
(the snapshot is built per-request, so each viewer reads names in their
own locale).
"""

from __future__ import annotations

_ADJECTIVES: dict[str, tuple[str, ...]] = {
    "en": (
        "Spicy", "Sneaky", "Brave", "Lucky", "Mighty", "Sly", "Jolly",
        "Fuzzy", "Royal", "Cosmic", "Turbo", "Velvet", "Wild", "Golden",
        "Mellow", "Zesty",
    ),
    "uk": (
        "Гострий", "Хитрий", "Хоробрий", "Щасливий", "Могутній", "Спритний",
        "Веселий", "Пухнастий", "Королівський", "Космічний", "Турбо",
        "Оксамитовий", "Дикий", "Золотий", "Лагідний", "Пряний",
    ),
}

_ANIMALS: dict[str, tuple[str, ...]] = {
    "en": (
        "Falcon", "Otter", "Panda", "Fox", "Lynx", "Badger", "Heron",
        "Wolf", "Raccoon", "Owl", "Bison", "Hare", "Mole", "Stoat",
        "Marten", "Beaver",
    ),
    "uk": (
        "Сокіл", "Видра", "Панда", "Лис", "Рись", "Борсук", "Чапля",
        "Вовк", "Єнот", "Сова", "Зубр", "Заєць", "Кріт", "Горностай",
        "Куниця", "Бобер",
    ),
}

DEFAULT_LANG = "en"


def generate_nickname(room_id: int, user_id: int, lang: str) -> str:
    """Stable per-(room, user) alias, localized to `lang` (falls back to EN)."""
    locale = lang if lang in _ADJECTIVES else DEFAULT_LANG
    adjectives = _ADJECTIVES[locale]
    animals = _ANIMALS[locale]
    # Mix the two ids so the same user differs across rooms, and pick the
    # adjective and animal from independent slices of the seed.
    seed = room_id * 73 + user_id * 5197
    adjective = adjectives[seed % len(adjectives)]
    animal = animals[(seed // len(adjectives)) % len(animals)]
    return f"{adjective} {animal}"
