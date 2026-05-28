# Cleanup pass findings (2026-05-28)

> Permanent record of the 2026-05-28 cleanup pass (Approach A, no
> new stage). Spec: `docs/superpowers/specs/2026-05-28-cleanup-pass-design.md`.
> Plan: `docs/superpowers/plans/2026-05-28-cleanup-pass.md`.

## Summary

**Cleanup pass executed 2026-05-28 per `docs/superpowers/specs/2026-05-28-cleanup-pass-design.md`** (Approach A, no new stage, no `CLAUDE.md` "Current phase" change). Stage C remains open with NO-GO on Phase 7+; this pass paid down debt only.

- **Lane 1 (TODO.md hygiene)** — 4 stale lines struck (B6 host toggle, B1 cooldown, G Dockerfile, C→B `room:updated` broadcast); 1 line added (`stage:C — verify — iPhone X spin-lag fix`); exhaustive cross-reference against every CLAUDE.md close-out section surfaced 0 extras. Two genuinely open Stage D items confirmed accurate. Commit `5fa6024`.
- **Lane 2 (doc drift)** — 5 docs edited inline with confident drift fixes (`roadmap.md`, `deployment.md`, `development.md`, `testing.md`, `botfather-setup.md`, `CLAUDE.md`), batched across 6 commits. `spec.md` left untouched (no factual drift; Phase 12 text remains future-tense and accurate). 1 opinion-drift finding logged (`architecture.md` prod-topology incomplete). 0 stale-but-historical findings — both `manual-verify-stage*.md` docs accurately describe their own pending-verification state. Rule-8 sweep (in-code `TODO`/`FIXME`/`XXX`) found 3 matches, all legitimate references to tracked work or historical narrative; no violations.
- **Lane 3 (codebase audit)** — Hardcoded English `.tsx` sweep: clean (Stage A acceptance grep zero, DevDSPage logged as exempt-question for owner). Debug `console.*` sweep: clean (one legitimate try/catch warn). `// removed` / backcompat shims sweep: clean (zero matches). Stale comments walk: 3 confident fixes applied across `permissions.ts`, `RoomSettingsSheet.tsx`, `schemas/room.py` in commit `d98fc0d` (commit-hash reference + stale-stage references). Half-implementations walk: clean. Dead exports sweep: scope-limited due to 133-export surface area; 5 needs-owner-decision findings logged (1 truly-dead `disconnectRoomSocket`, 3 export-keyword-unnecessary, 1 ambiguous `Modal`).

**Total commits in this pass:** 10 (between spec commit `5659c52` and findings-doc finalization).

**Quality gates at exit:** 113 backend tests / 53 frontend tests passing; `ruff` / `mypy --strict` / `eslint` / `tsc --noEmit` / `pnpm i18n:check` all green; 91 % backend coverage (unchanged from baseline).

**Owner triage queue:** the "needs owner decision" entries in Lane 3 (DevDSPage i18n exemption, 5 dead-export borderlines) and the single Lane 2 opinion-drift entry (architecture.md prod topology) are the actionable backlog from this pass. None are blocking; all can sit indefinitely.

## Plan-execution meta-findings

- `docs/superpowers/plans/2026-05-28-cleanup-pass.md` — Task 1 Step 1 + Step 2 specified `pnpm test --run` (should be `pnpm test` — script already wraps `vitest run`) and `pnpm i18n:check` from `apps/webapp` (should run from monorepo root `/home/kali/hoba`). Commands swapped during execution; no impact on outcomes.

## Lane 2 — Doc drift findings (uncertain / opinion)

_Append entries as docs are audited. Format:_
_`path:lineRange — observation — recommendation`._

- `docs/architecture.md:11-39` — bird's-eye diagram describes dev topology only (Vite at :5173 + ngrok tunnel + Caddy in prod profile). Doesn't describe the deployed Stage C reality: multi-stage Dockerfile → static bundle → in-container nginx → host nginx as TLS terminator on shared VPS, Caddy disabled via `compose.shared.yaml`. Not lying (prod-profile Caddy IS what the default prod profile includes), but incomplete. Recommendation: add a "Deployed Stage C topology" subsection or a second diagram for the shared-VPS flavour. Owner call — could also live solely in `docs/deployment.md`.

## Lane 2 — Doc drift findings (stale-but-historical, not edited)

_Manual-verify session logs where status entries lie about current state but rewriting would falsify the audit trail._

_No stale-but-historical drift surfaced. Both `docs/manual-verify-stageA.md` and `docs/manual-verify-stageB.md` accurately describe their own pending-verification status (iPhone X spin-lag verification for stageA item 18 is still legitimately open and now also tracked at `docs/TODO.md:8`; Stage B 360 px + BotFather sections describe checks to run, not stale status claims)._

## Lane 2 — In-code TODO/FIXME/XXX sweep result

_Rule 8 ("No TODOs without entry in `docs/TODO.md`") sweep, 2026-05-28:_

