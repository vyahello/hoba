# Cleanup Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pay down debt accumulated across Stages A/B/C without changing project state (Stage C remains open with NO-GO on Phase 7+). Three lanes: `docs/TODO.md` hygiene, doc drift audit, codebase audit.

**Architecture:** Increasing-risk lane order. Lane 1 (doc-only) confirms workflow. Lane 2 (doc-only) establishes findings doc. Lane 3 (code) runs per-category with quality-gate re-runs between commits and immediate rollback on regression. Findings doc at `docs/cleanup-2026-05-28-findings.md` accumulates uncertain findings throughout; committed at end of Lane 2 and updated at end of Lane 3 and at exit.

**Tech Stack:** No new dependencies. Quality gates: `pytest` + `ruff` + `mypy --strict` (backend), `pnpm test` + `pnpm lint` + `pnpm tsc --noEmit` + `pnpm i18n:check` (frontend). Spec lives at `docs/superpowers/specs/2026-05-28-cleanup-pass-design.md`.

---

## Pre-flight reminders

- **Brand:** `Hoba!` (Latin) in EN/code/docs/files; `Хоба!` (Cyrillic) only inside UK locale. Never mix.
- **Commits:** Conventional commits (`docs:`, `chore:`, `refactor:`). No Claude co-author trailer (per `~/.claude/projects/-home-kali-hoba/memory/no-claude-coauthor.md`).
- **No CLAUDE.md "Current phase" edits.** Stage C state unchanged.
- **No stage-transition ritual.** This is a batch, not a stage.
- **No memory writes** unless explicitly noted.
- **Rollback rule:** if a quality gate regresses, `git reset --hard HEAD~1` the offending commit, log to findings doc as "auto-fix attempted, reverted: <reason>", move on. No patch-on-top.
- **Findings discipline:** every entry cites `path:lineRange`. No "consider splitting X" without a location.

---

## Phase 1 — Setup & baseline

### Task 1: Capture quality-gate baseline

**Files:** None (read-only verification).

- [ ] **Step 1: Run backend tests + lint + types**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -10 && uv run ruff check . && uv run mypy --strict src
```

Expected: pytest exits 0, ruff exits 0, mypy exits 0. Record the pytest "N passed" count (should be 113).

- [ ] **Step 2: Run frontend tests + lint + types + i18n**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test --run 2>&1 | tail -10 && pnpm lint && pnpm tsc --noEmit && pnpm i18n:check
```

Expected: vitest exits 0 (53 passed), eslint exits 0, tsc exits 0, i18n:check exits 0.

- [ ] **Step 3: If any gate fails, STOP and report**

A red baseline is itself a finding. Do not proceed. Open a session message: "Baseline broken: <gate> failed. Cleanup pass cannot proceed until baseline is green. Output: <paste tail of failure>." Wait for owner direction.

- [ ] **Step 4: Record baseline counts in working notes**

In your own working memory (not committed), record: backend test count, frontend test count, today's date. These are the "this is what green looked like" numbers we hold ourselves to at exit.

---

### Task 2: Create findings doc skeleton

**Files:**
- Create: `/home/kali/hoba/docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Write the skeleton**

```markdown
# Cleanup pass findings (2026-05-28)

> Permanent record of the 2026-05-28 cleanup pass (Approach A, no
> new stage). Spec: `docs/superpowers/specs/2026-05-28-cleanup-pass-design.md`.
> Plan: `docs/superpowers/plans/2026-05-28-cleanup-pass.md`.

## Summary

