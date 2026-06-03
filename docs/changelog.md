# Hoba! — Delivered History

> Append-only record of shipped work. Moved out of `CLAUDE.md` so the operational file stays lean (and cheap to load into every Claude Code session). Newest first. `CLAUDE.md` keeps only the *current* phase line; close-out detail lands here.

---

## Post-launch — 2026-06-03 — Settings: Sound gates all audio; louder + wider picker SFX

- **Two toggles, not three** — removed the separate "Background music" toggle. **Sound** is now the single audio switch: it gates SFX *and* the music bed (`applySound` in `stores/settings.ts` calls both `audio.setEnabled` + `audio.setMusicEnabled`). Dropped `setMusic`/`music`/`KEY_MUSIC` from the store, the `Music` row from `SettingsPage`, the `settings:music` locale key (EN+UK), `music_enabled` from `Me`/`UserMe`/`UserMeUpdate`. The `users.music_enabled` **column is kept vestigial** (alongside `is_anonymous_default`) to avoid a SQLite rebuild — `docs/TODO.md` tracks dropping both.
- **Picker SFX everywhere** — added `audio.play("ui_tap")` to every plain (non-DS) button that lacked it: the language switch, Sound/Haptics toggles, the moderation entry, the Privacy/Terms/Credits links (`SettingsPage` via a shared `pickFeedback()`), and the Credits source/license links. DS `Button`/`IconButton` already played it, so this closes the gaps the owner heard (language, moderation).
- **Louder taps** — `ui_tap` volume 0.55 → 0.9, `ui_swipe` 0.5 → 0.7 (owner: picker SFX too quiet; bg-music level left as-is).
- Gates: backend 314 / frontend settings tests 4, mypy --strict · ruff · tsc · eslint · i18n parity · build all green.

## Post-launch — 2026-06-03 — Real music playlist + host-only in-room bed + bot turn pacing

- **Bot turn pacing** — `BOT_TURN_DELAY_SECONDS` 1.1 → 2.8 so after the host's spin settles there's a readable beat before the bot's wheel goes (owner couldn't see the host's landed option). Covers every bot hand-off (spin-settle, dare-resolve/approve, rejoin-resume).
- **Background music is now real tracks, not synth** — replaced the single synthesized `bg_music.mp3` loop with **6 user-supplied tracks** (`bg_1..6.mp3`), re-encoded to 112 kbps stereo + `loudnorm I=-16` (metadata/art stripped) → 41 MB raw down to ~16 MB. The dead `c_bg_music` synth cue + its bitrate special-case were removed from `scripts/generate_sounds.py` (11 SFX cues remain).
- **Shuffled playlist** (`audio/index.ts`, `manifest.ts`) — tracks stream once via **html5** (not Web Audio: full songs would fully decode into RAM), then advance to a random next track (`pickNextTrack`, never the same one twice in a row) on `onend`. The old gapless-loop concern doesn't apply when each track plays once. Per-track Howls are unloaded on advance to avoid leaking `<audio>` elements.
- **One source of music per room** — gating refactored into `musicShouldPlay()` = `wanted && enabled && allowed` + `reconcileMusic()`. New `setMusicAllowed(bool)`; `RoomPage` sets it to `callerIsHost` (cleanup restores `true` on leave), so **only the host plays the bed inside a room** — co-located guests don't stack different tracks. Guests still get all SFX; lobby music is unaffected.
- **Licensing + in-app Credits** — tracks identified from ID3 tags: 5 are **Kevin MacLeod / Incompetech (CC-BY 4.0 → attribution mandatory)**, 1 is Pixabay (no attribution). Added a **Credits screen** (`CreditsPage`, `/credits`, linked from Settings → Credits) listing each track + author + license, with tappable Source / CC-BY-license links (`openExternalLink` via `WebApp.openLink`). New `credits` i18n namespace (EN+UK). `docs/audio-licenses.md` records the full per-track table. Frontend gates green (tsc · eslint · settings tests · i18n parity · build, all 6 tracks in `dist/sounds/`). No backend test count change.

## Post-launch — 2026-06-02 — Room defaults: approval ON, "anonymous by default" setting removed

- **Join-approval ON by default** — `create_room` now sets `requires_approval=True` (host can still toggle it off per-room). Applies to all create paths (direct / from-template / use-wheel); the host auto-approves themselves, guests wait. Tests creating "open" rooms now pass `requires_approval=False` explicitly.
- **Removed the "Anonymous by default" setting** — the main-Settings toggle, the `useSettings.anonymousDefault` store plumbing (field/setter/hydrate/localStorage key), the `Me.is_anonymous_default` type, the `settings.anonymous` i18n key (EN+UK), and the `is_anonymous_default` fields on `UserMe`/`UserMeUpdate`. Room creation no longer seeds `is_anonymous` from it — anonymity is now purely a per-room host control (defaults off; an explicit `is_anonymous` on create still honored). The `users.is_anonymous_default` **column is kept (vestigial)** to avoid a SQLite drop-column rebuild — `docs/TODO.md` tracks dropping it.
- **No migration.** Backend 314 / frontend 121 green; ruff · mypy --strict · tsc · eslint · i18n · build all clean.

## Post-launch — 2026-06-01 — Fix: Chaos "miss" 500 + bot not showing in standings

Device testing of the solo bot surfaced two issues, both traced on the prod DB (the lock-PATCH 500 had no log — structlog swallows HTTP tracebacks — so it was reproduced by running `build_room_state` against the live rooms in the container).
- **500 on lock (and rejoin / any REST fetch) of a Chaos game** — pre-existing latent bug, not really bot-specific: `build_room_state` validates `punishment_last_outcome` through `PunishmentOutcomeOut`, whose `kind` was `Literal["lucky","punish"]` — but a **Chaos miss** (and now a bot miss) writes `kind="miss"`, so validation raised → 500. Live play never hit it because the WS patch sends the raw dict; `build_room_state` (REST GET, room:state on rejoin, the lock PATCH response) does validate. Fix: `kind` now allows `"miss"` (backend schema + frontend `PunishmentOutcome` type).
- **Bot didn't appear in the standings** — the bot *was* being added (prod bets showed `-1000`), but the live flow only sends incremental patches after `start_game`, never re-sends the participant list, so the client never learned about the synthetic bot participant. Fix: on game start, when a bot was added, the server pushes a fresh `room:state` to the host so the bot shows up immediately (rejoin already worked via `build_room_state`).
- Tests: `test_bot_appears_in_standings` now also asserts a `kind="miss"` outcome round-trips through `build_room_state`. Backend 314 / frontend 122 green.

## Post-launch — 2026-06-01 — Solo-play bot for Punishment & Chaos

