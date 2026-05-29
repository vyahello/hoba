# Punishment Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Punishment mode (spec §5.3) — after each spin the wheel-selected segment is the victim and the server deals a punishment card (dare) from the host-chosen deck (mild/spicy/chaos), drawn without replacement, with a room-wide "done" tally and spin blocked until the current card is resolved.

**Architecture:** Reuses the `GameModeEngine` abstraction from the Elimination slice. The card deck lives server-side (180 cards). `trigger_spin` owns the draw + the spin-gate + sets the room's pending-card atomically; `_emit_settled` surfaces the card via `mode_aftereffects` and a `room:updated` patch so every client snapshot carries it; a `punishment:done` WS event (any participant) clears the card and bumps the tally. Frontend renders a deck sub-picker, a non-auto-dismiss card overlay with a "Done" button, a tally, and disables the wheel hub while a card is pending.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2 async / Alembic / python-socketio / pytest (backend); React 18 / TS / Zustand / react-i18next / Framer Motion / Vitest (frontend).

**Reference spec:** `docs/superpowers/specs/2026-05-29-punishment-mode-design.md`.

**Data-flow decisions (locked):**
- `trigger_spin` (punishment): guard `card_pending` → draw index from pool (prior spins' snapshots; reshuffle when 30 exhausted) → record `{deck,lang,card_index}` in `spin.mode_state_snapshot["punishment"]` → set `room.punishment_active_card = {text, deck, victim_segment_id, spin_id}`.
- `_emit_settled`: read `room.punishment_active_card`; if present, add to `mode_aftereffects` AND broadcast `room:updated {patch:{punishment_active_card, punishment_done_count}}`.
- `punishment:done` (any participant): clear `punishment_active_card`, `punishment_done_count += 1`, broadcast `room:updated` patch + `punishment:cleared`.
- Card text bypasses `t()` (server-authored content, like segment labels).

**Quality gates (before done):** `cd apps/api && uv run --extra dev pytest -q && uv run --extra dev mypy --strict src && uv run --extra dev ruff check src tests`; `cd apps/webapp && pnpm vitest run && pnpm tsc --noEmit && pnpm run lint`; `cd /home/kali/hoba && node scripts/i18n-check.mjs`.

---

## File Structure

**Backend (create):**
- `apps/api/src/hoba_api/modes/punishment_decks.py` — 180 cards + `deck_cards()`.
- `apps/api/src/hoba_api/modes/punishment.py` — `PunishmentEngine`.
- `apps/api/alembic/versions/0006_add_punishment_room_columns.py`.
- `apps/api/tests/modes/test_punishment_decks.py`, `tests/modes/test_punishment_engine.py`.

**Backend (modify):**
- `apps/api/src/hoba_api/models/room.py` — 3 columns.
- `apps/api/src/hoba_api/schemas/room.py` — `RoomOut` + `RoomCreateIn` + `RoomUpdateIn`.
- `apps/api/src/hoba_api/services/rooms.py` — `create_room`/`update_room` deck.
- `apps/api/src/hoba_api/modes/registry.py` — register punishment.
- `apps/api/src/hoba_api/services/spins.py` — draw helpers + `trigger_spin`.
- `apps/api/src/hoba_api/realtime/handlers.py` — `_emit_settled` + `punishment:done`.
- tests: `tests/services/test_spins.py`, `tests/realtime/test_handlers.py`, `tests/api/test_rooms.py`.

**Frontend (create):**
- `apps/webapp/src/features/rooms/punishment.ts` + `__tests__/punishment.test.ts`.

**Frontend (modify):**
- `apps/webapp/src/lib/api.ts`, `src/data/gameModes.ts`,
  `src/components/room/RoomModePickerSheet.tsx`, `src/pages/SpinPage.tsx`,
  `src/stores/room.ts`, `src/pages/RoomPage.tsx`,
  `src/locales/en/room.json`, `src/locales/uk/room.json`.

**Docs:** `docs/game-modes.md`, `CLAUDE.md`.

---

## Task 1: Punishment deck data module + integrity test

**Files:**
- Create: `apps/api/src/hoba_api/modes/punishment_decks.py`
- Test: `apps/api/tests/modes/test_punishment_decks.py`

- [ ] **Step 1: Write the failing test**

```python
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


def test_deck_cards_helper_returns_list() -> None:
    assert deck_cards("mild", "en")[0]
    assert len(deck_cards("spicy", "uk")) == CARDS_PER_DECK


def test_deck_cards_falls_back_for_unknown_deck_and_lang() -> None:
    # Unknown lang → en; unknown deck → mild. Never raises.
    assert deck_cards("mild", "fr") == DECKS["mild"]["en"]
    assert deck_cards("nonsense", "en") == DECKS["mild"]["en"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run --extra dev pytest tests/modes/test_punishment_decks.py --no-cov -q`
Expected: FAIL — `ModuleNotFoundError: hoba_api.modes.punishment_decks`.

- [ ] **Step 3: Create `apps/api/src/hoba_api/modes/punishment_decks.py`**

Structure (fill EACH list to exactly 30 unique, non-empty, native-language cards — the samples below are tone anchors; complete to 30 following the tone ladder. Owner will tune; the integrity test in Step 1 is the hard gate):

```python
"""Bundled punishment decks (spec §5.3). Server-authoritative — never sent
to the client; only the dealt card text crosses the wire.

Tone ladder:
- mild  — silly, all-ages party dares.
- spicy — bolder adult-party dares (flirty/embarrassing, tasteful;
          no explicit NSFW, nothing unsafe or non-consensual).
- chaos — absurd wildcard dares.

Cards are written natively per language (spec §6), NOT translated, so the
en/uk lists do not need to align by index.
"""
from __future__ import annotations

import structlog

log = structlog.get_logger("hoba_api.modes.punishment_decks")

DECK_IDS = ("mild", "spicy", "chaos")
DECK_LANGS = ("en", "uk")
CARDS_PER_DECK = 30

DECKS: dict[str, dict[str, list[str]]] = {
    "mild": {
        "en": [
            "Speak in a robot voice until your next turn.",
            "Do your best impression of someone in the room.",
            "Sing the chorus of any song right now.",
            "Talk in rhymes until your next turn.",
            "Do 10 jumping jacks.",
            "Tell an embarrassing childhood story.",
            # … complete to exactly 30 …
        ],
        "uk": [
            "Говори голосом робота до свого наступного ходу.",
            "Зобрази когось із присутніх у кімнаті.",
            "Заспівай приспів будь-якої пісні просто зараз.",
            "Говори лише римами до наступного ходу.",
            "Зроби 10 стрибків «джампінг-джек».",
            "Розкажи незручну історію з дитинства.",
            # … complete to exactly 30 …
        ],
    },
    "spicy": {
        "en": [
            "Let the group pick your profile photo for a day.",
            "Text the 3rd person in your chats 'I was just thinking about you'.",
            "Reveal the last thing you searched on your phone.",
            # … complete to exactly 30 …
        ],
        "uk": [
            "Дозволь групі обрати тобі фото профілю на день.",
            "Напиши третьому контакту в чатах: «Я щойно про тебе думав(-ла)».",
            "Покажи, що ти востаннє шукав(-ла) у телефоні.",
            # … complete to exactly 30 …
        ],
    },
    "chaos": {
        "en": [
            "Swap one item of clothing with the player on your left.",
            "Everyone changes seats; you sit last.",
            "Talk only in questions until your next turn.",
            # … complete to exactly 30 …
        ],
        "uk": [
            "Поміняйся одним предметом одягу з гравцем ліворуч.",
            "Усі міняються місцями; ти сідаєш останнім.",
            "Говори лише запитаннями до свого наступного ходу.",
            # … complete to exactly 30 …
        ],
    },
}


def deck_cards(deck: str, lang: str) -> list[str]:
    """Cards for deck+lang. Falls back: unknown lang → 'en', unknown
    deck → 'mild'. Logs the fallback; never raises (no silent failure)."""
    d = deck if deck in DECKS else "mild"
    if d != deck:
        log.warning("punishment.unknown_deck", requested=deck)
    langs = DECKS[d]
    if lang in langs:
        return langs[lang]
    log.warning("punishment.unknown_lang", requested=lang, deck=d)
    return langs["en"]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run --extra dev pytest tests/modes/test_punishment_decks.py --no-cov -q`
Expected: PASS (all parametrized cases). If a list isn't exactly 30 unique non-empty, the test fails — complete the lists.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/hoba_api/modes/punishment_decks.py apps/api/tests/modes/test_punishment_decks.py
git commit -m "feat(api): punishment decks (mild/spicy/chaos, 180 cards)"
```

---

## Task 2: Room columns + Alembic 0006

**Files:**
- Modify: `apps/api/src/hoba_api/models/room.py`
- Create: `apps/api/alembic/versions/0006_add_punishment_room_columns.py`
- Test: `apps/api/tests/services/test_rooms.py` (extend)

- [ ] **Step 1: Write the failing test** — append to `tests/services/test_rooms.py`

```python
async def test_create_room_punishment_defaults_deck_to_mild(db) -> None:  # type: ignore[no-untyped-def]
    from hoba_api.services.rooms import SegmentDraft, create_room
    from hoba_api.services.users import upsert_from_telegram
    from hoba_api.auth.initdata import TelegramUser

    host = await upsert_from_telegram(db, TelegramUser(id=7700, first_name="H"))
    await db.flush()
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        game_mode="punishment",
    )
    assert room.punishment_deck == "mild"
    assert room.punishment_done_count == 0
    assert room.punishment_active_card is None