_To be filled at exit. Pre-fill at start of execution: see plan Task 22._

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
```

- [ ] **Step 2: Commit**

```bash
cd /home/kali/hoba && git add docs/cleanup-2026-05-28-findings.md && git commit -m "docs(cleanup): scaffold findings doc for 2026-05-28 cleanup pass"
```

---

## Phase 2 — Lane 1: `docs/TODO.md` hygiene

### Task 3: Exhaustive TODO staleness sweep

**Files:** None (read-only sweep).

- [ ] **Step 1: Read current TODO.md**

```bash
cat /home/kali/hoba/docs/TODO.md
```

Identify every open line (those starting `- [ ] stage:…`). Spec identifies 4 confirmed stale (lines 6, 7, 10, 11) and 2 fresh (lines 8, 9). Verify those line numbers still match.

- [ ] **Step 2: Cross-reference against all CLAUDE.md close-out sections**

Open `/home/kali/hoba/CLAUDE.md` and read these sections end-to-end:
- "Stage A close-out (2026-05-26)" — original 5 items + verification-pass 6 items
- "Stage A close-out batch (2026-05-27)" — items 13–21
- "Stage B close-out (2026-05-27)" — items B1–B9
- "Stage B verification-pass fix (2026-05-27)" — items 10–11
- "Stage C deploy chain (2026-05-27)" — commits `0756782 → 75bd608` through `2c156f7`

For each open TODO line, search for: scope keywords from the line, file paths mentioned, commit hashes referenced. Any match = stale.

- [ ] **Step 3: Build the staleness ledger**

Record (in working memory, not committed): exact line text, line number, resolution commit (or "not yet"), which CLAUDE.md section closed it. Spec's known-stale set: lines 6, 7, 10, 11. Any extras found in this sweep get added.

- [ ] **Step 4: Verify the 2 fresh items are still accurate**

For lines 8 and 9 (both `stage:D`):
- Line 8: read `apps/api/src/hoba_api/services/spins.py`, function `user_can_spin`. Confirm `turn_based` is still treated as `host_only` (or equivalent). Confirm spec §5 still references these modes.
- Line 9: confirm none of the default `spin_policy` overrides are wired yet. Read `apps/api/src/hoba_api/services/rooms.py` or `models/rooms.py` for the default-policy logic.

If either line is *also* stale, add to ledger.

---

### Task 4: Edit `docs/TODO.md` and commit

**Files:**
- Modify: `/home/kali/hoba/docs/TODO.md`

- [ ] **Step 1: Strike stale lines + add iPhone X verify line + add Resolved sections**

Use the `Edit` tool. The resulting file should have:
- Open list: only the 2 fresh `stage:D` lines (lines 8, 9 in current file) PLUS the new iPhone X verify line.
- The new line text: `- [ ] stage:C — verify — iPhone X spin-lag fix (33a976b, stacked-strokes replacement for feGaussianBlur). Confirm on an actual iPhone X / A11 device. Pending since 2026-05-27.`
- Add section `## Resolved in Stage B (2026-05-27)` after the existing Stage A close-out section. Entries:
  - `- [x] stage:B — moderation — host toggle in Room settings sheet to flip spin_policy. Done in B6, commit ac7dab2.`
  - `- [x] stage:B — anti-spam — server-side cooldown on spin:trigger via cooldown_take Redis primitive. Done in B1, commit f723a0f.`
  - `- [x] stage:C → stage:B — broadcast — room:updated Socket.IO event from PATCH /api/v1/rooms/{code}. Done in B6 follow-up, commit 3f4dbeb.`
- Add section `## Resolved in Stage C deploy chain (2026-05-27)`:
  - `- [x] stage:G — deploy — multi-stage Dockerfile static build via in-container nginx (pulled forward from Stage G). Commit 2050774.`
- Any additional stale items found during the exhaustive sweep get added to the appropriate Resolved section.

- [ ] **Step 2: Verify the edit visually**

```bash
cat /home/kali/hoba/docs/TODO.md
```

Confirm: 3 open lines (2 `stage:D` + 1 `stage:C verify`), Resolved sections in chronological order (A → B → C), every struck item has a commit hash.

- [ ] **Step 3: Commit**

```bash
cd /home/kali/hoba && git add docs/TODO.md && git commit -m "docs(todo): strike stale items closed in Stage A/B/C + add iPhone X verify line"
```

---

## Phase 3 — Lane 2: Doc drift audit

> Each task in this phase follows the same shape: read doc top-to-bottom, classify findings, apply confident-drift edits inline, append uncertain findings to the findings doc (in-memory; commit at Task 18). Each task ends with a commit IF an inline edit was applied; otherwise no commit. The findings doc accumulates uncommitted edits across tasks until Task 18.

### Task 5: Audit `docs/roadmap.md`

**Files:**
- Read: `/home/kali/hoba/docs/roadmap.md`
- Possibly modify: `/home/kali/hoba/docs/roadmap.md`
- Possibly append: `/home/kali/hoba/docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Read the doc**

```bash
cat /home/kali/hoba/docs/roadmap.md
```

- [ ] **Step 2: Apply confident drift fixes**

Known confident drift from spec:
- Stage G section scopes "replace Dockerfile dev-server with static build" — that work landed in commit `2050774` (Stage C deploy chain). Strike this bullet from Stage G; add a sentence: "The Dockerfile multi-stage static build was pulled forward in Stage C — see CLAUDE.md Stage C deploy chain."

Also scan for: references to "Vite dev server in prod" as the current state (now untrue), references to TODO.md line numbers (which just changed), references to test counts that may be stale.

Apply via `Edit` tool. One Edit call per discrete drift.

- [ ] **Step 3: Append opinion-drift findings (if any)**

If anything in roadmap.md reads dated but isn't factually wrong (e.g., "Where we are right now" still says "Code-complete through Phase 6"), append to `docs/cleanup-2026-05-28-findings.md` under "Lane 2 — Doc drift findings (uncertain / opinion)" — use the `Edit` tool, do not commit yet.

- [ ] **Step 4: Commit if confident drift was fixed**

If Step 2 made edits:
```bash
cd /home/kali/hoba && git add docs/roadmap.md && git commit -m "docs(roadmap): reconcile Stage G scope after Dockerfile pull-forward"
```

If Step 2 made no edits: skip commit, move on.

---

### Task 6: Audit `docs/architecture.md`

**Files:**
- Read: `/home/kali/hoba/docs/architecture.md`
- Possibly modify: same
- Possibly append: `/home/kali/hoba/docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Read the doc**

