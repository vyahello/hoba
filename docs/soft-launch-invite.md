# Soft-launch invite messages

Paste these into Telegram / Signal / wherever your friends are.
Pick the locale that matches the recipient. Both texts say the same
thing.

---

## English

> Hey — I've been building a tiny Telegram party game called **Hoba!** It's a
> shared "wheel of decisions" — spin together, the wheel stops, Hoba! — and
> the argument's over (where to eat, who pays, etc.).
>
> It's running in real Telegram now, soft launch with friends only.
> Would love your eyes on it for 5 minutes:
>
> 👉 https://t.me/hobagame_bot
>
> Tap the menu button at the bottom of the chat to open the app.
> Try a Quick Wheel, then try inviting a friend into a room.
>
> If anything looks weird / breaks / feels off — screenshot and send
> back. Honest reactions over polite ones, please.

---

## Ukrainian

> Привіт — я роблю невелику Telegram-гру **Хоба!** Це спільне «колесо
> рішень»: разом крутимо, воно зупиняється, Хоба! — і суперечка
> вирішена (де поїсти, хто платить тощо).
>
> Запустив це в Telegram, поки тільки для друзів. Закинь око хвилин
> на 5, якщо є можливість:
>
> 👉 https://t.me/hobagame_bot
>
> Тапни кнопку меню внизу чату, щоб відкрити застосунок. Спробуй
> Швидке колесо, а потім запроси когось у кімнату.
>
> Якщо щось виглядає дивно або зависає — кинь скріншот. Чесна
> реакція цінніша за ввічливу.

---

## Session structure (do NOT send this part to friends)

For the FIRST session, aim small — **5 friends, not 20**. Bigger means
harder to watch what breaks. Two play formats both work:

**Async** — send the message above, ask them to ping you when they've
played. Track each respondent in `docs/validation-notes.md`.

**Live (better signal)** — schedule a 30-minute call. Share screen.
Watch your friend's face as they hit the spin reveal. Listen to what
they say out loud. This is the gold-standard data.

If the first 5 friends pass without major issues → invite the next
batch up to 20.

---

## What to watch in the server logs during sessions

In a second terminal, tail the live logs:

```bash
ssh <user>@<your-vps>
cd ~/hoba
docker compose -f docker-compose.yml -f compose.shared.yaml logs -f api bot
```

Anything ERROR-level → screenshot, paste into the session log in
`docs/validation-notes.md`. Resist the urge to fix it in the moment
— note it, keep playing, fix in the next dev cycle.
