"""Solo-play bot for the Punishment / Chaos bet races.

When a host starts one of these turn-based race modes alone, the server
adds a single bot opponent so there's an actual race (otherwise you just
spin until your own bet comes up N times — no tension). The bot:

  * locks a unique bet at game start (`maybe_add_bot`),
  * takes its turns via server-driven spins (`realtime.handlers`),
  * plays fair — its spins use the same true-random odds as the human,
  * never performs dares (a bot doing a dare is meaningless): in
    Punishment a bot miss is a no-op, exactly like a Chaos miss.

The bot is NOT a `User`/`Participant` row — it lives entirely in the
existing JSON race maps (`punishment_predictions`, `punishment_match_counts`)
and the turn cursor, keyed by a reserved sentinel id. `build_room_state`
injects a synthetic participant for it so it shows up in the standings.
"""

from __future__ import annotations

# Reserved "user id" for the bot. Negative so it can never collide with a
# real `users.id` (positive autoincrement); distinct from the turn-cursor
# `None`/host sentinels used elsewhere.
BOT_USER_ID = -1000

# Fun names, one slot per index so EN/UK stay the "same" bot per room.
_BOT_NAMES_EN = (
    "Spinbot", "Sir Spins-a-Lot", "Lucky Pixel", "Captain Chance",
    "Wheelbot 3000", "Dizzy", "The Gambler", "Roulette Randy",
)
_BOT_NAMES_UK = (
    "Крутибот", "Пан Спін", "Щасливчик", "Капітан Фортуна",
    "Колесо-3000", "Дзиґа", "Азартний Тарас", "Лудоман",
)


def bot_display_name(room_id: int, lang: str) -> str:
    """A stable-per-room, localized bot name (so every client agrees)."""
    names = _BOT_NAMES_UK if lang == "uk" else _BOT_NAMES_EN
    return names[room_id % len(names)]
