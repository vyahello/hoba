# Punishment v2 — Prediction Wager — design

> Stage D enhancement of the Punishment mode (spec §5.3). The base
> "winning-segment-is-the-victim" mechanic shipped 2026-05-29 but never answered
> *who actually does the dare* — segments are usually options (🍕/🍔), not people.
> This redesign makes Punishment a **wager game**: players predict where the wheel
> will land; whoever guesses wrong does a dare. Built on the existing
> `GameModeEngine` / `PunishmentEngine` scaffold and the existing decks.

## Goal

A room in `punishment` mode plays a prediction round: every present player
**secretly** locks a guess (which segment the wheel will land on), the **host**
spins once all are locked, all guesses **reveal at once**, and each player whose
guess was **wrong** draws their **own** punishment card. Correct guessers are
"safe". A room-wide **"Punishments done: N"** tally counts resolved cards across
the session. Everything is server-authoritative (rule 2) — clients never see the
deck, and never see others' predictions before the reveal.

This **replaces** the base victim-segment behavior. Same `game_mode =
"punishment"`, same decks (mild/spicy/chaos × en/uk × 30, host language,
draw-without-replacement), same deck-picker, same `PunishmentEngine` + registry
entry.

## Decisions locked in brainstorming (2026-05-30)

1. **Direction:** prediction / wager (not person-target). Wheel keeps spinning
   over the option segments; players predict the landing segment.
2. **Round flow:** *everyone must guess*. SPIN is blocked until every present
   participant has locked a prediction.
3. **Cards dealt:** *one card per wrong guesser* — each wrong player draws their
   own distinct dare (draw-without-replacement), each with its own Done.
4. **Deadlock guard:** host *"Spin anyway"* (force) **and** auto-drop of any
   player who leaves the room from the required-guess set.
5. **Spin trigger:** *host only* (once predictions complete, or via Spin anyway).
6. **All-correct:** *"Everyone escaped! 🍀"* — no cards dealt; host starts a new
   round. (No auto re-spin.)
7. **Visibility:** *secret until reveal* — during predicting others see only a
   locked count + who-is-pending, never the picks. All reveal together on settle.
8. **Pick UI:** *chip row under the wheel* (one chip per segment), not
   tap-the-wedge. Wheel hub stays the spin control.

## Non-negotiables carried in

- Server-authoritative draw **and** prediction secrecy (rule 2): the deck is
  never sent to clients; other players' predictions are never sent to a client
  before the reveal (per-viewer redaction).
- `mypy --strict` / `tsc --noEmit` clean (rule 3); every user-facing string via
  `t()` (rule 5), EXCEPT the card deck text (server-authored content over the
  wire, like user-entered segment labels — unchanged from the base slice).
- Reuse the `GameModeEngine` / `PunishmentEngine` scaffold; no new abstraction
  (rule 6). The engine stays minimal; predict/resolve/draw is service-level.
- No silent fallbacks (rule 7): every rejection path emits a localized error key.

---

## 1. Round lifecycle

```
   ┌─────────────┐  punishment:predict {segment_id}    ┌──────────────┐
   │  PREDICTING │ ──────────────────────────────────▶ │  (locked++)  │
   │ cards=null  │  broadcasts locked_user_ids only     └──────┬───────┘
   └─────┬───────┘                                            │ all present locked
         │ host SPIN (gated)  or  host "Spin anyway" (force)  ◀┘ (else SPIN locked)
         ▼
   ┌─────────────┐  settle: reveal all guesses, draw a card per wrong guesser
   │  RESOLVED   │  cards = { uid: {text,deck,card_index,done:false} }  (or {} = escaped)
   │ cards!=null │
   └─────┬───────┘
         │ each loser: punishment:done {user_id}  → card.done=true, done_count++
         │ host: round:reset  → predictions=null, cards=null, result=null
         ▼
   ┌─────────────┐
   │  PREDICTING │  (next round; done_count persists across the session)
   └─────────────┘
```

**Phase derivation (no explicit column):** `predicting` ⇔
`punishment_cards IS NULL`; `resolved` ⇔ `punishment_cards IS NOT NULL`
(`{}` = everyone escaped; a non-empty map = pending/loser cards). "All done" ⇔
every card's `done` is true (or cards is `{}`).

