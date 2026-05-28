/**
 * `start_param` extraction — Telegram Mini App deep-link entry.
 *
 * The recipient of a share-link (`t.me/hobagame_bot?startapp=room_XYZ`)
 * needs us to land them in `/room/XYZ`. `start_param` is how Telegram
 * passes that "XYZ" through to the Mini App, but **where** it lives
 * depends on the launch surface and the SDK version:
 *
 *   1. `WebApp.initDataUnsafe.start_param` — canonical, populated by
 *      @twa-dev/sdk when Telegram puts `start_param` inside
 *      `tgWebAppData` (URL hash → `tgWebAppData=...&start_param=XYZ&...`).
 *      Works for menu-button launches on recent clients.
 *   2. `tgWebAppStartParam` as a **top-level** URL hash param. Modern
 *      Direct Link Mini App launches use this — and @twa-dev/sdk v7.10.1
 *      does not read it (see node_modules/.../telegram-web-apps.js
 *      lines 286-298 — only `tgWebAppData` is parsed). This is the
 *      single most likely cause of "share link opens app but does not
 *      navigate to room."
 *   3. `?startapp=room_XYZ` URL query — only ever appears in dev (when
 *      we paste the link into a non-Telegram browser to test the
 *      navigate path). Telegram strips it before injecting the Mini App.
 *
 * `extractStartParam` is a pure function so the tricky parsing can be
 * unit-tested without a DOM. `readStartParam` (in `telegram.ts`) is the
 * imperative wrapper that wires it up to the browser globals.
 */

export interface StartParamSources {
  /** Value from `WebApp.initDataUnsafe.start_param`, if any. */
  sdkStartParam: string | undefined;
  /** `window.location.hash` (`"#tgWebAppStartParam=…"`). */
  hash: string;
  /** `window.location.search` (`"?startapp=…"`). */
  search: string;
}

export function extractStartParam(sources: StartParamSources): string | undefined {
  const fromSdk = normalize(sources.sdkStartParam);
  if (fromSdk !== undefined) return fromSdk;

  const fromHash = readHashParam(sources.hash, "tgWebAppStartParam");
  if (fromHash !== undefined) return fromHash;

  const fromSearch = readSearchParam(sources.search, "startapp");
  if (fromSearch !== undefined) return fromSearch;

  return undefined;
}

function normalize(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readHashParam(hash: string, key: string): string | undefined {
  if (hash.length === 0) return undefined;
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (body.length === 0) return undefined;
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq) === key) {
      return normalize(safeDecode(pair.slice(eq + 1)));
    }
  }
  return undefined;
}

function readSearchParam(search: string, key: string): string | undefined {
  if (search.length === 0) return undefined;
  // Avoid URLSearchParams in module init paths — URL availability under
  // SSR/Vitest envs is reliable, but a manual scan also matches the
  // permissive hash parser above and keeps both branches symmetrical.
  const body = search.startsWith("?") ? search.slice(1) : search;
  if (body.length === 0) return undefined;
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq) === key) {
      return normalize(safeDecode(pair.slice(eq + 1)));
    }
  }
  return undefined;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch {
    return value;
  }
}

/**
 * Telegram passes us a launch param like `"room_ABC123"`. This pulls
 * the room code out. Returns `undefined` if the param isn't a room
 * deep-link (it might be a `wheel_<ID>` or other in the future).
 */
export function parseRoomDeepLink(startParam: string): string | undefined {
  const prefix = "room_";
  if (!startParam.startsWith(prefix)) return undefined;
  const code = startParam.slice(prefix.length).trim();
  return code.length > 0 ? code.toUpperCase() : undefined;
}

interface RoomInviteLinkOptions {
  roomCode: string;
  botUsername: string;
  /**
   * Optional BotFather "short name" from `/newapp`. When set, the link
   * becomes a **Direct Link Mini App** form
   * (`t.me/<bot>/<short>?startapp=…`), which auto-launches the Mini App
   * with `start_param` on modern Telegram clients. When absent, falls
   * back to the menu-button form (`t.me/<bot>?startapp=…`).
   */
  appShortName: string | undefined;
}

export function buildRoomInviteLink(opts: RoomInviteLinkOptions): string {
  const code = opts.roomCode.toUpperCase();
  const base =
    opts.appShortName !== undefined && opts.appShortName.length > 0
      ? `https://t.me/${opts.botUsername}/${opts.appShortName}`
      : `https://t.me/${opts.botUsername}`;
  return `${base}?startapp=room_${code}`;
}
