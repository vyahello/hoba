#!/usr/bin/env python3
"""Procedural sound-design generator for Hoba!'s 10 UI/game cues.

Pure-stdlib additive/subtractive synthesis (no numpy) → 16-bit WAV →
ffmpeg-encoded mono MP3 into `apps/webapp/public/sounds/`. Run from repo
root: `python3 scripts/generate_sounds.py`.

The set is tuned cohesively around C major / C pentatonic with a shared
soft-reverb character so taps, the wheel, chosen options, and winners feel
like one instrument. Re-run any time to tweak the palette — the manifest
in `apps/webapp/src/audio/manifest.ts` lists the canonical names.
"""

from __future__ import annotations

import math
import random
import struct
import subprocess
import tempfile
import wave
from collections.abc import Callable
from pathlib import Path

SR = 44_100
OUT_DIR = Path(__file__).resolve().parent.parent / "apps" / "webapp" / "public" / "sounds"

# C major palette (Hz) — keeps every tonal cue in the same key.
C5, D5, E5, G5, A5, C6, E6, G6 = 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1318.5, 1568.0

Samples = list[float]


# --- core synthesis helpers ----------------------------------------------


def silence(seconds: float) -> Samples:
    return [0.0] * int(seconds * SR)


def add(buf: Samples, src: Samples, at: float = 0.0, gain: float = 1.0) -> None:
    """Mix `src` into `buf` starting at `at` seconds, growing `buf` as needed."""
    start = int(at * SR)
    end = start + len(src)
    if end > len(buf):
        buf.extend([0.0] * (end - len(buf)))
    for i, s in enumerate(src):
        buf[start + i] += s * gain


def env_exp(n: int, attack: float, decay_tc: float) -> Samples:
    """Fast linear attack then exponential decay (natural percussive shape)."""
    out = [0.0] * n
    a = max(1, int(attack * SR))
    for i in range(n):
        amp = i / a if i < a else math.exp(-(i - a) / (decay_tc * SR))
        out[i] = amp
    return out


def partial(freq: float, n: int, *, detune: float = 0.0, phase: float = 0.0) -> Samples:
    out = [0.0] * n
    w = 2 * math.pi * (freq + detune) / SR
    for i in range(n):
        out[i] = math.sin(w * i + phase)
    return out


def sweep(f0: float, f1: float, n: int, *, curve: float = 1.0) -> Samples:
    """Sine with frequency gliding f0→f1 (curve>1 eases toward the end)."""
    out = [0.0] * n
    ph = 0.0
    for i in range(n):
        k = (i / n) ** curve
        f = f0 + (f1 - f0) * k
        ph += 2 * math.pi * f / SR
        out[i] = math.sin(ph)
    return out


def noise(n: int) -> Samples:
    return [random.uniform(-1.0, 1.0) for _ in range(n)]


def lowpass(buf: Samples, cutoff: float) -> Samples:
    """One-pole low-pass — softens harsh noise/edges."""
    a = math.exp(-2 * math.pi * cutoff / SR)
    out = [0.0] * len(buf)
    y = 0.0
    for i, x in enumerate(buf):
        y = (1 - a) * x + a * y
        out[i] = y
    return out


def highpass(buf: Samples, cutoff: float) -> Samples:
    a = math.exp(-2 * math.pi * cutoff / SR)
    out = [0.0] * len(buf)
    y = 0.0
    prev = 0.0
    for i, x in enumerate(buf):
        y = a * (y + x - prev)
        prev = x
        out[i] = y
    return out


def reverb_tail(buf: Samples, *, decay: float = 0.4, mix: float = 0.25) -> Samples:
    """Cheap Schroeder-ish multi-tap reverb for a polished tail."""
    out = list(buf)
    out.extend([0.0] * int(decay * SR))
    taps = [(0.029, 0.7), (0.037, 0.6), (0.041, 0.5), (0.053, 0.42), (0.067, 0.32)]
    for delay, g in taps:
        d = int(delay * SR)
        for i in range(len(buf)):
            out[i + d] += buf[i] * g * mix
    return out


def apply_env(buf: Samples, env: Samples) -> Samples:
    return [s * env[i] for i, s in enumerate(buf)]


