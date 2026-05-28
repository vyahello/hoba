# Mode Picker UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the mode picker sheet on room creation, the mode badge in the RoomPage header, and `turn_based` as a third option in `RoomSettingsSheet`, per spec at `docs/superpowers/specs/2026-05-29-mode-picker-ui-design.md`.

**Architecture:** New `data/gameModes.ts` carries mode metadata + pure helpers (`getGameModeMeta`, `shouldShowBadge`). Two thin React components (`RoomModePickerSheet`, `GameModeBadge`) wrap the metadata; selection state is local React `useState`. Backend PATCH endpoint extended to broadcast `current_turn_user_id` changes alongside the patch dict (1 new test). Existing `Sheet` DS primitive provides `dismissable` prop already; no DS extension needed.

**Tech Stack:** No new deps. Pure-logic test pattern (consistent with existing 6 test files in `apps/webapp/src/**/__tests__/`) — no jsdom, no `@testing-library/react`. Backend: FastAPI + SQLAlchemy 2.0 async + pytest.

---

## Pre-flight reminders

- **Brand:** `Hoba!` (Latin) in EN/code/docs/files; `Хоба!` only inside UK locale UI.
- **Commits:** Conventional commits (`feat:`, `chore:`, `docs:`, `test:`). **No Claude co-author trailer** (project memory `no-claude-coauthor.md`).
- **Rollback rule:** if a quality gate regresses after a commit, `git reset --hard HEAD~1`, fix root cause, re-commit. No patch-on-top.
- **TDD discipline:** every code-touching task writes the failing test first, runs it to confirm failure, then implements, then verifies pass.
- **No DOM tests in this slice.** Pure-logic helpers in `gameModes.ts` carry the testable surface. Components themselves are thin wrappers — visual verification per Task 11 covers them.
- **Direct commits on `main`** per Stage A/B/C/D-foundation pattern.
- **i18n script lives at repo root** — `pnpm i18n:check` must be invoked from `/home/kali/hoba`, NOT from `apps/webapp`. (Past plans got this wrong.)
- **`pnpm test`** in webapp runs `vitest run` directly — no `--run` flag needed.
- **`pnpm tsc --noEmit`** only works from `apps/webapp` (root has no `tsc` script).
- **Backend `uv run`** for all `pytest`, `ruff`, `mypy --strict` commands.

---

## Phase 1 — Backend

### Task 1: Capture quality-gate baseline

**Files:** None (verification only).

- [ ] **Step 1: Backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -3 && uv run ruff check . 2>&1 | tail -2 && uv run mypy --strict src 2>&1 | tail -2
```

Expected: 145 passed, ruff clean, mypy clean.

- [ ] **Step 2: Frontend gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test 2>&1 | tail -5 && pnpm lint 2>&1 | tail -2 && pnpm tsc --noEmit 2>&1 | tail -2
```

Expected: 62 passed, eslint clean, tsc clean.

- [ ] **Step 3: i18n from root**

```bash
cd /home/kali/hoba && pnpm i18n:check 2>&1 | tail -3
```

Expected: `i18n:check passed`.

- [ ] **Step 4: If any gate red, STOP**

Open chat: "Baseline broken: <gate> failed. Mode picker work cannot proceed until baseline is green." Wait for owner direction.

---

### Task 2: PATCH `room:updated` broadcast carries cursor delta

**Files:**
- Modify: `/home/kali/hoba/apps/api/src/hoba_api/api/v1/rooms.py:113-142` (the `patch_room_endpoint`)
- Modify: `/home/kali/hoba/apps/api/tests/api/test_rooms.py` (add 1 new test at end)

**Context.** Current `patch_room_endpoint` broadcasts only the patch dict (line 138). When host flips `spin_policy → turn_based` on an active room, `update_room` (commit `3a3e939`) mutates `room.current_turn_user_id` server-side, but guests' clients only see the `spin_policy` change. Their `computeCanSpin` then disagrees with the server. Fix: capture cursor before/after, append to broadcast patch when changed.

- [ ] **Step 1: Write the failing test**

Open `apps/api/tests/api/test_rooms.py`. Find the existing `test_patch_room_broadcasts_room_updated` (around line 74) — use the same `captured_sio_emits` fixture and `_payload()` helper. Append at the end of the file:

