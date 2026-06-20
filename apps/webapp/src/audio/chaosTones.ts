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

const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();

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
  const peak = Math.max(0.0001, o.gain * master);
  const atk = Math.min(o.attack ?? 0.008, o.dur * 0.5);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + atk);
  g.gain.linearRampToValueAtTime(0, t0 + o.dur);
  node.connect(g).connect(ctx.destination);
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
  const peak = Math.max(0.0001, o.gain * master);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.01, o.dur * 0.4));
  g.gain.linearRampToValueAtTime(0, t0 + o.dur);
  src.connect(filt).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + o.dur + 0.02);
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
    case "nudge_fwd": // ⏩ a short up-tick
      osc(ctx, master, { type: "triangle", freq: 520, to: 680, dur: 0.1, gain: 0.2 });
      break;
    case "nudge_back": // ⏪ a short down-tick
      osc(ctx, master, { type: "triangle", freq: 520, to: 390, dur: 0.1, gain: 0.2 });
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
    case "earthquake": // 💥 a low rumble
      noise(ctx, master, { dur: 1.0, gain: 0.32, filter: 170, q: 0.6 });
      osc(ctx, master, { type: "sine", freq: 62, to: 44, dur: 1.0, gain: 0.3, attack: 0.05 });
      osc(ctx, master, { type: "triangle", freq: 90, to: 60, dur: 1.0, gain: 0.14, attack: 0.05 });
      break;
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
    default: // unknown event — a neutral blip
      osc(ctx, master, { type: "triangle", freq: 600, dur: 0.1, gain: 0.16 });
  }
}