Owner feedback: playing these bet-race modes alone is pointless (you just spin until your own bet matches N). Now, starting either mode **solo** auto-adds a bot opponent so it's a real race.
- **`hoba_api/bot.py`** — `BOT_USER_ID = -1000` (sentinel, no `User`/`Participant` row) + a fun localized, stable-per-room name.
- **`services/punishment.py`** — `maybe_add_bot` (locks a unique free segment when the host starts alone; called from `start_game`); `_advance_turn` appends the bot after the humans (host→bot→host); a bot miss is a no-op in *both* modes (a bot can't do a dare, and it can't be a dare approver — so the human's dare still auto-approves solo).
- **`realtime/handlers.py`** — `_drive_bot_spin`: a server-driven, self-guarding spin that broadcasts `spin:announced/started/settled` (so the human watches the wheel) and resolves via the normal settle path. Scheduled from every turn-advance site: spin-settle, dare-resolve, dare-approve. Fair odds (`trigger_spin`, weights 1 → uniform; no rigging).
- **`services/room_state.py`** — injects a synthetic bot participant into the standings/turn banner when the bot is in the race.
- **No DB change / migration** — the bot rides the existing race maps + turn cursor. Frontend needed **zero** changes (it already keys standings/turn/winner off `participants` + the bet/count maps). Tests: 5 new in `test_punishment.py` (add-when-solo, skip-when-multiplayer, turn ping-pong, bot-miss-no-dare, bot-lucky-wins). Backend 313 / frontend 122 green; all gates clean.

## Post-launch — 2026-06-01 — Fix: language choice now drives server-rendered text

Bug: punishment cards rendered in the **device** language, not the one picked in-app. Root cause — punishment decks are localized server-side from `host.language_code`, but the in-app language switch only changed client i18n + localStorage (`setLocale`); it never persisted to the server. English/Russian phones therefore got English cards even after choosing Ukrainian.
- **Persist on pick** — Settings language buttons now go through a new `useSettings.setLanguage`, which calls `setLocale` *and* `PATCH /me { language_code }`. Server-rendered text (punishment decks, anonymous nicknames) follows the user's choice.
- **Self-heal on boot** — `hydrate()` compares the on-device display locale (`getLocale()`) with the server's `language_code` and pushes the display choice up if they differ, fixing already-mismatched accounts without a re-tap.
- No backend change (`PATCH /me` already accepted `language_code`). Frontend 122 green; all gates clean.

## Post-launch — 2026-06-01 — Audio polish: gapless music + more click coverage

Follow-up to the sound overhaul, from device feedback (looping gap, missing clicks, no music on Home):
- **Gapless, livelier music** — `bg_music` re-composed as an upbeat 8-bar I–V–vi–IV loop @ 124 BPM (driving bass + bright pulse arpeggio + catchy lead hook + four-on-the-floor groove), and rendered with **circular tail-wrap** so end→start has no click. The Howl switched from `html5: true` (whose `<audio>` loop gapped/stalled in WebViews) to **Web Audio** (`html5: false`) for a sample-accurate gapless `loop`. Fixes "music restarts every ~10 s" and "music sometimes vanishes."
- **Music is now app-wide** — requested once at the shell (`RootLayout`) and looping for the whole session (Home/Quick-Pick included), not scoped to the room. Started/revived on the first gesture + on `visibilitychange` (iOS suspends the context on backgrounding).
- **More click coverage** — Quick-Wheel cards and every mode-picker chip (mode / punishment deck / win-count) now play `ui_tap` (they're custom buttons, so they didn't inherit the `Button` sound).
- **Generator** gained a `pulse` (chiptune) waveform + an optional CLI cue filter (`python3 scripts/generate_sounds.py bg_music`). Gates: backend 308 / frontend 121 green; all linters/types/i18n/build clean.

## Post-launch — 2026-06-01 — Sound design overhaul + background music

Earlier in the day the silent audio system got a first synthesized set (`d7cd860`). This pass makes it a real, cohesive sound design and wires every cue.

- **12 cues, upgraded synthesis** (`scripts/generate_sounds.py`, now stereo + Schroeder plate reverb + detuned unison + layered transient/body/sub): punchier `wheel_tick`/`wheel_launch`, richer `result_chime`, plus two new cues — **`winner_fanfare`** (ascending arp → triumphant chord stab + sub thump + sparkle) and **`bg_music`** (seamless ~9.6 s lo-fi C–Am–F–G loop for the in-room bed).
- **Every cue is now wired** (previously `confetti_burst`/`chaos_event`/`join_ping`/`rigged_reveal` were generated but never played): button + icon-button taps → `ui_tap`; sheet open → `ui_swipe`; new-participant join → `join_ping`; chaos-event announce → `chaos_event`; rigged reveal → `rigged_reveal`; **winner moments** (elimination survivor, best-of-N, Chaos bet-race) → `winner_fanfare` + `confetti_burst` (were a tiny `hoba_pop`).
- **Background music** — `AudioManager` gains a looping, html5-streamed music track with fade in/out, gated by a new **Music** setting; `RoomPage` requests it on mount and releases on leave.
- **Music setting end-to-end** — `users.music_enabled` column (Alembic **0019**, additive boolean, SQLite-safe) + `UserMe`/`UserMeUpdate`; the settings store (`music`) persists to `PATCH /me` + localStorage and drives `audio.setMusicEnabled`; new `settings.music` label (EN+UK); Settings toggle row.
- **iOS** — the first-gesture Web Audio unlock from `d7cd860` carries the whole set; music uses `html5: true` so the longer file streams.
- **Tests/gates** — settings store test extended (music apply/persist/hydrate); backend 308 / frontend 121 green; ruff · mypy --strict · tsc · eslint · i18n:check · build (all 12 mp3s bundle) clean. Deploy runs migration **0019**.

## Post-launch — 2026-06-01 — Admin moderation review UI

Closed the only functional gap left after Stage G: reports auto-hid a wheel at 3 distinct reporters, but there was no way to *review* or *reverse* that — the queue lived only in the DB. Now there's an admin-gated review UI.

- **Admin gate** — new `ADMIN_TG_IDS` env var (comma-separated Telegram ids) parsed to a set on `Settings.admin_tg_id_set`; `auth/dependencies.py` gains `is_admin(user)` + an `AdminUser` dependency (403 `not_admin` for everyone else). `GET /api/v1/me` now returns `is_admin` so the client can show/hide the entry.
- **Endpoints** (`api/v1/moderation.py`, admin-only): `GET /moderation/reports` lists every reported-or-hidden wheel with its reporters + reasons (hidden first, then by report count); `POST /moderation/wheels/{id}/unhide` clears `is_hidden`, deletes the report rows, and resets `report_count` to 0 (clean slate so the next report starts fresh); `POST /moderation/wheels/{id}/hide` is a manual takedown for wheels below the auto-hide threshold.
- **Service** (`services/wheels.py`): `list_reported_wheels` (one wheels query + one batched reports-join-users query, returns `(Wheel, [ReportRow])`), `unhide_wheel`, `hide_wheel`. Schemas `ReportedWheelOut` + `ReportRowOut`.
- **Frontend** — `/admin/moderation` page (`AdminModerationPage.tsx`): loads the queue, renders each wheel with its option chips + per-reporter complaints + Restore/Take-down actions, self-guards on 403. Entry surfaces in Settings only when `is_admin`. New `admin` i18n namespace (EN+UK).
- **Tests** — `tests/api/test_moderation.py` (9): admin gate, `is_admin` flag, queue contents, threshold→hide→unhide→restore round-trip (incl. trending visibility), manual hide below threshold, 404s. Backend 306 / frontend 116 green; mypy strict + ruff + tsc + eslint + i18n:check clean.
- **Ops** — `ADMIN_TG_IDS` passthrough added to `docker-compose.yml` api env + documented in `docs/deployment.md`. (`.env.example` is permission-blocked in the working sandbox; owner should add the line manually.) **No migration** — schema unchanged.

## 🎉 STAGE G COMPLETE — 2026-06-01 — ALL STAGES A→G DONE

**Phases 11 + 12 delivered: host moderation, hardening, launch.** With this, the full `docs/spec.md` is implemented and the post-MVP roadmap (A→G) is finished. Three slices, each gated + committed separately. Remaining work is owner-only launch ops (BotFather, GIF, fresh-VPS smoke, device audit) — tracked in `docs/TODO.md`.

### Slice 1 — Host moderation toolkit (Phase 11) — commit `ba74992`

Much of the plumbing predated this slice (`is_locked`/`is_anonymous`/`kicked_at` columns; lock + kick-reblock already enforced in `join_room`; `close_room`); the slice added the **actions, anonymity, and host UI**.
- **Kick** — `kick_participant` (host-only, can't kick self, target must be present) sets `kicked_at`; `POST /rooms/{code}/kick {user_id}` → `room:kicked` broadcast. Re-join stays blocked.
- **Anonymous mode** — `is_anonymous` added to `update_room`'s allowed patch; `anon.py::generate_nickname` produces a deterministic adjective+animal alias per `(room, user)`, **localized to the viewer's `language_code`**; `build_room_state` swaps every real name for the nickname when `room.is_anonymous`.
- **Mid-room mode change** — `update_room` resets round/bet state (`_reset_round_state`, cursor preserved) + re-derives `punishment_unique_bets`/deck on a game-mode change.
- **Close** — `room:closed` broadcast so guests are ejected.
- **Frontend** — `RoomSettingsSheet` reworked into the host moderation hub (spin-policy conditional, Lock + Anonymous toggles, Players list with per-guest Kick, Change-mode → picker, Close room); destructive actions use a native Telegram confirm (`confirmPopup`). Store gains `endedReason` + `room:kicked`/`room:closed` handlers → RoomPage toasts + navigates home. 10 service tests.

### Slice 2 — Hardening pass (Phase 12) — commit `67cbf11`

Audited first: replay protection (`auth_date`), all §14 rate limits (room-create, spin 30/h + 1.5s cooldown, reactions, make-public 3/day, report), profanity filter, frontend error boundary — **already present**. This slice closed the three gaps:
- **Input sanitization** (`sanitize.py::sanitize_text`) — NFKC normalize, strip control/format/zero-width/bidi chars, collapse whitespace, defensive truncation; applied to room question + segment labels, room title, saved-wheel title + labels, report reason.
- **Room-cleanup task** (`tasks/cleanup.py::close_stale_rooms`) — closes non-closed rooms idle past a cutoff (newest participant `last_seen`, fallback `created_at`); CLI `python -m hoba_api.tasks.cleanup` + `HOBA_CLEANUP_AFTER_HOURS`; cron line in `docs/deployment.md` § 8.
- **Fuzz suite** (`tests/api/test_fuzz.py`) — authenticated junk payloads across every write route + GET routes with junk params; asserts every response `< 500`. Plus sanitize + cleanup unit tests.

### Slice 3 — Launch content + ops (Phase 12) — commit `b9af6d6`

- **Privacy + Terms, in-app + bilingual** — new `legal` i18n namespace (EN+UK, sectioned); `LegalPage` at `/privacy` + `/terms` (public SPA routes, also browser-reachable for BotFather's Privacy link); linked from Settings → About. `docs/privacy.md` points to the canonical in-app copy.
- **Deploy script** — `scripts/deploy.sh` (pull → build → up → `/health` poll; `--no-pull`, `HOBA_COMPOSE_FILE`).
- **README** — 60-second walkthrough storyboard (+ GIF placeholder) + Deploy-to-production section.

**Verification:** automated gates green — **289 backend (86%) / 106 frontend**, ruff + mypy --strict + tsc + eslint + i18n + `pnpm build` clean; alembic head **0016**; `bash -n scripts/deploy.sh` OK. **Spec §17 "Full Done" status:** all 5 modes ✅, Rigged playtest-ready ✅, public/trending/moderation ✅, host moderation toolkit ✅, 12 UX flows implemented ✅, Privacy + Terms both languages ✅, README walkthrough section ✅ (GIF = owner), public-wheel-in-trending path ✅; the remaining boxes (staging smoke + production deploy + BotFather final config) are the **owner-only launch checklist** in `docs/TODO.md`. **Next: owner launch ops, then ongoing feature/polish work — no further `go on stage X`.**

---

## STAGE F COMPLETE — 2026-05-31

**Phases 9 + 10 delivered: the wheel library + public discovery.** Three slices, each gated + committed separately.

### Slice 1 — Saved Wheels (Phase 9) — commit `17c812c`

Per-user wheel library. New `Wheel` model (`wheels` table, Alembic **0015**, named FK `fk_wheels_owner_id_users`), owning its options as `Segment` rows with `parent_type="wheel"` (the Segment model is polymorphic — no new options table). `services/wheels.py` (CRUD + ownership guards + `use_wheel` → `create_room` + bump `use_count`); REST `/wheels` (`GET` list · `POST` create → 201 · `PATCH/{id}` · `DELETE/{id}` → 204 · `POST/{id}/use` → RoomState). Frontend: Create page "Save to my wheels"/"Save changes" + edit-via-`location.state.editWheel`; rewritten Library page (list / Use→mode-picker→room / Edit / two-tap Delete); Home "My wheels" preview + "See all"; host 💾 "Save this wheel" in Room. `request()` gained a 204 guard. 7 service tests.

### Slice 2 — Templates (Phase 9) — commit `e1b8f4c`

Owner decisions: **server-side** (per spec) + **templates = expanded Quick Wheels**. Static catalog of **8 localized built-ins** (`hoba_api/templates/catalog.py`: the 6 curated presets ported EN+UK verbatim + new `drink` 🍹 + `game` 🎲), each carrying both locales' title/segments + emoji + gradient + category. `GET /api/v1/templates?locale=` resolves to one locale; `POST /api/v1/rooms/from-template {template_key, locale, game_mode, …}` re-resolves canonically server-side → `create_room` (rate-limited like room creation). Home's "Quick decide" grid now fetches templates (6-tile skeleton while loading, **fail-loud** error card + Retry per rule 7, refetches on language change); solo spin stays instant by loading the already-localized segments into the custom-wheel store; "Create room" from a template routes through `from-template`. `QuickWheelCard` refactored to primitive display props (serves both server templates + the DS showcase). 8 service tests. `quickWheels.ts` retained for the DevDS showcase + `/spin/:id` fallback.

### Slice 3 — Public + Trending + Moderation (Phase 10) — commit `3394183`

`wheels` gained social columns (`like_count`, `report_count`, `is_hidden`, `category`, `published_at`) + two per-`(wheel, user)` unique join tables `wheel_likes` / `wheel_reports` (Alembic **0016**, named FKs, `op.add_column` — SQLite-safe per § 9b). **Profanity filter** (`moderation/profanity.py`): EN + UK + transliterated-RU deny-list with NFKC + zero-width strip + leet-fold + de-spacing (catches `f u c k`, `sh1t`, `Сука`), applied to title + all labels on publish. New service ops in `services/wheels.py`: `publish_wheel` (owner, profanity-gated), `unpublish_wheel`, `toggle_like`, `report_wheel` (idempotent/user, auto-hide at **`REPORT_HIDE_THRESHOLD=3`** distinct reporters), `list_trending`, `search_trending`, `get_public_wheel`; `use_wheel` relaxed to allow any visible **public** wheel (non-owner becomes host). Endpoints: `POST /wheels/{id}/publish` (3/user/day) · `/unpublish` · `POST /wheels/{id}/like` · `GET /api/v1/trending?category=&limit=&offset=` · `GET /trending/search?q=` · `POST /api/v1/moderation/report`. **Trending signal** (documented in `docs/architecture.md`): `like_count*3 + use_count` desc, `published_at` then `id` tiebreak, hidden/private excluded at the query level. Frontend: new `/trending` page (debounced search, category chips, ❤️ optimistic like-toggle, Use→room, two-tap Report), Home Trending strip (hidden when empty) + "See all", Library per-wheel Make-public/Make-private toggle + 🌐 badge. 13 service tests.

**Verification:** automated gates green — **260 backend (85%) / 106 frontend**, ruff + mypy --strict + tsc + eslint + i18n + `pnpm build` clean; alembic head **0016** (single head). **End-of-stage gate met:** F10 flows work EN+UK, profanity filter rejects a curated list, trending paginates + sorts by a documented signal. **Carry-overs into Stage G (`docs/TODO.md`):** no category picker in the make-public UI (backend accepts it) → user wheels publish uncategorized; no admin un-hide/review UI (spec defers the manual queue); plus the still-open Chaos/Rigged polish items from Stage D/E. **Pending owner real-device verify** (deploy runs migration 0016). **Next: Stage G — host-moderation toolkit + hardening + launch.**

---

## Post-Stage-E fixes — 2026-05-31

- **Rigged reveal is now a separate full-screen page** (`fixed inset-0`, opaque) instead of an `absolute` overlay inside `<main>` that left the header showing and blended with the room. Reveal text changed to "Хоба! / воно було підкручене 🎭" (skewed HobaWord + sentence).
- **Bug: rigging a best-of-N Classic room stopped the attempt counter.** Rigging flips `game_mode` to `"rigged"`, but the best-of-N recompute in `_emit_settled` (and client `isBestOfN`) gated on `== "classic"` → attempts froze. Both now accept `game_mode in (classic, rigged)`.

---

## STAGE E COMPLETE — 2026-05-31

**Phase 8 delivered: Rigged Mode 🎭** — the legendary hidden-weighting feature. With it, **all five game modes are live** (Classic, Elimination, Punishment, Chaos, Rigged). Two slices:

- **Slice 1 — secret weighting + secrecy.** Host weights segments 0–100 (`Segment.weight`, already consumed by `compute_spin` → no engine change) via a hidden ~1.5 s long-press on the hub → `RigEditorSheet`. Room flips to `game_mode="rigged"`, but `build_room_state` redacts it to "classic" + uniform weights for non-host viewers — byte-identical to a plain Classic room. Host-only `PATCH /rooms/{code}/rig` (no broadcast). `services/rigged.py`, Alembic 0013 (`rigged_revealed`). CI fairness guard (±2% over 40k weighted picks).
- **Slice 2 — the reveal.** Host "Reveal the rig 🎭" → `POST /rooms/{code}/reveal` flips `rigged_revealed` (the redaction un-redacts mode + weights for everyone), stamps 🎭 into the title, broadcasts `rigged:revealed`; clients refetch + play a full-screen reveal (skewed Хоба! + weight bar-chart + "rigged for N spins 😈" + confetti). Alembic 0014 (`rigged_spin_count`).

**Verification:** automated gates green — **232 backend (86%) / 106 frontend**, ruff + mypy --strict + tsc + eslint + i18n + `pnpm build` clean; alembic head 0014. Spec calls Rigged "the most playtest-driven feature" — the reveal animation feel is tunable on owner device feedback. **Carry-overs into Stage F (`docs/TODO.md`):** Chaos animation tuning + deferred Chaos events (Double-spin, Phantom), Rigged reveal feel. **Next: Stage F — Library / Saved wheels / Templates / Public + Trending + Moderation.**

Slice detail below.

---

## Stage E — Rigged Mode 🎭 (slice history)

### Slice 2 — the reveal moment (2026-05-31)

The catharsis. Host-only "Reveal the rig 🎭" button in `RigEditorSheet` → `POST /rooms/{code}/reveal` (`services/rigged.py::reveal_rig`): sets `rigged_revealed = true`, stamps 🎭 into the room title (ethical guard), broadcasts `rigged:revealed`. The existing `build_room_state` redaction keys on `rigged_revealed`, so it un-redacts mode + weights for **everyone**; clients refetch on the event (`store` `rigged:revealed` handler → `api.getRoom` → `setSnapshot`). RoomPage plays a **full-screen reveal** — skewed "Хоба!" + "IT WAS RIGGED!" + an animated real-weight **bar-chart** (sorted desc) + "rigged for N spins 😈" + confetti, auto-dismiss 5 s. New `rooms.rigged_spin_count` (Alembic **0014**), incremented per spin while rigged (redacted to 0 for non-host pre-reveal); `rigged_revealed` + `rigged_spin_count` exposed on `RoomOut`/`RoomState` (client type optional to keep fixtures valid). EN+UK `rig.reveal` / `rig.revealed_title` / `rig.revealed_count`.

Gates green: **232 backend (86%) / 106 frontend**, ruff + mypy --strict + tsc + eslint + i18n + `pnpm build` clean. **Rigged Mode is feature-complete; pending owner real-device verify** (rig a Classic room, spin biased, guests can't tell, then reveal → bar-chart + 🎭). Mechanics in `docs/game-modes.md` (Rigged).

### Slice 1 — secret rigging mechanic (2026-05-31)

Rigged Mode (spec §5.5) groundwork + the secret-weighting half. The reveal moment is Slice 2.

- **Weighting reuses `Segment.weight`** (already fed to `compute_spin`) — no engine change for weighted spins. New `services/rigged.py::set_rig_weights` (host-only) validates `{segId: 0..100}`, rejects all-zero / bad / unknown segments, sets the weights and flips `room.game_mode="rigged"` (spin policy untouched).
- **Secrecy via per-viewer redaction** in `build_room_state`: non-host + not-revealed → `game_mode` serialized as `"classic"` and segment weights as `1`. Host (and everyone post-reveal) sees the truth. New `rooms.rigged_revealed` column (Alembic **0013**, additive bool).
- **Endpoint** `PATCH /rooms/{code}/rig` (`RigUpdateIn`) — host-only, **no broadcast** (guests must not learn). Returns the host's full snapshot.
- **Frontend**: hidden **long-press on the hub** (`<Wheel onHubLongPress>`, ~1.5 s, host-only, Classic/Rigged rooms) opens `RigEditorSheet` (0–100 slider per segment, commits on release via `api.setRig`). Host gets a "🎭 Rigged" badge (`getGameModeMeta`/`shouldShowBadge` now cover rigged while keeping it out of `PICKABLE_GAME_MODES`); guests see redacted "classic" → no badge. EN+UK `modes.rigged` + `rig.*`.
- **CI fairness guard**: weighted RNG lands within ±2% of declared share over 40k picks (`test_rigged.py`).

Gates green (Opus 4.8, inline): **229 backend (86%) / 106 frontend**, ruff + mypy --strict + tsc + eslint + i18n + `pnpm build` clean. Mechanics in `docs/game-modes.md` (Rigged). **Next: Slice 2 — the reveal moment** (un-redact + bar-chart + 🎭 title + rigged-spin-count).

---

## STAGE D COMPLETE — 2026-05-31

**Phase 7 delivered: all four non-Rigged game modes on prod**, built on the `GameModeEngine` abstraction (`apps/api/src/hoba_api/modes/`: base `Protocol`, `ClassicEngine`, `EliminationEngine`, `PunishmentEngine`, `ChaosEngine`, registry — unknown modes fall back to Classic). Closed-out items:

- **Foundation** — `turn_based` spin policy + per-mode default policy derivation (Slice 1).
- **Mode picker UI** — bottom-sheet picker, `GameModeBadge`, `data/gameModes.ts` source of truth (Slice 2).
- **Elimination** — winning segment shatters off, last survivor wins, `eliminated_at` + `round:reset` (Slice 3).
- **Punishment** — turn-based personal-bet race: lock a unique bet, spin in turn (host first), hit your own bet = match, first to host-picked N wins; a miss deals a dare resolved by a random other player's Yes/No (or Refuse −1). Per-player + room-wide done counters (Slices 4→5; v2 prediction-wager superseded by the v3/v4 race).
- **Chaos** — reworked (4× on real device 2026-05-31) into a **Punishment-style bet race + a chaos event on EVERY spin**. Reuses Punishment's whole flow via `isBetRace = punishment|chaos` (shared service `services/punishment.py`, columns, betting/turn/standings/winner UI); the only fork is `resolve_turn`'s miss branch (chaos miss = no-op). **Eight events** (≈⅛, server-authoritative in `modes/chaos.py`, never two in a row): multi_spin (2–5 fast spins), slow_burn (trimmed turns + flat-tail ease), reverse (CCW), swap (two segments shown crossing), nudge_fwd/nudge_back (settle→shake→creep ±1, generic "nudge" card), blind_pointer (pointer vanishes, reappears on a random option), roaming_pointer (wheel still, pointer roams the options then settles). No per-spin confetti — a hit shows "Хоба! {option}", the landed wedge flashes, winner page only on the winning hit; the viewer's own pick is highlighted. `turn_based` only. Detail in Slice 6 below + `docs/game-modes.md`.

**Verification:** automated gates green throughout — **223 backend (86%) / 106 frontend**, ruff + mypy --strict + tsc + eslint + i18n + `pnpm build` clean. Chaos + Punishment iterated on real device by the owner across 2026-05-31. **Carry-overs into Stage E (`docs/TODO.md`):** Chaos animation-constant tuning (feedback-driven), deferred events Double-spin + Phantom-segment. **Next: Stage E — Rigged Mode 🎭 (spec §5.5).**

Key engineering lessons recorded (memory): for SVG rotation about an arbitrary point use the `transform="rotate(a cx cy)"` attribute driven by a motion value's `.on("change")` subscription — **not** CSS `style.rotate`+`transform-origin` (own-axis bug) and **not** `useMotionTemplate` on the attribute (doesn't update per frame); and Framer `animate()`/`useAnimate` controls aren't awaitable in this version — pace sequences with your own timers.

---

## Stage D — slice history

### Slice 6 — Chaos mode (2026-05-31) — committed, pending owner deploy

Implemented Chaos (spec §5.4) as the fourth `GameModeEngine`, then **reworked it three times the same day** as the owner iterated. Final delivered design:

- **Chaos is now a personal-bet RACE** (like Punishment, minus dares): pick a unique option, spin **in turn** (host first), landing on your own bet scores a match, **first to N wins** (host picks N∈{1,3,5,7}). A miss = no-op (confetti + next turn). This **replaced** the earlier best-of-N "most-frequent-wins" model. Reuses Punishment's flow end-to-end via `isBetRace = punishment | chaos`: same service (`place_bet`/`start_game`/`resolve_turn`/`reset_game`), same columns, same betting/turn/standings/winner UI; the only fork is `resolve_turn`'s miss branch (chaos → `kind:"miss"`, advance). Dare/approval UI auto-disables (chaos outcomes are never `"punish"`). Per-spin: **no confetti**; a non-winning **hit** shows the **"Hoba! {option}"** banner, a **miss** shows nothing, the **winning** hit flips to phase `over` so only the **winner hero** shows (they never overlap), and the winner fires its own confetti. Chaos is **`turn_based` only** — host_only was dropped (degenerate for a multi-player race), and the settings gear is hidden. The engine **never repeats the same event two spins running** (`SpinContext.last_chaos_event` → pick from a different displayed group).
- **A chaos event still fires on EVERY spin** — one of **eight**, ≈⅛ each: **multi_spin** (2–5 short fast spins, last counts), **slow_burn** (slow crawl — trimmed turns + flat-tail ease), **reverse** (CCW), **swap** (two segments trade places, shown **crossing** on the card), **nudge_fwd / nudge_back** (settle → "thinking" shake → creep ±1 sector; share one **generic "nudge"** card), **blind_pointer** (pointer vanishes mid-spin, reappears at a random angle = result), **roaming_pointer** (wheel stays still; the pointer roams the options forward/back then settles on the result — `buildRoamHops` + the Wheel's imperative `roamPointer`, pointer driven by its own motion value). The first cut's speed_run became multi_spin; jackpot was removed. Announcement card holds 2.5 s. Plus polish: per-spin confetti removed (hit shows "Hoba! {option}", landed wedge flashes, winner page only on the winning hit), no back-to-back repeats, and the viewer's own pick is highlighted in standings.
- **Client choreography:** the RoomPage spin-drive effect is an async, cancellable sequence. `multi_spin` feeds sequential `SpinResult`s to `<Wheel>` via a `phaseSpin` override + `wheelRef`; `nudge_*` does spin → container shake (`useAnimate`) → one-sector creep; `swap` animates the two `swap_pair` labels crossing in the card. Server records the nudged result + `nudge_from_angle`; tunable constants (`MULTI_SPIN_*`, `NUDGE_*`, `SLOW_BURN_MULTIPLIER`) flagged for on-device tuning in `docs/TODO.md`.
- **Host picks attempts N ∈ {1,3,5,7}** in the mode picker (like Punishment) → **best-of-N**, most-frequent segment wins. Reuses the Classic best-of-N machinery via a one-line gate change (`game_mode in (classic, chaos)` in `_emit_settled`) + `isBestOfN` gate + `DEFAULT_CHAOS_SPIN_COUNT = 3`.
- **Spin policy:** default `turn_based`; settings sheet offers host_only + turn_based only ("anyone" hidden for Chaos). `MODE_DEFAULT_SPIN_POLICY["chaos"]` = `turn_based`.
- **Announcement card** leads with the skewed `<HobaWord/>` + event emoji/title, held `CHAOS_ANNOUNCE_MS = 1500` before the wheel releases (settle/reveal timers offset by the pre-roll).

Server-authoritative roll in `modes/chaos.py` (`ChaosEngine`, injected RNG for deterministic tests). The `reverse` angle flip lives in `services/spins.py` (engines never compute angles): final angle re-targeted below the start so Framer animates CCW to the same sector. `swap` reorders `SpinDecision.segments` + emits `segment_order` so the client renders the same order. Event **folded into `spin:started.mode_effects`** (no separate `chaos:event`). **No DB change.** Frontend: `features/rooms/chaos.ts` (`CHAOS_EVENTS`/`CHAOS_EVENT_EMOJI`/`orderSegmentsForSpin`); picker/badge/`GameMode`/`modes.chaos` were already wired from Slice 2. EN+UK i18n `chaos.events.*` + new "full chaos" tagline.

The intermediate first cut (commit `9c700cb`: 25% probability, 5 events incl. jackpot, env-configurable `CHAOS_PROBABILITY`, default policy `anyone`) was superseded within the day — probability config removed, jackpot removed, policy → turn_based, attempts added.

Gates green (Opus 4.8, inline — no subagent fan-out): **218 backend** (coverage 86%) / **103 frontend**, ruff + mypy --strict + tsc + eslint + i18n parity + `pnpm build` all clean. Doc `docs/game-modes.md` Chaos section rewritten. Deferred to `docs/TODO.md`: Double-spin, Phantom-segment, and on-device tuning of the choreography constants (`MULTI_SPIN_*`, `NUDGE_*`, `SLOW_BURN_MULTIPLIER`, `CHAOS_ANNOUNCE_MS`).

### Slice 5 — Punishment v3/v4: turn-based personal-bet race (2026-05-30) — committed, pending owner deploy

Reworked Punishment again, from the v2 prediction-wager (Slice 4) into a **turn-based personal-bet race**: each present player locks one **unique** bet (a segment) before the game; players spin **in turn** with the **host always first**; landing on your own bet scores a match (first to **N** wins, host picks `N = 1/3/5/7`, `N=1` = first correct guess ends the game), landing elsewhere deals the spinner their own dare and blocks the turn until resolved. Dare resolution: **I'll do it** → a random *other* online player approves with **Yes / No** (Yes advances + increments per-player & room-wide done counters; **No reopens the dare card** and keeps the turn blocked until truly approved); **Refuse (−1)** costs a match and is offered only when the player has points; solo/offline auto-approves.

Two passes landed this session (Opus 4.8, inline — no subagent fan-out):
- **v4 polish on the prior turn-based commit** — host-selectable attempts wired through (`N=1` no longer floored to 3); **unique picks are now always-on** (per-room toggle removed; server forces `punishment_unique_bets=True` for punishment, with a fallback that allows a duplicate only when players outnumber segments so betting can't deadlock); the dare card **disappears after "Done"** (replaced by a slim approval prompt); the host settings gear stays hidden for Punishment. Removed dead `punishment_unique_bets` request plumbing (schema/endpoint/`api.ts`/picker) + 2 stale ruff violations the prior commit introduced.
- **Two real-device bug fixes** — (1) the "Spin" button showed active for *both* host and guest because the frontend derived the starter from per-client presence order; the starter is now deterministically the **host** (matches server `start_game`). (2) Approval is now **Yes / No**: added `reject_punishment` service + `punishment:reject` WS handler + store action so "No" reopens the card instead of forcing the dare through.

Backend `services/punishment.py` (`place_bet` unique+fallback, `resolve_turn`, `resolve_punishment`, `approve_punishment`, `reject_punishment`, `reset_game`), `realtime/handlers.py` (`punishment:bet/resolve/approve/reject`, turn-gated `spin:trigger`). Alembic `0011_punishment_match_race` + `0012_punishment_v4`. Frontend `features/rooms/punishment.ts` + inlined RoomPage punishment branch (PunishmentPanel removed); EN+UK i18n (`approve_prompt`, `approve_yes/no`; dropped `approve`, `unique_bets_*`). Gates green: **206 backend / 99 frontend**, backend coverage 86%. Default spin policy `turn_based`. Doc `docs/game-modes.md` rewritten for the turn-based mechanic.

### Slice 4 — Punishment v2: prediction wager (2026-05-30) — SHIPPED, superseded by Slice 5

Reworked Punishment from victim-segment into a **prediction-wager** game: each round every present player secretly predicts the landing segment; the host spins once all present have locked (or "Spin anyway"); wrong guessers each draw their own dare (per-card Done), correct = safe, all-correct = "Everyone escaped 🍀"; room-wide tally; host "New round". Server-authoritative secrecy via per-viewer redaction in `build_room_state`. Alembic 0010 (`punishment_predictions` / `punishment_cards` / `punishment_result_segment_id`; legacy `punishment_active_card` left undropped — SQLite rebuild safety). Backend `services/punishment.py` (predict/resolve/draw, one distinct card per loser); host-gated spin + resolve-at-settle; `punishment:predict` / `punishment:done` / `round:reset` events; default spin policy `host_only`. Frontend `features/rooms/punishment.ts`, `components/room/PunishmentPanel.tsx`, store actions (`predictPunishment`, `markPunishmentDone(userId)`, `triggerSpin(force)`); EN+UK i18n. Built subagent-driven (Opus); 221 backend / 109 frontend tests, all gates green. Spec `docs/superpowers/specs/2026-05-30-punishment-prediction-wager-design.md`, plan `docs/superpowers/plans/2026-05-30-punishment-prediction-wager.md`, doc `docs/game-modes.md`. Commits `5c91eab … a4b9104`. Follow-ups in `docs/TODO.md` (drop `punishment_active_card` at Stage G; hard-disconnect doesn't auto-drop a pending prediction — force-start is the escape hatch).

### Slice 3 — Elimination mode (2026-05-29) — SHIPPED
First per-mode gameplay (spec §5.2) + the `GameModeEngine` abstraction (`apps/api/src/hoba_api/modes/`: base Protocol, `ClassicEngine`, `EliminationEngine`, registry — unknown/unbuilt modes fall back to Classic). `Segment.eliminated_at` (Alembic 0005) + `SegmentOut.is_eliminated`; engine-driven `trigger_spin` (spins over living segments, dramatic 1.5× at 2 left); eliminate-at-settle + `spin:settled.mode_aftereffects`; `round:reset` host action. Frontend: living-only wheel, winner hero, eliminated greyscale strip, brand-first "Хоба!→out" reveal.

**UX pass (all modes):** single centered-hub spin control (bottom SPIN buttons removed; solo bottom CTA is now "Create room"), auto-dismiss results (no manual Close), wheel hub is a real focusable/screen-reader-announced button + reduced-motion, prominent turn banner for turn_based, ~400ms reveal delay. Env-configurable room-creation rate limit (`ROOM_CREATE_RATE_LIMIT_MAX`).

Spec `docs/superpowers/specs/2026-05-29-elimination-mode-design.md`, plan `docs/superpowers/plans/2026-05-29-elimination-mode.md`, doc `docs/game-modes.md`. Commits `a4c99e3 … 478bb84`.

### Slice 2.5 — Turn-based bug-fix pass (2026-05-29, real-device)
Fixed: turn_based lobby deadlock (client `effectiveTurnUserId` + server `user_can_spin` both seed host pre-first-spin), participant `display_name` never populated (now from joined `User.first_name` in `build_room_state`), lobby→active not broadcast (`on_spin_trigger` now emits `room:updated`), header icons shrinking behind the mode badge. Commits `bd82ac2 … bf1faba`.

### Slice 2 — Mode-picker UI (2026-05-29)
Bottom sheet on Invite tap with 4 modes (Rigged stays for long-press reveal per spec §5.5). `GameModeBadge` in RoomPage header. `RoomSettingsSheet` gains `turn_based` as third option. PATCH endpoint extended to broadcast `current_turn_user_id` delta. EN + UK locales for all new strings. Spec `docs/superpowers/specs/2026-05-29-mode-picker-ui-design.md`. Commits `e6c47ba … 81092cd`.

### Slice 1 — Turn-based foundation (2026-05-28)
Backend `turn_based` spin policy + mode-default `spin_policy` derivation. Alembic 0004 added `current_turn_user_id` to rooms; `advance_turn` helper, `user_can_spin` dispatch, `_emit_settled` advance + `room:updated` broadcast, `update_room` cursor lifecycle. Frontend `computeCanSpin` turn_based branch, new `computeTurnState` helper, room-header status line in EN + UK. Spec `docs/superpowers/specs/2026-05-28-turn-based-mode-defaults-design.md`. Commits `6a91c46 … 023b6f3`.

### Stage D production deploy notes (2026-05-29)
Production live on `hobagame.duckdns.org` (Hetzner shared VPS, host nginx TLS terminator, containers on `127.0.0.1:8800/5800/6800`; static-bundle webapp). Test totals at this point: **164 backend / 82 frontend**, 91% coverage. The 2026-05-29 deploy uncovered 4 production-only issues (uvicorn `--reload` loop, Alembic `batch_alter_table` FK naming, partial-migration corruption, sudo-rm-while-container-running no-op) — all fixed and folded into `docs/deployment.md` § 9b "Troubleshooting recipes" + tracked as Stage G items in `docs/TODO.md`. See `docs/validation-notes.md` § Owner-side deploy + verification — 2026-05-29.

---

## Stage C — deploy chain (2026-05-27)

Production deploy hit a shared VPS that already ran an unrelated site on its public-facing nginx. Soft-launch path landed across 7 commits, several of which were on-the-fly fixes to the deploy walkthrough as friction surfaced:

- `0756782 → 75bd608` — shared-VPS deployment groundwork: `compose.shared.yaml` with `!override` ports + Caddy disabled, `infra/nginx/hoba.conf` server block (proxy_pass to `127.0.0.1:8800` for `/api/`, `/socket.io/`, `/openapi.json`; `127.0.0.1:5800` for the SPA), `docs/deployment.md` rewritten with both dedicated- and shared-VPS flavours.
- `a6ce1af` — Vite `allowedHosts` extended to cover `.duckdns.org` + a `VITE_ALLOWED_HOSTS` env hook for future custom domains. First-deploy Vite quirk: 403 on the new hostname.
- `2050774` — multi-stage Dockerfile pulled forward from Stage G. Vite dev server proved unreliable in prod (allowedHosts 403, then a 9 s hang during a HEAD request that Telegram aborted with "Operation was cancelled"). Webapp container is now `nginx:1.27-alpine` serving a pre-built static bundle from `pnpm build`. `apps/webapp/nginx.conf` handles SPA fallback + immutable-asset cache headers. `docker-compose.yml` pins the dev target explicitly so local workflow is unchanged.
- `c0a591e` — anchored the rsync excludes in `docs/deployment.md` after the unanchored `--exclude=data` collateral-deleted `apps/webapp/src/data/quickWheels.ts` from the server.
- `acd2c62` — `docs/privacy.md` for BotFather's Privacy Policy field.
- `2c156f7` — `docs/deployment.md` smoke-test paths fixed (FastAPI serves `openapi.json` at root, not `/api/v1/openapi.json`).
- BotFather (manual, owner-side) — name `Hoba!`, About + Description in EN, command list, profile pic, Direct Link Mini App `play` URL, Privacy Policy URL — all set against `https://hobagame.duckdns.org/`.

Stage C closed 2026-05-28 with owner-override GO on Phase 7+.

---

## Stage B — pre-launch hardening (2026-05-27)

9 items across 9 commits:

1. ✅ **B1 — server rate limits + spin cooldown.** New `cooldown_take(key, ttl_ms)` Redis primitive (SET NX PX); `on_spin_trigger` enforces 1.5 s/room cooldown + 30 spins/room/hour; `POST /api/v1/rooms` enforces 5/user/hour. +8 backend tests (`tests/services/test_cooldown.py`, `tests/api/test_rooms.py`, `tests/realtime/test_handlers.py`). Commit `f723a0f`.
2. ✅ **B2 — brand-keyed crash screen.** `AppErrorBoundary` reduced to React boundary plumbing; visible UI moved to functional `CrashScreen` with locale-aware copy + reload CTA + collapsible technical details. New `common.crash.{title,description,reload,details_label}` (EN + UK). Commit `d87371b`.
3. ✅ **B3 — enableClosingConfirmation in active rooms.** New `enableClosingConfirmation` / `disableClosingConfirmation` helpers in `lib/telegram.ts`; `RoomPage` wires them on `snapshot.room.status === "active"` only (lobby + closed are fine to swipe away). Commit `e1c16d0`.
4. ✅ **B4 — empty states.** Audit showed `HomePage` `my_wheels`, `LibraryPage` (via `StubPage`), and the `EmptyState` DS component already cover the charter; no new work needed. Closed without a code commit.
5. ✅ **B5 — Aurora background.** Mounted globally in `RootLayout`. `fixed inset-0 -z-10`, pure CSS — no per-page boilerplate. Commit `e6916bd`.
6. ✅ **B6 — host settings sheet.** New `RoomSettingsSheet` (bottom sheet) + `isHost(snapshot)` helper (+2 tests) + `api.patchRoom` + `useRoomStore.setSnapshot`. Host-only ⚙️ button next to share. Toggle "Everyone in the room" / "Only me (host)". REST PATCH refreshes calling host's snapshot; guest broadcast queued for Stage C. Commit `ac7dab2`.
7. ✅ **B7 — 360 px audit.** Static review surfaced no fixed widths that breach 360 px; checklist for real-device pass in `docs/manual-verify-stageB.md` §6. Commit `c02cc64`.
8. ✅ **B8 — prod compose boot check.** `docker compose --profile prod config` parses cleanly; the webapp dev-server-as-prod limitation deferred to Stage G via `docs/TODO.md`. Commit `544fa6d`.
9. ✅ **B9 — BotFather pre-launch checklist.** Owner-driven steps scripted in `docs/manual-verify-stageB.md` §7 (name, photo, about, description, commands, menu button, Direct Link Mini App URL). Commit `c02cc64`.

### Stage B verification-pass fix (2026-05-27)
10. ✅ **B6 follow-up — stale guest UI on policy change.** Real-device test surfaced three coupled bugs: server emitted `not_allowed_to_spin` but the locale was missing it; the cooldown check ran before the permission check so a guest's rejected tap burned the per-room cooldown; and connected guests' UIs never learned about the host's `PATCH` because the REST endpoint didn't broadcast. Fix: localized error (EN+UK), reordered `on_spin_trigger` (permission first, throttles second), `PATCH /api/v1/rooms/{code}` now emits `room:updated { patch }`, client store merges into `snapshot.room`. Commit `3f4dbeb`.
11. ✅ **Back button dead for deep-link entrants.** Guest opening `t.me/hobagame_bot?startapp=room_<CODE>` couldn't navigate back from `/room/<CODE>`. Cause: `RootLayout`'s deep-link auto-navigate uses `replace: true` so `window.history.length === 1`; `navigate(-1)` is a no-op. New `lib/navigation.ts` `safeNavigateBack(navigate)` checks history length and falls back to `navigate("/")`. Wired into all 5 call sites. +3 unit tests. Commit `150b323`.

**Stage B test totals:** 113 backend / 53 frontend, 91% backend coverage. mypy --strict, ruff, eslint, tsc, i18n:check all green.

---

## Stage A — close-out (2026-05-26)

### Original roadmap items (5)
1. ✅ Share deep-link auto-navigate fixed in `lib/startParam.ts` (SDK → hash → query fallback) + `RoomPage.handleShare` uses `buildRoomInviteLink` with optional Direct Link short_name from `VITE_TELEGRAM_APP_SHORT_NAME`. Commit `b873a00`.
2. ✅ Redis `tg_id → user_id` cache: `services/users.resolve_telegram_user` + `cache_user_after_commit`; 15 min TTL; HTTP auth dependency + WS connect both wired. Commit `b873a00`.
3. ✅ New `room` namespace in EN + UK; all `RoomPage` / `SpinPage` / `ReactionsBar` hardcoded strings removed; error codes map through `room.errors.*` with fallback. Commit `b873a00`.
4. ✅ `scripts/i18n-check.mjs` — EN ↔ UK key parity + referenced-key coverage; failure-on-divergence verified. Commit `b873a00`.
5. ✅ Realtime + Redis tests via `FakeSocketIO` + `fakeredis.aioredis` autouse fixture; coverage gate back to global 80%. Commit `b873a00`.

### Verification-pass fixes (6, found during real-device testing)
6. ✅ Docs split: README rewritten as a landing page; runtime composition → `docs/architecture.md`; local setup → `docs/development.md`; test layout + manual verification → `docs/testing.md`. Commit `6ef70a4`.
7. ✅ `VITE_TELEGRAM_BOT_USERNAME` + `VITE_TELEGRAM_APP_SHORT_NAME` piped through `docker-compose.yml` to the webapp container (env vars existed in `.env.example` but weren't reaching Vite at runtime). Commit `6b72946`.
8. ✅ Host detection bug: `RoomPage` was comparing Telegram tg_id against internal DB `user_id`. Added `me_user_id` to `RoomState` DTO. Commit `7db1b0a`.
9. ✅ UK locale rewrite: "Куди їсти?" → "Що поїсти?", ICU plurals for participant count (учасник/учасники/учасників), "Господар" → "Ведучий" in spin hint, ~15 other natural-language fixes. Commit `4efb510`.
10. ✅ `+ Invite friends` CTA now visible on the solo idle screen (was only post-settle). Commit `bfdca38`.
11. ✅ Wheel hub tap fully wired in rooms (was missing `onSpinClick` prop on `<Wheel>` in `RoomPage`) + `SPIN` label localized via `t('common:actions.spin')`. Commit `d425a7a`.
12. ✅ Default `spin_policy` flipped from `host_only` to `anyone` (model + service + REST schema + Alembic `0003`). Party-game social fit. Existing rows untouched. Commit `00f3c21`.

### Close-out batch (2026-05-27, 9 items)
13. ✅ Wheel hub stays tappable across `idle → spinning → settled` and respects spin permission. New `features/wheel/hubLogic.ts` (`isHubInteractive`) + 5 tests. Commit `31a23e8`.
14. ✅ `features/rooms/permissions.ts` (`computeCanSpin`) extracted from `RoomPage` + 7 tests — regression guard for the tg_id-vs-user_id bug. Commit `c5334ee`.
15. ✅ BotFather Direct Link Mini App `spin` deleted; `play` matched `VITE_TELEGRAM_APP_SHORT_NAME`. `docs/botfather-setup.md` §8 aligned. Commit `0756782`.
16. ✅ `docs/manual-verify-stageA.md` backfilled with two-device verification record. Stale ngrok README TODO closed. Commit `55b9ff3`.
17. ✅ Top-of-room Share Button overflowed the iPhone X viewport (UK ~56 px off-screen). Converted to `IconButton` 📤 with localized text in `aria-label`. Commit `7e21a85`.
18. ✅ Wheel spin lag on iPhone X (A11, iOS 16) — replaced `feGaussianBlur` ring-glow filter with three stacked solid strokes (18/12/6 px, decreasing opacity). Pure compositor path. **Pending iPhone X verification.** Commit `33a976b`.
19. ✅ Flying reactions emerged at random horizontal positions. New `features/rooms/reactionLanes.ts` gives each emoji a fixed lane + ±2.5% jitter. 5 tests. Commit `798788f`.
20. ✅ `RoomCodePill` default size tightened (`text-3xl`→`text-2xl`, looser→`tracking-[0.3em]`, smaller padding) — ~175 px instead of ~220 px on iPhone X. Commit `6dbfbe0`.
21. ✅ Three hardcoded EN strings in `RoomCodePill` localized through `room.code_pill.*` (EN + UK). Commit `0fb392c`.

**Stage A test totals:** 102 backend / 48 frontend, 92% backend coverage. mypy --strict, ruff, eslint, tsc, i18n:check all green.

---

## Shipped foundation (Phases 1–6)

- **Phase 1** — monorepo + docker-compose (redis, api, bot, webapp) + `.env.example`.
- **Phase 2** — User model, Alembic, FastAPI app, initData validation, `/api/v1/me`.
- **Phase 3** — aiogram bot, all commands, deep-link parsing for `room_<CODE>`.
- **Phase 4** — Vite/React/TS Mini App, full DS at `/dev/ds`, i18n EN + UK (6 namespaces), Home with Quick Wheels (F2).
- **Phase 5** — `<Wheel>` + solo spin flow + audio + custom wheel editor + spin history.
- **Phase 6** — Rooms REST (`/api/v1/rooms`), Socket.IO `/rooms` namespace, server-authoritative spin, presence, reactions, share-link generation + delivery (delivery fixed in Stage A item 1, commit `b873a00`).
