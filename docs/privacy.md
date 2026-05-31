# Hoba! — Privacy Policy

> The **canonical, user-facing** Privacy Policy + Terms now live in-app
> (EN + UK) at `/privacy` and `/terms`, sourced from
> `apps/webapp/src/locales/{en,uk}/legal.json` and served publicly at the
> production domain (point BotFather's Privacy link there). This file is the
> long-form reference copy — keep it consistent with `legal.json`.

_Last updated: 2026-05-27_

Hoba! (`@hobagame_bot`) is a Telegram Mini App party game. This document
describes what data we collect, why, and what we do with it. The bot is
operated by Volodymyr Yahello (contact: vyahello@gmail.com).

## What we collect

When you open Hoba! from Telegram, we receive the following from the
Telegram WebApp `initData` payload:

- Your Telegram numeric ID (`tg_id`) — required to identify your session.
- Your first name (and optionally last name + username) — used to display
  your name to other players in a room.
- Your Telegram client language code — used to pick the in-app locale.

When you play, we additionally store:

- Wheels you create (question + segments).
- Rooms you join + your role (host / guest) and last-seen timestamp.
- Spins you trigger (segment outcome, timestamp, seed).
- Reactions you send during a spin.

We do **not** collect:

- Your phone number, email address, or any contact data.
- Your Telegram messages or media outside the Mini App.
- Your location, IP address (beyond standard server logs), or device
  identifiers.

## How we use it

- To run the game (server-authoritative spin, multiplayer presence,
  reactions, the spin-policy / host-only enforcement).
- To remember your saved wheels across sessions so you don't have to
  re-create them.
- To enforce rate limits (e.g. 30 spins/room/hour, 5 room creations
  per user/hour) so the service stays usable for everyone.

We do not use your data for advertising, profiling, or any commercial
purpose. We do not sell or share it with third parties.

## Where it lives

- **SQLite** on the server: user record, wheel + segment definitions,
  room + participant + spin history.
- **Redis** on the server, with short TTLs: presence (≤60 s),
  `tg_id → user_id` cache (15 min), rate-limit counters (≤1 h),
  spin cooldown (1.5 s).

## How long we keep it

- Active user record: kept while you continue to use the Mini App.
- Spin history: indefinitely, scoped to the room.
- Closed rooms and their data: kept for analytics during the soft-launch
  phase; will be subject to a retention policy before public release.

You can request deletion of your account and all associated data at any
time by emailing vyahello@gmail.com.

## Cookies and tracking

The Mini App does not set cookies. It does not load third-party
analytics, ad networks, or tracking scripts.

## Changes to this policy

This is an early-release policy for the soft-launch phase. As the app
grows, this document will be updated. The "Last updated" date at the
top reflects the most recent revision.

## Contact

Volodymyr Yahello — vyahello@gmail.com