```

(Check the test module's existing imports/fixtures; reuse them rather than re-importing if already present.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run --extra dev pytest tests/services/test_rooms.py::test_create_room_punishment_defaults_deck_to_mild --no-cov -q`
Expected: FAIL — `AttributeError: punishment_deck` (and `create_room` doesn't set it yet — Task 3).

- [ ] **Step 3: Add columns to `apps/api/src/hoba_api/models/room.py`**

Add `JSON` to the sqlalchemy import block:
```python
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    JSON,
    String,
    func,
)
```
Add after the `current_turn_user_id` column:
```python
    # Punishment mode (spec §5.3). NULL/0 for other modes.
    punishment_deck: Mapped[str | None] = mapped_column(String(16))
    punishment_done_count: Mapped[int] = mapped_column(
        default=0, nullable=False, server_default="0",
    )
    # Pending card, room-shared (survives reconnects, gates spinning):
    # {"text": str, "deck": str, "victim_segment_id": int, "spin_id": int}
    # or NULL when no card is pending.
    punishment_active_card: Mapped[dict[str, object] | None] = mapped_column(
        JSON, nullable=True,
    )
```

- [ ] **Step 4: Create `apps/api/alembic/versions/0006_add_punishment_room_columns.py`**

```python
"""add punishment columns to rooms

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-29

Three columns for Punishment mode (spec §5.3). Uses op.add_column directly
(not batch_alter_table) per the 0004/0005 lesson in docs/deployment.md §9b.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column("rooms", sa.Column("punishment_deck", sa.String(length=16), nullable=True))
    op.add_column(
        "rooms",
        sa.Column("punishment_done_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("rooms", sa.Column("punishment_active_card", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("rooms", "punishment_active_card")
    op.drop_column("rooms", "punishment_done_count")
    op.drop_column("rooms", "punishment_deck")
```

- [ ] **Step 5: Run** — still fails until Task 3 sets the deck. Verify the AttributeError is gone:

Run: `cd apps/api && uv run --extra dev pytest tests/services/test_rooms.py::test_create_room_punishment_defaults_deck_to_mild --no-cov -q`
Expected: now fails on `assert room.punishment_deck == "mild"` (None != "mild"), NOT AttributeError. Proceed to Task 3 to make it pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/hoba_api/models/room.py apps/api/alembic/versions/0006_add_punishment_room_columns.py apps/api/tests/services/test_rooms.py
git commit -m "feat(api): rooms punishment columns + alembic 0006"
```

---

## Task 3: Schema fields + create_room/update_room deck

**Files:**
- Modify: `apps/api/src/hoba_api/schemas/room.py`, `apps/api/src/hoba_api/services/rooms.py`
- Test: covered by Task 2's test (now made to pass) + a serialization test below

- [ ] **Step 1: Write the failing test** — append to `tests/services/test_room_state.py`

```python
async def test_room_out_exposes_punishment_fields(db: AsyncSession) -> None:
    host = await upsert_from_telegram(db, TelegramUser(id=7710, first_name="H"))
    await db.flush()
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        game_mode="punishment",
    )
    await db.commit()
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    state = await build_room_state(db, fetched, current_user_id=host.id)
    assert state.room.punishment_deck == "mild"
    assert state.room.punishment_done_count == 0
    assert state.room.punishment_active_card is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run --extra dev pytest tests/services/test_room_state.py::test_room_out_exposes_punishment_fields --no-cov -q`
Expected: FAIL — `RoomOut` has no `punishment_deck` (ValidationError / AttributeError).

- [ ] **Step 3: Add fields to `apps/api/src/hoba_api/schemas/room.py`**

Add a type alias near the top aliases (after `GameMode = ...`):
```python
PunishmentDeck = Literal["mild", "spicy", "chaos"]
```
In `RoomOut`, after `current_turn_user_id`:
```python
    punishment_deck: PunishmentDeck | None
    punishment_done_count: int
    punishment_active_card: dict[str, object] | None
