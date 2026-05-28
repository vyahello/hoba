# Hoba! — Cleanup pass design (2026-05-28)

> Approach A from the brainstorming session: one cleanup batch under
> Stage C, no new stage, no `STAGE COMPLETE` ritual. Three lanes pay
> down debt accumulated across Stages A/B/C so future-Claude opens
> cold to a repo whose docs match its code and whose TODO list reflects
> actual open work.

---

## Context

Stage C is currently **open** with a recorded **NO-GO on Phase 7+**
(commit `564a4c8`, 2026-05-28). The NO-GO rationale is "no soft-launch
sessions logged"; cleanup does not change that state and does not
substitute for it. The next code work after this pass is still gated
on either real-device session data or an explicit owner override.

Brand context (locale-aware per CLAUDE.md rule 5): the product brand is
`Hoba!` (Latin) in EN, code, files, and docs; `Хоба!` (Cyrillic) only
inside the UK locale in-app. This doc uses `Hoba!`.

---

## Goal

Three lanes, in priority + ascending-risk order:

1. **Lane 1 — `docs/TODO.md` hygiene.** Strike stale lines (closed in
   earlier stages but never removed from the open list); keep the
   genuinely open Stage D items; add an explicit "pending verification"
   line for the iPhone X spin-lag fix.
2. **Lane 2 — Doc drift audit.** Every doc in CLAUDE.md's
   documentation index, plus inline code `TODO`/`FIXME`/`XXX` tags.
   Confident drift fixed inline; opinion drift logged to the findings
   doc.
3. **Lane 3 — Codebase audit.** Sweep for dead exports, unused
   imports, stale comments, `// removed` shims, hardcoded English in
   `.tsx`, half-implementations. Confident wins fixed inline;
   uncertain findings logged to the findings doc for owner triage.

## Non-goals

- No refactoring. CLAUDE.md rule 6 ("No premature abstraction") still applies.
- No new features. CLAUDE.md rule 10 still applies.
- No real-device verification. (Owner opted out of that lane during brainstorming.)
- No Stage D scoping. NO-GO on Phase 7+ still stands.
- No `CLAUDE.md` "Current phase" line change.
- No stage-transition ritual.
- No memory rewrites unless a finding genuinely warrants one — and
  that surfaces via the findings doc first.

---

## Lane 1 — `docs/TODO.md` hygiene

### Confirmed stale lines to strike (cross-referenced against CLAUDE.md close-out sections)

| `docs/TODO.md` line | Tag | Resolution | Commit |
|---|---|---|---|
| 6 | `stage:B` host toggle in Room settings sheet | Stage B item 6 — `RoomSettingsSheet` shipped | `ac7dab2` |
| 7 | `stage:B` anti-spam cooldown on `spin:trigger` | Stage B item 1 — `cooldown_take` primitive | `f723a0f` |
| 10 | `stage:G` Dockerfile multi-stage static build | Pulled forward in Stage C deploy chain | `2050774` |
| 11 | `stage:C → stage:B` `room:updated` broadcast on PATCH | Stage B verification-pass fix item 10 | `3f4dbeb` |

### Genuinely open lines (kept, verified accurate)

- Line 8 — `stage:D` finish `turn_based` spin policy in
  `services/spins.user_can_spin` (currently treats it as `host_only`).
  Required by Punishment + Elimination per spec §5.
- Line 9 — `stage:D` per-mode default `spin_policy` overrides
  (Elimination → `host_only`, Punishment → `turn_based`,
  Chaos → `anyone`, Rigged → `host_only`).

### Lines to add

- `stage:C — verify — iPhone X spin-lag fix (33a976b, stacked-strokes
  replacement for feGaussianBlur). Confirm on an actual iPhone X / A11
  device. Pending since 2026-05-27.`

### Exhaustive sweep (per owner instruction)

Before committing Lane 1, cross-reference every closed item in:
- CLAUDE.md "Stage A close-out (2026-05-26)" section
- CLAUDE.md "Stage A close-out batch (2026-05-27)" section
- CLAUDE.md "Stage B close-out (2026-05-27)" section
- CLAUDE.md "Stage B verification-pass fix (2026-05-27)" section
- CLAUDE.md "Stage C deploy chain (2026-05-27)" section

…against every open line in `docs/TODO.md`. Any additional stale line
found gets struck.

### Treatment of struck lines

Following the existing pattern in `docs/TODO.md` (`## Resolved in Stage
A …` sub-sections already exist), add:
- `## Resolved in Stage B (2026-05-27)` — items 6, 7, 11 (and any
  found during the exhaustive sweep).
