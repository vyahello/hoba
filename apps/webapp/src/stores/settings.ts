/**
 * User preferences store — Sound and Haptics.
 *
 * Three layers keep these honest:
 *   1. localStorage (via safeStorage) — read synchronously at module load
 *      so audio/haptics gating is correct from the very first interaction,
 *      even before the network /me round-trip and even offline.
 *   2. The server (`/me`) — cross-device source of truth; `hydrate()`
 *      reconciles on app boot (server wins, then re-persists locally).
 *   3. Side effects — `audio.setEnabled` + `setHapticsEnabled` are applied
 *      on every change so the toggles take effect immediately app-wide.
 *
 * Sound is the single audio switch: it gates SFX *and* the background-music
 * bed (turning Sound off silences everything). There is no separate music
 * toggle.
 */

import { create } from "zustand";

import { audio } from "@/audio";
import { getLocale, type Locale, setLocale } from "@/i18n";
import { api } from "@/lib/api";
import { setHapticsEnabled } from "@/lib/haptics";
import { safeStorage } from "@/lib/safeStorage";

const KEY_SOUND = "hoba.sound";
const KEY_HAPTICS = "hoba.haptics";

function readBool(key: string, fallback: boolean): boolean {
  const raw = safeStorage.get(key);
  if (raw === null) return fallback;
  return raw === "1";
}

function writeBool(key: string, value: boolean): void {
  safeStorage.set(key, value ? "1" : "0");
}

/** Sound gates both SFX and the music bed. */
function applySound(value: boolean): void {
  audio.setEnabled(value);
  audio.setMusicEnabled(value);
}

interface SettingsState {
  sound: boolean;
  haptics: boolean;
  setSound: (value: boolean) => void;
  setHaptics: (value: boolean) => void;
  /** Switch UI language AND persist it server-side so server-rendered text
   *  (e.g. punishment cards) follows the user's choice, not the device. */
  setLanguage: (locale: Locale) => void;
  /** Reconcile with the server's stored preferences (server wins). */
  hydrate: () => Promise<void>;
}

// Initial values from localStorage so gating is correct pre-network.
const initialSound = readBool(KEY_SOUND, true);
const initialHaptics = readBool(KEY_HAPTICS, true);

// Apply the persisted gates immediately at module load.
applySound(initialSound);
setHapticsEnabled(initialHaptics);

/** Fire-and-forget PATCH /me; failures are non-fatal (local state holds). */
function persistRemote(patch: Record<string, boolean>): void {
  void api.patchMe(patch).catch(() => {
    /* offline / non-Telegram: localStorage still has it */
  });
}

export const useSettings = create<SettingsState>((set) => ({
  sound: initialSound,
  haptics: initialHaptics,

  setSound: (value) => {
    applySound(value);
    writeBool(KEY_SOUND, value);
    persistRemote({ sound_enabled: value });
    set({ sound: value });
  },

  setHaptics: (value) => {
    setHapticsEnabled(value);
    writeBool(KEY_HAPTICS, value);
    persistRemote({ haptics_enabled: value });
    set({ haptics: value });
  },

  setLanguage: (locale) => {
    setLocale(locale); // i18n + localStorage (display language)
    // Server owns language_code for server-rendered text (punishment decks).
    void api.patchMe({ language_code: locale }).catch(() => {
      /* offline / non-Telegram: display still switched locally */
    });
  },

  hydrate: async () => {
    const me = await api.getMe();
    // Self-heal a stale server language_code: the user's on-device display
    // locale is their real choice, so push it up if the server disagrees
    // (covers users who picked a language before it was ever persisted).
    const display = getLocale();
    if (display !== me.language_code) {
      void api.patchMe({ language_code: display }).catch(() => {
        /* offline */
      });
    }
    applySound(me.sound_enabled);
    setHapticsEnabled(me.haptics_enabled);
    writeBool(KEY_SOUND, me.sound_enabled);
    writeBool(KEY_HAPTICS, me.haptics_enabled);
    set({
      sound: me.sound_enabled,
      haptics: me.haptics_enabled,
    });
  },
}));