- `apps/webapp/src/features/rooms/permissions.ts:10` — doc comment references `docs/TODO.md stage:D` (turn_based policy). Tracked entry still open (line 6 in TODO.md post-cleanup). **Keep.**
- `apps/webapp/src/features/rooms/__tests__/permissions.test.ts:161` — test comment references same `docs/TODO.md stage:D` entry. **Keep.**
- `apps/api/tests/services/test_user_cache.py:3` — docstring describes the test as "the Stage A fix for the deferred Phase 2 TODO". Historical narrative referencing an already-resolved TODO; not an unresolved inline tag. **Keep.**

No rule-8 violations. No inline tags require migration or deletion.

## Lane 3 — Codebase findings (auto-fixed)

_Append entries as fixes land. Format:_
_`path:lineRange — observation — recommendation — commit <hash>`._

### Category: Hardcoded English in .tsx

_No fixes needed. Stage A acceptance grep clean across user-facing pages/features/components/layouts. Two false positives (event.key match + JSDoc reference); DevDSPage exempted per below._

### Category: Debug console.* leftovers

_No fixes needed. Single match at `apps/webapp/src/main.tsx:19` is a `console.warn` inside the try/catch that wraps Telegram SDK init — legitimate error-path fallback, intentional. No debug `console.log` / `console.debug` / `console.info` leftovers found in webapp source._

### Category: `// removed` / backcompat shims

_Zero matches. Rule from CLAUDE.md system prompt ("Avoid backwards-compatibility hacks") is being respected._

### Category: Stale comments referencing closed work

- `apps/webapp/src/features/rooms/permissions.ts:11-15` — doc comment referenced commit `7db1b0a` as "the entire point" of the check. Reference removed; the constraint (tg_id vs user_id are different number spaces) is now stated without naming the fix-commit. Commit `d98fc0d`.
- `apps/webapp/src/components/room/RoomSettingsSheet.tsx:16-23` — doc comment claimed "server-side broadcast of `room:updated` is queued for a later stage", but that broadcast shipped in Stage B verification-pass fix (commit `3f4dbeb`). Comment updated to reflect the broadcast being live. Commit `d98fc0d`.
- `apps/api/src/hoba_api/schemas/room.py:102-104` — comment said "see docs/roadmap.md Stage B for the host-toggle" implying the toggle was still upcoming work. Stage B is closed and the toggle shipped; comment now references the actual `RoomSettingsSheet` component. Commit `d98fc0d`.

### Category: Half-implementations

_No fixes needed. Frontend `return null` patterns (6 sites) all serve legitimate purposes: SSR portal guards, side-effect-only components (`ConfettiBurst`), and conditional-render no-op cases. Backend handler branches all carry action bodies — no empty `pass`-only branches found in `realtime/handlers.py`. Scaffolds that aren't yet wired (e.g. `LibraryPage` stub for Phase 9, `disconnectRoomSocket` lifecycle helper) are intentional pre-work or designed-but-not-yet-needed API surface, surfaced separately in the "needs owner decision" section above._

## Lane 3 — Codebase findings (needs owner decision)

_All items resolved during owner triage 2026-05-28. Decisions + resolving commits inline._

- ~~`apps/webapp/src/pages/DevDSPage.tsx:65-417`~~ — **Resolved: exempt /dev/ds from t() rule.** CLAUDE.md updated with a one-line clarification noting the design-system showcase is exempt because its strings are fixtures simulating user input. Commit `5b6e9c8`.

### Category: Dead exports

- ~~`apps/webapp/src/stores/room.ts:250` (`disconnectRoomSocket`)~~ — **Resolved: deleted.** YAGNI per CLAUDE.md rule 6. Re-add when an actual caller appears. Commit `78da077`.
- ~~`apps/webapp/src/audio/manifest.ts:10` (`AUDIO_NAMES`)~~ — **Resolved: kept exported.** Attempted to drop the `export` keyword per the original recommendation, but eslint `no-unused-vars` flags it as value-only-used-as-type (only consumed in `typeof AUDIO_NAMES[number]`). Keeping the export is the cheaper way to satisfy the rule and preserves runtime iteration as a useful affordance. See commit `78da077`.
- ~~`apps/webapp/src/audio/manifest.ts:25` (`AudioDef`)~~ — **Resolved: unexported.** Interface, no eslint issue. Commit `78da077`.
- ~~`apps/webapp/src/data/quickWheels.ts:10` (`QuickWheelSegmentDef`)~~ — **Resolved: unexported.** Commit `78da077`.
- ~~`apps/webapp/src/lib/startParam.ts:107` (`RoomInviteLinkOptions`)~~ — **Resolved: unexported.** Commit `78da077`.
- ~~`apps/webapp/src/components/ds/Modal.tsx`~~ — **Resolved: deleted.** Modal + DevDSPage import + showcase entry removed. CLAUDE.md rule 4 ("Sheets, not modals") makes this dead surface. Commit `89085c4`.

### Category: Lockfile policy (out-of-scope artifact)

- ~~`apps/api/uv.lock`~~ — **Resolved: committed.** Tracked for reproducible Python deps per modern uv guidance. Commit `f421eb9`.

## Triage outcome

All 7 needs-decision items resolved 2026-05-28 via direct owner choice. 4 deletions, 3 export-keyword drops (1 of 4 attempted reverted on eslint grounds), 1 doc clarification, 1 new file tracked. Quality gates green at each commit. The findings doc is now complete and serves as the permanent audit trail.
