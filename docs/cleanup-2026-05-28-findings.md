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

## Lane 2 — Doc drift findings (stale-but-historical, not edited)

_Manual-verify session logs where status entries lie about current state but rewriting would falsify the audit trail._

## Lane 3 — Codebase findings (auto-fixed)

_Append entries as fixes land. Format:_
_`path:lineRange — observation — recommendation — commit <hash>`._

## Lane 3 — Codebase findings (needs owner decision)

_Append uncertain findings. Format:_
_`path:lineRange — observation — recommendation`._
