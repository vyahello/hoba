# Cleanup pass findings (2026-05-28)

> Permanent record of the 2026-05-28 cleanup pass (Approach A, no
> new stage). Spec: `docs/superpowers/specs/2026-05-28-cleanup-pass-design.md`.
> Plan: `docs/superpowers/plans/2026-05-28-cleanup-pass.md`.

## Summary

_To be filled at exit. Pre-fill at start of execution: see plan Task 22._

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

## Lane 3 — Codebase findings (needs owner decision)

_Append uncertain findings. Format:_
_`path:lineRange — observation — recommendation`._