- `## Resolved in Stage C deploy chain (2026-05-27)` — item 10 (and
  any others found).

Each struck line gets a one-line entry with the commit hash.

### Commit

`docs(todo): strike stale items closed in Stage A/B/C + add iPhone X verify line`

---

## Lane 2 — Doc drift audit

### Docs to audit

Every doc in CLAUDE.md's documentation index, plus the two
`manual-verify-stage*.md` session logs, plus `CLAUDE.md` itself:

1. **`README.md`** — landing page rewritten 2026-05-27 (commit
   `2e8b2d0`). Spot-check it still matches Stage C reality.
2. **`docs/spec.md`** — source of truth. Grep for any Phase 12 deploy
   items pulled forward (Dockerfile multi-stage), and any references
   that overstate what's left.
3. **`docs/roadmap.md`** — Stage G section still scopes "replace
   Dockerfile dev-server with static build." That work landed in Stage
   C commit `2050774`. Stage G charter has shrunk.
4. **`docs/architecture.md`** — written before Stage C. May still
   describe Vite-dev-in-prod runtime instead of the
   static-bundle-via-in-container-nginx runtime.
5. **`docs/development.md`** — was rewritten in Stage A verification
   pass. Spot-check for any stale tunnel / port references.
6. **`docs/testing.md`** — should reflect current 113/53 test totals
   or be deliberately count-agnostic. Either is fine; just check.
7. **`docs/TODO.md`** — covered by Lane 1.
8. **`docs/botfather-setup.md`** — `play` short_name was aligned in
   Stage A item 15; verify no leftover `spin` references.
9. **`docs/deployment.md`** — heavily edited during the 7-commit
   deploy chain. Check for remnants of the failed Vite-dev-in-prod
   path.
10. **`docs/privacy.md`** — should match what's set in BotFather.
11. **`docs/validation-notes.md`** — updated 2026-05-28 (this
    session). Skip.
12. **`docs/soft-launch-invite.md`** — invite copy. Should be current.
13. **`docs/manual-verify-stageA.md`** — session log with item
    statuses. Some "pending" items may now be verified.
14. **`docs/manual-verify-stageB.md`** — same; created in Stage B.
15. **`CLAUDE.md`** — internal consistency between the three close-out
    sections (A / B / C deploy chain) and the just-rewritten
    current-phase line.

### In-code TODO sweep

`grep -RIn "TODO\|FIXME\|XXX" apps/ packages/ 2>/dev/null` — every
match must have a `docs/TODO.md` counterpart per rule 8. Unmatched
inline TODOs get either:
- Moved to `docs/TODO.md` (if the work is real and pending), or
- Deleted (if the underlying work has shipped).

### Treatment

- **Confident drift** (doc factually wrong about the code) → fixed
  inline. One commit per non-trivial doc; trivial single-line edits
  may batch.