def soft_clip(buf: Samples, drive: float = 1.0) -> Samples:
    return [math.tanh(drive * s) for s in buf]


def normalize(buf: Samples, peak: float = 0.89) -> Samples:
    m = max((abs(s) for s in buf), default=1.0) or 1.0
    g = peak / m
    return [s * g for s in buf]


# --- the ten cues ---------------------------------------------------------


def bell(freqs: list[float], seconds: float, decay_tc: float, *, inharm: float = 0.0) -> Samples:
    """Additive bell: stacked partials with optional inharmonic shimmer."""
    n = int(seconds * SR)
    out = [0.0] * n
    for j, f in enumerate(freqs):
        e = env_exp(n, 0.002, decay_tc * (1.0 - 0.12 * j))
        p = apply_env(partial(f * (1 + inharm * j), n), e)
        for i in range(n):
            out[i] += p[i] / (j + 1.4)
    return out


def make_ui_tap() -> Samples:
    n = int(0.07 * SR)
    body = apply_env(partial(A5, n), env_exp(n, 0.001, 0.018))
    click = apply_env(highpass(noise(n), 4000), env_exp(n, 0.0005, 0.004))
    out = [body[i] * 0.8 + click[i] * 0.25 for i in range(n)]
    return normalize(out, 0.7)


def make_ui_swipe() -> Samples:
    n = int(0.2 * SR)
    air = lowpass(highpass(noise(n), 600), 3500)
    env = [math.sin(math.pi * i / n) ** 1.5 for i in range(n)]
    # rising band gives the "whoosh" direction
    out = [air[i] * env[i] for i in range(n)]
    return normalize(out, 0.55)


def make_wheel_tick() -> Samples:
    n = int(0.035 * SR)
    tick = apply_env(partial(G6, n), env_exp(n, 0.0004, 0.006))
    click = apply_env(highpass(noise(n), 5000), env_exp(n, 0.0003, 0.0025))
    out = [tick[i] * 0.7 + click[i] * 0.4 for i in range(n)]
    return normalize(out, 0.6)


def make_wheel_launch() -> Samples:
    n = int(0.6 * SR)
    rise = sweep(C5 * 0.5, G6, n, curve=1.6)
    vib = [rise[i] * (1 + 0.04 * math.sin(2 * math.pi * 6 * i / SR)) for i in range(n)]
    air = lowpass(noise(n), 2200)
    env = [min(1.0, i / (0.08 * SR)) * math.exp(-(max(0, i - 0.4 * SR)) / (0.12 * SR)) for i in range(n)]
    out = [(vib[i] * 0.8 + air[i] * 0.15) * env[i] for i in range(n)]
    return normalize(soft_clip(out, 1.2), 0.8)


def make_result_chime() -> Samples:
    # Resolved major triad bell — the "we have a result" reward.
    core = bell([C5, E5, G5, C6], 1.1, 0.34, inharm=0.0008)
    sparkle = bell([G6, E6], 0.5, 0.12)
    out = list(core)
    add(out, sparkle, at=0.0, gain=0.3)
    return normalize(reverb_tail(out, decay=0.5, mix=0.3), 0.85)


def make_hoba_pop() -> Samples:
    # Playful "boop" — quick upward pitch blip with a bubble body.
    n = int(0.14 * SR)
    blip = sweep(C5, C6 * 1.2, n, curve=0.5)
    env = env_exp(n, 0.003, 0.045)
    out = apply_env(blip, env)
    pop = apply_env(partial(C6, int(0.02 * SR)), env_exp(int(0.02 * SR), 0.0005, 0.006))
    add_buf = list(out)
    for i in range(len(pop)):
        add_buf[i] += pop[i] * 0.4
    return normalize(soft_clip(add_buf, 1.3), 0.82)


def make_confetti_burst() -> Samples:
    # Noise burst + scattered bright sparkles = celebration.
    n = int(0.7 * SR)
    burst = apply_env(highpass(noise(n), 1500), env_exp(n, 0.002, 0.09))
    out = [burst[i] * 0.5 for i in range(n)]
    pent = [C6, D5 * 2, E6, G6, A5 * 2]
    for _ in range(14):
        f = random.choice(pent) * random.choice([1.0, 1.0, 2.0])
        dur = random.uniform(0.04, 0.12)
        ping = apply_env(partial(f, int(dur * SR)), env_exp(int(dur * SR), 0.001, dur * 0.4))
        add(out, ping, at=random.uniform(0.0, 0.55), gain=0.22)
    return normalize(reverb_tail(out, decay=0.4, mix=0.2), 0.84)


