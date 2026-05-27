# Stage B — manual verification checklist

> Stage B charter is pre-launch hardening. Most B-items are unit-tested
> or type-checked end-to-end, but five need hands-on real-device passes
> before the stage can claim done. Run through this doc on the same
> two devices you used for Stage A (iPhone 14 + iPhone X), in EN and
> UK locale, against ngrok in dev.

## 1. Server-side rate limits (B1)

```text
Setup: open the room from Device A as host.

a. Spin cooldown (1.5 s / room)
   1. Hammer the SPIN hub or the lower SPIN button as fast as you can.
   2. Expected: exactly one spin event animates; subsequent rapid taps
      surface "Slow down a moment." / "Зачекайте секунду." toast
      (room.errors.rate_limited).
   3. After the spin settles + ~1.5 s passes, a fresh tap works again.

b. Hourly cap (30 / room / hour)
   1. Spin 30 times (paced out by the 1.5 s cooldown).
   2. The 31st spin within the hour returns the same rate_limited
      toast — verified by the test_handlers suite, exercise live to
      sanity-check Redis TTL behaviour on the box.

c. Room creation (5 / user / hour)
   1. From Home → "+ Invite friends" → /create → six times in a row.
   2. The 6th attempt fails with HTTP 429 and a localized toast
      mapped through `room.errors.rate_limited`.
```

## 2. Crash screen (B2)

```text
1. In a dev build, throw inside a render — e.g. add a temporary
   `if (window.location.search.includes("boom")) throw new Error("boom")`
   inside HomePage, navigate to /?boom.
2. Expected: brand-keyed crash screen with the `Hoba!` / `Хоба!` mark,
   localized title + description, a Reload CTA, and a collapsible
   "Technical details" block showing the stack.
3. Tap Reload → returns to a fresh app shell.
4. Flip locale to UK in /settings → trigger the same crash → UK copy.
```

## 3. enableClosingConfirmation (B3)

```text
1. Open /room/<CODE> in lobby state (no spin yet). Telegram swipe-down
   closes WITHOUT a confirmation prompt. ✓
2. Trigger a spin — room status becomes active. Swipe-down now shows
   Telegram's native "Close anyway?" sheet. ✓
3. Close the room (host) — confirmation goes away again. ✓
```

## 4. Aurora background (B5)

```text
1. Open any page. The 3-stop radial gradient drifts on a ~30 s loop
   behind the content (visible on idle screens, subtle behind dense
   ones).
2. Spin the wheel — the Aurora drift must NOT interfere with the
   wheel animation on iPhone X (test for regression of bug 18
   resolved in Stage A).
```

## 5. Host settings sheet (B6)

```text
Device A (host) + Device B (guest), iPhone 14 + iPhone X:

1. Open /room/<CODE> on both. Device A sees a ⚙️ button next to the
   📤 share button; Device B does not.
2. Device A taps ⚙️ → bottom sheet opens with the "Who can spin"
   section.
3. Default selection: "Everyone in the room" / "Усі в кімнаті".
4. Tap "Only me (host)". The option shows a loading spinner briefly,
   then a checkmark. No toast.
5. Device B (guest) — the SPIN button below the wheel disappears
   (replaced by "Host spins..." hint). NOTE: until the server emits
   `room:updated` (docs/TODO.md stage:C item), the guest needs a
   page refresh to see the change. Server-broadcast follow-up
   tracked.
6. Flip back to "Everyone in the room" on Device A → SPIN returns on
   Device B after refresh.
```

## 6. 360 px width audit (B7)

```text
Smallest target: 360 CSS px (Galaxy S22 / S23 / Pixel 6a). iPhone X
is 375 px and already verified for Stage A bug 17.

For each page, screenshot at 360 px (Android Chrome DevTools or a
real device) and confirm:
- No element clips the right edge.
- All tap targets ≥ 44×44 (CLAUDE.md rule 4).
- Truncation kicks in cleanly (ellipsis, not text overflow).
- Text remains ≥ 14 px body / ≥ 16 px primary (spec §3).

Pages:
  /             HomePage         Header + Quick Wheels grid + my_wheels EmptyState
  /create       CreatePage       Question input + segment editor + Save
  /spin/<id>    SpinPage         Wheel + SPIN + Invite friends (+ result overlay)
  /room/<CODE>  RoomPage         Pill + share + ⚙️ + wheel + reactions
  /library      LibraryPage      Stub EmptyState (Phase 9 placeholder)
  /settings     SettingsPage     Language switcher + toggle rows

If anything clips: file as a Stage B finding (closing rule — bugs
discovered in stage verification stay in the stage). Code-level
static review found no fixed widths that breach 360 px; everything
flexes around `gap-3 + px-4`.
```

## 7. BotFather pre-launch checklist (B9)

> Manual, owner-side via [@BotFather](https://t.me/BotFather). All
> strings are pinned in `docs/spec.md` §6 — copy them verbatim.

```text
/setname            @hobagame_bot                 → Hoba!
/setuserpic         @hobagame_bot                 → upload Latin Hoba! logo PNG (640×640, brand-amber on dark purple). docs/brand/ should hold this asset.
/setabouttext       @hobagame_bot                 → "Spin the wheel with friends. Hoba! — and you're done. 🎯"
/setdescription     @hobagame_bot                 → spec §6 paragraph (5 modes, ≤512 chars)
/setcommands        @hobagame_bot                 → start | new | help | lang | about
/setmenubutton      @hobagame_bot                 → production URL + label "Open Hoba!"
                                                    (or current ngrok URL while in dev)
/myapps → @hobagame_bot/play → Edit Web App URL  → production / current ngrok URL
                                                    (Direct Link Mini App for share deep-links)
```

After each change, in any Telegram chat type `@hobagame_bot` —
the share card must render with the Latin Hoba! logo, "Hoba!"
display name, and the About text. Tap the bot → Description shows
above the Start button. Tap Start → bot responds; `/lang` works;
menu button (`≡ Open Hoba!`) launches the Mini App.

## End-of-Stage-B gate

Per `docs/roadmap.md`:

> Fresh-clone `docker compose up` → working bot → working webapp →
> joinable room from a second device → both languages flip cleanly →
> no console errors over a 5-minute play session.

When all the above pass on the two devices in both locales, mark
Stage B done in CLAUDE.md and move to Stage C (soft-launch +
validation).