```
In `RoomCreateIn`, after `game_mode`:
```python
    punishment_deck: PunishmentDeck | None = Field(default=None)
```
In `RoomUpdateIn`, after `game_mode`:
```python
    punishment_deck: PunishmentDeck | None = None
```

- [ ] **Step 4: Set the deck in `create_room`** (`apps/api/src/hoba_api/services/rooms.py`)

Add `punishment_deck: str | None = None` to the `create_room` signature (after `game_mode`). After the `room = Room(...)` block currently constructs the room, set the deck. Change the `Room(...)` construction to include:
```python
    room = Room(
        code=code,
        host_id=host_id,
        title=title,
        status="lobby",
        game_mode=game_mode,
        spin_policy=effective_spin_policy,
        suggestion_policy=suggestion_policy,
        punishment_deck=(
            (punishment_deck or "mild") if game_mode == "punishment" else None
        ),
    )
```
Validate the deck if provided (near the other guards, after the game_mode check):
```python
    if punishment_deck is not None and punishment_deck not in ("mild", "spicy", "chaos"):
        raise RoomServiceError("bad_punishment_deck")
```

- [ ] **Step 5: Allow deck change in `update_room`** — add `"punishment_deck"` to the `allowed` set in `update_room`:
```python
    allowed = {
        "title",
        "spin_policy",
        "suggestion_policy",
        "is_locked",
        "game_mode",
        "punishment_deck",
    }
```

- [ ] **Step 6: Thread the field through the REST create endpoint** (`apps/api/src/hoba_api/api/v1/rooms.py`) — in `create_room_endpoint`, pass `punishment_deck=payload.punishment_deck` to the `create_room(...)` call.

- [ ] **Step 7: Run to verify Task 2 + Task 3 tests pass**

Run: `cd apps/api && uv run --extra dev pytest tests/services/test_rooms.py tests/services/test_room_state.py --no-cov -q`
Expected: PASS (punishment default-deck + serialization).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/hoba_api/schemas/room.py apps/api/src/hoba_api/services/rooms.py apps/api/src/hoba_api/api/v1/rooms.py apps/api/tests/services/test_room_state.py
git commit -m "feat(api): punishment_deck on room schema + create/update"
```

---

## Task 4: PunishmentEngine + registry

**Files:**
- Create: `apps/api/src/hoba_api/modes/punishment.py`
- Modify: `apps/api/src/hoba_api/modes/registry.py`
- Test: `apps/api/tests/modes/test_punishment_engine.py`

- [ ] **Step 1: Write the failing test** — `tests/modes/test_punishment_engine.py`

```python
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.modes.base import SpinContext
from hoba_api.modes.punishment import PunishmentEngine
from hoba_api.modes.registry import engine_for


def _seg(seg_id: int, pos: int) -> Segment:
    return Segment(id=seg_id, parent_id=1, parent_type="question",
                   label=f"s{seg_id}", color_seed=0, weight=1, position=pos)


def _ctx(segs: list[Segment]) -> SpinContext:
    room = Room(code="ABC123", host_id=1, status="active",
                game_mode="punishment", spin_policy="anyone", suggestion_policy="off")
    return SpinContext(room=room, question=None, segments=segs)


def test_punishment_visible_all_no_eliminate() -> None:
    segs = [_seg(1, 0), _seg(2, 1)]
    e = PunishmentEngine()
    ctx = _ctx(segs)
    assert e.get_visible_segments(ctx) == segs
    d = e.on_spin_request(ctx)
    assert d.segments == segs
    assert d.duration_multiplier == 1.0
    assert d.effects == {}
    eff = e.on_spin_settled(ctx, segs[0])
    assert eff.eliminate_segment_ids == []
    assert eff.round_over is False
    assert e.is_round_over(ctx) is False


def test_registry_resolves_punishment() -> None:
    assert engine_for("punishment").mode_id == "punishment"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run --extra dev pytest tests/modes/test_punishment_engine.py --no-cov -q`
Expected: FAIL — `ModuleNotFoundError: hoba_api.modes.punishment` / registry returns classic.

- [ ] **Step 3: Create `apps/api/src/hoba_api/modes/punishment.py`**

```python
"""Punishment mode (spec §5.3) — wheel picks the victim; the service deals
a card. The engine itself is a plain pass-through (no eliminations, no
duration change); the draw is a service concern (engines are pure/DB-free)."""
from __future__ import annotations

from hoba_api.models.segment import Segment
from hoba_api.modes.base import ModeEffects, SpinContext, SpinDecision


class PunishmentEngine:
    mode_id = "punishment"

    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]:
        return ctx.segments

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision:
        return SpinDecision(segments=ctx.segments)

    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects:
        return ModeEffects()

    def is_round_over(self, ctx: SpinContext) -> bool:
        return False
```

- [ ] **Step 4: Register it** in `apps/api/src/hoba_api/modes/registry.py`

```python
from hoba_api.modes.punishment import PunishmentEngine
```
```python
_ENGINES: dict[str, GameModeEngine] = {
    "classic": ClassicEngine(),
    "elimination": EliminationEngine(),
    "punishment": PunishmentEngine(),
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/api && uv run --extra dev pytest tests/modes/test_punishment_engine.py --no-cov -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/hoba_api/modes/punishment.py apps/api/src/hoba_api/modes/registry.py apps/api/tests/modes/test_punishment_engine.py
git commit -m "feat(api): PunishmentEngine + registry entry"
```

