#!/usr/bin/env python3
"""Procedural sound-design studio for Hoba! — 12 polished UI/game cues.

Pure-stdlib synthesis (no numpy) → 16-bit stereo WAV → ffmpeg MP3 into
`apps/webapp/public/sounds/`. Run from repo root:

    python3 scripts/generate_sounds.py

Design goals (lead-dev brief): cohesive, punchy, "addictive" feedback.
Everything is tuned to C major and shares a stereo plate-reverb character
so taps, the wheel, picked options, and winner fanfares feel like one
instrument. Layering = transient + body + tail; detuned unison + chorus
give width; a sub layer adds weight to the celebratory hits. `bg_music`
is a seamless ~9.6 s lo-fi loop (C–Am–F–G) for the in-room bed.

100% original output — no samples, no third-party license. `random.seed`
keeps sparkle/chaos reproducible (byte-identical re-runs).
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

# Note table (Hz) — C major / C pentatonic palette.
A2, C3, E3, G3 = 110.0, 130.81, 164.81, 196.0
C4, D4, E4, F4, G4, A4, B4 = 261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88
C5, D5, E5, F5, G5, A5, B5 = 523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77
C6, D6, E6, G6, A6 = 1046.5, 1174.7, 1318.5, 1568.0, 1760.0

Samples = list[float]
Stereo = tuple[Samples, Samples]


# --- core mono helpers ----------------------------------------------------


def buf(seconds: float) -> Samples:
    return [0.0] * int(seconds * SR)


def mix(dst: Samples, src: Samples, at: float = 0.0, gain: float = 1.0) -> None:
    start = int(at * SR)
    end = start + len(src)
    if end > len(dst):
        dst.extend([0.0] * (end - len(dst)))
    for i, s in enumerate(src):
        dst[start + i] += s * gain


def env_adsr(n: int, a: float, d: float, s: float, r: float, sustain: float = 0.6) -> Samples:
    out = [0.0] * n
    an, dn, rn = int(a * SR), int(d * SR), int(r * SR)
    sn = max(0, n - an - dn - rn)
    i = 0
    for k in range(an):
        if i < n:
            out[i] = k / max(1, an)
        i += 1
    for k in range(dn):
        if i < n:
            out[i] = 1.0 - (1.0 - sustain) * (k / max(1, dn))
        i += 1
    for _ in range(sn):
        if i < n:
            out[i] = sustain
        i += 1
    for k in range(rn):
        if i < n:
            out[i] = sustain * (1.0 - k / max(1, rn))
        i += 1
    return out


def env_perc(n: int, attack: float, decay_tc: float) -> Samples:
    out = [0.0] * n
    a = max(1, int(attack * SR))
    for i in range(n):
        out[i] = i / a if i < a else math.exp(-(i - a) / (decay_tc * SR))
    return out


def sine(freq: float, n: int, phase: float = 0.0) -> Samples:
    w = 2 * math.pi * freq / SR
    return [math.sin(w * i + phase) for i in range(n)]


def saw(freq: float, n: int) -> Samples:
    # band-limited-ish saw via summed harmonics (warm, not buzzy)
    out = [0.0] * n
    h = 1
    while h * freq < 12000 and h <= 12:
        w = 2 * math.pi * freq * h / SR
        g = 1.0 / h
        for i in range(n):
            out[i] += g * math.sin(w * i)
        h += 1
    return out


def pulse(freq: float, n: int, duty: float = 0.5) -> Samples:
    """Chiptune pulse/square wave — bright, gamey lead/arp timbre."""
    out = [0.0] * n
    period = SR / freq
    for i in range(n):
        out[i] = 1.0 if (i % period) / period < duty else -1.0
    return out


def unison(freq: float, n: int, voices: int = 3, spread: float = 0.006) -> Samples:
    """Detuned stacked saws — fat, wide-feeling lead/pad voice."""
    out = [0.0] * n
    for v in range(voices):
        det = freq * (1 + spread * (v - (voices - 1) / 2))
        s = saw(det, n)
        for i in range(n):
            out[i] += s[i] / voices
    return out


def pluck(freq: float, seconds: float, decay: float = 0.18) -> Samples:
    n = int(seconds * SR)
    tone = [0.0] * n
    for h, g in ((1, 1.0), (2, 0.5), (3, 0.28), (4, 0.12)):
        w = 2 * math.pi * freq * h / SR
        for i in range(n):
            tone[i] += g * math.sin(w * i)
    e = env_perc(n, 0.002, decay)
    return [tone[i] * e[i] for i in range(n)]


def sweep(f0: float, f1: float, n: int, curve: float = 1.0) -> Samples:
    out = [0.0] * n
    ph = 0.0
    for i in range(n):
        f = f0 + (f1 - f0) * (i / n) ** curve
        ph += 2 * math.pi * f / SR
        out[i] = math.sin(ph)
    return out


def noise(n: int) -> Samples:
    return [random.uniform(-1.0, 1.0) for _ in range(n)]


def lowpass(b: Samples, cutoff: float) -> Samples:
    a = math.exp(-2 * math.pi * cutoff / SR)
    out, y = [0.0] * len(b), 0.0
    for i, x in enumerate(b):
        y = (1 - a) * x + a * y
        out[i] = y
    return out


def highpass(b: Samples, cutoff: float) -> Samples:
    a = math.exp(-2 * math.pi * cutoff / SR)
    out, y, prev = [0.0] * len(b), 0.0, 0.0
    for i, x in enumerate(b):
        y = a * (y + x - prev)
        prev = x
        out[i] = y
    return out


def kick(seconds: float = 0.22) -> Samples:
    n = int(seconds * SR)
    pitch = sweep(150, 45, n, curve=0.4)
    e = env_perc(n, 0.001, 0.07)
    click = lowpass(noise(int(0.01 * SR)), 4000)
    out = [pitch[i] * e[i] for i in range(n)]
    for i in range(len(click)):
        out[i] += click[i] * 0.3 * (1 - i / len(click))
    return [math.tanh(1.4 * s) for s in out]


def hat(seconds: float = 0.05) -> Samples:
    n = int(seconds * SR)
    return [highpass(noise(n), 7000)[i] * math.exp(-i / (0.012 * SR)) for i in range(n)]


def soft_clip(b: Samples, drive: float = 1.0) -> Samples:
    return [math.tanh(drive * s) for s in b]


def normalize(b: Samples, peak: float = 0.89) -> Samples:
    m = max((abs(s) for s in b), default=1.0) or 1.0
    g = peak / m
    return [s * g for s in b]


def bell(freqs: list[float], seconds: float, decay_tc: float, inharm: float = 0.0) -> Samples:
    n = int(seconds * SR)
    out = [0.0] * n
    for j, f in enumerate(freqs):
        e = env_perc(n, 0.002, decay_tc * (1.0 - 0.1 * j))
        p = sine(f * (1 + inharm * j), n)
        for i in range(n):
            out[i] += p[i] * e[i] / (j + 1.4)
    return out


# --- stereo + reverb ------------------------------------------------------


def stereo(b: Samples, width: float = 0.0) -> Stereo:
    """Mono → stereo. width>0 applies a tiny Haas delay for gentle spread."""
    if width <= 0:
        return (list(b), list(b))
    d = int(width * 0.012 * SR)
    left = list(b)
    right = [0.0] * d + b[: len(b) - d] if d else list(b)
    return (left, right)


def reverb_stereo(b: Samples, decay: float = 0.5, mix_amt: float = 0.28) -> Stereo:
    """Schroeder plate: 4 combs + 2 allpass, slightly different per channel."""

    def comb(sig: Samples, delay: float, fb: float) -> Samples:
        d = int(delay * SR)
        out = [0.0] * (len(sig) + d)
        for i in range(len(sig)):
            out[i] += sig[i]
            out[i + d] += out[i] * fb
        return out

    def allpass(sig: Samples, delay: float, g: float) -> Samples:
        d = int(delay * SR)
        out = list(sig) + [0.0] * d
        for i in range(len(sig)):
            out[i + d] += -g * sig[i] + (1 - g * g) * out[i]
        return out

    def channel(tunings: list[tuple[float, float]]) -> Samples:
        acc: Samples = []
        for delay, fb in tunings:
            c = comb(b, delay, fb * decay)
            if len(c) > len(acc):
                acc.extend([0.0] * (len(c) - len(acc)))
            for i in range(len(c)):
                acc[i] += c[i] / len(tunings)
        acc = allpass(acc, 0.005, 0.7)
        acc = allpass(acc, 0.0017, 0.7)
        return acc

    left = channel([(0.0297, 0.78), (0.0371, 0.74), (0.0411, 0.70), (0.0437, 0.66)])
    right = channel([(0.0307, 0.78), (0.0367, 0.74), (0.0419, 0.70), (0.0443, 0.66)])
    n = max(len(left), len(right), len(b))
    left += [0.0] * (n - len(left))
    right += [0.0] * (n - len(right))
    dry = list(b) + [0.0] * (n - len(b))
    outl = [dry[i] + left[i] * mix_amt for i in range(n)]
    outr = [dry[i] + right[i] * mix_amt for i in range(n)]
    return (outl, outr)


def norm_stereo(s: Stereo, peak: float = 0.92) -> Stereo:
    m = max(max((abs(x) for x in s[0]), default=1.0), max((abs(x) for x in s[1]), default=1.0)) or 1.0
    g = peak / m
    return ([x * g for x in s[0]], [x * g for x in s[1]])


# --- the cues -------------------------------------------------------------


def c_ui_tap() -> Stereo:
    n = int(0.06 * SR)
    body = [sine(A5, n)[i] * env_perc(n, 0.001, 0.016)[i] for i in range(n)]
    click = [highpass(noise(n), 4500)[i] * env_perc(n, 0.0004, 0.004)[i] for i in range(n)]
    out = normalize([body[i] * 0.7 + click[i] * 0.3 for i in range(n)], 0.62)
    return stereo(out)


def c_ui_swipe() -> Stereo:
    n = int(0.19 * SR)
    air = lowpass(highpass(noise(n), 700), 3600)
    e = [math.sin(math.pi * i / n) ** 1.6 for i in range(n)]
    return norm_stereo(stereo([air[i] * e[i] for i in range(n)], width=0.8), 0.5)


def c_wheel_tick() -> Stereo:
    # Punchier ratchet: woody click + short pitched body so it cuts through.
    n = int(0.04 * SR)
    body = [sine(G5, n)[i] * env_perc(n, 0.0004, 0.007)[i] for i in range(n)]
    woody = [(sine(1600, n)[i] + 0.5 * sine(2400, n)[i]) * env_perc(n, 0.0003, 0.0035)[i]
             for i in range(n)]
    click = [highpass(noise(n), 5500)[i] * env_perc(n, 0.0002, 0.002)[i] for i in range(n)]
    out = normalize([body[i] * 0.5 + woody[i] * 0.5 + click[i] * 0.45 for i in range(n)], 0.78)
    return stereo(out)


def c_wheel_launch() -> Stereo:
    # Big excited whoosh: rising detuned lead + air sweep + a low swell.
    n = int(0.7 * SR)
    rise = sweep(C4 * 0.5, A5, n, curve=1.5)
    vib = [rise[i] * (1 + 0.05 * math.sin(2 * math.pi * 6.5 * i / SR)) for i in range(n)]
    air = lowpass(noise(n), 2600)
    sub = sweep(60, 120, n, curve=1.0)
    e = [min(1.0, i / (0.06 * SR)) * math.exp(-max(0, i - 0.5 * SR) / (0.13 * SR)) for i in range(n)]
    out = [(vib[i] * 0.7 + air[i] * 0.18 + sub[i] * 0.3) * e[i] for i in range(n)]
    return norm_stereo(stereo(soft_clip(out, 1.2), width=0.6), 0.85)


def c_result_chime() -> Stereo:
    # "Your option" — a clean resolved major bell with sparkle + plate tail.
    core = bell([C5, E5, G5, C6], 1.0, 0.32, inharm=0.0007)
    spark = bell([G6, E6], 0.45, 0.11)
    mix(core, spark, 0.0, 0.28)
    return norm_stereo(reverb_stereo(core, decay=0.55, mix_amt=0.3), 0.86)


def c_hoba_pop() -> Stereo:
    # Playful signature "boop" for the Hoba! word.
    n = int(0.13 * SR)
    blip = sweep(C5, C6 * 1.15, n, curve=0.5)
    out = [blip[i] * env_perc(n, 0.003, 0.04)[i] for i in range(n)]
    pop = [sine(C6, int(0.02 * SR))[i] * env_perc(int(0.02 * SR), 0.0005, 0.006)[i]
           for i in range(int(0.02 * SR))]
    mix(out, pop, 0.0, 0.4)
    return stereo(normalize(soft_clip(out, 1.3), 0.82), width=0.4)


def c_confetti_burst() -> Stereo:
    # Celebration layer: paper burst + scattered pentatonic sparkles.
    n = int(0.7 * SR)
    burst = [highpass(noise(n), 1600)[i] * env_perc(n, 0.002, 0.08)[i] for i in range(n)]
    out = [burst[i] * 0.45 for i in range(n)]
    pent = [C6, D6, E6, G6, A6]
    for _ in range(16):
        f = random.choice(pent)
        dur = random.uniform(0.05, 0.13)
        mix(out, pluck(f, dur, dur * 0.35), at=random.uniform(0.0, 0.5), gain=0.22)
    return norm_stereo(reverb_stereo(out, decay=0.4, mix_amt=0.22), 0.85)


def c_chaos_event() -> Stereo:
    # Glitchy chiptune wobble — playful, not creepy.
    n = int(0.6 * SR)
    out = [0.0] * n
    ph, f, hold, step = 0.0, 300.0, 0, int(0.045 * SR)
    for i in range(n):
        if hold <= 0:
            f = random.choice([196, 233, 294, 349, 440, 523, 622]) * random.choice([1, 1, 2])
            hold = step
        hold -= 1
        ph += 2 * math.pi * f / SR
        out[i] = 1.0 if math.sin(ph) > 0 else -1.0
    e = [min(1.0, i / (0.02 * SR)) * math.exp(-max(0, i - 0.3 * SR) / (0.15 * SR)) for i in range(n)]
    out = [out[i] * e[i] * (0.7 + 0.3 * math.sin(2 * math.pi * 18 * i / SR)) for i in range(n)]
    return norm_stereo(stereo(soft_clip(out, 1.1), width=0.7), 0.72)


def c_join_ping() -> Stereo:
    # Warm two-note ascending notification.
    out = buf(0.42)
    mix(out, pluck(G5, 0.2, 0.08), 0.0, 0.6)
    mix(out, bell([C6, E6], 0.32, 0.13), 0.12, 0.6)
    return norm_stereo(reverb_stereo(out, decay=0.35, mix_amt=0.2), 0.7)


def c_rigged_reveal() -> Stereo:
    # 🎭 suspense drone rising into a dramatic resolve hit.
    n = int(0.95 * SR)
    drone = sweep(C4 * 0.5, C4, n, curve=2.0)
    shimmer = [0.0] * n
    for f in (G4, C5, E5):
        p = sine(f, n)
        for i in range(n):
            shimmer[i] += p[i] * 0.12 * (i / n)
    swell = [min(1.0, i / (0.3 * SR)) for i in range(n)]
    pre = [(drone[i] * 0.5 + shimmer[i]) * swell[i] for i in range(n)]
    mix(pre, bell([C5, E5, G5, C6, E6], 0.9, 0.3, inharm=0.001), at=0.92, gain=1.0)
    return norm_stereo(reverb_stereo(soft_clip(pre, 1.1), decay=0.55, mix_amt=0.3), 0.86)


def c_winner_fanfare() -> Stereo:
    # The big one: ascending arp → triumphant chord stab + sub thump + sparkle.
    out = buf(2.2)
    # quick rising arpeggio lead-in
    for k, f in enumerate([C5, E5, G5, C6]):
        mix(out, [pluck(f, 0.16, 0.09)[i] for i in range(int(0.16 * SR))], at=0.05 + k * 0.07, gain=0.5)
    # triumphant chord stab (C major add9) with detuned unison body
    stab_n = int(1.4 * SR)
    chord = [0.0] * stab_n
    for f in (C5, E5, G5, C6, D6):
        u = unison(f, stab_n, voices=3, spread=0.007)
        e = env_adsr(stab_n, 0.006, 0.25, 0.55, 0.9, sustain=0.5)
        for i in range(stab_n):
            chord[i] += u[i] * e[i] / 5
    mix(out, chord, at=0.36, gain=0.7)
    # sub thump for impact
    sub_n = int(0.4 * SR)
    sub = [sweep(120, 55, sub_n, 0.4)[i] * env_perc(sub_n, 0.001, 0.1)[i] for i in range(sub_n)]
    mix(out, sub, at=0.36, gain=0.6)
    # sparkle tail
    for _ in range(10):
        mix(out, pluck(random.choice([C6, E6, G6, A6]), 0.12, 0.05),
            at=random.uniform(0.5, 1.6), gain=0.16)
    return norm_stereo(reverb_stereo(soft_clip(out, 1.15), decay=0.6, mix_amt=0.3), 0.95)


CUES: dict[str, Callable[[], Stereo]] = {
    "ui_tap": c_ui_tap,
    "ui_swipe": c_ui_swipe,
    "wheel_tick": c_wheel_tick,
    "wheel_launch": c_wheel_launch,
    "result_chime": c_result_chime,
    "hoba_pop": c_hoba_pop,
    "confetti_burst": c_confetti_burst,
    "chaos_event": c_chaos_event,
    "join_ping": c_join_ping,
    "rigged_reveal": c_rigged_reveal,
    "winner_fanfare": c_winner_fanfare,
}


def write_wav(path: Path, s: Stereo) -> None:
    left, right = s
    n = min(len(left), len(right))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for i in range(n):
            for ch in (left[i], right[i]):
                frames += struct.pack("<h", max(-32767, min(32767, int(ch * 32767))))
        w.writeframes(bytes(frames))


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    random.seed(7)
    # Optional CLI filter: `python3 scripts/generate_sounds.py bg_music ui_tap`
    # regenerates only the named cues (others left untouched).
    import sys
    only = set(sys.argv[1:])
    for name, fn in CUES.items():
        if only and name not in only:
            continue
        s = fn()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            wav_path = Path(tmp.name)
        write_wav(wav_path, s)
        bitrate = "112k"  # SFX stay tiny
        mp3_path = OUT_DIR / f"{name}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
             "-codec:a", "libmp3lame", "-b:a", bitrate, "-ar", str(SR), "-ac", "2",
             str(mp3_path)],
            check=True,
        )
        wav_path.unlink(missing_ok=True)
        dur = min(len(s[0]), len(s[1])) / SR
        print(f"  ✓ {name}.mp3  ({mp3_path.stat().st_size // 1024} KB, {dur:.2f}s)")
    print(f"Wrote {len(CUES)} sounds → {OUT_DIR}")


if __name__ == "__main__":
    main()
