/**
 * Procedural sound cues for Chaos (§5.4) events — one distinctive sound per
 * event, synthesised live with the Web Audio API (no audio files to ship or
 * licence). Each event gets a signature so players can tell them apart by ear:
 * blippy bursts, slow glides, a quake rumble, a fake-out "wah-wah", glitch
 * stutter, etc.
 *
 * Pure + side-effecting only on the passed `AudioContext` (Howler's shared
 * one). Gating on the Sound setting + context resume happens in the caller
 * (`audio.playChaos`); this module just schedules nodes.
 */

type OscOpts = {
  type?: OscillatorType;
  /** Start frequency (Hz). */
  freq: number;
  /** Glide to this frequency over `dur` (default: no glide). */
  to?: number;
  /** Delay before this voice starts (s from now). */
  at?: number;
  /** Duration (s). */
  dur: number;
  /** Peak gain (0…1), before master scaling. */
  gain: number;
  /** Attack ramp (s). */
  attack?: number;
  /** Pitch wobble: { rate Hz, depth Hz }. */
  vibrato?: { rate: number; depth: number };
};

type NoiseOpts = {
  at?: number;
  dur: number;
  gain: number;
  /** Biquad filter type + cutoff/centre frequency. */
  filterType?: BiquadFilterType;
  filter: number;
  /** Sweep the filter to this frequency over `dur`. */
  sweepTo?: number;
  q?: number;
};

// Chaos cues were too quiet against the music bed. Boost every voice and run
// them through a per-context limiter so the louder signal can't clip/distort
// when several voices stack (earthquake, glitch, multi_spin).
const CHAOS_BOOST = 3.2;

const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();
const buses = new WeakMap<AudioContext, GainNode>();

/** A shared, loud-but-clean output bus: makeup gain → limiter → destination. */
function chaosBus(ctx: AudioContext): GainNode {
  const cached = buses.get(ctx);
  if (cached !== undefined) return cached;
  const comp = ctx.createDynamicsCompressor();
  const t = ctx.currentTime;
  comp.threshold.setValueAtTime(-8, t);
  comp.knee.setValueAtTime(6, t);
  comp.ratio.setValueAtTime(20, t);
  comp.attack.setValueAtTime(0.003, t);
  comp.release.setValueAtTime(0.12, t);
  const input = ctx.createGain();
  input.gain.setValueAtTime(1, t);
  input.connect(comp).connect(ctx.destination);
  buses.set(ctx, input);
  return input;
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached !== undefined) return cached;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ctx, buf);
  return buf;
}

function osc(ctx: AudioContext, master: number, o: OscOpts): void {
  const t0 = ctx.currentTime + (o.at ?? 0);
  const node = ctx.createOscillator();
  node.type = o.type ?? "sine";
  node.frequency.setValueAtTime(o.freq, t0);
  if (o.to !== undefined && o.to !== o.freq) {
    node.frequency.linearRampToValueAtTime(o.to, t0 + o.dur);
  }
  const g = ctx.createGain();
  const peak = Math.min(0.9, Math.max(0.0001, o.gain * master * CHAOS_BOOST));
  const atk = Math.min(o.attack ?? 0.008, o.dur * 0.5);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + atk);
  g.gain.linearRampToValueAtTime(0, t0 + o.dur);
  node.connect(g).connect(chaosBus(ctx));
  if (o.vibrato !== undefined) {
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(o.vibrato.rate, t0);
    const ld = ctx.createGain();
    ld.gain.setValueAtTime(o.vibrato.depth, t0);
    lfo.connect(ld).connect(node.frequency);
    lfo.start(t0);
    lfo.stop(t0 + o.dur + 0.02);
  }
  node.start(t0);
  node.stop(t0 + o.dur + 0.02);
}

function noise(ctx: AudioContext, master: number, o: NoiseOpts): void {
  const t0 = ctx.currentTime + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise(ctx);
  const filt = ctx.createBiquadFilter();
  filt.type = o.filterType ?? "lowpass";
  filt.frequency.setValueAtTime(o.filter, t0);
  if (o.sweepTo !== undefined) filt.frequency.linearRampToValueAtTime(o.sweepTo, t0 + o.dur);
  filt.Q.setValueAtTime(o.q ?? 0.7, t0);
  const g = ctx.createGain();
  const peak = Math.min(0.9, Math.max(0.0001, o.gain * master * CHAOS_BOOST));
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.01, o.dur * 0.4));
  g.gain.linearRampToValueAtTime(0, t0 + o.dur);
  src.connect(filt).connect(g).connect(chaosBus(ctx));
  src.start(t0);
  src.stop(t0 + o.dur + 0.02);
}