---

## Task 5: Draw helpers + trigger_spin punishment

**Files:**
- Modify: `apps/api/src/hoba_api/services/spins.py`
- Test: `apps/api/tests/services/test_spins.py` (extend)

- [ ] **Step 1: Write failing tests** — append to `tests/services/test_spins.py`

```python
async def test_trigger_spin_punishment_draws_and_sets_active_card(
    db: AsyncSession,
) -> None:
    host_id = await _make_user(db, tg_id=400)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(3),
        spin_policy="anyone", game_mode="punishment", punishment_deck="mild",
    )
    await db.commit()
    spin = await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()
    pun = spin.mode_state_snapshot["punishment"]
    assert pun["deck"] == "mild"
    assert pun["lang"] in ("en", "uk")
    assert 0 <= pun["card_index"] < 30
    card = room.punishment_active_card
    assert card is not None
    assert card["text"]
    assert card["victim_segment_id"] == spin.result_segment_id
    assert card["spin_id"] == spin.id


async def test_trigger_spin_punishment_blocks_while_card_pending(
    db: AsyncSession,
) -> None:
    import pytest
    from hoba_api.services.rooms import RoomServiceError

    host_id = await _make_user(db, tg_id=401)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(3),
        spin_policy="anyone", game_mode="punishment", punishment_deck="mild",
    )
    await db.commit()
    await trigger_spin(db, room=room, user_id=host_id)
    await db.commit()
    with pytest.raises(RoomServiceError) as exc:
        await trigger_spin(db, room=room, user_id=host_id)
    assert exc.value.code == "card_pending"


async def test_draw_without_replacement_no_repeat_until_exhausted(
    db: AsyncSession,
) -> None:
    # Drawing N times yields distinct indices until the 30-card pool empties.
    host_id = await _make_user(db, tg_id=402)
    room = await create_room(
        db, host_id=host_id, question_text="Q?", segments=_drafts(3),
        spin_policy="anyone", game_mode="punishment", punishment_deck="mild",
    )
    await db.commit()
    seen: list[int] = []
    for _ in range(30):
        spin = await trigger_spin(db, room=room, user_id=host_id)
        seen.append(spin.mode_state_snapshot["punishment"]["card_index"])
        room.punishment_active_card = None  # simulate "done" so spin unblocks
        await db.commit()
    assert sorted(seen) == list(range(30))  # all 30, no repeats
```

