/**
 * Audio manifest — every sound the app ever plays is declared here.
 *
 * Spec §11 lists 10 sounds. Phase 5 wires the system; the actual `.mp3`
 * assets land in `apps/webapp/public/sounds/` (see
 * `docs/audio-licenses.md` for sourcing guidance). Missing files fail
 * silently — the app remains functional with no audio.
 */

export const AUDIO_NAMES = [
  "ui_tap",
  "ui_swipe",
  "wheel_tick",
  "wheel_launch",
  "result_chime",
  "hoba_pop",
  "confetti_burst",
  "chaos_event",
  "join_ping",
  "rigged_reveal",
] as const;

export type AudioName = (typeof AUDIO_NAMES)[number];

export interface AudioDef {
  src: string;
  /** Relative volume in [0, 1]; multiplied by master volume at playback. */
  volume?: number;
}

export const AUDIO_MANIFEST: Record<AudioName, AudioDef> = {
  ui_tap: { src: "/sounds/ui_tap.mp3", volume: 0.6 },
  ui_swipe: { src: "/sounds/ui_swipe.mp3", volume: 0.5 },
  wheel_tick: { src: "/sounds/wheel_tick.mp3", volume: 0.4 },
  wheel_launch: { src: "/sounds/wheel_launch.mp3", volume: 0.7 },
  result_chime: { src: "/sounds/result_chime.mp3", volume: 0.8 },
  hoba_pop: { src: "/sounds/hoba_pop.mp3", volume: 1.0 },
  confetti_burst: { src: "/sounds/confetti_burst.mp3", volume: 0.6 },
  chaos_event: { src: "/sounds/chaos_event.mp3", volume: 0.7 },
  join_ping: { src: "/sounds/join_ping.mp3", volume: 0.5 },
  rigged_reveal: { src: "/sounds/rigged_reveal.mp3", volume: 0.8 },
};
