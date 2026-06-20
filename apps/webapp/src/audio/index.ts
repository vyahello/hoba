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

import { playChaosTone, playThunkTone, playTickTone } from "./chaosTones";
import { AUDIO_MANIFEST, type AudioName, MUSIC_TRACKS, MUSIC_VOLUME } from "./manifest";

const DEFAULT_MASTER_VOLUME = 0.6;
const MUSIC_FADE_MS = 800;

class AudioManager {
  private howls = new Map<AudioName, Howl>();
  private enabled = true;
  private master = DEFAULT_MASTER_VOLUME;
  private unlockBound = false;
  // Background music is a shuffled playlist with its own on/off.
  private music?: Howl; // the currently playing track
  private currentTrack = -1; // index into MUSIC_TRACKS of the live track
  private musicEnabled = true; // Settings → Music
  private musicWanted = false; // app is past boot and wants the bed playing
  private musicAllowed = true; // context permits it (false for a guest in a room)

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
    const revive = (): void => this.wake();
    for (const event of ["touchend", "pointerdown", "click"] as const) {
      document.addEventListener(event, revive, { passive: true });
    }
    // Returning from background (iOS suspends the context, and Telegram
    // "minimise" — swipe-down to a pill — backgrounds the WebView). Cover
    // every signal a foreground gives us. `pageshow` fires on bfcache restore.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") revive();
    });
    window.addEventListener("focus", revive);
    window.addEventListener("pageshow", revive);
  }

  /**
   * Resume audio after a background/minimise. iOS suspends the Web Audio
   * context when the Mini App is backgrounded (incl. Telegram's swipe-down
   * minimise), which silences SFX *and* music until something resumes it.
   * Safe to call repeatedly; also wired to the Telegram `activated` event
   * (see main.tsx) and to every user gesture.
   */
  wake(): void {
    try {
      if (Howler.ctx && Howler.ctx.state !== "running") void Howler.ctx.resume();
    } catch {
      /* no Web Audio context (non-Telegram / unsupported) */
    }
    // Music paused on backgrounding (html5 stream) — kick it back to life.
    if (this.musicShouldPlay()) this.startMusic();
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

  /**
   * Play the signature synthesised cue for a Chaos event (one distinct sound
   * per event, generated live — see `chaosTones`). Respects the Sound setting
   * and reuses Howler's shared Web Audio context. Falls back to the generic
   * `chaos_event` sample if Web Audio isn't available yet (no context).
   */
  playChaos(event: string): void {
    if (!this.enabled) return;
    // Howler's types say `ctx` is always present, but it's lazily created on
    // the first Howl — so it can genuinely be absent here.
    const ctx = Howler.ctx as AudioContext | null | undefined;
    if (ctx === null || ctx === undefined) {
      this.play("chaos_event"); // Web Audio not up yet — generic cue
      return;
    }
    try {
      if (ctx.state !== "running") void ctx.resume();
      playChaosTone(ctx, event, this.master);
    } catch {
      /* synthesis failed (unsupported) — stay silent rather than crash */
    }
  }

  /**
   * A wheel "tick" whose pitch rises with `progress` (0…1, 1 = about to stop).
   * Synthesised live (rising-pitch ratchet feel); falls back to the generic
   * `wheel_tick` sample if Web Audio isn't up yet. Respects the Sound setting.
   */
  playTick(progress: number): void {
    if (!this.enabled) return;
    const ctx = Howler.ctx as AudioContext | null | undefined;
    if (ctx === null || ctx === undefined) {
      this.play("wheel_tick"); // Web Audio not up yet — generic sample
      return;
    }
    try {
      if (ctx.state !== "running") void ctx.resume();
      playTickTone(ctx, progress, this.master);
    } catch {
      /* synthesis failed (unsupported) — stay silent rather than crash */
    }
  }

  /** A "thunk" impact when the wheel lands. Synthesised; silent no-op if Web
   *  Audio isn't up. Respects the Sound setting. */
  playThunk(): void {
    if (!this.enabled) return;
    const ctx = Howler.ctx as AudioContext | null | undefined;
    if (ctx === null || ctx === undefined) return;
    try {
      if (ctx.state !== "running") void ctx.resume();
      playThunkTone(ctx, this.master);
    } catch {
      /* synthesis failed (unsupported) — stay silent rather than crash */
    }
  }

  // --- background music ---------------------------------------------------

  /** True when every gate agrees the bed should be playing. */
  private musicShouldPlay(): boolean {
    return this.musicWanted && this.musicEnabled && this.musicAllowed;
  }

  /** Start or stop the bed to match the current gate state. */
  private reconcileMusic(): void {
    if (this.musicShouldPlay()) this.startMusic();
    else this.stopMusic();
  }

  /** Turn the music track on/off (Settings → Music). */
  setMusicEnabled(value: boolean): void {
    this.musicEnabled = value;
    this.reconcileMusic();
  }

  /** Context gate: only the host plays the background bed inside a room, so
   *  co-located players don't get a cacophony of different tracks. Guests in
   *  a room set this false; it's true on the lobby / for the host. */
  setMusicAllowed(value: boolean): void {
    this.musicAllowed = value;
    this.reconcileMusic();
  }

  /** Ask for the background bed to play (called once at app boot). It then
   *  loops for the whole session; the Music setting + context gate stop it. */
  requestMusic(): void {
    this.musicWanted = true;
    this.reconcileMusic();
  }

  private startMusic(): void {
    try {
      if (Howler.ctx && Howler.ctx.state !== "running") void Howler.ctx.resume();
    } catch {
      /* no context */
    }
    const m = this.music;
    if (m !== undefined) {
      // A track already exists — resume it (paused on disable / blocked by
      // autoplay at boot) and fade back up. The playlist keeps advancing
      // from wherever it was.
      if (!m.playing()) m.play();
      m.fade(m.volume(), MUSIC_VOLUME, MUSIC_FADE_MS);
      return;
    }
    this.playTrack(this.pickNextTrack());
  }

  /** A random track index, never the one currently/last playing (unless
   *  there is only one track to choose from). */
  private pickNextTrack(): number {
    const n = MUSIC_TRACKS.length;
    if (n <= 1) return 0;
    let next = this.currentTrack;
    while (next === this.currentTrack) {
      next = Math.floor(Math.random() * n);
    }
    return next;
  }

  private playTrack(index: number): void {
    // Tear down the previous track's Howl so we don't leak <audio> elements.
    if (this.music !== undefined) {
      this.music.unload();
      this.music = undefined;
    }
    this.currentTrack = index;
    const howl = new Howl({
      src: [MUSIC_TRACKS[index]],
      loop: false,
      volume: 0,
      // html5 streaming (NOT Web Audio): full-length tracks would otherwise
      // be downloaded + decoded into RAM in full, which is heavy on mobile.
      // Streaming keeps memory and start latency low. The old gapless-loop
      // concern that forced Web Audio doesn't apply here — each track plays
      // once and we advance, so there is no loop point to gap.
      html5: true,
      onend: () => {
        // Chain to the next track only while every gate still agrees.
        if (this.musicShouldPlay()) {
          this.playTrack(this.pickNextTrack());
        }
      },
      onloaderror: () => {
        /* missing track file — silent */
      },
      onplayerror: () => {
        /* gesture not yet received — retried by installUnlock */
      },
    });
    this.music = howl;
    howl.play();
    howl.fade(0, MUSIC_VOLUME, MUSIC_FADE_MS);
  }

  private stopMusic(): void {
    const m = this.music;
    if (m === undefined || !m.playing()) return;
    m.fade(m.volume(), 0, MUSIC_FADE_MS);
    m.once("fade", () => {
      // Pause to stop streaming, unless music got re-requested during the fade.
      if (!this.musicShouldPlay()) m.pause();
    });
  }
}

export const audio = new AudioManager();
export type { AudioName } from "./manifest";