(Confirm `create_room` accepts `punishment_deck` — added in Task 3. `_drafts`/`_make_user` already exist in this module.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && uv run --extra dev pytest tests/services/test_spins.py -k punishment --no-cov -q`
Expected: FAIL — no punishment handling in `trigger_spin` (`KeyError: 'punishment'`, active_card None).

- [ ] **Step 3: Add a draw helper to `apps/api/src/hoba_api/services/spins.py`**

Add imports at top:
```python
import secrets

from hoba_api.models.user import User
from hoba_api.modes.punishment_decks import CARDS_PER_DECK, deck_cards
```
(secrets is already imported — don't duplicate.)

Add the helper (module level, near `user_can_spin`):
```python
async def _draw_punishment_index(
    session: AsyncSession, question_id: int,
) -> int:
    """Pick a card index not yet drawn for this question (without
    replacement). When all CARDS_PER_DECK have been drawn, reshuffle —
    the pool resets to the full range. Uses prior spins'
    mode_state_snapshot['punishment']['card_index'] as the drawn set."""
    rows = (
        await session.execute(
            select(Spin.mode_state_snapshot).where(Spin.question_id == question_id),
        )
    ).scalars().all()
    drawn = {
        snap["punishment"]["card_index"]
        for snap in rows
        if isinstance(snap, dict) and isinstance(snap.get("punishment"), dict)
    }
    pool = [i for i in range(CARDS_PER_DECK) if i not in drawn]
    if not pool:  # exhausted → reshuffle
        pool = list(range(CARDS_PER_DECK))
    return secrets.choice(pool)
```

- [ ] **Step 4: Add the early guard + draw to `trigger_spin`**

After the `user_can_spin` check (around line 43), add the pending-card guard:
```python
    if room.game_mode == "punishment" and room.punishment_active_card is not None:
        raise RoomServiceError("card_pending")
```

After the existing `session.add(spin)` and the `if room.status == "lobby": room.status = "active"` block, but BEFORE the final `await session.flush(); return spin`, replace that tail with:
```python
    if room.status == "lobby":
        room.status = "active"

    await session.flush()

    if room.game_mode == "punishment":
        deck = room.punishment_deck or "mild"
        host = await session.get(User, room.host_id)
        lang = host.language_code if host is not None else "en"
        idx = await _draw_punishment_index(session, question.id)
        # Record the draw for without-replacement history.
        snapshot = dict(spin.mode_state_snapshot)
        snapshot["punishment"] = {"deck": deck, "lang": lang, "card_index": idx}
        spin.mode_state_snapshot = snapshot
        # Set the room's pending card (gate + display source of truth).
        room.punishment_active_card = {
            "text": deck_cards(deck, lang)[idx],
            "deck": deck,
            "victim_segment_id": winning_segment.id,
            "spin_id": spin.id,
        }
        await session.flush()

    return spin
```

(Note: `mode_state_snapshot` must be reassigned as a new dict — SQLAlchemy JSON change-tracking needs a new object, not in-place mutation.)

- [ ] **Step 5: Run to verify they pass**

Run: `cd apps/api && uv run --extra dev pytest tests/services/test_spins.py --no-cov -q`
Expected: PASS (punishment draw + gate + without-replacement, plus existing spin tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/hoba_api/services/spins.py apps/api/tests/services/test_spins.py
git commit -m "feat(api): punishment card draw + spin gate in trigger_spin"
```

---

## Task 6: _emit_settled surfaces the card + broadcasts patch

**Files:**
- Modify: `apps/api/src/hoba_api/realtime/handlers.py` (`_emit_settled`)
- Test: `apps/api/tests/realtime/test_handlers.py` (extend)

- [ ] **Step 1: Write the failing test** — append to `tests/realtime/test_handlers.py`

```python
@pytest.mark.asyncio
async def test_emit_settled_punishment_emits_card_and_patch(
    sio: FakeSocketIO, db: Any,
) -> None:
    from hoba_api.services.rooms import get_room_by_code
    from hoba_api.services.spins import trigger_spin

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=88))
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a", color_seed=0, weight=1),
                  SegmentDraft(label="b", color_seed=1, weight=1)],
        spin_policy="anyone", game_mode="punishment", punishment_deck="mild",
    )
    await db.commit()
    spin = await trigger_spin(db, room=room, user_id=host.id)
    await db.commit()
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    sio.emitted.clear()

    await _emit_settled(  # type: ignore[arg-type]
        sio, room.code, fetched.id,
        spin_id=spin.id, result_segment_id=spin.result_segment_id, duration_ms=0,
    )

    after = sio.events_named("spin:settled")[-1][1]["mode_aftereffects"]
    assert after["punishment_card"]
    assert after["victim_segment_id"] == spin.result_segment_id
    patches = [e[1]["patch"] for e in sio.events_named("room:updated")
               if isinstance(e[1], dict) and "patch" in e[1]]
    assert any("punishment_active_card" in p for p in patches)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run --extra dev pytest tests/realtime/test_handlers.py -k punishment --no-cov -q`
Expected: FAIL — `mode_aftereffects` has no `punishment_card`.

- [ ] **Step 3: Modify `_emit_settled`** in `apps/api/src/hoba_api/realtime/handlers.py`

Inside the `if room is not None:` block, after the elimination handling (after the `if winner is not None:` block, still inside `if room is not None:`), add punishment handling. Also add a `room_patch` accumulator. Restructure the broadcast tail to send a combined room:updated patch. Concretely, after the `if room.spin_policy == "turn_based":` block and before `await session.commit()`, capture the punishment card:

```python
            punishment_card = (
                room.punishment_active_card
                if room.game_mode == "punishment"
                else None
            )
            if punishment_card is not None:
                mode_aftereffects = {
                    "punishment_card": punishment_card["text"],
                    "deck": punishment_card["deck"],
                    "victim_segment_id": punishment_card["victim_segment_id"],
                }
            done_count = room.punishment_done_count
            await session.commit()
```

Then after the existing `spin:settled` emit, add a room:updated patch for punishment (alongside the existing turn_based `advanced` emit):
```python
    if punishment_card is not None:
        await sio.emit(
            "room:updated",
            {"patch": {
                "punishment_active_card": punishment_card,
                "punishment_done_count": done_count,
            }},
            room=room_code,
            namespace=NAMESPACE,
        )
```

You must hoist `punishment_card` and `done_count` to the function scope (initialize `punishment_card = None` and `done_count = 0` near the top of `_emit_settled` next to `mode_aftereffects = {}`), since they're read after the `async with` block.

- [ ] **Step 4: Run to verify it passes (and existing settle tests still pass)**

Run: `cd apps/api && uv run --extra dev pytest tests/realtime/test_handlers.py --no-cov -q`
Expected: PASS — punishment card emitted + patch; elimination + turn_based settle tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/hoba_api/realtime/handlers.py apps/api/tests/realtime/test_handlers.py
git commit -m "feat(api): emit punishment card + room patch at settle"
```

---

## Task 7: punishment:done handler

**Files:**
- Modify: `apps/api/src/hoba_api/realtime/handlers.py`
- Test: `apps/api/tests/realtime/test_handlers.py` (extend)

- [ ] **Step 1: Write failing tests** — append to `tests/realtime/test_handlers.py`

```python
@pytest.mark.asyncio
async def test_punishment_done_increments_tally_and_clears(
    sio: FakeSocketIO, db: Any,
) -> None:
    from hoba_api.services.spins import trigger_spin

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=89))
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a", color_seed=0, weight=1),
                  SegmentDraft(label="b", color_seed=1, weight=1)],
        spin_policy="anyone", game_mode="punishment", punishment_deck="mild",
    )
    await db.commit()
    await trigger_spin(db, room=room, user_id=host.id)
    await db.commit()
    code = room.code

    await _connect(sio, "sid-h89", user_id=89)
    await sio.call("room:join", "sid-h89", {"code": code})
    sio.emitted.clear()

    await sio.call("punishment:done", "sid-h89")
    assert sio.events_named("punishment:cleared")
    from hoba_api.services.rooms import get_room_by_code
    refreshed = await get_room_by_code(db, code)
    assert refreshed is not None
    await db.refresh(refreshed)
    assert refreshed.punishment_done_count == 1
    assert refreshed.punishment_active_card is None


@pytest.mark.asyncio
async def test_punishment_done_noop_without_card(sio: FakeSocketIO, db: Any) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=90))
    await db.commit()
    code = await _create_room(db, host_id=host.id)  # classic, no card
    await _connect(sio, "sid-h90", user_id=90)
    await sio.call("room:join", "sid-h90", {"code": code})
    sio.emitted.clear()
    await sio.call("punishment:done", "sid-h90")
    # No card → no cleared broadcast, no tally change.
    assert not sio.events_named("punishment:cleared")
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && uv run --extra dev pytest tests/realtime/test_handlers.py -k punishment_done --no-cov -q`
Expected: FAIL — no `punishment:done` handler.

- [ ] **Step 3: Add the handler** inside `register_handlers` (after `on_round_reset`), modeled on it but with no host gate:

```python
    @sio.on("punishment:done", namespace=NAMESPACE)
    async def on_punishment_done(sid: str) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_code = sess.get("room_code")
        room_id = sess.get("room_id")
        if user_id is None or room_code is None or room_id is None:
            await sio.emit("error", {"code": "not_in_room"}, to=sid, namespace=NAMESPACE)
            return
        async with SessionLocal() as session:
            room = await session.get(Room, room_id)
            if room is None or room.punishment_active_card is None:
                return  # nothing pending — no-op
            room.punishment_done_count += 1
            room.punishment_active_card = None
            done_count = room.punishment_done_count
            await session.commit()
        await sio.emit(
            "room:updated",
            {"patch": {"punishment_active_card": None, "punishment_done_count": done_count}},
            room=room_code,
            namespace=NAMESPACE,
        )
        await sio.emit("punishment:cleared", {}, room=room_code, namespace=NAMESPACE)
        log.info("ws.punishment.done", user_id=user_id, code=room_code)