**Losers** = users present in `punishment_predictions` whose guess ≠
`punishment_result_segment_id`. **Safe** = guess == result. **Sat out**
(force-start non-guessers) = no entry in predictions ⇒ no card.

**Tally** (`punishment_done_count`) is cumulative across rounds for the room
session; `round:reset` does **not** reset it.

## 2. Data model — Alembic 0010

On `rooms`, **keep**: `punishment_deck` (str|None), `punishment_done_count`
(int, default 0).

**Add** (all nullable — use `op.add_column`, **no** `batch_alter_table`, per the
0004/0005 lesson):

- `punishment_predictions` — `JSON | None`. Raw, server-only source of truth:
  `{ "<user_id>": <segment_id> }`. `NULL`/absent ⇒ no guesses yet this round.
- `punishment_cards` — `JSON | None`. After resolve:
  `{ "<user_id>": { "text": str, "deck": str, "card_index": int, "done": bool } }`.
  `NULL` while predicting; `{}` when everyone escaped; non-empty = loser cards.
- `punishment_result_segment_id` — `int | None`. The landed segment for the
  current round (reveal + safe/wrong classification). `NULL` while predicting.

**The old `punishment_active_card` column is intentionally NOT dropped.** It is
left in the table, always `NULL` going forward, superseded by
`punishment_cards`. Dropping a column on SQLite forces a `batch_alter_table`
table-rebuild, which already corrupted a live migration once (see
`docs/deployment.md` §9b / the deploy-gotchas record). The migration docstring
states this explicitly so the leftover column is documented, not silent. (If a
later migration consolidates schema on Postgres, it can drop the column safely
then.)

`build_room_state` stops reading `punishment_active_card`; `create_room` /
`update_room` stop writing it. No code references it after this slice.

## 3. Per-viewer serialization (secrecy)

`build_room_state(room, me_user_id)` already takes the connection's user, so it
redacts predictions by phase. The wire DTO (`RoomState` / `ServerRoom`) carries:

