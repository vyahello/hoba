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

### Owner-side verification — 2026-05-28

Owner ran the soft-launch end-to-end on two real devices and reports
no defects.

**Who:** Owner (Volodymyr).
**Devices:** iPhone 14 (A15) + iPhone X (A11, iOS 16).
**Format:** Owner-driven; no third-party testers in this round.

**Outcome:** "Works fine" on both devices, both locales. Replaces the
formal multi-tester soft-launch protocol that the original Stage C
charter envisioned. iPhone X spin-lag fix (commit `33a976b`, stacked
strokes replacing the `feGaussianBlur` ring-glow) confirmed smooth on
the A11 device — closes the verification pending since 2026-05-27.

**Caveats the owner accepted in lieu of multi-tester signal:**
- No organic-share data (multiplayer invite-path learning question)
  beyond what owner can observe by self.
- No Android / 360 px signal — both verification devices are iOS.
- No locale signal from a Ukrainian speaker who isn't the owner.

The roadmap's "two third-party play sessions" criterion is being
overridden here by owner judgement, not satisfied. Future sessions
(if/when scheduled) get logged below per the original template.

---

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

> **Status: owner-side verification, no third-party sessions.** Synthesis
> reflects owner's two-device verification + acceptance of the trade-offs
> spelled out in the entry above.

### What's working
- Solo flow on both iPhone 14 and iPhone X (per owner verification).
- Multiplayer flow on both devices, both locales.
- iPhone X spin-lag fix (commit `33a976b`) confirmed smooth on A11.

### What needs fixing before public launch
- Unknown from third-party signal; owner reports no defects on the
  verification path. Items still genuinely open are tracked in
  `docs/TODO.md` (currently 2 Stage D items).

### Stage D priority signal
- No third-party "which mode do you want first" signal.
- Owner-chosen order falls back to spec §5 / §15 Phase 7 order
  (Elimination → Punishment → Chaos → Rigged) absent contrary input.

### Stage F/G priorities surfaced
- None new beyond what was already known going into Stage C.
- Architecture.md opinion-drift (prod-topology incomplete) flagged
  during the 2026-05-28 cleanup pass at
  `docs/cleanup-2026-05-28-findings.md`.

### Go / no-go on Phase 7+

- **Decision: GO** (per owner override 2026-05-28).
- Rationale: owner verified the soft-launch path end-to-end on iPhone
  14 + iPhone X across both locales and reports no defects. The
  original NO-GO (2026-05-28 morning) was based on absence of
  third-party play sessions; owner is choosing to accept the
  trade-offs of skipping that protocol (no organic-share signal, no
  Android signal, no non-owner Ukrainian-speaker signal) in exchange
  for moving the project forward.
- Stage C effectively closes here. Stage D work can begin per spec §5
  + §15 Phase 7. If real third-party sessions happen later, log them
  above and the answers to the six learning questions can still steer
  Stage D priority within the spec-defined mode order.