```

- [ ] **Step 4: Run to verify they pass + full backend gate**

Run: `cd apps/api && uv run --extra dev pytest -q && uv run --extra dev mypy --strict src && uv run --extra dev ruff check src tests`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/hoba_api/realtime/handlers.py apps/api/tests/realtime/test_handlers.py
git commit -m "feat(api): punishment:done clears card + bumps tally"
```

---

## Task 8: Frontend types

**Files:**
- Modify: `apps/webapp/src/lib/api.ts`, `apps/webapp/src/stores/room.ts`

- [ ] **Step 1: Add types to `apps/webapp/src/lib/api.ts`**

Add a deck type near `GameMode`:
```typescript
export type PunishmentDeck = "mild" | "spicy" | "chaos";
```
Add to `ServerRoom` (after `current_turn_user_id`):
```typescript
  punishment_deck: PunishmentDeck | null;
  punishment_done_count: number;
  punishment_active_card: {
    text: string;
    deck: PunishmentDeck;
    victim_segment_id: number;
    spin_id: number;
  } | null;
```
Add to `RoomCreatePayload` and `RoomPatchPayload`:
```typescript
  punishment_deck?: PunishmentDeck;
```

- [ ] **Step 2: Extend `SpinSettledEvent`** in `apps/webapp/src/stores/room.ts` — add to the `mode_aftereffects` object type:
```typescript
    punishment_card?: string;
    deck?: PunishmentDeck;
    // victim_segment_id already representable; add if not present:
    victim_segment_id?: number;
```
(Import `PunishmentDeck` from `@/lib/api` if needed.)

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/webapp && pnpm tsc --noEmit`
Expected: PASS (additive). Fix any `ServerRoom` test fixtures that now miss the new required fields — search `__tests__` for object literals building `ServerRoom`/snapshots and add `punishment_deck: null, punishment_done_count: 0, punishment_active_card: null`. (The store/permissions/turnState test fixtures use `active_question: null` and a full `room`; check `permissions.test.ts`, `turnState.test.ts`, `room.test.ts`.)

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/lib/api.ts apps/webapp/src/stores/room.ts
git commit -m "feat(webapp): punishment room + settled-event types"
```

---

## Task 9: Deck metadata + mode-picker sub-picker + SpinPage

**Files:**
- Modify: `apps/webapp/src/data/gameModes.ts`, `apps/webapp/src/components/room/RoomModePickerSheet.tsx`, `apps/webapp/src/pages/SpinPage.tsx`

- [ ] **Step 1: Add deck metadata to `apps/webapp/src/data/gameModes.ts`**

```typescript
import { type GameMode, type PunishmentDeck } from "@/lib/api";

export interface PunishmentDeckMeta {
  id: PunishmentDeck;
  emoji: string;
  /** i18n key under `room` namespace, suffixed `.label` / `.tagline`. */
  i18nKey: string;
}

export const PUNISHMENT_DECKS: readonly PunishmentDeckMeta[] = [
  { id: "mild", emoji: "🙂", i18nKey: "punishment.deck_mild" },
  { id: "spicy", emoji: "🌶️", i18nKey: "punishment.deck_spicy" },
  { id: "chaos", emoji: "🔥", i18nKey: "punishment.deck_chaos" },
];

export const DEFAULT_PUNISHMENT_DECK: PunishmentDeck = "mild";
```

- [ ] **Step 2: Update `RoomModePickerSheet.tsx`** — change the callback signature and add the deck sub-picker.

Change the prop:
```typescript
  onCreate: (mode: GameMode, deck?: PunishmentDeck) => void;
```
Import deck data + type:
```typescript
import { DEFAULT_PUNISHMENT_DECK, PUNISHMENT_DECKS, PICKABLE_GAME_MODES, DEFAULT_GAME_MODE } from "@/data/gameModes";
import { type GameMode, type PunishmentDeck } from "@/lib/api";
```
Add deck state + reset:
```typescript
  const [deck, setDeck] = useState<PunishmentDeck>(DEFAULT_PUNISHMENT_DECK);
  useEffect(() => {
    if (open) { setSelected(DEFAULT_GAME_MODE); setDeck(DEFAULT_PUNISHMENT_DECK); }
  }, [open]);
```
After the modes `<div>` list and before the Create button, render the deck sub-picker only when punishment is selected:
```tsx
        {selected === "punishment" ? (
          <div className="mt-3">
            <p className="text-sm font-medium text-ink-light-2 dark:text-ink-dark-2 mb-2">
              {t("room:mode_picker.deck_title")}
            </p>
            <div className="flex gap-2">
              {PUNISHMENT_DECKS.map((d) => {
                const active = d.id === deck;
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={loading}
                    aria-pressed={active}
                    onClick={() => { if (!loading) { haptics.selection(); setDeck(d.id); } }}
                    className={`ds-tactile grow min-h-[44px] px-3 py-2 rounded-md text-sm font-semibold ${
                      active
                        ? "bg-brand-primary text-white"
                        : "bg-surface-light-2 dark:bg-surface-dark-2 text-ink-light-1 dark:text-ink-dark-1"
                    } disabled:opacity-60`}
                  >
                    <span aria-hidden className="mr-1">{d.emoji}</span>
                    {t(`room:${d.i18nKey}.label`)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
```
Update the Create button handler:
```tsx
          onClick={() => {
            onCreate(selected, selected === "punishment" ? deck : undefined);
          }}
```

- [ ] **Step 3: Update `SpinPage.tsx` `handleCreateRoom`** to accept + send the deck:

```typescript
  async function handleCreateRoom(mode: GameMode, deck?: PunishmentDeck): Promise<void> {
    if (wheel === undefined || inviteLoading) return;
    setInviteLoading(true);
    try {
      const state = await api.createRoom({
        question_text: wheel.questionText,
        segments: wheel.segments.map((s) => ({
          label: s.label, emoji: s.emoji ?? null, color_seed: s.colorSeed, weight: s.weight ?? 1,
        })),
        game_mode: mode,
        ...(deck !== undefined ? { punishment_deck: deck } : {}),
      });
      navigate(`/room/${state.room.code}`);
    } catch (exc) {
      const code = exc instanceof ApiError ? exc.code : "create_failed";
      const key = `room:errors.${code}`;
      const localized = t(key);
      const message = localized === key ? t("room:errors.fallback") : localized;
      toast({ title: message, intent: "error" });
      setInviteLoading(false);
    }
  }
```
Import `PunishmentDeck`:
```typescript
import { api, ApiError, type GameMode, type PunishmentDeck } from "@/lib/api";
```
Update the `RoomModePickerSheet` usage:
```tsx
        onCreate={(mode, deck) => {
          void handleCreateRoom(mode, deck);
        }}
```