/**
 * A single wheel "tick" (peg clack) whose pitch ramps up with `p01` (0 at the
 * start of the decel → 1 just before the stop) — the classic wheel-of-fortune
 * accelerating-tick feel. Modest + direct (NOT through the boosted chaos bus),
 * since these fire many times a second. No-op at zero volume.
 */
export function playTickTone(ctx: AudioContext, p01: number, master: number): void {
  const m = Math.max(0, Math.min(1, master));
  if (m <= 0) return;
  const p = Math.max(0, Math.min(1, p01));
  const t0 = ctx.currentTime;
  // The clack: a short bandpass-noise transient, centre rising with p.
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(1400 + p * 1900, t0);
  bp.Q.setValueAtTime(3, t0);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.17 * m, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
  src.connect(bp).connect(ng).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + 0.05);
  // A short resonant blip body, pitch rising with p.
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(620 + p * 920, t0);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t0);
  og.gain.linearRampToValueAtTime(0.1 * m, t0 + 0.002);
  og.gain.linearRampToValueAtTime(0.0001, t0 + 0.035);
  o.connect(og).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.05);
}

/**
 * A satisfying "thunk" — the wheel's stopper catching as it lands. A fast
 * pitch-drop body + a click transient. Played once per spin at the settle.
 * Modest + direct. No-op at zero volume.
 */
export function playThunkTone(ctx: AudioContext, master: number): void {
  const m = Math.max(0, Math.min(1, master));
  if (m <= 0) return;
  const t0 = ctx.currentTime;
  // Impact body: pitch drops fast.
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(260, t0);
  o.frequency.exponentialRampToValueAtTime(80, t0 + 0.13);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t0);
  og.gain.linearRampToValueAtTime(0.34 * m, t0 + 0.005);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
  o.connect(og).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.22);
  // Click transient for the "tk".
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(1800, t0);
  bp.Q.setValueAtTime(1.5, t0);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.2 * m, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
  src.connect(bp).connect(ng).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + 0.06);
}

/** Schedule the signature sound for `event` on `ctx`. Unknown names get a
 *  neutral blip. `master` is the global SFX volume (0…1). */
