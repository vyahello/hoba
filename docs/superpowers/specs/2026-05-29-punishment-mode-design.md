# Punishment Mode — design

> Stage D, second per-mode gameplay slice (after Elimination). Implements
> spec §5.3 (Punishment) on the `GameModeEngine` abstraction already built in
> the Elimination slice. Chaos (§5.4) remains a later sibling slice.

## Goal

A room in `punishment` mode plays like Classic, except after each spin the
wheel-selected segment is the **victim** and the server **deals a punishment
card** (the dare) from the host-chosen deck. Cards are drawn without
replacement; a room-wide **"Punishments done"** tally counts resolved cards.
Spinning is blocked until the current card is marked Done. Everything is
server-authoritative (rule 2) — the client never sees the deck, only the dealt
card.

## Decisions locked in brainstorming

- **Content scope:** full 180 cards this slice (3 decks × 30 × EN/UK), drafted
  here; owner tunes tone (esp. spicy).
- **Who performs:** the **winning segment** is the victim; the card is the dare.
  Reveal framing: "🎯 {victim} → {card}".
- **Deck pick:** in the mode picker — selecting Punishment expands inline to
  mild / spicy / chaos; also changeable later via room settings.
- **Card language:** the **host's** `language_code`, captured at deal time
  (whole room sees one card; respects spec §6 "written natively per language").
- **Mark Done:** **anyone** in the room.
- **Spin gating:** **blocked** while a card is pending (no stacking).

## Scope

In scope: `PunishmentEngine` + registry entry; deck data module (180 cards);
server-side draw-without-replacement; room columns for deck/tally/active-card
(Alembic 0006); deck-pick UI; card overlay + Done + tally; `punishment:done` /
`punishment:cleared` WS events; EN+UK strings; `docs/game-modes.md` update.

Out of scope: Chaos, Rigged. Any mode without an engine still falls back to
Classic via the registry.

## Non-negotiables carried in

- Server-authoritative draw (rule 2) — deck never sent to client.
- `mypy --strict` / `tsc` clean (rule 3); every user string via `t()` (rule 5),
  EXCEPT the card deck text itself, which is server-authored content delivered
  over the wire (not UI chrome) — analogous to user-entered segment labels.
- Engine abstraction reused; no new abstraction (rule 6).

---

## 1. Backend: deck storage

New `apps/api/src/hoba_api/modes/punishment_decks.py`:

```python
PunishmentDeck = Literal["mild", "spicy", "chaos"]
DECK_LANGS = ("en", "uk")
CARDS_PER_DECK = 30

DECKS: dict[str, dict[str, list[str]]] = {
    "mild":  {"en": [...30...], "uk": [...30...]},
    "spicy": {"en": [...30...], "uk": [...30...]},
    "chaos": {"en": [...30...], "uk": [...30...]},
}

def deck_cards(deck: str, lang: str) -> list[str]:
    """Cards for a deck+lang; falls back to 'en' for unsupported langs,
    'mild' for an unknown deck. Never raises (loud log on fallback)."""
```

Content tone ladder (owner curates):
- **mild** — silly, all-ages ("Speak in a robot voice until your next turn").
- **spicy** — bolder adult-party (flirty/embarrassing, tasteful; no explicit
  NSFW, nothing unsafe).
- **chaos** — absurd wildcard ("Swap one clothing item with the player left").

Integrity test: every deck×lang has exactly 30 non-empty, unique entries.

## 2. Data model (Alembic 0006)

Three nullable/defaulted columns on `rooms` (use `op.add_column`, not
`batch_alter_table`, per the 0004/0005 lesson):

- `punishment_deck: str | None` — `mild`/`spicy`/`chaos`; set when
  game_mode=punishment (else NULL).
- `punishment_done_count: int` — default 0.
- `punishment_active_card: JSON | None` — the pending card, room-shared so it
  survives reconnects and is the single source of truth for the spin gate +
  Done action. Shape:
  `{ "text": str, "deck": str, "victim_segment_id": int, "spin_id": int }`
  or NULL when no card is pending.