- [ ] **Step 4: Verify build + lint**

Run: `cd apps/webapp && pnpm tsc --noEmit && pnpm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/data/gameModes.ts apps/webapp/src/components/room/RoomModePickerSheet.tsx apps/webapp/src/pages/SpinPage.tsx
git commit -m "feat(webapp): punishment deck picker in mode sheet"
```

---

## Task 10: punishment.ts helper + store action

**Files:**
- Create: `apps/webapp/src/features/rooms/punishment.ts`, `apps/webapp/src/features/rooms/__tests__/punishment.test.ts`
- Modify: `apps/webapp/src/stores/room.ts`

- [ ] **Step 1: Write the failing test** — `apps/webapp/src/features/rooms/__tests__/punishment.test.ts`

```typescript
import { describe, expect, it } from "vitest";

import { type RoomState } from "@/lib/api";

import { activeCard, doneCount, hasPendingCard, isPunishment } from "../punishment";

function snap(overrides: Partial<RoomState["room"]> = {}): RoomState {
  return {
    room: {
      id: 1, code: "ABC123", host_id: 1, title: null, status: "active",
      game_mode: "punishment", spin_policy: "anyone", suggestion_policy: "off",
      is_locked: false, is_anonymous: false, current_turn_user_id: null,
      created_at: "2026-05-29T00:00:00Z", closed_at: null,
      punishment_deck: "mild", punishment_done_count: 2,
      punishment_active_card: { text: "Do a dance", deck: "mild", victim_segment_id: 5, spin_id: 9 },
      ...overrides,
    },
    participants: [], active_question: null, last_spin: null, me_user_id: 1,
  };
}

describe("punishment helpers", () => {
  it("reads active card / done count / pending / mode", () => {
    const s = snap();
    expect(isPunishment(s)).toBe(true);
    expect(doneCount(s)).toBe(2);
    expect(hasPendingCard(s)).toBe(true);
    expect(activeCard(s)?.text).toBe("Do a dance");
  });

  it("no pending card when null", () => {
    expect(hasPendingCard(snap({ punishment_active_card: null }))).toBe(false);
    expect(activeCard(snap({ punishment_active_card: null }))).toBeNull();
  });

  it("null snapshot safe", () => {
    expect(isPunishment(null)).toBe(false);
    expect(hasPendingCard(null)).toBe(false);
    expect(doneCount(null)).toBe(0);
    expect(activeCard(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/webapp && pnpm vitest run src/features/rooms/__tests__/punishment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/webapp/src/features/rooms/punishment.ts`**

```typescript
import { type RoomState, type ServerRoom } from "@/lib/api";

export function isPunishment(snap: RoomState | null): boolean {
  return snap?.room.game_mode === "punishment";
}

export function activeCard(
  snap: RoomState | null,
): ServerRoom["punishment_active_card"] {
  return snap?.room.punishment_active_card ?? null;
}

export function hasPendingCard(snap: RoomState | null): boolean {
  return activeCard(snap) !== null;
}

export function doneCount(snap: RoomState | null): number {
  return snap?.room.punishment_done_count ?? 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/webapp && pnpm vitest run src/features/rooms/__tests__/punishment.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the store action + cleared listener** in `apps/webapp/src/stores/room.ts`

Add to the `RoomStore` interface:
```typescript
  /** Mark the pending punishment card done (any participant). */
  markPunishmentDone(): void;
```
Add the implementation in the store object:
```typescript
  markPunishmentDone(): void {
    socket?.emit("punishment:done");
  },
```
Add a listener in `wireListeners` (the `room:updated` patch already nulls the card; this is the explicit dismiss signal — no extra state needed, but wire it for symmetry/future use):
```typescript
  s.on("punishment:cleared", () => {
    // The room:updated patch already cleared punishment_active_card; this
    // event is the explicit "drop the overlay" signal. No-op beyond that.
  });
```

- [ ] **Step 6: Run frontend tests**

Run: `cd apps/webapp && pnpm vitest run && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/features/rooms/punishment.ts apps/webapp/src/features/rooms/__tests__/punishment.test.ts apps/webapp/src/stores/room.ts
git commit -m "feat(webapp): punishment helpers + markPunishmentDone"
```

---

## Task 11: i18n strings (EN + UK)

**Files:**
- Modify: `apps/webapp/src/locales/en/room.json`, `apps/webapp/src/locales/uk/room.json`

- [ ] **Step 1: Add a `punishment` block to `en/room.json`** (top-level key; match the ICU plural shape used by `elimination.remaining` / `header.participants_count`):

```json
  "punishment": {
    "tally": "{count, plural, one {# punishment done} other {# punishments done}}",
    "done": "Done ✓",
    "victim_card": "🎯 {victim}",
    "pending_hint": "Resolve the card to keep going",
    "deck_mild": { "label": "Mild", "tagline": "Silly, all-ages dares" },
    "deck_spicy": { "label": "Spicy", "tagline": "Bolder adult-party dares" },
    "deck_chaos": { "label": "Chaos", "tagline": "Absurd wildcard dares" }
  },
```
Add `deck_title` under the existing `mode_picker` block:
```json
    "deck_title": "Choose a deck",
```

- [ ] **Step 2: Add the matching `punishment` block to `uk/room.json`**

```json
  "punishment": {
    "tally": "{count, plural, one {# покарання виконано} few {# покарання виконано} many {# покарань виконано} other {# покарання виконано}}",
    "done": "Готово ✓",
    "victim_card": "🎯 {victim}",
    "pending_hint": "Виконайте картку, щоб продовжити",
    "deck_mild": { "label": "Лагідний", "tagline": "Жартівливі завдання для всіх" },
    "deck_spicy": { "label": "Гострий", "tagline": "Сміливіші завдання для дорослих" },
    "deck_chaos": { "label": "Хаос", "tagline": "Абсурдні непередбачувані завдання" }
  },