- **Opinion drift** (doc could be re-phrased better but isn't wrong) →
  noted in the findings doc, not touched.
- **Stale-but-historical** (e.g., a manual-verify-stage doc says
  "pending" for items now closed) → flagged in findings, not edited.
  These are session logs; rewriting them rewrites history.

### Commits

One commit per doc that needs a non-trivial edit, scope `docs(<doc>)`.
Trivial edits may batch into a single
`docs: fix drift after stage C deploy chain` commit. Maximum batch
size: 4 docs per commit.

---

## Lane 3 — Codebase audit

### Sweep categories (in execution order)

| # | Category | Tool / method |
|---|---|---|
| 1 | Lint baseline | `pytest`, `ruff check`, `mypy --strict`, `eslint --max-warnings 0`, `tsc --noEmit`, `pnpm i18n:check` — all green before sweep begins. Any regression is itself a finding. |
| 2 | Hardcoded English in `.tsx` | `grep -RE "\"[A-Z][a-zA-Z ]{2,}\"" apps/webapp/src/{pages,features,components,layouts}` — Stage A's own acceptance grep. Should be zero. |
| 3 | Inline `TODO`/`FIXME`/`XXX` | (Done in Lane 2.) |
| 4 | Debug leftovers | `grep -RIn "console\.\(log\|warn\|debug\)" apps/webapp/src/` — any `console.*` outside an error path or `lib/devLog` is a leak. |
| 5 | Dead exports | Manual cross-reference: for each `export` in `apps/webapp/src/{features,lib,components,pages}`, verify ≥1 import elsewhere via `grep`. |
| 6 | `// removed` / backcompat shims | `grep -RIn "// removed\|// deprecated\|// legacy\|// keep for compat" apps/ packages/`. CLAUDE.md system prompt bans these. |
| 7 | Stale comments | Walk each file top-level; flag comments referencing closed bugs, removed features, or commit hashes that no longer reflect current state. |
| 8 | Half-implementations | Look for components rendered to nothing, types defined but unused, server handlers with empty branches. |

### What's "obvious win" (auto-fix inline)

- Unused imports / dead exports verified by grep
- `console.*` outside error paths
- Stale comments referring to long-closed work
- Hardcoded English in `.tsx` (add `t()` key to `en/uk` namespaces)
- `// removed` shims and dead branches

### What's "uncertain" (report, don't touch)

- Pattern inconsistencies that work but smell
- Refactor candidates (large files, tangled responsibilities)
- Test-coverage gaps where the gap is non-critical
- Any change that touches >2 files and isn't a one-line obvious win

### Commits

One per category that has 2+ findings, scope `chore(<area>)`. One
catch-all `chore: cleanup sweep` only if every category has ≤1
finding. Quality gates re-run after each commit batch; a regression
triggers immediate rollback of that batch, not a patch-on-top.

---

## Findings doc

Single combined doc at **`docs/cleanup-2026-05-28-findings.md`** —
permanent, lives alongside `manual-verify-stage*.md` as audit trail.

### Structure

```
# Cleanup pass findings (2026-05-28)

## Summary
- Lane 1: N stale lines struck, M added, exhaustive sweep result.
- Lane 2: N docs edited inline, M opinion-drift findings logged.
- Lane 3: N categories auto-fixed (commits …), M findings need owner decision.

## Lane 2 — Doc drift findings (uncertain / opinion)
- `<path>:<lineRange>` — observation — recommendation
- …

## Lane 3 — Codebase findings (auto-fixed)
- `<path>:<lineRange>` — observation — recommendation — commit `<hash>`
- …

## Lane 3 — Codebase findings (needs owner decision)
- `<path>:<lineRange>` — observation — recommendation
- …
```

### Hard rule

Every finding cites a specific `file:lineRange`. No generic
"consider splitting X" without a concrete location. Prevents the
findings doc from drifting into a rewrite-the-world wishlist.

---

## Execution sequencing

Increasing-risk order, lane-by-lane:

1. **Lane 1** — mechanical, doc-only. Confirms workflow.
2. **Lane 2** — doc edits + first findings-doc entries.
3. **Lane 3** — code edits, highest risk. Per-category commits with
   quality-gate re-runs between batches.

### Branching

Direct commits on `main`. Matches Stage A/B/C pattern (every close-out
item shipped to main without PR review). Override available if owner
wants a `chore/cleanup-2026-05-28` branch + review.

---

## Exit gate

The cleanup pass is "done" when:

- All three lanes walked end-to-end.
- All quality gates green:
  - `cd apps/api && uv run pytest` (113 backend baseline)
  - `cd apps/webapp && pnpm test` (53 frontend baseline)
  - `cd apps/api && uv run ruff check && uv run mypy --strict src`
  - `cd apps/webapp && pnpm lint && pnpm tsc --noEmit && pnpm i18n:check`
- `git status` clean.
- `docs/cleanup-2026-05-28-findings.md` committed with at minimum the
  Summary section (even if "no findings — clean sweep" — that's
  itself a finding worth recording).
- Status block in chat: commits landed, lines struck, drift fixes per
  doc, auto-fixes per category, count of uncertain findings awaiting
  owner triage.

### What deliberately does NOT happen at exit

- No `CLAUDE.md` "Current phase" change.
- No stage-transition ritual.
- No memory rewrites.

---

## Risk + mitigations

| Risk | Mitigation |
|---|---|
| Scope creep — sweep uncovers a tempting refactor. | Anything >2 files or non-obvious goes to findings doc, not auto-fix. Rule 6. |
| Auto-fix breaks i18n. | `pnpm i18n:check` re-runs after each Lane 3 batch touching strings. |
| Auto-fix breaks types. | `mypy --strict` + `tsc --noEmit` re-run after each batch. |
| Findings doc becomes a wishlist. | Hard rule: every finding cites a specific `file:line`. |
| Lane 1 misses a stale TODO. | Exhaustive cross-reference against every closed item in CLAUDE.md (per owner instruction). |
| Working tree gets messy mid-sweep. | One lane at a time, commit before moving on. No interleaving. |

---

## Open questions

None. All three brainstorming-phase open questions answered by owner
2026-05-28:

1. Findings doc lifetime: **permanent**.
2. TODO.md staleness sweep depth: **exhaustive cross-reference**.
3. Stage A item 18 (iPhone X): **add as a `stage:C — verify` line in
   `docs/TODO.md`**.
