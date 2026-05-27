# BotFather setup — `@hobagame_bot`

Manual one-time configuration. Run these in a DM with [@BotFather](https://t.me/BotFather).
All strings come from `docs/spec.md` §0 and §6 — copy them verbatim.

The bot itself (`apps/bot`) calls `set_my_commands` and (when
`WEBAPP_URL` is configured) `set_chat_menu_button` on startup, so the
**Commands list** and **Menu button** entries below are normally set
programmatically. Run them via BotFather only as a fallback or for a
brand-new bot before the service first boots.

## 1. Create / claim the bot

```
/newbot                # if creating from scratch
Hoba!                  # bot name (Latin — single source of truth)
hobagame_bot           # username (must end in `_bot`)
```

Copy the issued HTTP API token into `.env` as `TELEGRAM_BOT_TOKEN=…`.

## 2. Display name (idempotent)

```
/setname
@hobagame_bot
Hoba!
```

## 3. About (≤ 120 chars, shown in the share card)

```
/setabouttext
@hobagame_bot
Spin the wheel with friends. Hoba! — and you're done. 🎯
```

## 4. Description (≤ 512 chars, shown above the Start button)

```
/setdescription
@hobagame_bot
🎯 Multiplayer decision wheel for Telegram.
Build a wheel, invite friends, spin together in real time.
Hoba! — and it's decided.

5 modes: Classic, Elimination, Punishment, Chaos, and the secret Rigged 🎭.
```

## 5. Commands list (also set by the bot on startup)

```
/setcommands
@hobagame_bot
start - Launch Hoba!
new - Create a new wheel
help - Help
lang - Change language
about - About Hoba!
```

## 6. Profile photo

Upload the Latin **`Hoba!`** logo (PNG, 640×640, brand-amber on dark
purple, no localized variant — the logo is always Latin).

```
/setuserpic
@hobagame_bot
<upload PNG>
```

## 7. Menu button (Mini App entry point — set by the bot on startup)

The running bot does this automatically when `WEBAPP_URL` is set. To do
it manually instead:

```
/setmenubutton
@hobagame_bot
https://<your-cloudflared-or-prod-url>/
Open Hoba!
```

In dev: paste the current `https://*.trycloudflare.com` URL from the
running `cloudflared tunnel --url http://localhost:5173` process. Note
the trailing slash.

## 8. Direct Link Mini App (REQUIRED from Phase 6 — share deep links)

Without this, `t.me/hobagame_bot?startapp=room_<CODE>` returns "Something
went wrong, sorry. Please try again later." in the recipient's Telegram
client. Direct Link Mini Apps are configured via BotFather and are
**separate** from the menu button. Run once:

```
/newapp
@hobagame_bot
Hoba!                                ← title (≤ 32 chars)
🎯 Multiplayer decision wheel.
Build a wheel, invite friends, spin together.
Hoba! — and it's decided.
                                     ← description (≤ 80 chars per line)
<upload Hoba! logo PNG, 640×360>     ← photo (NOTE: 640×360 not square)
/empty                               ← demo GIF (skip)
<paste current public HTTPS URL>     ← e.g. https://abc.ngrok-free.app
play                                 ← short name (lowercase a–z + digits)
```

After this:
- `t.me/hobagame_bot?startapp=room_K7M9X2` opens the default Direct Link
  Mini App.
- `t.me/hobagame_bot/play?startapp=room_K7M9X2` opens it explicitly by
  short name (more reliable across older clients).

`WebApp.initDataUnsafe.start_param` will equal `room_K7M9X2`. The Mini
App's `RootLayout` reads this on mount and navigates to `/room/K7M9X2`
automatically.

When the dev tunnel URL changes, update via:

```
/myapps → @hobagame_bot → @hobagame_bot/play → Edit Web App URL
```

## 9. Allow inline mode (Phase 9+ — skip for now)

Inline mode (`@hobagame_bot yesno`) needs server-side inline handlers
which Phase 6 doesn't implement. When ready:

```
/setinline
@hobagame_bot
yesno or wheel
```

## Verification

After steps 1–8, in any Telegram chat:

- Search `@hobagame_bot` → share card shows `Hoba!`, photo, About text.
- Tap the bot → Description appears above the Start button.
- Tap Start → bot replies (commands work).
- The text input shows a `≡` menu button labelled "Open Hoba!" (Phase 4+
  webapp visible once you tap it).
- `t.me/hobagame_bot?startapp=room_TEST01` → Mini App opens **and
  navigates directly to `/room/TEST01`** (Phase 6+ behaviour); the
  recipient sees the wheel pre-joined with the host.