```
Add `deck_title` under UK `mode_picker`:
```json
    "deck_title": "Виберіть колоду",
```

- [ ] **Step 3: Verify i18n parity**

Run: `cd /home/kali/hoba && node scripts/i18n-check.mjs`
Expected: PASS (EN ↔ UK key parity).

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/locales/en/room.json apps/webapp/src/locales/uk/room.json
git commit -m "feat(webapp): punishment i18n strings (EN+UK)"
```

---

## Task 12: RoomPage UI — tally, card overlay, Done, spin gate

**Files:**
- Modify: `apps/webapp/src/pages/RoomPage.tsx`

- [ ] **Step 1: Derive punishment view-state** — after the elimination derivations (`const survivor = …`), add:

```typescript
  const isPunish = snapshot?.room.game_mode === "punishment";
  const pendingCard = activeCard(snapshot);
  const punishDone = doneCount(snapshot);
  const markPunishmentDone = useRoomStore((s) => s.markPunishmentDone);
```
Add the import:
```typescript
import { activeCard, doneCount } from "@/features/rooms/punishment";
```

- [ ] **Step 2: Gate the wheel hub while a card is pending** — in the `<Wheel>` render (the non-roundOver branch), change `onSpinClick`:
```tsx
            onSpinClick={canSpin && !pendingCard ? triggerSpin : undefined}
```

- [ ] **Step 3: Tally near the GameModeBadge** — next to the elimination "Remaining" line in the header `<section>`, add:
```tsx
        {isPunish ? (
          <span className="text-sm font-medium text-ink-light-2 dark:text-ink-dark-2">
            {t("room:punishment.tally", { count: punishDone })}
          </span>
        ) : null}
```

- [ ] **Step 4: Pending hint** — in the bottom controls `<div className="mt-auto …">`, after the turn lines, add:
```tsx
          {isPunish && pendingCard ? (
            <p className="text-center text-sm text-ink-light-2 dark:text-ink-dark-2 py-2">
              {t("room:punishment.pending_hint")}
            </p>
          ) : null}
```

- [ ] **Step 5: Card overlay** — add inside the `<main>`, as a sibling of the elimination/classic result `AnimatePresence` (a separate `AnimatePresence`), so the pending card shows regardless of the transient reveal:

```tsx
        <AnimatePresence>
          {isPunish && pendingCard ? (
            <motion.div
              key="punish-card"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-0 z-30 px-4 pt-3 pb-6 flex flex-col items-center justify-center gap-5 bg-bg-light/92 dark:bg-bg-dark/92 backdrop-blur-sm"
              aria-live="polite"
              role="status"
            >
              <motion.div
                initial={{ scale: 0.6, y: 20, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                transition={{ type: "spring", damping: 16, stiffness: 240 }}
                className="w-full max-w-sm rounded-2xl p-6 shadow-spin bg-gradient-to-br from-brand-primary to-brand-amber-3 text-white"
              >
                <p className="text-xs uppercase tracking-widest opacity-85 mb-2">
                  {t(`room:punishment.deck_${pendingCard.deck}.label`)}
                </p>
                {(() => {
                  const victim = snapshot?.active_question?.segments.find(
                    (s) => s.id === pendingCard.victim_segment_id,
                  );
                  return victim !== undefined ? (
                    <p className="text-sm font-semibold mb-3">
                      {t("room:punishment.victim_card", {
                        victim: `${victim.emoji ? victim.emoji + " " : ""}${victim.label}`,
                      })}
                    </p>
                  ) : null;
                })()}
                <p className="text-2xl font-display font-extrabold leading-snug">
                  {pendingCard.text}
                </p>
              </motion.div>
              <Button variant="accent" size="xl" onClick={markPunishmentDone}>
                {t("room:punishment.done")}
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
```

(Place this BEFORE the existing classic/elimination result `AnimatePresence`, or after — z-30 on both; since the card is gated on `pendingCard` and the result auto-dismisses, they won't both linger. If desired, also suppress the classic/elimination result overlay when `isPunish` by adding `&& !isPunish` to that block's condition — punishment uses its own overlay.)

- [ ] **Step 6: Verify build + lint**

Run: `cd apps/webapp && pnpm tsc --noEmit && pnpm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/pages/RoomPage.tsx
git commit -m "feat(webapp): punishment card overlay, tally, spin gate"
```

---

## Task 13: docs/game-modes.md + index + full gates

**Files:**
- Modify: `docs/game-modes.md`, `CLAUDE.md`

- [ ] **Step 1: Add a Punishment section to `docs/game-modes.md`** documenting: the loop (spin → wheel picks victim → server deals a card from the host-chosen deck → anyone marks Done → tally++ → next spin), deck selection (mild/spicy/chaos at room creation, changeable in settings), draw-without-replacement (reshuffle on exhaustion), host-language cards, block-until-Done spin gate, and the `punishment_active_card` / `punishment:done` / `punishment:cleared` wire shapes. Change the Punishment "Planned" stub to "Live".

- [ ] **Step 2: Confirm the `CLAUDE.md` doc-index line** for `docs/game-modes.md` reads e.g. `Elimination + Punishment live; Chaos planned` (update the parenthetical).

- [ ] **Step 3: Run ALL gates**

```bash
cd apps/api && uv run --extra dev pytest -q && uv run --extra dev mypy --strict src && uv run --extra dev ruff check src tests
cd ../webapp && pnpm vitest run && pnpm tsc --noEmit && pnpm run lint
cd /home/kali/hoba && node scripts/i18n-check.mjs
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/game-modes.md CLAUDE.md
git commit -m "docs: game-modes.md — punishment"
```

---

## Final verification (after all tasks)

- [ ] All gates green (Task 13 Step 3).
- [ ] Deploy to VPS (api rebuild — migration 0006 auto-applies; webapp rebuild) and manual-verify on two accounts:
  - Create a Punishment room, pick a deck → spin → wheel lands on a segment → card overlay shows "🎯 {victim}" + the dare; hub is disabled.
  - Tap "Done ✓" (from any account) → card clears, "punishments done" tally increments, next player can spin.
  - Spin repeatedly → cards don't repeat until the deck (30) is exhausted.
  - turn_based + punishment compose (turn rotates AND cards deal) — Punishment derives turn_based by default.
  - Classic + Elimination rooms still behave correctly (regression).
