# Hoba! — Soft-launch validation notes

> Stage C log. Per `docs/roadmap.md`: "no code work — only telemetry
> review." Each play session goes in its own dated section below.
> Anything that's actionable bubbles up to `docs/TODO.md` (with a
> stage tag) or directly into the next stage's plan.

Production URL: <https://hobagame.duckdns.org>
Bot: [@hobagame_bot](https://t.me/hobagame_bot)
Deployed: 2026-05-27 (Hetzner, shared nginx, static bundle, DuckDNS)

---

## What we're trying to learn

From the roadmap Stage C charter, the questions worth answering:

1. **Does the brand-word moment land?** When `Hoba!` / `Хоба!` fires
   on a spin reveal, do people react with the "yes, that was the
   moment" energy the spec promises? Or does it land flat?
2. **Onboarding friction.** New user opens the bot — do they figure
   out how to spin within 10 seconds (spec §17 MVP-done bullet)?
   Where do they hesitate?
3. **Multiplayer invite path.** Does anyone organically share a room
   with a second person? If not, why — is the Share button hard to
   find, or do they not see the point?
4. **Game mode signal.** Which mode do friends ask for FIRST?
   Elimination / Punishment / Chaos / Rigged. This decides the
   Stage D priority order.
5. **Locale quality.** Ukrainian-speaking friends — does the UK
   copy read native, or does anything sound like translated English?
6. **Real-device bugs.** Anything that didn't surface during my own
   testing — different iPhone models, Android, slow networks, etc.

---

## Session log

### Session N — YYYY-MM-DD (template)

**Who joined:** [names or initials, count]
**Devices:** [iPhone X / iPhone 14 / Samsung S22 / etc.]
**Format:** [in person / async / scheduled call]

**What happened (timeline notes):**
- HH:MM — joined
- HH:MM — first spin
- HH:MM — [something noteworthy]

**Bugs / errors observed:**
- [ ] [paste console error / screenshot link / repro steps]

**Quotes worth remembering:**
> "..." — [who, context]

**Brand-word moment:**
- Did `Hoba!` / `Хоба!` reveal land? [yes / kind of / no]
- Why?

**Multiplayer attempts:**
- [Did anyone share a room? Was the share flow clear?]

**Game modes asked for:**
- [most-requested-first]

**Action items spawned:**
- [add to docs/TODO.md or note inline]

---

## Cross-session synthesis

> **Status: no sessions ran during the Stage C window.** The
> session log above is empty; the synthesis below reflects that
> absence, not a finding.

### What's working
- Unknown — no real-user signal collected. Pre-launch hardening
  (Stage B) is green on synthetic tests (113 backend / 53 frontend,
  91 % coverage) and on owner-side real-device verification, but
  that's not the same as third-party validation.

### What needs fixing before public launch
- Unknown — the six learning questions at the top of this doc
  remain unanswered. Specifically: brand-word moment landing,
  onboarding friction, multiplayer invite path clarity, locale
  quality (UK), Android + non-iPhone-X device coverage, and slow-
  network behaviour.

### Stage D priority signal
- Which game mode is the strongest pull from friends: **no signal**.
- Recommended Stage D order: defer until Stage C actually produces
  signal. Falling back to spec order (Elimination → Punishment →
  Chaos → Rigged) is a guess, not a decision.

### Stage F/G priorities surfaced
- None surfaced beyond what was already known going into Stage C
  (the Stage G static-build TODO was pulled forward and resolved
  in commit `2050774`; no new items).

### Go / no-go on Phase 7+

- **Decision: NO-GO.**
- Rationale: Stage C's exit criterion is a verdict grounded in
  soft-launch evidence. No play sessions were logged, so there is
  no evidence to ground the verdict. Advancing to Phase 7+ on the
  strength of pre-launch hardening alone would convert "we believe
  it works" into "we shipped it" without the intermediate step
  the roadmap explicitly requires.
- Required to convert this to a GO: at minimum two play sessions
  on real devices (mix of iOS + Android, EN + UK speakers),
  written into the Session log above, with the six learning
  questions answered. Then re-run this synthesis.
- Until that happens, Stage C stays open. No Stage D scoping, no
  Phase 7+ work.
