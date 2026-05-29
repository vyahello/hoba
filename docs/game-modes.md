# Game Modes — Hoba!

Per-mode gameplay mechanics. See `docs/spec.md` §5 for the full product specification.

---

## Classic (§5.1)

The default mode. Every spin is independent — the wheel lands on a segment, the result is revealed, and the wheel resets to the full set for the next spin. No state carries between spins.

**Spin policy default:** `anyone`.

---

## Elimination (§5.2) — Live

Each spin eliminates the winning segment from the wheel. The game continues until only one segment remains; that segment is the survivor. The host can then start a new round, restoring all segments.

### The loop

1. Host (or any participant, depending on `spin_policy`) triggers a spin.
2. The server spins over **living segments only** (see "Living-segments contract" below).
3. On settle the server marks the winning segment as eliminated, then emits `spin:settled` with `mode_aftereffects`.
4. Clients apply the elimination locally via `applyEliminated` (store reducer).
5. The wheel visually shrinks (the eliminated segment disappears from the living set on the next render) and a brief "thunk" animation fires (scale 1→0.97→1, ~300 ms + haptic).
6. The "Remaining: N" counter in the room header decrements.
7. The eliminated segment appears in a greyscale strip below the wheel.
8. Repeat from step 1 until one segment remains.
9. When `remaining === 1`, the server sets `round_over: true` in `mode_aftereffects`.
10. Clients show the survivor banner ("🏆 {label} survives!") and hide the SPIN button.
11. The host sees a "New round" button; tapping it emits `round:reset` to the server.
12. The server clears `eliminated_at` on all segments and broadcasts `round:reset` to the room.
13. Clients call `reviveAllSegments` (store reducer) to restore all segments locally.

### `eliminated_at` model

```python
# apps/api/src/hoba_api/models/segment.py
class Segment(Base):
    eliminated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    @property
    def is_eliminated(self) -> bool:
        return self.eliminated_at is not None
```

Alembic migration: `0005_add_segment_eliminated_at.py`.

### `is_eliminated` on the wire

`SegmentOut` (schema) exposes `is_eliminated: bool` so every `room:state` and `spin:settled` payload carries the current elimination status for each segment. The client never needs to track this separately — the server is the source of truth.

```python
# apps/api/src/hoba_api/schemas/room.py
class SegmentOut(BaseModel):
    ...
    is_eliminated: bool
```

### Living-segments contract

The server always spins over **living segments** — those where `eliminated_at IS NULL` — ordered by `position`. This is the same set the client renders. Because the client builds the wheel from `snapshot.active_question.segments.filter(s => !s.is_eliminated)`, the spin animation always lands on a segment that is actually on the wheel.

### `round:reset` event

- **Client → server:** `round:reset` (Socket.IO, no payload). Host-only; a non-host caller receives `error { code: "not_host" }`.
- **Server → room broadcast:** `round:reset` (no payload). All connected clients call `reviveAllSegments` on their local snapshot.

### `spin:settled.mode_aftereffects` payload

```json
{
  "eliminated_segment_id": 3,
  "remaining": 2,
  "round_over": false,
  "survivor_segment_id": null
}
```

| Field | Type | Description |
|---|---|---|
| `eliminated_segment_id` | `number` | Segment id that was just eliminated. |
| `remaining` | `number` | Living segments left after this elimination. |
| `round_over` | `boolean` | `true` when only one survivor remains. |
| `survivor_segment_id` | `number \| null` | Id of the sole survivor when `round_over` is `true`, otherwise `null`. |

When `mode_aftereffects` is absent (Classic, other modes), clients treat the settle as a no-op for elimination state.

### Frontend helpers

- `apps/webapp/src/features/rooms/elimination.ts` — `livingSegments`, `eliminatedSegments`, `remainingCount`, `isRoundOver`.
- `apps/webapp/src/stores/room.ts` — `applyEliminated`, `reviveAllSegments` (exported pure reducers); `resetRound` action.

**Spin policy default:** `turn_based`.

---

## Punishment (§5.3) — Planned — next slice

The winning segment carries a punishment card. The server draws a card from the deck and broadcasts it; all players see the same card. Planned for the next Stage D slice.

---

## Chaos (§5.4) — Planned — next slice

A pre-spin event is announced to the room (e.g. "Double spin", "Reverse order") before the wheel fires. Planned for the next Stage D slice.

---

## Rigged (§5.5) — Planned

Long-press reveal only (not surfaced in the standard mode picker). Host secretly pre-selects the outcome. Planned for a later stage.