```python
def test_patch_room_to_turn_based_active_broadcasts_cursor(
    client: TestClient,
    init_data: str,
    captured_sio_emits: list[EmittedSioCall],
) -> None:
    """When host flips spin_policy to turn_based on an active room, the
    `room:updated` broadcast must carry BOTH spin_policy AND the new
    current_turn_user_id so guests see both updates without reconnect."""
    headers = {HEADER: init_data}
    create = client.post("/api/v1/rooms", json=_payload(), headers=headers)
    assert create.status_code == 201, create.text
    body = create.json()
    code = body["room"]["code"]
    host_id = body["room"]["host_id"]

    # Trip the room into active status directly (simpler than running a
    # real spin through the WS handler — we're testing the broadcast
    # logic, not the lobby→active transition).
    import asyncio

    from hoba_api.db import SessionLocal
    from hoba_api.services.rooms import get_room_by_code

    async def set_active() -> None:
        async with SessionLocal() as s:
            room = await get_room_by_code(s, code)
            assert room is not None
            room.status = "active"
            await s.commit()

    asyncio.get_event_loop().run_until_complete(set_active())

    captured_sio_emits.clear()
    patch = client.patch(
        f"/api/v1/rooms/{code}",
        json={"spin_policy": "turn_based"},
        headers=headers,
    )
    assert patch.status_code == 200, patch.text

    updates = [e for e in captured_sio_emits if e[0] == "room:updated"]
    assert len(updates) == 1, "expected exactly one room:updated"
    payload = updates[0][1]["patch"]
    assert payload["spin_policy"] == "turn_based"
    assert payload["current_turn_user_id"] == host_id
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/api/test_rooms.py::test_patch_room_to_turn_based_active_broadcasts_cursor -v 2>&1 | tail -10
```