- `punishment_deck: PunishmentDeck | null` (unchanged).
- `punishment_done_count: number` (unchanged).
- `punishment_locked_user_ids: number[]` — **always** the set of user_ids that
  have locked a guess this round (derived from the raw map's keys). Reveals
  participation, not picks.
- `punishment_my_prediction: number | null` — the **viewer's own** locked
  segment id (so the client highlights its chip). Predicting phase; `null` if the
  viewer hasn't locked.
- `punishment_predictions: { [user_id: string]: number } | null` — the **full**
  map, populated **only when resolved** (`punishment_cards IS NOT NULL`); `null`
  while predicting. This is the reveal.
- `punishment_result_segment_id: number | null` — populated when resolved.
- `punishment_cards: { [user_id: string]: { text, deck, card_index, done } } | null`
  — populated when resolved.

Rule: while predicting, the server **never** emits any other player's chosen
segment id. A client gets only `locked_user_ids` (who) + its own
`my_prediction`. The full `punishment_predictions` map crosses the wire only on
and after settle.

## 4. Backend: engine + spin pipeline

`PunishmentEngine` (unchanged shape, `apps/api/src/hoba_api/modes/punishment.py`):
`mode_id="punishment"`; `get_visible_segments` → all; `on_spin_request` →
`SpinDecision(segments=all, duration_multiplier=1.0, effects={})`;
`on_spin_settled` → `ModeEffects()`; `is_round_over` → `False`. Predict/resolve/
draw are **service** concerns (engines stay pure/DB-free).

Registry entry `"punishment": PunishmentEngine()` unchanged.

### 4a. Prediction lock — `services/punishment.py` (new module helpers)

`lock_prediction(session, room, user_id, segment_id) -> None`:
- Reject (`RoomServiceError("round_resolved")`) if `room.punishment_cards is not
  None` (predictions closed once resolved).
- Reject (`RoomServiceError("invalid_segment")`) if `segment_id` is not a current
  visible segment of the active question.
- Set `room.punishment_predictions[str(user_id)] = segment_id` (init `{}` if
  None); commit.

`drop_prediction(session, room, user_id)` — used on leave: remove the key if
present; commit. No-op if absent.

`present_user_ids(room) -> set[int]` — the set of currently-joined participants
(from `RoomParticipant` rows with a live session, mirroring how presence is
already computed). Used for the all-locked gate.

`all_present_locked(room, present: set[int]) -> bool` — `present` is non-empty
and ⊆ the prediction keys.

### 4b. Spin gate — extend the existing spin trigger

`on_spin_trigger` handler accepts an optional `force: bool` in the payload
(default `False`). After the existing permission checks, when
`room.game_mode == "punishment"`:
1. Host-only: a non-host caller → `error { code: "not_host" }`. (Punishment's
   mode-default `spin_policy` is set to `host_only`; this check is also enforced
   here so it holds regardless of a manually-changed policy.)
2. Reject if already resolved: `room.punishment_cards is not None` →
   `error { code: "round_resolved" }` (must reset before re-spinning).
3. Gate: unless `force` is true, require `all_present_locked`. Otherwise
   `error { code: "predictions_pending" }`.
4. With `force`, proceed using whatever predictions exist (non-lockers sit out).

Existing throttles (cooldown, per-room hourly cap) run after these, unchanged.

### 4c. Resolve — `_emit_settled` (handler) + `services/punishment.py`

After the normal settle computes `result_segment_id`, when
`room.game_mode == "punishment"`:

`resolve_predictions(session, room, result_segment_id, host_lang) ->
dict[str, dict]`:
1. `predictions = room.punishment_predictions or {}`.
2. `losers = [uid for uid, seg in predictions.items() if seg != result_segment_id]`.
3. `deck = room.punishment_deck or "mild"`; `lang = host_lang` (host
   `language_code`, fallback `"en"`).
4. Draw **distinct** cards for the losers, draw-without-replacement, in a single
   pass: start from the already-drawn index set for this question (the
   `card_index` values recorded in prior punishment spins' `mode_state_snapshot`
   for the active question), then for each loser pick
   `idx = secrets.choice(sorted(pool))`, remove from pool; if the pool empties
   mid-pass, reshuffle (pool = full `range(CARDS_PER_DECK)` minus indices already
   used **in this same resolve**, so a single resolve never repeats a card).
5. `cards = { uid: {"text": deck_cards(deck, lang)[idx], "deck": deck,
   "card_index": idx, "done": False} for uid, idx in zip(losers, drawn) }`.
   When there are no losers, `cards = {}` (everyone escaped).
6. `room.punishment_cards = cards`; `room.punishment_result_segment_id =
   result_segment_id`; record the drawn indices on the spin's
   `mode_state_snapshot` (`{"punishment": {"deck": deck, "lang": lang,
   "card_indices": [...]}}`); commit.

`_emit_settled` then broadcasts, in `spin:settled.mode_aftereffects`:
```json
{
  "punishment_result_segment_id": 7,
  "punishment_predictions": { "3": 7, "4": 2, "5": 1 },
  "punishment_cards": { "4": { "text": "...", "deck": "spicy", "card_index": 11, "done": false },
                        "5": { "text": "...", "deck": "spicy", "card_index": 4,  "done": false } },
  "everyone_escaped": false
}
```
plus a `room:updated { patch: { punishment_cards, punishment_result_segment_id,
punishment_predictions } }` so late joiners / reconnects get the resolved state.
Classic / elimination aftereffects unchanged. `everyone_escaped` is
`len(cards) == 0` (and at least one prediction existed).

## 5. Events

- **`punishment:predict { segment_id }`** (client→server, any participant):
  `not_in_room` guard; `lock_prediction`; on success broadcast `room:updated
  { patch: { punishment_locked_user_ids } }` to the room (reveals only the
  key set, never the segment). The caller's own `punishment_my_prediction` is
  known optimistically client-side (it just tapped) and confirmed on the next
  full snapshot.
- **`spin:trigger { force?: boolean }`** (extended, see §4b).
- **`punishment:done { user_id }`** (client→server, any participant): no-op if
  `room.punishment_cards is None` or the `user_id` has no pending card or is
  already done. Else set that card's `done = true`, `room.punishment_done_count
  += 1`, commit; broadcast `room:updated { patch: { punishment_cards,
  punishment_done_count } }` AND `punishment:cleared { user_id }`. `not_in_room`
  guard. (Anyone may tap any card's Done — shared-phone friendly, matches the
  base slice.)
- **`round:reset`** (existing, host-only): the punishment branch sets
  `punishment_predictions = None`, `punishment_cards = None`,
  `punishment_result_segment_id = None`; commit; broadcast the existing
  `round:reset` event (clients clear local round UI). `done_count` persists.
- **Leave** (existing disconnect/leave handling): call `drop_prediction` for the
  departing user and, if it changed anything, broadcast the updated
  `punishment_locked_user_ids` patch so the host's "waiting on" line updates.

## 6. Frontend

### Types (`lib/api.ts`)
- `ServerRoom` gains: `punishment_locked_user_ids: number[]`,
  `punishment_my_prediction: number | null`,
  `punishment_predictions: Record<string, number> | null`,
  `punishment_result_segment_id: number | null`,
  `punishment_cards: Record<string, PunishmentCard> | null`, where
  `PunishmentCard = { text: string; deck: PunishmentDeck; card_index: number;
  done: boolean }`. (`punishment_deck`, `punishment_done_count` already exist.)
  Remove `punishment_active_card` from the client type.
- `SpinSettledEvent.mode_aftereffects` gains the §4c fields.

### Pure helpers (`features/rooms/punishment.ts`, extend)
- `isPunishment(snapshot)` (exists).
- `punishmentPhase(snapshot): "predicting" | "resolved"`.
- `lockedUserIds(snapshot): number[]`.
- `myPrediction(snapshot): number | null`.
- `pendingCards(snapshot): Array<{ userId: number } & PunishmentCard>` (resolved).
- `isEveryoneEscaped(snapshot): boolean` (resolved & predictions existed & no cards).
- `allPresentLocked(snapshot, presentUserIds): boolean` — host SPIN gate.
- `waitingOnUserIds(snapshot, presentUserIds): number[]` — present − locked.
- `doneCount(snapshot): number`.
All unit-tested; keeps `RoomPage` lean.

### Store (`stores/room.ts`)
- New action `predictPunishment(segmentId)` → emits `punishment:predict`.
- `markPunishmentDone(userId)` → emits `punishment:done { user_id }` (was
  no-arg; now targets a specific card).
- Handle `punishment:cleared { user_id }` (immediate per-card overlay dismiss;
  the `room:updated` patch is the authoritative state) and the resolve patch.
- Optimistic local set of `my_prediction` on `predictPunishment` for instant
  chip highlight (reconciled by the next snapshot).

### RoomPage UI (gated on `game_mode === "punishment"`)
- **Tally** near the `GameModeBadge`: "Punishments done: N" (existing).
- **Predicting phase:**
  - **Chip row** under the wheel: one chip per visible segment (emoji + label,
    ≥44px targets). Tapping locks/changes the viewer's guess → `predictPunishment`;
    the chosen chip highlights (driven by `myPrediction`). Disabled once resolved.
  - **Status line:** "🔮 {k}/{n} locked" + "waiting on {names}" (host sees names;
    everyone sees the count). Names come from participant `display_name`.
  - **Spin control:** host-only. Hub SPIN enabled when `allPresentLocked`; else
    disabled with a hint. Host also gets a **"Spin anyway"** button (sends
    `spin:trigger { force: true }`) whenever ≥1 player has locked. Non-hosts see
    a "waiting for host to spin" hint, never a SPIN affordance.
- **Resolved phase:**
  - **Reveal** the landed segment (existing reveal beat) + each participant's
    guess (✓ safe / ✗ wrong) using the now-public `punishment_predictions`.
  - **Cards list:** one card per loser — name + "guessed wrong → {card text}" +
    deck badge + **Done ✓** (any participant → `markPunishmentDone(userId)`);
    a card greys out when `done`. NOT auto-dismiss (action items).
  - **Everyone escaped:** when `isEveryoneEscaped`, a "Everyone escaped! 🍀"
    hero instead of a cards list.
  - **New round:** host-only button → `resetRound()` (`round:reset`).
  - Spin hub disabled while resolved (must reset to spin again).
- Classic / elimination unaffected.

### Mode picker
Deck sub-picker for punishment is unchanged from the base slice (mild/spicy/chaos
chips; default `mild`). `onCreate(mode, deck?)` unchanged.

### i18n (room namespace, EN + UK)
New/changed keys (card text itself stays out of `t()`):
`punishment.tally` (ICU plural, exists), `punishment.done`,
`punishment.predicting_status` (ICU "{locked}/{total} locked"),
`punishment.waiting_on` ("Waiting on {names}"),
`punishment.your_guess` / `punishment.pick_hint` ("Tap to predict"),
`punishment.spin_when_ready` ("Waiting for everyone to guess"),
`punishment.spin_anyway`, `punishment.reveal_safe` ("{name} — safe ✨"),
`punishment.reveal_wrong` ("{name} guessed wrong → {card}"),
`punishment.everyone_escaped` ("Everyone escaped! 🍀"),
`punishment.new_round`, `punishment.waiting_for_host` ("Waiting for the host to
spin"). UK written natively (spec §6), not translated.

### Errors (`room.errors.*`, EN + UK)
Add `predictions_pending`, `round_resolved`, `invalid_segment` (and reuse the
existing `not_host`). Mapped through the existing `room.errors.*` fallback.

## 7. Testing

### Backend
- `PunishmentEngine` units unchanged (visible=all; no eliminate; not round-over).
- `lock_prediction`: stores guess; overwrites on re-lock; rejects when resolved
  (`round_resolved`); rejects a segment not on the wheel (`invalid_segment`).
- `drop_prediction`: removes key; no-op when absent.
- `all_present_locked` / `waiting`: true only when present ⊆ locked & present
  non-empty.
- Spin gate: punishment + non-host → `not_host`; all-locked false & no force →
  `predictions_pending`; force bypasses; resolved → `round_resolved`.
- `resolve_predictions`: losers = wrong guessers; distinct card per loser; no
  card for safe/sat-out; `{}` when all correct; draw-without-replacement (K
  losers → K distinct indices; never repeats within one resolve; reshuffles when
  pool < K).
- `_emit_settled` punishment: sets `punishment_cards` +
  `punishment_result_segment_id`, emits `mode_aftereffects` with reveal +
  `everyone_escaped` (FakeSocketIO regression).
- `punishment:done`: flips one card, increments tally, broadcasts patch +
  `punishment:cleared`; no-op for unknown/already-done card; `not_in_room` guard.
- `round:reset` punishment branch clears predictions/cards/result; preserves
  `done_count`.
- **Per-viewer redaction:** while predicting, `build_room_state` for a viewer
  exposes `locked_user_ids` + own `my_prediction` but NOT others' segments and
  `punishment_predictions is None`; once resolved, the full map is exposed.
- Field serialization for all new room columns; `create_room` defaults deck to
  `mild` for punishment and writes no `punishment_active_card`.

### Frontend
- `punishment.ts` helpers (phase, lockedUserIds, myPrediction, pendingCards,
  isEveryoneEscaped, allPresentLocked, waitingOnUserIds, doneCount).
- Store: `predictPunishment` emits + optimistic my_prediction; `markPunishmentDone`
  targets a user; `punishment:cleared` + patch update cards.
- RoomPage punishment branch: chip row renders + highlights my pick; locked
  count + waiting-on; host SPIN gated + "Spin anyway" visible only to host with
  ≥1 locked; resolved cards list + per-card Done + greying; everyone-escaped
  hero; new-round host-only; non-host never sees SPIN.

### Docs
- Rewrite the `docs/game-modes.md` Punishment section (prediction wager loop,
  secrecy, one-card-per-loser, host force-start + auto-drop, all-correct escape,
  new columns, events).
- Update `CLAUDE.md` Current-phase + doc-index note after ship.

### Gates
`pytest` + `mypy --strict` + `ruff` + `vitest` + `tsc --noEmit` + `eslint` +
`i18n:check` — all green before each commit (per the change-control discipline).

## 8. Open questions / deferred

- **`punishment_active_card` left undropped** on SQLite for prod migration
  safety (see §2). A future Postgres consolidation may drop it.
- **Tap-the-wedge** prediction UI deferred in favor of the chip row.
- **Scoring / streaks** for correct guessers deferred — correct = "safe" only.
- **Solo prediction** (outside a room) out of scope — Punishment stays room-only.
- **Per-viewer card language** still host-language only (unchanged from base).
- Card text continues to bypass `t()` (server-authored content).