export function playChaosTone(ctx: AudioContext, event: string, master: number): void {
  switch (event) {
    case "multi_spin": // ⚡️ a burst of rising blips
      for (let i = 0; i < 5; i++) {
        osc(ctx, master, { type: "square", freq: 520 + i * 130, at: i * 0.06, dur: 0.05, gain: 0.16 });
      }
      break;
    case "tiny_spin": // 💨 one quick high pip
      osc(ctx, master, { type: "square", freq: 1400, to: 1750, dur: 0.07, gain: 0.18 });
      break;
    case "mega_spin": // 🌪️ epic long rising sweep + low body
      osc(ctx, master, { type: "sawtooth", freq: 180, to: 900, dur: 1.1, gain: 0.16, attack: 0.06 });
      osc(ctx, master, { type: "sine", freq: 90, to: 240, dur: 1.1, gain: 0.18, attack: 0.06 });
      break;
    case "slow_burn": // 🐢 slow descending glide
      osc(ctx, master, { type: "sine", freq: 520, to: 150, dur: 1.2, gain: 0.2, attack: 0.08 });
      break;
    case "reverse": // 🔄 tape-rewind: repeated rising chirps
      for (let i = 0; i < 3; i++) {
        osc(ctx, master, { type: "sawtooth", freq: 300, to: 920, at: i * 0.1, dur: 0.09, gain: 0.14 });
      }
      break;
    case "swap": // 🔀 two notes trading places
      osc(ctx, master, { type: "triangle", freq: 660, dur: 0.12, gain: 0.2 });
      osc(ctx, master, { type: "triangle", freq: 440, at: 0.13, dur: 0.12, gain: 0.2 });
      break;
    case "nudge_fwd": // ⏩⏪ a ratchet creep + clunk into place. Both nudges
    case "nudge_back": // share one neutral cue so the ear doesn't spoil the way.
      noise(ctx, master, { at: 0, dur: 0.03, gain: 0.18, filterType: "bandpass", filter: 2200, q: 1.6 });
      noise(ctx, master, { at: 0.08, dur: 0.03, gain: 0.18, filterType: "bandpass", filter: 2500, q: 1.6 });
      osc(ctx, master, { type: "square", freq: 500, to: 560, at: 0.14, dur: 0.16, gain: 0.24 });
      osc(ctx, master, { type: "triangle", freq: 560, at: 0.31, dur: 0.13, gain: 0.2 }); // clunk
      break;
    case "blind_pointer": // 🫥 a vanishing whoosh
      noise(ctx, master, { dur: 0.5, gain: 0.18, filter: 1300, sweepTo: 300, q: 0.7 });
      osc(ctx, master, { type: "sine", freq: 300, to: 160, dur: 0.5, gain: 0.1, attack: 0.02 });
      break;
    case "roaming_pointer": // 🎯 a wandering wobble
      osc(ctx, master, {
        type: "sine", freq: 600, dur: 0.6, gain: 0.18, attack: 0.02,
        vibrato: { rate: 14, depth: 120 },
      });
      break;
    case "shuffle": // 🎰 a fast card riffle (clatter)
      for (let i = 0; i < 9; i++) {
        noise(ctx, master, { at: i * 0.045, dur: 0.03, gain: 0.13, filterType: "bandpass", filter: 2600 + i * 220, q: 1.2 });
      }
      break;
    case "earthquake": { // 💥 a broadband rumble (audible on phone speakers —
      // pure sub-bass was inaudible). A low-mid boom with harmonics, an
      // overlapping noise rumble that "shakes", and debris crackle.
      osc(ctx, master, { type: "sawtooth", freq: 165, to: 70, dur: 0.75, gain: 0.34, attack: 0.004 });
      osc(ctx, master, { type: "square", freq: 82, to: 55, dur: 0.85, gain: 0.16, attack: 0.01 });
      for (let i = 0; i < 10; i++) { // the shaking rumble (overlapping bursts)
        noise(ctx, master, { at: i * 0.085, dur: 0.16, gain: 0.18 + (i % 3) * 0.04, filter: 520 + (i % 4) * 130, q: 0.9 });
      }
      for (let i = 0; i < 5; i++) { // debris crackle
        noise(ctx, master, { at: 0.1 + i * 0.14, dur: 0.04, gain: 0.13, filterType: "bandpass", filter: 1900 + i * 220, q: 2.2 });
      }
      break;
    }
    case "fake_out": // 🎭 a hopeful "ta-da?" rise (the drop comes later)
      osc(ctx, master, { type: "triangle", freq: 440, to: 560, dur: 0.18, gain: 0.2 });
      osc(ctx, master, { type: "triangle", freq: 620, at: 0.2, dur: 0.22, gain: 0.2 });
      break;
    case "fake_out_drop": // 🎭 the comedic "wah-wah" let-down (on the yank-away)
      osc(ctx, master, { type: "sawtooth", freq: 420, to: 300, dur: 0.2, gain: 0.2, attack: 0.01 });
      osc(ctx, master, { type: "sawtooth", freq: 300, to: 110, at: 0.22, dur: 0.45, gain: 0.22, attack: 0.01 });
      break;
    case "glitch": { // 📺 a broken-signal stutter
      const steps = [220, 880, 330, 1320, 180, 990];
      for (let i = 0; i < steps.length; i++) {
        osc(ctx, master, { type: "square", freq: steps[i]!, at: i * 0.07, dur: 0.05, gain: 0.13 });
        if (i % 2 === 0) {
          noise(ctx, master, { at: i * 0.07, dur: 0.04, gain: 0.1, filterType: "bandpass", filter: 4000, q: 2 });
        }
      }
      break;
    }
    case "jammed": // 🔒 a stuck-motor strain: a low buzz that grinds + a clunk
      osc(ctx, master, { type: "sawtooth", freq: 150, to: 115, dur: 0.22, gain: 0.24, attack: 0.006 });
      osc(ctx, master, { type: "square", freq: 70, dur: 0.24, gain: 0.12, attack: 0.01 });
      noise(ctx, master, { dur: 0.14, gain: 0.16, filter: 850, q: 1.1 }); // grind
      noise(ctx, master, { at: 0.2, dur: 0.04, gain: 0.16, filterType: "bandpass", filter: 1600, q: 2 }); // clunk
      break;
    default: // unknown event — a neutral blip
      osc(ctx, master, { type: "triangle", freq: 600, dur: 0.1, gain: 0.16 });
  }
}