Expected: AssertionError on `payload["current_turn_user_id"] == host_id` (KeyError because current code doesn't include cursor in broadcast).

- [ ] **Step 3: Update `patch_room_endpoint`**

Edit `apps/api/src/hoba_api/api/v1/rooms.py`. The current body of `patch_room_endpoint` (lines 113-142) is:

```python
@router.patch("/{code}", response_model=RoomState)
async def patch_room_endpoint(
    code: str,
    payload: RoomUpdateIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoomState:
    room = await get_room_by_code(db, code)
    if room is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="room_not_found",
        )
    patch_dict = payload.model_dump(exclude_unset=True)
    try:
        await update_room(db, room, user_id=user.id, patch=patch_dict)
    except RoomServiceError as exc:
        raise _service_error_to_http(exc) from exc
    await db.commit()
    # Broadcast the patch so connected guests' snapshots catch up
    # without a manual refresh — without this, a guest hitting SPIN
    # after the host flips spin_policy gets `not_allowed_to_spin`
    # instead of seeing the SPIN button disappear from their UI.
    if patch_dict:
        await sio.emit(
            "room:updated",
            {"patch": patch_dict},
            room=room.code,
            namespace=NAMESPACE,
        )
    return await build_room_state(db, room, current_user_id=user.id)
```

Replace with:

```python
@router.patch("/{code}", response_model=RoomState)
async def patch_room_endpoint(
    code: str,
    payload: RoomUpdateIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoomState:
    room = await get_room_by_code(db, code)
    if room is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="room_not_found",
        )
    patch_dict = payload.model_dump(exclude_unset=True)
    cursor_before = room.current_turn_user_id
    try:
        await update_room(db, room, user_id=user.id, patch=patch_dict)
    except RoomServiceError as exc:
        raise _service_error_to_http(exc) from exc
    await db.commit()
    # Broadcast the patch so connected guests' snapshots catch up
    # without a manual refresh. Also include current_turn_user_id when
    # the service-layer side-effect changed it (spin_policy flip to/from
    # turn_based seeds or clears the cursor — guests need both fields).
    broadcast_patch: dict[str, object] = dict(patch_dict)
    if room.current_turn_user_id != cursor_before:
        broadcast_patch["current_turn_user_id"] = room.current_turn_user_id
    if broadcast_patch:
        await sio.emit(
            "room:updated",
            {"patch": broadcast_patch},
            room=room.code,
            namespace=NAMESPACE,
        )
    return await build_room_state(db, room, current_user_id=user.id)
```

- [ ] **Step 4: Run the new test to confirm it passes**

```bash
uv run pytest tests/api/test_rooms.py::test_patch_room_to_turn_based_active_broadcasts_cursor -v 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Verify Stage B regression test still passes**

The existing `test_patch_room_broadcasts_room_updated` PATCHes `host_only` on a lobby room. Cursor stays None before AND after → `broadcast_patch` equals `patch_dict` → existing assertion `assert updates[0][1] == {"patch": {"spin_policy": "host_only"}}` still holds.

```bash
uv run pytest tests/api/test_rooms.py::test_patch_room_broadcasts_room_updated -v 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 6: Full backend gates**

```bash
uv run pytest -q 2>&1 | tail -3 && uv run ruff check . 2>&1 | tail -2 && uv run mypy --strict src 2>&1 | tail -2
```

Expected: 146 passed (145 + 1), ruff/mypy clean.

- [ ] **Step 7: Commit**

```bash
cd /home/kali/hoba && git add apps/api/src/hoba_api/api/v1/rooms.py apps/api/tests/api/test_rooms.py && git commit -m "feat(api): PATCH room:updated broadcast carries current_turn_user_id delta"
```

---

## Phase 2 — Frontend data layer

### Task 3: `data/gameModes.ts` + tests + `RoomCreatePayload.game_mode`

**Files:**
- Create: `/home/kali/hoba/apps/webapp/src/data/gameModes.ts`
- Create: `/home/kali/hoba/apps/webapp/src/data/__tests__/gameModes.test.ts`
- Modify: `/home/kali/hoba/apps/webapp/src/lib/api.ts:127-138` (`RoomCreatePayload` interface)

- [ ] **Step 1: Write the failing tests**

Create `apps/webapp/src/data/__tests__/gameModes.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  DEFAULT_GAME_MODE,
  PICKABLE_GAME_MODES,
  getGameModeMeta,
  shouldShowBadge,
} from "../gameModes";

describe("PICKABLE_GAME_MODES", () => {
  it("has exactly 4 entries", () => {
    expect(PICKABLE_GAME_MODES).toHaveLength(4);
  });

  it("excludes Rigged (spec §5.5 reserves it for long-press reveal)", () => {
    expect(PICKABLE_GAME_MODES.map((m) => m.id)).not.toContain("rigged");
  });

  it("includes the 4 normal modes in display order", () => {
    expect(PICKABLE_GAME_MODES.map((m) => m.id)).toEqual([
      "classic",
      "elimination",
      "punishment",
      "chaos",
    ]);
  });

  it("every entry has an emoji and i18nKey", () => {
    for (const m of PICKABLE_GAME_MODES) {
      expect(m.emoji.length).toBeGreaterThan(0);
      expect(m.i18nKey).toMatch(/^modes\./);
    }
  });
});

describe("getGameModeMeta", () => {
  it("returns the entry for a pickable mode", () => {
    const meta = getGameModeMeta("elimination");
    expect(meta).toBeDefined();
    expect(meta?.id).toBe("elimination");
    expect(meta?.emoji).toBe("💥");
  });

  it("returns undefined for rigged (intentionally absent from picker meta)", () => {
    expect(getGameModeMeta("rigged")).toBeUndefined();
  });
});

describe("DEFAULT_GAME_MODE", () => {
  it("is classic (party-game default)", () => {
    expect(DEFAULT_GAME_MODE).toBe("classic");
  });
});

describe("shouldShowBadge", () => {
  it("returns true for elimination, punishment, chaos", () => {
    expect(shouldShowBadge("elimination")).toBe(true);
    expect(shouldShowBadge("punishment")).toBe(true);
    expect(shouldShowBadge("chaos")).toBe(true);
  });

  it("returns false for classic (default — no badge for boring case)", () => {
    expect(shouldShowBadge("classic")).toBe(false);
  });

  it("returns false for rigged (defensive — preserves long-press reveal)", () => {
    expect(shouldShowBadge("rigged")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test src/data/__tests__/gameModes.test.ts 2>&1 | tail -10
```

Expected: import errors on `gameModes` (module doesn't exist yet).

- [ ] **Step 3: Create `gameModes.ts`**

Create `apps/webapp/src/data/gameModes.ts`:

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
 * see spec §5.5 (revealed via 1.5 s long-press, not via picker).
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

/**
 * Whether the RoomPage header should render a GameModeBadge for this mode.
 * Classic = false (no badge for the default). Rigged = false (defensive;
 * don't accidentally reveal the long-press feature in the header).
 */
export function shouldShowBadge(mode: GameMode): boolean {
  return mode !== "classic" && mode !== "rigged";
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
pnpm test src/data/__tests__/gameModes.test.ts 2>&1 | tail -10
```

Expected: 12 passed.

- [ ] **Step 5: Add `game_mode` to `RoomCreatePayload`**

Edit `apps/webapp/src/lib/api.ts`. The current `RoomCreatePayload` (around line 127) is:

```typescript
export interface RoomCreatePayload {
  question_text: string;
  segments: Array<{
    label: string;
    emoji?: string | null;
    color_seed?: number;
    weight?: number;
  }>;
  title?: string;
  spin_policy?: SpinPolicy;
  suggestion_policy?: SuggestionPolicy;
}
```

Add `game_mode?: GameMode;` after `suggestion_policy`:

```typescript
export interface RoomCreatePayload {
  question_text: string;
  segments: Array<{
    label: string;
    emoji?: string | null;
    color_seed?: number;
    weight?: number;
  }>;
  title?: string;
  spin_policy?: SpinPolicy;
  suggestion_policy?: SuggestionPolicy;
  game_mode?: GameMode;
}
```

`GameMode` is already exported from this file (verified at line 50).

- [ ] **Step 6: Run all frontend gates**

```bash
pnpm test 2>&1 | tail -5 && pnpm lint 2>&1 | tail -2 && pnpm tsc --noEmit 2>&1 | tail -2
```

Expected: 74 passed (62 + 12), eslint clean, tsc clean.

- [ ] **Step 7: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src/data apps/webapp/src/lib/api.ts && git commit -m "feat(webapp): data/gameModes.ts + RoomCreatePayload.game_mode"
```

---

## Phase 3 — Frontend components

### Task 4: `RoomModePickerSheet` component

**Files:**
- Create: `/home/kali/hoba/apps/webapp/src/components/room/RoomModePickerSheet.tsx`

**Context.** The Sheet DS primitive (`apps/webapp/src/components/ds/Sheet.tsx`) already accepts a `dismissable?: boolean` prop (line 12). Setting `dismissable={!loading}` blocks backdrop tap, ESC key, and drag-to-dismiss during the API call. No DS extension needed.

Existing `RoomSettingsSheet.tsx` (lines 91-120) provides the exact "selectable row" pattern we should mirror — `ds-tactile` button with `aria-pressed`, active state highlighting, optional spinner.

No test file for this component — the picker is presentation glue around `gameModes.ts` data (already tested) and `Sheet` DS (already wired). Selection state is `useState<GameMode>(DEFAULT_GAME_MODE)`. Visual smoke verification covers it (Task 11).

- [ ] **Step 1: Create the component**

Create `apps/webapp/src/components/room/RoomModePickerSheet.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ds/Button";
import { Sheet } from "@/components/ds/Sheet";
import {
  DEFAULT_GAME_MODE,
  PICKABLE_GAME_MODES,
} from "@/data/gameModes";
import { type GameMode } from "@/lib/api";
import { haptics } from "@/lib/haptics";

export interface RoomModePickerSheetProps {
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onCreate: (mode: GameMode) => void;
}

/**
 * Bottom sheet for picking `game_mode` before room creation. Owner
 * (SpinPage) handles the API call; this component is selection + UI.
 *
 * Selection resets to Classic each time the sheet re-opens so the
 * common case ("just create the room") is a single Create tap.
 */
export function RoomModePickerSheet({
  open,
  loading,
  onClose,
  onCreate,
}: RoomModePickerSheetProps): JSX.Element {
  const { t } = useTranslation(["room"]);
  const [selected, setSelected] = useState<GameMode>(DEFAULT_GAME_MODE);

  // Reset to Classic each time the sheet re-opens.
  useEffect(() => {
    if (open) setSelected(DEFAULT_GAME_MODE);
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      dismissable={!loading}
      title={t("room:mode_picker.title")}
    >
      <div className="flex flex-col gap-2">
        {PICKABLE_GAME_MODES.map((meta) => {
          const isSelected = meta.id === selected;
          return (
            <button
              key={meta.id}
              type="button"
              disabled={loading}
              aria-pressed={isSelected}
              onClick={() => {
                if (loading || isSelected) return;
                haptics.selection();
                setSelected(meta.id);
              }}
              className={`ds-tactile w-full flex items-start gap-3 min-h-[56px] px-4 py-3 rounded-md text-left ${
                isSelected
                  ? "bg-brand-primary text-white"
                  : "bg-surface-light-2 dark:bg-surface-dark-2 text-ink-light-1 dark:text-ink-dark-1 active:bg-surface-light dark:active:bg-surface-dark"
              } disabled:opacity-60`}
            >
              <span aria-hidden className="text-2xl shrink-0 mt-0.5">
                {meta.emoji}
              </span>
              <span className="flex flex-col gap-0.5 grow">
                <span className="text-base font-semibold">
                  {t(`room:${meta.i18nKey}.label`)}
                </span>
                <span
                  className={`text-sm ${
                    isSelected
                      ? "text-white/85"
                      : "text-ink-light-2 dark:text-ink-dark-2"
                  }`}
                >
                  {t(`room:${meta.i18nKey}.tagline`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-5">
        <Button
          variant="accent"
          size="xl"
          fullWidth
          loading={loading}
          onClick={() => {
            onCreate(selected);
          }}
        >
          {t("room:mode_picker.create")}
        </Button>
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/kali/hoba/apps/webapp && pnpm tsc --noEmit 2>&1 | tail -5
```

Expected: clean. (i18n keys referenced — `t()` doesn't enforce existence at type level; `pnpm i18n:check` will surface them as "unused (maybe)" until Task 8 adds them, but the component compiles.)

- [ ] **Step 3: Run lint**

```bash
pnpm lint 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 4: Run existing tests (no new tests in this task)**

```bash
pnpm test 2>&1 | tail -5
```

Expected: 74 passed (no regression).

- [ ] **Step 5: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src/components/room/RoomModePickerSheet.tsx && git commit -m "feat(webapp): RoomModePickerSheet — bottom sheet for game_mode at creation"
```

---

### Task 5: `GameModeBadge` component

**Files:**
- Create: `/home/kali/hoba/apps/webapp/src/components/room/GameModeBadge.tsx`

**Context.** Tiny presentation component for the RoomPage header. Returns `null` for modes where `shouldShowBadge(mode)` is false (classic + rigged). Pure props in, JSX out — no state. Testability lives in `shouldShowBadge` (already covered in Task 3) and `getGameModeMeta` (also covered).

- [ ] **Step 1: Create the component**

Create `apps/webapp/src/components/room/GameModeBadge.tsx`:

```tsx
import { useTranslation } from "react-i18next";

import { getGameModeMeta, shouldShowBadge } from "@/data/gameModes";
import { type GameMode } from "@/lib/api";
import { cn } from "@/lib/cn";

export interface GameModeBadgeProps {
  mode: GameMode;
  className?: string;
}

/**
 * Small chip showing `{emoji} {label}` for the room's current
 * game_mode. Renders null for `classic` (the default — no badge for
 * the boring case) and `rigged` (defensive: don't accidentally reveal
 * the long-press feature in the header).
 */
export function GameModeBadge({
  mode,
  className,
}: GameModeBadgeProps): JSX.Element | null {
  const { t } = useTranslation(["room"]);
  if (!shouldShowBadge(mode)) return null;
  const meta = getGameModeMeta(mode);
  if (meta === undefined) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        "px-2.5 py-1 rounded-full",
        "bg-surface-light-2 dark:bg-surface-dark-2",
        "text-sm font-medium text-ink-light-1 dark:text-ink-dark-1",
        className,
      )}
    >
      <span aria-hidden>{meta.emoji}</span>
      <span>{t(`room:${meta.i18nKey}.label`)}</span>
    </span>
  );
}
```

- [ ] **Step 2: Verify it compiles + lints**

```bash
cd /home/kali/hoba/apps/webapp && pnpm tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -5
```

Expected: both clean.

- [ ] **Step 3: Run tests**

```bash
pnpm test 2>&1 | tail -5
```

Expected: 74 passed (no new tests; `shouldShowBadge` already tested in Task 3).

- [ ] **Step 4: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src/components/room/GameModeBadge.tsx && git commit -m "feat(webapp): GameModeBadge — header chip for non-classic, non-rigged modes"
```

---

## Phase 4 — Integration

### Task 6: SpinPage flow — sheet on Invite tap

**Files:**
- Modify: `/home/kali/hoba/apps/webapp/src/pages/SpinPage.tsx`

**Context.** Current `handleInviteFriends` runs `api.createRoom` inline (starting around line 170). New flow: tap → open sheet → sheet calls `onCreate(mode)` → wrapper runs the API call with the picked mode.

- [ ] **Step 1: Add the sheet import + state**

Edit `apps/webapp/src/pages/SpinPage.tsx`.

Add the import near the existing component imports (right after the `ResultBanner` import, around line 11):

```typescript
import { RoomModePickerSheet } from "@/components/room/RoomModePickerSheet";
```

Add the `GameMode` type to the existing `lib/api` import (around line 22). Current:

```typescript
import { api, ApiError } from "@/lib/api";
```

Replace with:

```typescript
import { api, ApiError, type GameMode } from "@/lib/api";
```

Add the state declaration alongside the existing `inviteLoading` (around line 63):

```typescript
  const [inviteLoading, setInviteLoading] = useState(false);
  const [modePickerOpen, setModePickerOpen] = useState(false);
```

- [ ] **Step 2: Reshape `handleInviteFriends` and add `handleCreateRoom`**

The current `handleInviteFriends` (around line 170-193) is:

```typescript
  async function handleInviteFriends(): Promise<void> {
    if (wheel === undefined || inviteLoading) return;
    setInviteLoading(true);
    haptics.medium();
    try {
      const state = await api.createRoom({
        question_text: wheel.questionText,
        segments: wheel.segments.map((s) => ({
          label: s.label,
          emoji: s.emoji ?? null,
          color_seed: s.colorSeed,
          weight: s.weight ?? 1,
        })),
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

Replace with:

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
        segments: wheel.segments.map((s) => ({
          label: s.label,
          emoji: s.emoji ?? null,
          color_seed: s.colorSeed,
          weight: s.weight ?? 1,
        })),
        game_mode: mode,
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

- [ ] **Step 3: Render the sheet**

Find where SpinPage's JSX ends — the last few lines before the closing `</> );` return. Add the `<RoomModePickerSheet>` element near the end of the rendered tree (right before the closing fragment):

```tsx
      <RoomModePickerSheet
        open={modePickerOpen}
        loading={inviteLoading}
        onClose={() => {
          setModePickerOpen(false);
        }}
        onCreate={(mode) => {
          void handleCreateRoom(mode);
        }}
      />
```

Use `grep -n "</>" apps/webapp/src/pages/SpinPage.tsx | tail -3` to locate the closing fragment if unsure.

- [ ] **Step 4: Verify gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -2 && pnpm test 2>&1 | tail -5
```

Expected: tsc clean, lint clean, 74 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src/pages/SpinPage.tsx && git commit -m "feat(webapp): SpinPage opens mode picker sheet before creating room"
```

---

### Task 7: RoomPage header gains `<GameModeBadge>`

**Files:**
- Modify: `/home/kali/hoba/apps/webapp/src/pages/RoomPage.tsx`

- [ ] **Step 1: Add the import**

Edit `apps/webapp/src/pages/RoomPage.tsx`. Near the existing room-component imports (after `FlyingReactions` / `ReactionsBar` / `RoomSettingsSheet` imports, around line 18), add:

```typescript
import { GameModeBadge } from "@/components/room/GameModeBadge";
```

- [ ] **Step 2: Render the badge after `<RoomCodePill>`**

Find the `<RoomCodePill code={snapshot.room.code} />` element (line 241 in current code). Insert the badge immediately after it:

```tsx
        <RoomCodePill code={snapshot.room.code} />
        <GameModeBadge mode={snapshot.room.game_mode} />
        <IconButton
          aria-label={t("room:actions.share")}
          ...
```

The wrapper `<section>` (line 240) already has `flex items-center gap-3` — badge slots in naturally between pill and IconButton.

- [ ] **Step 3: Verify gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -2 && pnpm test 2>&1 | tail -5
```

Expected: all clean, 74 passed.

- [ ] **Step 4: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src/pages/RoomPage.tsx && git commit -m "feat(webapp): RoomPage header shows GameModeBadge after the code pill"
```

---

### Task 8: `RoomSettingsSheet` — third `turn_based` option

**Files:**
- Modify: `/home/kali/hoba/apps/webapp/src/components/room/RoomSettingsSheet.tsx`

- [ ] **Step 1: Add the third `<PolicyOption>` row**

Edit `apps/webapp/src/components/room/RoomSettingsSheet.tsx`. The current two-option block (lines 61-78) is:

```tsx
        <div className="flex flex-col gap-2">
          <PolicyOption
            label={t("room:settings.spin_policy.anyone")}
            selected={snapshot.room.spin_policy === "anyone"}
            saving={saving === "anyone"}
            onSelect={() => {
              void applyPolicy("anyone");
            }}
          />
          <PolicyOption
            label={t("room:settings.spin_policy.host_only")}
            selected={snapshot.room.spin_policy === "host_only"}
            saving={saving === "host_only"}
            onSelect={() => {
              void applyPolicy("host_only");
            }}
          />
        </div>
```

Add a third option for `turn_based`:

```tsx
        <div className="flex flex-col gap-2">
          <PolicyOption
            label={t("room:settings.spin_policy.anyone")}
            selected={snapshot.room.spin_policy === "anyone"}
            saving={saving === "anyone"}
            onSelect={() => {
              void applyPolicy("anyone");
            }}
          />
          <PolicyOption
            label={t("room:settings.spin_policy.host_only")}
            selected={snapshot.room.spin_policy === "host_only"}
            saving={saving === "host_only"}
            onSelect={() => {
              void applyPolicy("host_only");
            }}
          />
          <PolicyOption
            label={t("room:settings.spin_policy.turn_based")}
            selected={snapshot.room.spin_policy === "turn_based"}
            saving={saving === "turn_based"}
            onSelect={() => {
              void applyPolicy("turn_based");
            }}
          />
        </div>
```

- [ ] **Step 2: Verify gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm tsc --noEmit 2>&1 | tail -5 && pnpm lint 2>&1 | tail -2 && pnpm test 2>&1 | tail -5
```

Expected: all clean, 74 passed.

- [ ] **Step 3: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src/components/room/RoomSettingsSheet.tsx && git commit -m "feat(webapp): RoomSettingsSheet third option — turn_based"
```

---

## Phase 5 — i18n + exit

### Task 9: i18n keys EN + UK

**Files:**
- Modify: `/home/kali/hoba/apps/webapp/src/locales/en/room.json`
- Modify: `/home/kali/hoba/apps/webapp/src/locales/uk/room.json`

13 EN keys × 2 locales. After this task all the new `t()` calls resolve and `pnpm i18n:check` shows no NEW `unused (maybe)` warnings.

- [ ] **Step 1: Update EN `room.json`**

Open `apps/webapp/src/locales/en/room.json`. The existing structure has `header`, `actions`, `share`, `code_pill`, `spin`, `turn`, `settings`, `reactions`, `errors` blocks. Insert the new top-level `mode_picker` and `modes` blocks (alphabetical order suggests: `mode_picker` right before `modes`, both before `reactions`). Also extend the existing `settings.spin_policy` block with `turn_based`.

The full replacement for the file:

```json
{
  "header": {
    "participants_count": "{count, plural, one {# in room} other {# in room}}",
    "wheel_aria": "Wheel"
  },
  "actions": {
    "share": "Share",
    "invite_friends": "+ Invite friends",
    "go_multiplayer": "Play together"
  },
  "share": {
    "message": "Join my Hoba! wheel · {code}",
    "copied_title": "Link copied",
    "copied_description": "Paste it in any chat to invite"
  },
  "code_pill": {
    "aria_label": "Copy room code {code}",
    "copied_title": "Code copied",
    "copy_failed_title": "Copy failed"
  },
  "spin": {
    "host_only_hint": "Host spins. React with the bar above."
  },
  "turn": {
    "my_turn": "Your turn",
    "waiting_named": "Waiting for {name}",
    "waiting_unnamed": "Waiting for next player",
    "no_one": "Waiting for someone to join"
  },
  "mode_picker": {
    "title": "Choose a game mode",
    "create": "Create room"
  },
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
  },
  "settings": {
    "open_aria": "Room settings",
    "title": "Room settings",
    "spin_policy": {
      "label": "Who can spin",
      "anyone": "Everyone in the room",
      "host_only": "Only me (host)",
      "turn_based": "Take turns"
    },
    "save_failed": "Couldn't save. Try again."
  },
  "reactions": {
    "aria_label": "React {emoji}"
  },
  "errors": {
    "create_failed": "Couldn't create the room. Try again.",
    "room_not_found": "Room not found.",
    "room_closed": "This room is closed.",
    "room_locked": "This room is locked.",
    "room_full": "This room is full.",
    "not_host": "Only the host can do that.",
    "not_allowed_to_spin": "Only the host can spin right now.",
    "rate_limited": "Slow down a moment.",
    "kicked": "You were removed from this room.",
    "not_in_room": "Not in a room.",
    "unauthenticated": "Sign-in expired. Reopen from Telegram.",
    "bad_payload": "Something looked off — try again.",
    "fallback": "Something went wrong."
  }
}
```

- [ ] **Step 2: Update UK `room.json`**

Open `apps/webapp/src/locales/uk/room.json`. Full replacement (mirror structure, natural Ukrainian per Stage A item 9 tone):

```json
{
  "header": {
    "participants_count": "{count, plural, one {# учасник} few {# учасники} many {# учасників} other {# учасника}}",
    "wheel_aria": "Колесо"
  },
  "actions": {
    "share": "Поділитись",
    "invite_friends": "+ Запросити друзів",
    "go_multiplayer": "Грати разом"
  },
  "share": {
    "message": "Заходь у мою кімнату Хоба! · код {code}",
    "copied_title": "Посилання скопійовано",
    "copied_description": "Вставте в чат, щоб запросити"
  },
  "code_pill": {
    "aria_label": "Скопіювати код {code}",
    "copied_title": "Код скопійовано",
    "copy_failed_title": "Не вдалося скопіювати"
  },
  "spin": {
    "host_only_hint": "Крутить ведучий. Реагуйте панеллю вище."
  },
  "turn": {
    "my_turn": "Ваш хід",
    "waiting_named": "Чекаємо на {name}",
    "waiting_unnamed": "Чекаємо наступного гравця",
    "no_one": "Чекаємо, поки хтось приєднається"
  },
  "mode_picker": {
    "title": "Виберіть режим",
    "create": "Створити кімнату"
  },
  "modes": {
    "classic": {
      "label": "Класичний",
      "tagline": "Крутимо колесо. Вирішуємо будь-що."
    },
    "elimination": {
      "label": "Вибуття",
      "tagline": "Програшні сегменти зникають щораунду."
    },
    "punishment": {
      "label": "Покарання",
      "tagline": "По черзі. Хто програв — тягне картку."
    },
    "chaos": {
      "label": "Хаос",
      "tagline": "Випадковий поворот перед кожним обертом."
    }
  },
  "settings": {
    "open_aria": "Налаштування кімнати",
    "title": "Налаштування кімнати",
    "spin_policy": {
      "label": "Хто може крутити",
      "anyone": "Усі в кімнаті",
      "host_only": "Лише я (ведучий)",
      "turn_based": "По черзі"
    },
    "save_failed": "Не вдалося зберегти. Спробуйте ще раз."
  },
  "reactions": {
    "aria_label": "Реакція {emoji}"
  },
  "errors": {
    "create_failed": "Не вдалося створити кімнату. Спробуйте ще раз.",
    "room_not_found": "Кімнату не знайдено.",
    "room_closed": "Цю кімнату закрито.",
    "room_locked": "Цю кімнату заблоковано.",
    "room_full": "У кімнаті немає місць.",
    "not_host": "Це може робити лише ведучий.",
    "not_allowed_to_spin": "Зараз крутити може лише ведучий.",
    "rate_limited": "Зачекайте секунду.",
    "kicked": "Вас видалили з кімнати.",
    "not_in_room": "Ви не в кімнаті.",
    "unauthenticated": "Сеанс минув. Відкрийте Mini App з Telegram.",
    "bad_payload": "Щось пішло не так — спробуйте ще раз.",
    "fallback": "Щось зламалось."
  }
}
```

- [ ] **Step 3: Run i18n:check from root**

```bash
cd /home/kali/hoba && pnpm i18n:check 2>&1 | tail -10
```

Expected: `i18n:check passed (en + uk parity + referenced-key coverage)`. The new keys should NOT appear as `unused (maybe)` — Tasks 4 + 5 + 8 already wire them via `t()`.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/locales && git commit -m "feat(webapp): room.modes + mode_picker + settings.spin_policy.turn_based EN+UK"
```

---

### Task 10: Final quality-gate run

**Files:** None (verification only).

- [ ] **Step 1: Backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . 2>&1 | tail -2 && uv run mypy --strict src 2>&1 | tail -2
```

Expected: 146 passed (was 145; +1 from Task 2), ruff/mypy clean.

- [ ] **Step 2: Frontend gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test 2>&1 | tail -5 && pnpm lint 2>&1 | tail -2 && pnpm tsc --noEmit 2>&1 | tail -2
```

Expected: 74 passed (was 62; +12 from Task 3 gameModes tests), eslint clean, tsc clean.

- [ ] **Step 3: i18n from root**

```bash
cd /home/kali/hoba && pnpm i18n:check 2>&1 | tail -5
```

Expected: passes.

- [ ] **Step 4: Working tree clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`. If dirty: investigate orphan file, decide per case.

- [ ] **Step 5: If any gate red, STOP**

Apply rollback rule: identify offending commit, `git reset --hard HEAD~1`, fix root cause, re-run gates. Do NOT silence with `eslint-disable` or test skips.

---

### Task 11: Status block + handoff

**Files:** None (final chat message).

- [ ] **Step 1: Compose summary**

Write a chat message with:

- **Commits landed** — `git log --oneline fcfc9c1..HEAD` (spec commit was `fcfc9c1`; this plan commit follows). Expect ~9-11 commits.
- **Backend changes** — Task 2: PATCH broadcast cursor delta, +1 test (146 total).
- **Frontend data layer** — Task 3: `gameModes.ts` + 12 tests, `RoomCreatePayload.game_mode`.
- **Frontend components** — Tasks 4 + 5: `RoomModePickerSheet`, `GameModeBadge`.
- **Integration** — Tasks 6 + 7 + 8: SpinPage flow, RoomPage badge, RoomSettingsSheet third option.
- **i18n** — Task 9: 13 EN + 13 UK keys.
- **Quality gates at exit** — final test totals, all linters clean.
- **What's now reachable on phone** — pick a non-classic mode at room creation; flip existing rooms to `turn_based` from host settings; see mode badge in room header.
- **What did NOT change** — CLAUDE.md "Current phase" (Stage D in progress; gameplay UI per mode still ahead).

- [ ] **Step 2: Offer push**

End with: "Branch is N ahead of `origin/main`. Say the word for `git push`."

---

## Self-review

**1. Spec coverage** — every spec section maps to a task:

- §Goal item 1 (mode picker sheet on Invite) → Tasks 4, 6.
- §Goal item 2 (mode badge in header) → Tasks 5, 7.
- §Goal item 3 (turn_based in RoomSettingsSheet) → Task 8.
- §Components + data (`gameModes.ts`, `RoomModePickerSheet`, `GameModeBadge`) → Tasks 3, 4, 5.
- §Flow integration (SpinPage, RoomPage, RoomSettingsSheet) → Tasks 6, 7, 8.
- §Backend (PATCH broadcast carries cursor side-effect) → Task 2.
- §i18n keys (13 EN + 13 UK) → Task 9.
- §Testing strategy — backend +1 test → Task 2. Frontend pure-logic tests in `gameModes.ts` → Task 3. (Component DOM tests dropped per spec's fallback paragraph; matches existing codebase pattern.)
- §Risks (Sheet.dismissable prop, PATCH regression, jsdom fallback) → fallback to pure-logic addressed by Task 3; Sheet.dismissable verified to exist via Sheet.tsx:12 read.

No gaps.

**2. Placeholder scan** — no "TBD" / "implement later" / "fill in details" / "handle edge cases" / "similar to Task N" in instruction text. Every code block is complete; every command shows expected output.

**3. Type consistency** —
- `GameMode` (server-side enum) used identically across all tasks via `@/lib/api` import.
- `GameModeMeta` interface declared in Task 3, consumed in Tasks 4 + 5.
- `RoomModePickerSheetProps` declared in Task 4, used in Task 6.
- `GameModeBadgeProps` declared in Task 5, used in Task 7.
- `shouldShowBadge` + `getGameModeMeta` referenced consistently in Tasks 3 + 5.
- Backend `cursor_before` capture pattern (Task 2) uses field name matching the existing model column `current_turn_user_id` (introduced in Alembic 0004).

No naming drift.

**4. Command consistency** — `cd /home/kali/hoba/...` paths absolute. `pnpm test` (no `--run`). `pnpm i18n:check` only from repo root. `uv run` prefix for all backend commands. Matches the foundation-slice plan's verified-working command shapes.
