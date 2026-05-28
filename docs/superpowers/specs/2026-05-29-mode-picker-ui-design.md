# Hoba! — Mode picker UI design (2026-05-29)

> Second slice of Stage D. Makes `game_mode` and `turn_based`
> reachable from the phone without API calls. Three visible pieces:
> mode picker sheet on room creation, mode badge in room header,
> `turn_based` as a third option in the host settings sheet's
> spin_policy row. Builds on the 2026-05-28 foundation slice
> (spec `2026-05-28-turn-based-mode-defaults-design.md`).

---

## Context

The foundation slice (commits `6a91c46 … 023b6f3`) shipped backend
plumbing for `turn_based` spin policy and mode-default
`spin_policy` derivation, plus the room-header turn status line on
the frontend. But there's no UI path to actually USE any of it:

- `CreatePage` is solo-only — doesn't create rooms.
- Room creation happens in `SpinPage.handleInviteFriends`, which
  doesn't expose `game_mode`.
- `RoomSettingsSheet` only shows two spin_policy options
  (`anyone` / `host_only`).
- No mode badge surfaces `room.game_mode` anywhere in the UI.

Per spec §15 Phase 7 ("Mode picker at room creation, mode badge in
room header") this slice closes the gap so the foundation slice's
work is reachable. Per-mode gameplay (Elimination segment shatter,
Punishment deck, Chaos events) is still out of scope — separate
Stage D slices.

Brand context: `Hoba!` in EN/code/docs/files; `Хоба!` only inside
UK locale UI. This doc uses `Hoba!`.

---

## Goal

Three visible pieces:

1. **Mode picker sheet on room creation.** Tap `+ Invite friends`
   on `SpinPage` → bottom sheet opens with 4 modes
   (Classic / Elimination / Punishment / Chaos). Classic
   preselected. Tap `Create room` → API call with `game_mode` →
   navigate to `/room/<code>`.

2. **Mode badge in RoomPage header.** Small chip
   `{emoji} {label}` near `RoomCodePill`. Hidden for `classic`
   and `rigged` (defensive — don't accidentally reveal Rigged).

3. **`turn_based` option in `RoomSettingsSheet`.** Third row in
   the existing `spin_policy` selector. Backend handles the
   cursor lifecycle (commit `3a3e939`); PATCH broadcast extended
   to carry `current_turn_user_id` when it changes server-side.

## Non-goals

- **No mode-change-mid-room.** `game_mode` is set at creation,
  immutable from the room. Spec §11 lists it as future work but
  it's meaningful only after Elimination / Punishment / Chaos UI
  ships.
- **No Rigged in the picker.** Spec §5.5 reserves it for the
  1.5 s long-press reveal — preserves the "yo wait what" moment.
- **No per-mode gameplay UI.** Elimination shatter, Punishment
  deck, Chaos events all stay out of scope. This slice ships
  metadata only.
- **No `CreatePage` change.** That page is solo-only; room
  creation happens from `SpinPage`.
- **No `CLAUDE.md` "Current phase" rewrite.** Stage D in
  progress; owner declares `STAGE D COMPLETE` once gameplay UI
  also lands.

---

## Components + data

### `apps/webapp/src/data/gameModes.ts` (new)

Single source of truth for mode metadata. Pure module, no React.

```typescript
import { type GameMode } from "@/lib/api";

export interface GameModeMeta {
  id: GameMode;
  emoji: string;
  /** i18n key under `room` namespace, suffixed with `.label` and `.tagline`. */
  i18nKey: string;
}

/**
 * Picker order = display order. Rigged is intentionally excluded —
 * see spec §5.5 (reveal via 1.5 s long-press, not via picker).
 */
export const PICKABLE_GAME_MODES: readonly GameModeMeta[] = [
  { id: "classic", emoji: "🎯", i18nKey: "modes.classic" },
  { id: "elimination", emoji: "💥", i18nKey: "modes.elimination" },
  { id: "punishment", emoji: "🃏", i18nKey: "modes.punishment" },
  { id: "chaos", emoji: "🌀", i18nKey: "modes.chaos" },
];

export const DEFAULT_GAME_MODE: GameMode = "classic";

export function getGameModeMeta(id: GameMode): GameModeMeta | undefined {
  return PICKABLE_GAME_MODES.find((m) => m.id === id);
}
```

### `apps/webapp/src/lib/api.ts` extension

`RoomCreatePayload` gains the optional `game_mode` field:

```typescript
export interface RoomCreatePayload {
  question_text: string;
  segments: Array<{...}>;
  title?: string;
  spin_policy?: SpinPolicy;
  suggestion_policy?: SuggestionPolicy;
  game_mode?: GameMode;
}
```

Server already accepts this (foundation slice commit `2490e95`).

### `apps/webapp/src/components/room/RoomModePickerSheet.tsx` (new)

Bottom sheet for picking `game_mode` before room creation. Reuses
the `Sheet` DS primitive.

```typescript
interface RoomModePickerSheetProps {
  open: boolean;
  loading: boolean;
  onClose(): void;
  onCreate(mode: GameMode): void;
}
```

Behaviour:

- `open=true` → renders 4 mode rows as a vertical list. Each row:
  emoji + `t("room:modes.<id>.label")` + small dim
  `t("room:modes.<id>.tagline")`.
- Selected mode highlighted (`brand-amber-3` border, matches
  `RoomSettingsSheet` pattern). Classic preselected on open;
  resets to Classic each time sheet opens fresh.
- Bottom: `<Button variant="accent" size="xl" fullWidth>` with
  `t("room:mode_picker.create")` label.
- `loading=true` disables the Create button via `Button`'s
  `loading` prop and blocks `onClose` from backdrop tap (prevent
  user from dismissing during API call).
- Component is presentation + selection state only; no API call.

### `apps/webapp/src/components/room/GameModeBadge.tsx` (new)

Tiny presentation component for the RoomPage header.

```typescript
interface GameModeBadgeProps {
  mode: GameMode;
  className?: string;
}
```

Renders `{emoji} {label}` as a small chip (visual weight similar
to `RoomCodePill` but smaller — `text-sm`, lighter padding).
Returns `null` for `classic` (no badge for default) and `rigged`
(defensive — preserves the long-press reveal). Reads label from
`t("room:modes.<id>.label")` via `getGameModeMeta`.

---

## Flow integration

### `SpinPage` — pre-flight sheet on Invite

Current `handleInviteFriends` runs the full create flow inline.
New shape: handler opens the sheet; sheet `onCreate(mode)` calls
the API.

New state:

```typescript
const [modePickerOpen, setModePickerOpen] = useState(false);
```

Simplified handler:

```typescript
function handleInviteFriends(): void {
  if (wheel === undefined || inviteLoading) return;
  haptics.medium();
  setModePickerOpen(true);
}

async function handleCreateRoom(mode: GameMode): Promise<void> {
  if (wheel === undefined || inviteLoading) return;
  setInviteLoading(true);
  try {
    const state = await api.createRoom({
      question_text: wheel.questionText,
      segments: wheel.segments.map((s) => ({...})),  // existing mapping
      game_mode: mode,
    });
    navigate(`/room/${state.room.code}`);
  } catch (exc) {
    // existing toast path
    const code = exc instanceof ApiError ? exc.code : "create_failed";
    // ... existing toast ...
    setInviteLoading(false);
  }
}
```

`<RoomModePickerSheet>` rendered conditionally on the same level
as existing sheets:

```tsx
<RoomModePickerSheet
  open={modePickerOpen}
  loading={inviteLoading}
  onClose={() => setModePickerOpen(false)}
  onCreate={handleCreateRoom}
/>
```

### `RoomPage` — mode badge in header

Find the existing `<RoomCodePill code={...} />` in the header.
Add `<GameModeBadge>` immediately after it:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <RoomCodePill code={snapshot.room.code} />
  <GameModeBadge mode={snapshot.room.game_mode} />
</div>
```

`flex-wrap` so badge falls below on narrow viewports if width
becomes a problem. Badge returns `null` for Classic so layout is
unchanged for the default case.

### `RoomSettingsSheet` — `turn_based` third option

Existing two-button selector becomes three. Same row pattern as
today's `anyone` / `host_only`:

```tsx
<button onClick={() => patchPolicy("turn_based")} ...>
  {t("room:settings.spin_policy.turn_based")}
</button>
```

EN: `Take turns`. UK: `По черзі`.

When host taps it, the existing `api.patchRoom(code, { spin_policy: "turn_based" })`
fires. Server-side `update_room` (commit `3a3e939`) seeds cursor
to host_id when status=active, or leaves null in lobby. **Server
must also broadcast the cursor change** — see backend section
below.

### Backend — PATCH broadcast carries cursor side-effect

The current PATCH endpoint at
`apps/api/src/hoba_api/api/v1/rooms.py:135-141` broadcasts only
the patch dict:

```python
if patch_dict:
    await sio.emit(
        "room:updated",
        {"patch": patch_dict},
        room=room.code,
        namespace=NAMESPACE,
    )
```

When host PATCHes `spin_policy → turn_based` on an active room,
`update_room` mutates `current_turn_user_id` server-side, but
the broadcast doesn't tell guests about it. Guests would see
`spin_policy` change but not the new cursor → mismatch with
`computeCanSpin`.

Fix: capture cursor before/after, augment broadcast when changed:

```python
cursor_before = room.current_turn_user_id
await update_room(db, room, user_id=user.id, patch=patch_dict)
await db.commit()
broadcast_patch = dict(patch_dict)
if room.current_turn_user_id != cursor_before:
    broadcast_patch["current_turn_user_id"] = room.current_turn_user_id
if broadcast_patch:
    await sio.emit(
        "room:updated",
        {"patch": broadcast_patch},
        room=room.code,
        namespace=NAMESPACE,
    )
```

Stage B regression check: the existing
`test_patch_room_broadcasts_room_updated` PATCHes
`spin_policy: "host_only"` on a lobby room. Cursor is None before
and after (lobby → no cursor seeding); `broadcast_patch` equals
`patch_dict`; existing test passes unchanged.

---

## i18n keys

13 new EN keys × 2 locales. All under `room` namespace.

### Picker UI

```json
{
  "mode_picker": {
    "title": "Choose a game mode",
    "create": "Create room"
  }
}
```

UK: `"Виберіть режим"` / `"Створити кімнату"`.

### Per-mode labels + taglines

```json
{
  "modes": {
    "classic": {
      "label": "Classic",
      "tagline": "Spin the wheel. Settle anything."
    },
    "elimination": {
      "label": "Elimination",
      "tagline": "Losing segments disappear each round."
    },
    "punishment": {
      "label": "Punishment",
      "tagline": "Take turns. Loser draws a card."
    },
    "chaos": {
      "label": "Chaos",
      "tagline": "Random twist before every spin."
    }
  }
}
```

UK:

| mode | label | tagline |
|---|---|---|
| classic | Класичний | Крутимо колесо. Вирішуємо будь-що. |
| elimination | Вибуття | Програшні сегменти зникають щораунду. |
| punishment | Покарання | По черзі. Хто програв — тягне картку. |
| chaos | Хаос | Випадковий поворот перед кожним обертом. |

### Settings sheet — new option

```json
{
  "settings": {
    "spin_policy": {
      "turn_based": "Take turns"
    }
  }
}
```

UK: `"По черзі"`.

### Tagline guardrails

Taglines describe gameplay that's not yet wired (Elimination
segments don't actually shatter, etc.). Risk: user picks
Elimination → plays Classic-feeling spin → confusion. Mitigation:
keep taglines neutral about timing; if drift becomes a problem
during testing, swap to `"Coming soon"`.

---

## Testing strategy

### Frontend tests

**`apps/webapp/src/data/__tests__/gameModes.test.ts`** (new):

- `PICKABLE_GAME_MODES` has exactly 4 entries.
- No entry has `id === "rigged"`.
- `getGameModeMeta("elimination")` returns the entry.
- `getGameModeMeta("rigged")` returns `undefined`.
- `DEFAULT_GAME_MODE === "classic"`.

**`apps/webapp/src/components/room/__tests__/RoomModePickerSheet.test.tsx`** (new):

- Renders 4 mode rows when `open=true`.
- Classic preselected on open.
- Tap Elimination row → selection state changes.
- Tap Create → `onCreate("elimination")` fires.
- `loading=true` disables Create button.
- `loading=true` blocks `onClose` via backdrop tap.

**`apps/webapp/src/components/room/__tests__/GameModeBadge.test.tsx`** (new):

- Renders chip for elimination / punishment / chaos.
- Returns null for classic.
- Returns null for rigged (defensive).

**First `.tsx` component tests in this codebase.** Existing
frontend tests are all `.ts` (pure logic). Plan adds
`// @vitest-environment jsdom` directive at file top per vitest
docs. If `@testing-library/react` isn't already a dep, plan adds
it under `apps/webapp/package.json` devDependencies. Fallback:
extract selection logic into a `pickerLogic.ts` helper (similar
to `hubLogic.ts` precedent) and unit-test that, treating JSX as
glue.

### Backend tests

**`apps/api/tests/api/test_rooms.py`** — one new test for the
PATCH cursor broadcast:

```python
def test_patch_room_to_turn_based_active_broadcasts_cursor(
    client: TestClient,
    init_data: str,
    captured_sio_emits: list[EmittedSioCall],
) -> None:
    """Stage D mode-picker slice: when host flips to turn_based on an
    active room, the broadcast must carry both spin_policy AND the new
    current_turn_user_id so guests see both updates without reconnect.
    """
    # Create room, set status to "active" directly (simpler than running
    # a real spin), PATCH spin_policy to turn_based, assert broadcast
    # carries both fields.
```

### Estimated test deltas

- Backend: **+1 test**. Baseline 145 → 146.
- Frontend: **+~14 tests** (5 gameModes + 6 picker + 5 badge − overlap). Baseline 62 → ~76.

### Quality-gate baseline at exit

~146 backend / ~76 frontend, ≥91 % coverage, ruff / mypy --strict
/ eslint / tsc --noEmit / i18n:check all clean.

### Visual verification (recommended, not blocking)

1. Tap `+ Invite friends` → sheet opens with Classic preselected.
2. Tap Elimination → highlight moves.
3. Tap `Create room` → navigate to room.
4. Header shows `💥 Elimination` badge next to code pill.
5. Open host settings ⚙️ → three options including `Take turns`.
6. Tap `Take turns` → server-side cursor seeds.
7. Locale flip EN ⇄ UK → all new copy renders correctly.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| First `.tsx` component tests need jsdom + RTL. | Per-file `@vitest-environment jsdom` directive. Plan adds `@testing-library/react` dep if missing. Fallback: extract pure selection logic into helper, unit-test that. |
| Tagline-vs-reality drift (gameplay not wired). | Taglines neutral about timing. Fallback: swap to `"Coming soon"`. Owner accepted. |
| PATCH broadcast change risks Stage B regression. | Existing `test_patch_room_broadcasts_room_updated` PATCHes host_only on lobby → cursor stays None → broadcast unchanged → existing test passes. New test covers the additive turn_based-active case. |
| `Sheet` `dismissable` prop may not exist. | Verify in implementation. If missing: (a) add as 1-line DS extension, or (b) pass `onClose={loading ? () => {} : actualClose}` (uglier, no DS change). |
| `SpinPage.inviteLoading` overlaps with sheet `loading` prop. | Reuse `inviteLoading` directly as the sheet's `loading` prop — single source of truth. |

---

## Sequencing + branching

Direct commits on `main`, matching foundation-slice pattern.
Per-task quality-gate re-runs, rollback rule on regression.

1. **Backend.** PATCH `room:updated` broadcast extension + test.
2. **Frontend data layer.** `data/gameModes.ts` + tests.
   `lib/api.ts` `RoomCreatePayload.game_mode` extension.
3. **Frontend components.** `RoomModePickerSheet` + tests,
   `GameModeBadge` + tests. (If jsdom setup needed, single
   sub-commit at top of phase.)
4. **Frontend integration.** `SpinPage` flow rework. `RoomPage`
   header gains badge. `RoomSettingsSheet` gains `turn_based`
   option.
5. **i18n + final gates.** EN + UK keys. Full gates green.
   Status block.

**Total estimate:** 9–12 commits.

---

## Open questions

None blocking. Two implementation-time unknowns flagged in Risks:
jsdom availability and `Sheet.dismissable` prop existence. Both
resolvable by the implementer; no design decision blocked.