def make_chaos_event() -> Samples:
    # Glitchy sample-and-hold wobble — playful chaos.
    n = int(0.6 * SR)
    out = [0.0] * n
    ph = 0.0
    f = 300.0
    hold = 0
    step = int(0.045 * SR)
    for i in range(n):
        if hold <= 0:
            f = random.choice([196, 233, 294, 349, 440, 523, 622]) * random.choice([1, 1, 2])
            hold = step
        hold -= 1
        ph += 2 * math.pi * f / SR
        # square-ish for a chiptune edge
        out[i] = (1.0 if math.sin(ph) > 0 else -1.0)
    env = [min(1.0, i / (0.02 * SR)) * math.exp(-(max(0, i - 0.3 * SR)) / (0.15 * SR)) for i in range(n)]
    out = apply_env(out, env)
    wob = [out[i] * (0.7 + 0.3 * math.sin(2 * math.pi * 18 * i / SR)) for i in range(n)]
    return normalize(soft_clip(wob, 1.1), 0.7)


def make_join_ping() -> Samples:
    # Gentle two-note ascending notification (G5 → C6).
    out = silence(0.42)
    a = apply_env(partial(G5, int(0.18 * SR)), env_exp(int(0.18 * SR), 0.004, 0.07))
    b = bell([C6, E6], 0.32, 0.14)
    add(out, a, at=0.0, gain=0.6)
    add(out, b, at=0.13, gain=0.6)
    return normalize(reverb_tail(out, decay=0.35, mix=0.22), 0.7)


def make_rigged_reveal() -> Samples:
    # Suspense drone rising into a bright resolve hit — the 🎭 reveal.
    n = int(1.0 * SR)
    drone = sweep(C5 * 0.5, C5, n, curve=2.0)
    shimmer = [0.0] * n
    for f in (G5, C6, E6):
        p = partial(f, n)
        for i in range(n):
            shimmer[i] += p[i] * 0.12 * (i / n)
    swell = [min(1.0, i / (0.3 * SR)) for i in range(n)]
    pre = [(drone[i] * 0.5 + shimmer[i]) * swell[i] for i in range(n)]
    out = list(pre)
    hit = bell([C5, E5, G5, C6, E6], 0.9, 0.3, inharm=0.001)
    add(out, hit, at=0.95, gain=1.0)
    return normalize(reverb_tail(soft_clip(out, 1.1), decay=0.5, mix=0.3), 0.85)


CUES: dict[str, Callable[[], Samples]] = {
    "ui_tap": make_ui_tap,
    "ui_swipe": make_ui_swipe,
    "wheel_tick": make_wheel_tick,
    "wheel_launch": make_wheel_launch,
    "result_chime": make_result_chime,
    "hoba_pop": make_hoba_pop,
    "confetti_burst": make_confetti_burst,
    "chaos_event": make_chaos_event,
    "join_ping": make_join_ping,
    "rigged_reveal": make_rigged_reveal,
}


def write_wav(path: Path, buf: Samples) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b"".join(
            struct.pack("<h", max(-32767, min(32767, int(s * 32767)))) for s in buf
        )
        w.writeframes(frames)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    random.seed(7)  # reproducible sparkle/chaos
    for name, fn in CUES.items():
        buf = fn()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            wav_path = Path(tmp.name)
        write_wav(wav_path, buf)
        mp3_path = OUT_DIR / f"{name}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
             "-codec:a", "libmp3lame", "-b:a", "96k", "-ar", str(SR), "-ac", "1",
             str(mp3_path)],
            check=True,
        )
        wav_path.unlink(missing_ok=True)
        print(f"  ✓ {name}.mp3  ({mp3_path.stat().st_size // 1024} KB, {len(buf) / SR:.2f}s)")
    print(f"Wrote {len(CUES)} sounds → {OUT_DIR}")


if __name__ == "__main__":
    main()