`RoomOut` exposes all three. `RoomCreateIn` + `RoomUpdateIn` accept
`punishment_deck`. `create_room` stores it (default `mild` when game_mode is
punishment and none given); `update_room` allows changing it.

**Draw-without-replacement source of truth:** the set of already-drawn card
indices for the active question = the `card_index` values recorded in prior
punishment spins' `mode_state_snapshot` for that question. No extra table.

## 3. Backend: engine + spin pipeline

`apps/api/src/hoba_api/modes/punishment.py` — `PunishmentEngine`:
- `mode_id = "punishment"`.
- `get_visible_segments` → all.
- `on_spin_request` → `SpinDecision(segments=all, duration_multiplier=1.0,
  effects={})`.
- `on_spin_settled(winner)` → `ModeEffects()` (no eliminations). The card draw
  is a **service** concern (engines are pure/DB-free), so the engine just
  signals normal settle; the service performs the draw.
- `is_round_over` → `False`.

Registry: add `"punishment": PunishmentEngine()`.

`trigger_spin` (service): after computing the spin, if
`room.game_mode == "punishment"`:
1. Guard: if `room.punishment_active_card is not None` → raise
   `RoomServiceError("card_pending")` (blocks spin until Done). Checked BEFORE
   persisting the spin.
2. `lang = host.language_code` (load host User; fall back "en").
3. Compute drawn indices from prior punishment spins for the active question;
   pool = `range(CARDS_PER_DECK) - drawn`. If pool empty → reshuffle (pool =
   full range; drawn restart). `idx = secrets.choice(sorted(pool))`.
4. Record on the spin: `mode_state_snapshot = {..., "punishment": {"deck":
   deck, "lang": lang, "card_index": idx}}`.
5. Card text = `deck_cards(deck, lang)[idx]`.

`_emit_settled` (handler): after the existing settle work, if the spin carried
a punishment draw, set `room.punishment_active_card = {text, deck,
victim_segment_id=result_segment_id, spin_id}` (commit), and include in
`spin:settled.mode_aftereffects`:
```json
{ "punishment_card": "<text>", "deck": "spicy", "victim_segment_id": 42 }
```
Classic/elimination aftereffects unchanged.

## 4. Events: Done + tally

New client→server `punishment:done` (any participant):
- No-op if `room.punishment_active_card is None`.
- `room.punishment_done_count += 1`; `room.punishment_active_card = None`;
  commit.
- Broadcast `room:updated { patch: { punishment_done_count, punishment_active_card: null } }`
  AND `punishment:cleared {}` to the room. (The patch keeps snapshots correct
  for late joiners; the dedicated event lets clients drop the overlay.)
- `not_in_room` error if no room session.

No host-only gate (anyone can mark Done).

## 5. Frontend

### Types (`lib/api.ts`)
- `PunishmentDeck = "mild" | "spicy" | "chaos"`.
- `ServerRoom` gains `punishment_deck: PunishmentDeck | null`,
  `punishment_done_count: number`,
  `punishment_active_card: { text: string; deck: PunishmentDeck;
  victim_segment_id: number; spin_id: number } | null`.
- `RoomCreatePayload` + `RoomPatchPayload` gain `punishment_deck?`.
- `SpinSettledEvent.mode_aftereffects` gains
  `punishment_card?`, `deck?`, `victim_segment_id?`.

### Deck metadata (`data/gameModes.ts`)
`PUNISHMENT_DECKS: { id: PunishmentDeck; emoji; i18nKey }[]` — single source of
truth (mild/spicy/chaos), mirrors `PICKABLE_GAME_MODES`.

### Mode picker (`RoomModePickerSheet`)
- `onCreate` signature → `(mode: GameMode, deck?: PunishmentDeck)`.
- When `selected === "punishment"`, render an inline deck sub-picker (3 chips,
  default `mild`). Reset to `mild` when the sheet reopens / when switching away
  from punishment.