```bash
cat /home/kali/hoba/docs/architecture.md
```

- [ ] **Step 2: Apply confident drift fixes**

Known suspected drift from spec:
- Webapp runtime: doc may say "Vite dev server" or "`pnpm dev`" for the prod runtime. Current reality is multi-stage Dockerfile → static bundle → in-container nginx → host nginx as TLS terminator (Stage C shared-VPS topology). Update if found.
- Container ports: `127.0.0.1:8800/5800/6800` is the current shared-VPS mapping. Confirm or update.
- Caddy: prod profile uses Caddy in dedicated-VPS flavour but the deployed-shared flavour disables Caddy via `compose.shared.yaml`. Both should be described.

Apply Edits as needed.

- [ ] **Step 3: Append opinion-drift findings**

Append to findings doc if applicable.

- [ ] **Step 4: Commit if confident drift was fixed**

```bash
cd /home/kali/hoba && git add docs/architecture.md && git commit -m "docs(architecture): reflect static-bundle + shared-VPS runtime after Stage C"
```

---

### Task 7: Audit `docs/deployment.md`

**Files:**
- Read: `/home/kali/hoba/docs/deployment.md`
- Possibly modify: same
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Read the doc**

```bash
cat /home/kali/hoba/docs/deployment.md
```

- [ ] **Step 2: Apply confident drift fixes**

Heavily edited in the deploy chain. Check for:
- Remnants of "Vite dev server" as the prod webapp runtime — should now be static bundle.
- Smoke-test paths: spec says these were corrected in commit `2c156f7` (FastAPI serves `openapi.json` at root, not `/api/v1/openapi.json`). Confirm.
- rsync excludes: should be anchored to repo root (`/data/` not `data/`) per commit `c0a591e`. Confirm.
- BotFather "Privacy Policy URL" instruction should reference `docs/privacy.md` hosted location.

- [ ] **Step 3: Append opinion-drift findings**

- [ ] **Step 4: Commit if confident drift was fixed**

```bash
cd /home/kali/hoba && git add docs/deployment.md && git commit -m "docs(deployment): close remaining drift after Stage C deploy chain"
```

---

### Task 8: Audit `docs/spec.md`

**Files:**
- Read: `/home/kali/hoba/docs/spec.md`
- Possibly modify: same
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Read sections most likely to drift**

```bash
grep -n "^##\|^###" /home/kali/hoba/docs/spec.md
```

Identify section headers. Focus reads on:
- §15 Phases — particularly Phase 12 (deployment). Dockerfile multi-stage was pulled forward, so Phase 12's stated scope may overstate what's left.
- §17 "Full Done" — verify ship-point bullets still describe the work.

- [ ] **Step 2: Apply confident drift fixes carefully**

