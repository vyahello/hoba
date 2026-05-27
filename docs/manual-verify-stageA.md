# Stage A — manual verification record

> Required by `docs/roadmap.md` § "Stage A — Close Phase 6 MVP blockers"
> ("end-of-stage gate"). Backfilled in the Stage A close-out commit.

## 2026-05-26 — original 5-blocker verification

The five-blocker Stage A landed with `b873a00`. Automated suites all
green (102 backend tests, 31 frontend tests, 91 % backend coverage,
`mypy --strict`, `ruff`, `eslint`, `tsc --noEmit`, `pnpm i18n:check`).
Hands-on two-device verification then ran the 11-step protocol from
`docs/testing.md` § "Two-device verification" and uncovered **six more
defects** that were fixed in the same stage rather than punted forward
(per the closing rule now in `docs/roadmap.md`):

| # | Step (testing.md) | Outcome | Fix landed in |
|---|---|---|---|
| 1 | Device A: menu button → Quick Wheel → spin | ✅ | — |
| 2 | Settled → `+ Invite friends` visible | ❌ CTA only appeared post-settle, not on idle | `bfdca38` |
| 3 | Tap Share → recipient sees deep link | ❌ env vars not piped through `docker-compose.yml`; Direct Link form built but never enabled at runtime | `6b72946` |
| 4 | Device B: tap deep link | ✅ once env wiring + short-name alignment landed | `0756782` (rename) |
| 5 | Lands directly in `/room/<CODE>` | ✅ | `b873a00` (start_param SDK→hash→query) |
| 6 | Presence list grows on Device A | ✅ | — |
| 7 | Spin from Device A → both wheels animate in sync | ❌ hub on Device A (the host) refused to fire — `onSpinClick` not wired in RoomPage + `SPIN` hub label hardcoded English | `d425a7a` |
| 7b | Host-detection (who is allowed to spin) | ❌ client compared Telegram tg_id to internal user_id; host always treated as guest | `7db1b0a` (added `me_user_id` to RoomState) |
| 8 | Confetti + brand reveal | ✅ | — |
| 9 | Device B reaction → flying emoji on both | ✅ | — |
| 10 | Rate-limit at 11th reaction in 30 s | ✅ | — |
| 11 | UK locale flip is total | ❌ multiple Ukrainian strings were awkward translations + missing ICU plurals for participant count | `4efb510` |
| — | Doc structure for new contributors | ❌ README was a wall of text mixing landing-page and dev-setup content | `6ef70a4` (split into `architecture.md` / `development.md` / `testing.md`) |
| — | Default spin policy social fit | ❌ `host_only` discourages party-game play; flipped to `anyone` | `00f3c21` (Alembic `0003`) |

After all six fixes landed, the 11-step protocol re-ran end-to-end on
real devices (iPhone + Android, EN + UK) without further regressions.
Stage A formally closed in `12ce234`.

## 2026-05-27 — close-out batch (this commit set)

Post-close-out review surfaced **two more user-observable defects** the
original verification missed because both are subtle interaction-state
bugs that only become obvious after multiple spins in a single session.
Per the same closing rule (verification findings stay in their stage),
they were fixed in Stage A:

| # | Observation | Fix |
|---|---|---|
| 12 | Hub button (the centerpiece of the wheel) was dead after the first spin: state advanced `idle → spinning → settled` and only the secondary button below the wheel could revive it. Closing the result overlay left users staring at an inert centerpiece. | `31a23e8` — `isHubInteractive()` helper + state-machine relaxation |
| 13 | In `host_only` rooms, the hub kept the `SPIN` label + breath animation for non-host guests because `Wheel.tsx` ignored whether `onSpinClick` was wired. | Same commit — `hasHandler` check in `isHubInteractive`. |
| 14 | `RoomPage`'s host-detection logic had no direct test guarding the regression fixed in `7db1b0a`. A future refactor could silently re-break it. | `c5334ee` — extracted `computeCanSpin(snapshot)` with seven cases (anyone, host_only host, host_only guest, unknown user_id, `-1` sentinel, turn_based host, turn_based guest). |
| 15 | BotFather had two Direct Link Mini Apps (`spin` and `play`); only `play` matched `VITE_TELEGRAM_APP_SHORT_NAME`. | `0756782` — `spin` deleted in BotFather + docs aligned. |

### Hands-on verification — pending owner sign-off

The unit tests for items 12–15 pass (43 frontend / 102 backend, all gates
green). What still needs a real-device pass before this batch can claim
parity with the 2026-05-26 record:

```
Device A (host):
  1. Quick Wheel → spin. After settle, the hub itself should still glow
     and show SPIN — a tap should kick off a fresh spin without going
     through the lower button. (Item 12.)
  2. Close the result overlay. The hub should remain interactive in the
     same way. (Item 12.)
  3. Create a room, change spin_policy back to host_only via the API
     (no UI yet — Stage B). On Device B (guest), the hub should not
     show SPIN, should not glow, should not be tappable. (Item 13.)

Device B (guest in host_only room):
  4. After Device A spins, the guest can still react. (No regression.)
```

Status: **awaiting owner verification on real Telegram.** Update this
section with outcomes when complete.

## Quality gates — Stage A close-out

```text
backend  pytest .................... 102 passed (91 % coverage)
backend  ruff check ................ clean
backend  mypy --strict ............. clean
webapp   vitest .................... 43 passed (was 31; +12 from this batch)
webapp   tsc --noEmit .............. clean
webapp   eslint --max-warnings 0 ... clean
root     pnpm i18n:check ........... clean (EN ⇄ UK parity + key coverage)
```
