/**
 * Audio playback — Howler-backed, per-sound lazy load.
 *
 * `audio.play(name)` is the only public entry point. Calls are no-ops
 * if sound is disabled (Settings) or the file is missing. Howls are
 * created on first use to keep the initial bundle / main-thread cost
 * out of the cold start path — playback before the first user gesture
 * is silently suppressed by the browser's autoplay policy anyway.
 */

import { Howl, Howler } from "howler";

import { AUDIO_MANIFEST, type AudioName, MUSIC_SRC, MUSIC_VOLUME } from "./manifest";

const DEFAULT_MASTER_VOLUME = 0.6;
const MUSIC_FADE_MS = 800;

class AudioManager {
  private howls = new Map<AudioName, Howl>();
  private enabled = true;
  private master = DEFAULT_MASTER_VOLUME;
  private unlockBound = false;
  // Background music is a separate looping track with its own on/off.
  private music?: Howl;
  private musicEnabled = true;
  private musicWanted = false; // a screen (active room) wants music playing

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  /**
   * iOS/WKWebView starts the Web Audio context "suspended" and only lets
   * it resume inside a user gesture. Telegram's iPhone WebView is no
   * exception — without this, the first (and sometimes every) sound is
   * silently dropped. Bind once at boot: any tap/touch resumes the
   * context. Listeners are passive + cheap, and stay bound so a context
   * re-suspended on backgrounding revives on the next interaction.
   *
   * Note: this cannot override the phone's hardware mute/ring switch —
   * iOS mutes all web audio when the ringer is silenced. That's a device
   * setting, not something the app can bypass.
   */
  installUnlock(): void {
    if (this.unlockBound || typeof document === "undefined") return;
    this.unlockBound = true;
    const resume = (): void => {
      try {
        if (Howler.ctx && Howler.ctx.state !== "running") void Howler.ctx.resume();
      } catch {
        /* no Web Audio context (non-Telegram / unsupported) */
      }
    };
    for (const event of ["touchend", "pointerdown", "click"] as const) {
      document.addEventListener(event, resume, { passive: true });
    }
  }

  setMasterVolume(value: number): void {
    this.master = Math.max(0, Math.min(1, value));
    for (const [name, howl] of this.howls) {
      const def = AUDIO_MANIFEST[name];
      howl.volume(this.master * (def.volume ?? 1));
    }
  }

  play(name: AudioName): void {
    if (!this.enabled) return;
    // Defensive resume: if the context drifted back to suspended (iOS
    // backgrounding), nudge it before the play call.
    try {
      if (Howler.ctx && Howler.ctx.state === "suspended") void Howler.ctx.resume();
    } catch {
      /* no context */
    }
    let howl = this.howls.get(name);
    if (howl === undefined) {
      const def = AUDIO_MANIFEST[name];
      howl = new Howl({
        src: [def.src],
        volume: this.master * (def.volume ?? 1),
        // Per-Howl onloaderror swallows missing-file errors — system is
        // designed to degrade silently when assets aren't in place yet.
        onloaderror: () => {
          /* missing audio file — silent */
        },
        onplayerror: () => {
          /* gesture not yet received or codec unsupported — silent */
        },
      });
      this.howls.set(name, howl);
    }
    howl.play();
  }

  // --- background music ---------------------------------------------------

  /** Turn the music track on/off (Settings → Music). Starts/stops if a
   *  screen currently wants music. */
  setMusicEnabled(value: boolean): void {
    this.musicEnabled = value;
    if (value) {
      if (this.musicWanted) this.startMusic();
    } else {
      this.stopMusic();
    }
  }

  /** A screen (e.g. an active room) asks for the bed to play. */
  requestMusic(): void {
    this.musicWanted = true;
    if (this.musicEnabled) this.startMusic();
  }

  /** Leaving the screen — fade the bed out. */
  releaseMusic(): void {
    this.musicWanted = false;
    this.stopMusic();
  }

  private startMusic(): void {
    if (this.music === undefined) {
      this.music = new Howl({
        src: [MUSIC_SRC],
        loop: true,
        volume: 0,
        html5: true, // stream the longer file; avoids decoding the whole clip
        onloaderror: () => {
          /* missing music file — silent */
        },
        onplayerror: () => {
          /* gesture not yet received — retry on unlock */
        },
      });
    }
    const m = this.music;
    if (!m.playing()) m.play();
    m.fade(m.volume(), MUSIC_VOLUME, MUSIC_FADE_MS);
  }

  private stopMusic(): void {
    const m = this.music;
    if (m === undefined || !m.playing()) return;
    m.fade(m.volume(), 0, MUSIC_FADE_MS);
    m.once("fade", () => {
      // Only pause if nothing re-requested music during the fade.
      if (!this.musicWanted) m.pause();
    });
  }
}

export const audio = new AudioManager();
export type { AudioName } from "./manifest";