⚠️ `docs/spec.md` is the SOURCE OF TRUTH per CLAUDE.md. Drift-fix edits here are particularly sensitive: the spec is the contract. ONLY fix things that are factually wrong about already-shipped code (e.g., "Phase 12 will introduce multi-stage Dockerfile" when it's already done). Do NOT rewrite spec text on style grounds. If uncertain, log to findings doc instead.

- [ ] **Step 3: Append opinion-drift findings**

Liberal here — spec rewrites are owner-decision territory.

- [ ] **Step 4: Commit if confident drift was fixed**

```bash
cd /home/kali/hoba && git add docs/spec.md && git commit -m "docs(spec): mark Phase 12 Dockerfile work as already shipped (Stage C deploy chain)"
```

---

### Task 9: Audit small + low-drift docs (batch: README, development, testing)

**Files:**
- Read: `/home/kali/hoba/README.md`, `/home/kali/hoba/docs/development.md`, `/home/kali/hoba/docs/testing.md`
- Possibly modify: any of the three
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Read each**

```bash
cat /home/kali/hoba/README.md
cat /home/kali/hoba/docs/development.md
cat /home/kali/hoba/docs/testing.md
```

- [ ] **Step 2: Check for confident drift**

- README.md: landing page rewritten 2026-05-27 (commit `2e8b2d0`). Likely current. Verify test totals (if cited), prod URL, bot handle.
- development.md: rewritten in Stage A verification pass. Check ngrok vs cloudflared note still matches `docs/TODO.md` (note: TODO entry was struck in Stage A close-out; verify the README ngrok delegation is intact).
- testing.md: should reflect current totals (113/53, 91%) OR be count-agnostic. Either is OK; flag if cited counts differ from baseline (Task 1).

Apply Edits as needed.

- [ ] **Step 3: Append opinion-drift findings**

- [ ] **Step 4: Commit if confident drift was fixed**

Per spec: up to 4 docs per batch commit if all are trivial single-line edits. Use:
```bash
cd /home/kali/hoba && git add README.md docs/development.md docs/testing.md && git commit -m "docs: reconcile drift after Stage C (README + development + testing)"
```

Adjust the `git add` to include only files actually edited.

---

### Task 10: Audit small docs (batch: botfather-setup, privacy, soft-launch-invite)

**Files:**
- Read: `/home/kali/hoba/docs/botfather-setup.md`, `/home/kali/hoba/docs/privacy.md`, `/home/kali/hoba/docs/soft-launch-invite.md`
- Possibly modify: any of the three
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Read each**

```bash
cat /home/kali/hoba/docs/botfather-setup.md
cat /home/kali/hoba/docs/privacy.md
cat /home/kali/hoba/docs/soft-launch-invite.md
```

- [ ] **Step 2: Check for confident drift**

- botfather-setup.md: §8 short_name was aligned to `play` in Stage A item 15 (commit `0756782`). Verify no leftover `spin` short_name references. Verify the production URL matches `hobagame.duckdns.org`.
- privacy.md: was created 2026-05-27 for BotFather. Verify production URL + contact email match Stage C reality.
- soft-launch-invite.md: invite copy. Verify production URL + bot handle.

- [ ] **Step 3: Append opinion-drift findings**

- [ ] **Step 4: Commit if confident drift was fixed**

```bash
cd /home/kali/hoba && git add docs/botfather-setup.md docs/privacy.md docs/soft-launch-invite.md && git commit -m "docs: reconcile drift after Stage C (botfather + privacy + soft-launch-invite)"
```

Adjust `git add` to only edited files.

---

### Task 11: Audit `docs/manual-verify-stage*.md` (read-only, findings-only)

**Files:**
- Read: `/home/kali/hoba/docs/manual-verify-stageA.md`, `/home/kali/hoba/docs/manual-verify-stageB.md`
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Read each**

```bash
cat /home/kali/hoba/docs/manual-verify-stageA.md
cat /home/kali/hoba/docs/manual-verify-stageB.md
```

- [ ] **Step 2: Identify stale-but-historical entries**

These are session logs. Status entries that say "pending" for items now closed (e.g., iPhone X spin-lag) are inaccurate today but reflect what was true at the time. **Do not edit.** Rewriting session logs falsifies the audit trail.

- [ ] **Step 3: Append findings to "stale-but-historical" section**

For each stale-but-not-fixable entry, append to `docs/cleanup-2026-05-28-findings.md` under `## Lane 2 — Doc drift findings (stale-but-historical, not edited)`. Format: `docs/manual-verify-stageA.md:<line> — entry says <X> pending; resolved in <stage>/<commit>.`

- [ ] **Step 4: No commit**

Findings doc commits at Task 18.

---

### Task 12: Audit `CLAUDE.md` for internal consistency

**Files:**
- Read: `/home/kali/hoba/CLAUDE.md`
- Possibly modify: same
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Read end-to-end**

```bash
cat /home/kali/hoba/CLAUDE.md
```

- [ ] **Step 2: Check internal consistency**

- "Current phase" line vs Stage close-out sections — should be consistent (current phase reflects NO-GO post-Stage-B-close, post-Stage-C-deploy).
- Documentation index list — verify every linked path exists. Spec says we'll also audit `manual-verify-stage*.md`; if they aren't in the index but exist, that's a finding (could be added, owner call).
- "What is already shipped" section vs Stage close-outs — consistency check.
- Tech stack section vs actual `apps/*/package.json` and `apps/api/pyproject.toml` — version drift?

- [ ] **Step 3: Apply confident drift fixes**

⚠️ CLAUDE.md "Current phase" is OFF-LIMITS — already set in this session's commit `564a4c8`. Touching anything else is fine.

- [ ] **Step 4: Append opinion-drift findings**

- [ ] **Step 5: Commit if confident drift was fixed**

```bash
cd /home/kali/hoba && git add CLAUDE.md && git commit -m "docs(claude-md): reconcile documentation index / shipped section after Stage C"
```

---

### Task 13: In-code TODO / FIXME / XXX sweep

**Files:**
- Read: `apps/`, `packages/`
- Possibly modify: `/home/kali/hoba/docs/TODO.md` (if any inline TODO needs to migrate)
- Possibly modify: source files (if any inline tag needs to be deleted)
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Run the sweep**

```bash
cd /home/kali/hoba && grep -RInE "TODO|FIXME|XXX" apps/ packages/ 2>/dev/null | grep -v node_modules | grep -v __pycache__
```

- [ ] **Step 2: Classify each match**

For each line:
- Does the underlying work have an entry in `docs/TODO.md`? → Keep, log finding "inline tag is tracked at docs/TODO.md line N".
- Has the underlying work shipped? → Delete the inline tag. Confident win.
- Is the underlying work real and pending but untracked? → Migrate to `docs/TODO.md` with stage tag. Owner-decision territory unless trivially obvious.

- [ ] **Step 3: Apply deletions inline**

Use the `Edit` tool to remove tags for shipped work. For each deletion, also remove any orphaned comment that surrounded the tag.

- [ ] **Step 4: Migrate genuinely-open inline TODOs to `docs/TODO.md`**

For each migrated tag: add line to `docs/TODO.md` open section AND delete the inline tag. Use the `Edit` tool for both.

- [ ] **Step 5: Re-run quality gates after source edits**

If Steps 3 or 4 touched source files:
```bash
cd /home/kali/hoba/apps/api && uv run ruff check . && uv run mypy --strict src
cd /home/kali/hoba/apps/webapp && pnpm lint && pnpm tsc --noEmit
```

Expected: all green. If any gate fails, `git status` to see what changed, narrow the diff, revert non-essential edits.

- [ ] **Step 6: Commit**

If only `docs/TODO.md` was touched:
```bash
cd /home/kali/hoba && git add docs/TODO.md && git commit -m "docs(todo): import inline TODOs surfaced during cleanup sweep"
```

If source files were touched:
```bash
cd /home/kali/hoba && git add -A && git commit -m "chore: drop inline TODO/FIXME tags for shipped work (rule 8 sweep)"
```

If both: two separate commits, docs first then source.

If nothing touched: append "no inline TODO drift surfaced" to findings doc Summary scratch space.

---

### Task 14: Commit Lane 2 findings to findings doc

**Files:**
- Modify: `/home/kali/hoba/docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Verify Lane 2 sections are populated**

Open `docs/cleanup-2026-05-28-findings.md`. Confirm "Lane 2 — Doc drift findings (uncertain / opinion)" and "Lane 2 — Doc drift findings (stale-but-historical, not edited)" sections have entries (or, if no drift was uncertain, leave a placeholder line: `_No uncertain Lane 2 findings — all drift was either confident-fixed inline or absent._`).

- [ ] **Step 2: Commit the findings doc updates**

```bash
cd /home/kali/hoba && git add docs/cleanup-2026-05-28-findings.md && git commit -m "docs(cleanup): record Lane 2 doc-drift findings"
```

---

## Phase 4 — Lane 3: Codebase audit

> Each task in this phase: run the grep / sweep, classify findings, apply confident wins inline, re-run quality gates, commit. Uncertain findings go to the findings doc (no commit until Task 21). Rollback rule applies: failed quality gate after a commit → `git reset --hard HEAD~1`, log to findings doc as "auto-fix attempted, reverted".

### Task 15: Hardcoded English in `.tsx` sweep

**Files:**
- Read: `apps/webapp/src/{pages,features,components,layouts}/**/*.tsx`
- Possibly modify: any of the above + `apps/webapp/src/locales/{en,uk}/*.json`
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Run Stage A's own acceptance grep**

```bash
cd /home/kali/hoba && grep -RInE "\"[A-Z][a-zA-Z ]{2,}\"" apps/webapp/src/pages apps/webapp/src/features apps/webapp/src/components apps/webapp/src/layouts 2>/dev/null | grep -v "\.test\." | grep -v "\.spec\."
```

- [ ] **Step 2: Filter out false positives**

Common false positives: string union types (e.g., `type Mode = "Classic" | "Elimination"`), `aria-label="…"` already routed through `t()`, prop-type literals, CSS class names that happen to match the pattern.

Real findings: JSX text content, button labels, error messages, toast titles that are bare English literals.

- [ ] **Step 3: For each real finding, apply confident fix**

The fix pattern:
1. Pick a key name following existing namespace conventions (`room.foo`, `common.bar`, etc.).
2. Add the key to `apps/webapp/src/locales/en/<namespace>.json` AND `apps/webapp/src/locales/uk/<namespace>.json`. UK translation: use natural Ukrainian per existing locale style (see Stage A item 9 for tone reference).
3. Replace the hardcoded string in `.tsx` with `t("namespace:key")` using the existing `useTranslation` hook setup.

If the namespace doesn't exist, add a finding instead — creating new namespaces is owner-call territory.

- [ ] **Step 4: Re-run i18n + frontend gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm i18n:check && pnpm lint && pnpm tsc --noEmit && pnpm test --run 2>&1 | tail -5
```

Expected: all green. If `i18n:check` fails on key parity, the most likely cause is added EN key without UK counterpart (or vice versa). Fix before commit.

- [ ] **Step 5: Commit**

If any fixes landed:
```bash
cd /home/kali/hoba && git add apps/webapp/src && git commit -m "chore(webapp): route hardcoded UI strings through t() (i18n sweep)"
```

Then record each fix in `docs/cleanup-2026-05-28-findings.md` under "Lane 3 — Codebase findings (auto-fixed)" with the commit hash. Do NOT commit the findings doc yet — that's Task 21.

If no fixes needed: append "no hardcoded English drift surfaced" finding, no commit.

---

### Task 16: Debug leftovers (`console.*`) sweep

**Files:**
- Read: `apps/webapp/src/**/*.{ts,tsx}`
- Possibly modify: any of the above
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Run the grep**

```bash
cd /home/kali/hoba && grep -RInE "console\.(log|warn|debug|info)" apps/webapp/src 2>/dev/null | grep -v "\.test\." | grep -v "\.spec\."
```

- [ ] **Step 2: Classify each match**

Allowed:
- `console.error(...)` for actual error-path logging.
- Anything inside `lib/devLog.ts` or equivalent wrapper.
- Anything explicitly gated by `import.meta.env.DEV` or similar dev flag.

Not allowed (auto-fix delete):
- `console.log` left from debugging.
- `console.warn` outside an error path.
- `console.debug` / `console.info` in production code paths.

Uncertain (report):
- `console.error` that looks like it might be a debug remnant.
- Wrapper-eligible patterns (multiple `console.error` calls that should be centralized).

- [ ] **Step 3: Delete auto-fix matches**

For each match in "not allowed" category, use the `Edit` tool to remove the line (and any orphaned surrounding context like `if (debug)` blocks).

- [ ] **Step 4: Re-run frontend gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm lint && pnpm tsc --noEmit && pnpm test --run 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 5: Commit**

If any fixes landed:
```bash
cd /home/kali/hoba && git add apps/webapp/src && git commit -m "chore(webapp): drop debug console.* leftovers"
```

Record each in findings doc under "Lane 3 — Codebase findings (auto-fixed)". Append uncertain matches under "needs owner decision".

If no fixes needed: append "no console.* drift surfaced", no commit.

---

### Task 17: Dead exports sweep

**Files:**
- Read: `apps/webapp/src/{features,lib,components,pages,layouts}/**/*.{ts,tsx}`, `apps/api/src/hoba_api/**/*.py`
- Possibly modify: any of the above
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Enumerate exports (frontend)**

```bash
cd /home/kali/hoba && grep -RInE "^export (const|function|class|type|interface|default|async function)" apps/webapp/src/{features,lib,components,pages,layouts} 2>/dev/null > /tmp/hoba-exports-frontend.txt && wc -l /tmp/hoba-exports-frontend.txt
```

- [ ] **Step 2: For each export, check for imports**

This is mechanical and tedious. Iterate /tmp/hoba-exports-frontend.txt. For each `<file>:<line>: export … <name>`:

```bash
# Replace NAME with the actual export name
grep -RInE "(from|import).*\\b<NAME>\\b" apps/webapp/src --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "<file_of_export>"
```

Zero matches AND not a default export of a route component or test-mounted symbol → likely dead. Add to candidates list.

⚠️ Caveat: dynamic imports (`React.lazy`, `import()`) won't show up via static grep. Default-exported page components reached via lazy loading are NOT dead even if static grep shows zero hits. Cross-check against the router config (`apps/webapp/src/App.tsx` or wherever routes are declared) before deleting any default export.

- [ ] **Step 3: Enumerate exports (backend)**

Backend Python: `from foo import bar` style. Run:

```bash
cd /home/kali/hoba && python -c "
import ast, pathlib
root = pathlib.Path('apps/api/src/hoba_api')
for p in root.rglob('*.py'):
    if '__pycache__' in str(p): continue
    tree = ast.parse(p.read_text())
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not node.name.startswith('_'):
            print(f'{p}:{node.lineno}:{node.name}')
" > /tmp/hoba-exports-backend.txt && wc -l /tmp/hoba-exports-backend.txt
```

For each non-underscore-prefixed top-level function/class, check for imports:
```bash
grep -RInE "\\b<NAME>\\b" apps/api/src apps/bot/src 2>/dev/null | grep -v "<file_of_definition>"
```

⚠️ Caveat: FastAPI route handlers (`@router.get(...)`) are not statically imported; they're registered via decorator. Don't flag those. Aiogram handlers similar.

- [ ] **Step 4: For confident dead exports, delete**

A confident dead export:
- Has zero static imports.
- Is not a route handler / event handler registered via decorator.
- Is not a default export of a page / route component.
- Is not a test fixture or test helper.

Use the `Edit` tool to remove the export and any private helpers ONLY used by it.

- [ ] **Step 5: For uncertain dead exports, log to findings**

Anything where Step 4's checklist isn't unambiguous → append to findings doc under "needs owner decision".

- [ ] **Step 6: Re-run all gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run mypy --strict src
cd /home/kali/hoba/apps/webapp && pnpm test --run 2>&1 | tail -5 && pnpm tsc --noEmit
```

Expected: all green.

- [ ] **Step 7: Commit**

If deletions landed:
```bash
cd /home/kali/hoba && git add -A && git commit -m "chore: drop dead exports surfaced by cleanup sweep"
```

Record each in findings doc.

If quality gate failed after commit: `git reset --hard HEAD~1`, append to findings doc as "auto-fix reverted: <gate failure detail>".

If no deletions: append "no dead exports surfaced (or all were uncertain — logged)".

---

### Task 18: `// removed` / backcompat shims sweep

**Files:**
- Read: `apps/`, `packages/`
- Possibly modify: any source files matched
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Run the grep**

```bash
cd /home/kali/hoba && grep -RInE "// removed|// deprecated|// legacy|// keep for compat|# removed|# deprecated|# legacy|# keep for compat" apps/ packages/ 2>/dev/null | grep -v node_modules | grep -v __pycache__
```

- [ ] **Step 2: Classify**

System prompt explicitly bans these. Each match is auto-fix-eligible: delete the comment AND any shim code it accompanies.

⚠️ Sanity check before deletion: does the shim code have any current callers? Run a follow-up grep to confirm zero usage before deleting any code (not just comment).

- [ ] **Step 3: Apply deletions**

`Edit` tool removals. If the shim function has zero callers, delete the function. If it has callers, the comment is a lie — the code isn't actually removed — log as finding instead.

- [ ] **Step 4: Re-run gates**

Same gates as Task 17 Step 6.

- [ ] **Step 5: Commit**

If deletions landed:
```bash
cd /home/kali/hoba && git add -A && git commit -m "chore: drop backcompat shims surfaced by cleanup sweep"
```

Apply rollback rule if gates regress.

---

### Task 19: Stale comments walk

**Files:**
- Read: all `.ts`, `.tsx`, `.py` under `apps/` and `packages/`
- Possibly modify: any
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Build a candidate list via grep**

```bash
cd /home/kali/hoba && grep -RInE "(commit [0-9a-f]{7,40}|fix(es)? #[0-9]+|see (issue|PR) #[0-9]+|removed in|added for the|introduced by)" apps/ packages/ 2>/dev/null | grep -v node_modules | grep -v __pycache__
```

These are comments referencing specific commits, issues, or change rationale — exactly the kind CLAUDE.md system prompt says to avoid ("they belong in the PR description and rot as the codebase evolves").

- [ ] **Step 2: For each match, judge**

- Comment references closed bug + the fix is now in code → delete the comment.
- Comment references a constraint that's still load-bearing (e.g., "must run before Y because Z") → keep, log as finding "constraint comment, kept".
- Comment is a generic narration ("this function calculates X") → delete (well-named identifiers do that work).

- [ ] **Step 3: Apply deletions**

`Edit` tool. Be conservative: when in doubt, log as finding, don't delete.

- [ ] **Step 4: Re-run gates**

Same gates as Task 17 Step 6.

- [ ] **Step 5: Commit**

If deletions landed:
```bash
cd /home/kali/hoba && git add -A && git commit -m "chore: prune stale narration / closed-issue comments"
```

---

### Task 20: Half-implementations walk

**Files:**
- Read: walk the repo top-level
- Possibly append: `docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Walk candidate sites**

Manual inspection. Pattern recognition:
- Components defined but never rendered: `grep -RIn "export (const|function|default function) [A-Z]" apps/webapp/src/{features,components}` and cross-check against `<ComponentName` usages.
- Types defined but never used: `tsc --noEmit` already catches most via `--noUnusedLocals` if enabled. Check `tsconfig.json` — if not enabled, this sweep is the catch-net.
- Server handlers with empty branches: `grep -RIn "if .*:$" apps/api/src/hoba_api/realtime` — look for branches that pass without action.
- Conditional rendering returning nothing: `grep -RIn "return null" apps/webapp/src` — confirm each is intentional.

- [ ] **Step 2: For each candidate, judge**

Half-implementation = scaffold that's not wired up AND not part of an in-flight feature. Spec is the arbiter of "in-flight": Stage D mentions Punishment, Chaos etc., so any scaffolding for those modes is intentional pre-work, NOT a half-implementation. Leave alone, log as finding "Stage D pre-work".

Confident half-impl = code that's not in any roadmap stage's scope and has no callers. Delete only with high confidence; otherwise log.

- [ ] **Step 3: Apply deletions (rare; bias toward logging)**

`Edit` tool, only if confidence is very high.

- [ ] **Step 4: Re-run gates**

- [ ] **Step 5: Commit if deletions**

```bash
cd /home/kali/hoba && git add -A && git commit -m "chore: drop unused scaffold surfaced by cleanup sweep"
```

Findings doc gets the rest.

---

### Task 21: Commit Lane 3 findings to findings doc

**Files:**
- Modify: `/home/kali/hoba/docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Verify Lane 3 sections are populated**

Open `docs/cleanup-2026-05-28-findings.md`. Confirm:
- "Lane 3 — Codebase findings (auto-fixed)" has entries for every auto-fix commit landed in Tasks 15–20 (with commit hashes).
- "Lane 3 — Codebase findings (needs owner decision)" has uncertain findings.

If either section is empty, write a one-line placeholder: `_No findings in this category._`.

- [ ] **Step 2: Commit**

```bash
cd /home/kali/hoba && git add docs/cleanup-2026-05-28-findings.md && git commit -m "docs(cleanup): record Lane 3 codebase findings"
```

---

## Phase 5 — Exit gate

### Task 22: Fill the Summary section of the findings doc

**Files:**
- Modify: `/home/kali/hoba/docs/cleanup-2026-05-28-findings.md`

- [ ] **Step 1: Compute the summary numbers**

Tally from git log and from the findings-doc body:
- Lane 1: number of TODO lines struck, number added (should be 1 for iPhone X), exhaustive-sweep extras found.
- Lane 2: number of docs edited inline (count `docs(*)` commits since Task 4), number of opinion-drift findings, number of stale-but-historical findings.
- Lane 3: number of categories with auto-fixes, number of auto-fix commits, number of uncertain findings.
- Total commits in this cleanup pass: `git log --oneline 5659c52..HEAD | wc -l` (5659c52 is the spec commit; everything after is this pass).

- [ ] **Step 2: Write the Summary section**

Replace the placeholder Summary section with the real numbers. Format:

```markdown
## Summary

**Cleanup pass executed 2026-05-28 per `docs/superpowers/specs/2026-05-28-cleanup-pass-design.md`.**

- **Lane 1 (TODO.md hygiene):** N stale lines struck, 1 iPhone X verify line added, M extras found via exhaustive sweep.
- **Lane 2 (doc drift):** N docs edited inline; M opinion-drift findings logged; K stale-but-historical entries flagged in manual-verify logs (not edited).
- **Lane 3 (codebase audit):** N categories had auto-fixes (commits …); M uncertain findings logged for owner triage.

**Total commits in this pass:** X.
**Quality gates at exit:** Y backend / Z frontend tests passing; ruff / mypy --strict / eslint / tsc / i18n:check all green.

**Owner triage queue:** the "needs owner decision" entries in Lane 3 and the "uncertain / opinion" entries in Lane 2 are the actionable backlog from this pass.
```

- [ ] **Step 3: Commit**

```bash
cd /home/kali/hoba && git add docs/cleanup-2026-05-28-findings.md && git commit -m "docs(cleanup): finalize findings doc summary"
```

---

### Task 23: Final quality-gate run

**Files:** None (verification only).

- [ ] **Step 1: Run all gates back-to-back**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -10 && uv run ruff check . && uv run mypy --strict src
cd /home/kali/hoba/apps/webapp && pnpm test --run 2>&1 | tail -10 && pnpm lint && pnpm tsc --noEmit && pnpm i18n:check
```

Expected: every gate exits 0. Test counts match baseline from Task 1 (or are higher if any Lane 3 fix added tests). If counts dropped, that's a regression — STOP and investigate.

- [ ] **Step 2: Confirm working tree clean**

```bash
cd /home/kali/hoba && git status
```

Expected: `nothing to commit, working tree clean`.

If unclean: `git status` to see orphans, decide per-file: commit (if intentional and in scope) or `git checkout --` (if accidental). Then re-run this step.

---

### Task 24: Status block + handoff

**Files:** None (final chat message to owner).

- [ ] **Step 1: Compose status block**

Write a chat message to the owner with:

- **Commits landed** — `git log --oneline 5659c52..HEAD` output (or summarized count).
- **Lane 1 result** — strikes / additions count, line for iPhone X verify entry.
- **Lane 2 result** — docs edited, findings count.
- **Lane 3 result** — categories swept, fixes per category, uncertain findings count.
- **Owner triage queue** — point at `docs/cleanup-2026-05-28-findings.md` "needs owner decision" sections.
- **Quality gates at exit** — backend tests / frontend tests / lint+types+i18n.
- **What did NOT change** — CLAUDE.md "Current phase" (Stage C still open with NO-GO); no stage close-out; no memory writes.

- [ ] **Step 2: Mark plan complete**

End the session message with: "Cleanup pass complete. NO-GO on Phase 7+ is unchanged. Next move is yours — triage the findings doc, or run the soft-launch sessions to unblock Stage C exit."

---

## Self-review

**Spec coverage** — every spec section has at least one task:
- Goal / non-goals → Task 0 pre-flight + Task 24 handoff (explicitly does-not-touch list)
- Lane 1 TODO hygiene → Tasks 3-4
- Lane 2 doc drift audit → Tasks 5-14 (per-doc + in-code TODO + findings commit)
- Lane 3 codebase audit → Tasks 15-21 (per-category + findings commit)
- Findings doc structure → Task 2 (scaffold) + Tasks 14, 21, 22 (population + summary)
- Execution sequencing → Phase order in plan matches spec
- Exit gate → Tasks 22-24
- Risk + mitigations → rollback rule called out in Phase 4 preamble + per-task quality-gate re-runs

**Placeholder scan** — searched for "TBD", "TODO" (within the plan itself, not the sweep targets), "fill in details", "similar to Task N": no matches in instruction text.

**Type consistency** — N/A; this plan doesn't introduce types. The single "function" referenced in Lane 1 Step 4 of Task 3 (`user_can_spin` in `services/spins.py`) is read-only.

**Command consistency** — all `cd /home/kali/hoba/...` paths absolute. `pnpm test --run` used consistently (vitest one-shot mode). `uv run` prefix used for all backend commands.