- `SpinPage.handleCreateRoom(mode, deck)` includes `punishment_deck` in the
  `createRoom` payload when mode is punishment.

### Store (`stores/room.ts`)
- `spin:settled`: existing handling; punishment fields ride in
  `mode_aftereffects` but the **authoritative** pending-card source is
  `snapshot.room.punishment_active_card` (set via the `room:updated` patch from
  `_emit_settled`). Client doesn't need to mutate room state from the settle
  event — the patch does it.
- `punishment:cleared`: no-op beyond the `room:updated` patch already nulling
  the card; included for an immediate overlay-dismiss signal.
- New action `markPunishmentDone()` → emits `punishment:done`.

### Pure helper `features/rooms/punishment.ts`
`activeCard(snapshot)`, `doneCount(snapshot)`, `hasPendingCard(snapshot)`,
`isPunishment(snapshot)`. Unit-tested; keeps RoomPage lean.

### RoomPage UI (gated on `game_mode === "punishment"`)
- **Tally** near the GameModeBadge: "Punishments done: N".
- **Card overlay** when `hasPendingCard`: brand-tinted card showing the victim
  segment (label/emoji) + the card text, deck badge, and a **"Done ✓"** button
  (any participant → `markPunishmentDone()`). NOT auto-dismiss (it's an action
  item). Driven by `room.punishment_active_card`, so it persists across
  reconnects and is identical for everyone.
- **Spin gate:** hub disabled (`onSpinClick` undefined) while `hasPendingCard`.
  A short hint line ("Resolve the card to keep going") when pending.
- Classic/elimination unaffected.

### i18n (room namespace, EN + UK)
`punishment.tally` (ICU plural), `punishment.done`, `punishment.victim_card`
("🎯 {victim} → {card}" framing — victim + card interpolated),
`punishment.pending_hint`, `punishment.deck_mild/spicy/chaos.{label,tagline}`,
`mode_picker.deck_title`. Card text itself is NOT in i18n (server content).

## 6. Testing

### Backend
- `PunishmentEngine` units (visible=all; no eliminate; not round-over).
- `registry.engine_for("punishment")` resolves to it.
- `deck_cards` integrity: each deck×lang = 30 non-empty unique; fallback paths.
- Draw-without-replacement: N spins draw N distinct indices; the (N+1)th after
  exhausting 30 reshuffles (no crash, draws again).
- `trigger_spin` punishment: records `{deck,lang,card_index}`; raises
  `card_pending` when `punishment_active_card` set.
- `_emit_settled`: sets `room.punishment_active_card` + emits
  `mode_aftereffects.punishment_card` (handler regression via `FakeSocketIO`).
- `punishment:done`: increments tally, clears card, broadcasts patch +
  `punishment:cleared`; no-op when no card; `not_in_room` guard.
- Room field serialization (`punishment_deck`/`_done_count`/`_active_card`).
- `create_room` defaults deck to `mild` for punishment; `update_room` changes it.

### Frontend
- `punishment.ts` helpers.
- `RoomModePickerSheet`: deck sub-picker shows only for punishment; `onCreate`
  passes the deck.
- Store: `markPunishmentDone` emits; `punishment:cleared`/patch clears overlay.
- RoomPage gating: overlay + Done + tally render when pending; hub disabled
  while pending.

### Docs
- Extend `docs/game-modes.md` with Punishment (decks, draw-without-replacement,
  victim framing, Done tally, block-until-done, host-language cards).
- Update `CLAUDE.md` doc-index note + Current-phase after ship.

### Gates
`pytest` + `mypy --strict` + `ruff` + `vitest` + `tsc` + `eslint` + `i18n:check`.

## Open questions / deferred

- Card text intentionally bypasses `t()` (server content, like segment labels).
- Reshuffle-on-exhaustion is the chosen exhaustion behavior (vs stop) — keeps
  long sessions going.
- Per-viewer card language is explicitly out (host-language only this slice).
