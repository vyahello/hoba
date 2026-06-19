import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";

import { audio } from "@/audio";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";

import { isHubInteractive } from "./hubLogic";
import { segmentUnderPointer } from "./spinMath";
import { type SegmentDef, type SpinResult, type WheelState } from "./types";
import { WHEEL_PALETTE } from "../../../tailwind.config";

const CX = 200;
const CY = 200;
const OUTER_R = 195;
const SEGMENT_R = 180;
const HUB_R = 54;
const POINTER_TIP_Y = 4;
const MAX_LABEL_CHARS = 12;
/** Decelerate phase begins at this fraction of total spin duration. */
const DECELERATE_START_FRACTION = 0.35;
const TICK_MIN_INTERVAL_MS = 1000 / 12;
const INK = "#14101F";
/** Default spin easing (ease-out-ish) when a SpinResult carries none. */
const DEFAULT_EASE: readonly [number, number, number, number] = [0.15, 0.85, 0.25, 1];

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Cubic-bezier timing function → `t ∈ [0,1]` to eased progress. Replaces the
 * framer easing so the whole wheel runs on ONE hand-managed rAF (no second
 * animation system, no extra rAF). Newton-Raphson solve, good enough for 60fps.
 */
function cubicBezier(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): (t: number) => number {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const x2 = sampleX(t) - x;
      const d = sampleDX(t);
      if (Math.abs(x2) < 1e-4 || d === 0) break;
      t -= x2 / d;
    }
    return sampleY(t);
  };
}

const easeInOut = cubicBezier(0.42, 0, 0.58, 1);

function makeEase(
  ease: SpinResult["ease"],
): (t: number) => number {
  const tuple = Array.isArray(ease) && ease.length === 4 ? ease : DEFAULT_EASE;
  return cubicBezier(tuple[0], tuple[1], tuple[2], tuple[3]);
}

function ellipsize(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Split a segment label into up to two lines so long multi-word labels
 * (e.g. "Наступного разу") wrap instead of truncating. Single long words
 * (no spaces) still ellipsize.
 */
function wrapLabel(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const words = s.split(" ");
  if (words.length === 1) return [ellipsize(s, max)];
  let first = "";
  let second = "";
  for (const w of words) {
    if (second === "" && (first === "" || `${first} ${w}`.length <= max)) {
      first = first === "" ? w : `${first} ${w}`;
    } else {
      second = second === "" ? w : `${second} ${w}`;
    }
  }
  if (second === "") return [ellipsize(first, max)];
  return [ellipsize(first, max), ellipsize(second, max)];
}

function polarToCart(
  cx: number,
  cy: number,
  r: number,
  deg: number,
): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polarToCart(cx, cy, r, startDeg);
  const end = polarToCart(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

interface SegmentVisualProps {
  segment: SegmentDef;
  index: number;
  total: number;
}

function SegmentVisual({ segment, index, total }: SegmentVisualProps): JSX.Element {
  const sectorDeg = 360 / total;
  const startDeg = index * sectorDeg;
  const endDeg = startDeg + sectorDeg;
  const midDeg = startDeg + sectorDeg / 2;
  const color = WHEEL_PALETTE[segment.colorSeed % WHEEL_PALETTE.length] ?? "#7C5CFF";

  const labelR = segment.emoji !== undefined ? SEGMENT_R * 0.7 : SEGMENT_R * 0.6;
  const labelPos = polarToCart(CX, CY, labelR, midDeg);
  const emojiPos = polarToCart(CX, CY, SEGMENT_R * 0.42, midDeg);
  const labelLines = wrapLabel(segment.label, MAX_LABEL_CHARS);

  return (
    <g>
      {/* Bold ink separators between wedges — the neubrutalist signature. */}
      <path
        d={arcPath(CX, CY, SEGMENT_R, startDeg, endDeg)}
        fill={color}
        stroke={INK}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {segment.emoji !== undefined ? (
        <text
          x={emojiPos.x}
          y={emojiPos.y}
          fontSize={26}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ userSelect: "none" }}
        >
          {segment.emoji}
        </text>
      ) : null}
      <text
        x={labelPos.x}
        y={labelPos.y}
        fontSize={14}
        fontWeight={800}
        fill="#FFFFFF"
        textAnchor="middle"
        dominantBaseline="central"
        transform={`rotate(${midDeg} ${labelPos.x} ${labelPos.y})`}
        style={{
          paintOrder: "stroke",
          stroke: INK,
          strokeWidth: 3,
          userSelect: "none",
        }}
      >
        {labelLines.map((line, i) => (
          <tspan
            key={line}
            x={labelPos.x}
            dy={labelLines.length === 1 ? 0 : i === 0 ? "-0.55em" : "1.1em"}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

export interface WheelProps {
  segments: SegmentDef[];
  state: WheelState;
  /** When `state === 'spinning'`, drives the animation. */
  spin?: SpinResult;
  /** Called when the user taps the hub. Only fires when state === 'idle'. */
  onSpinClick?: () => void;
  ariaLabel: string;
  className?: string;
  /**
   * Screen angle (deg, clockwise from top) to draw the pointer at. Default 0
   * = the usual top position. Chaos `blind_pointer` reveals it elsewhere.
   */
  pointerDeg?: number;
  /** Hide the pointer entirely (Chaos `blind_pointer` while spinning). */
  pointerHidden?: boolean;
  /**
   * Hidden host gesture (Rigged Mode 🎭, spec §5.5): fires after a ~1.5 s
   * press-and-hold on the hub. When provided, the hub also supports long-press;
   * the press that triggers it does NOT also fire `onSpinClick`.
   */
  onHubLongPress?: () => void;
  /**
   * Segment id to flash-highlight once the wheel settles — the visual "this
   * one landed!" cue for modes without a per-spin result overlay (Chaos,
   * Punishment). Undefined = no highlight.
   */
  highlightSegmentId?: string;
}

export interface WheelHandle {
  getCurrentRotation: () => number;
  /** Animate the pointer through a sequence of screen angles (Chaos
   * `roaming_pointer`). Resolves when the last hop finishes. */
  roamPointer: (hops: { deg: number; ms: number }[]) => Promise<void>;
}

export const Wheel = forwardRef<WheelHandle, WheelProps>(function Wheel(
  {
    segments,
    state,
    spin,
    onSpinClick,
    ariaLabel,
    className,
    pointerDeg = 0,
    pointerHidden = false,
    highlightSegmentId,
    onHubLongPress,
  },
  ref,
) {
  const { t } = useTranslation("common");
  const wheelGroupRef = useRef<SVGGElement>(null);
  const pointerGroupRef = useRef<SVGGElement>(null);

  // Rotation + pointer angle are driven IMPERATIVELY via refs + setAttribute —
  // never React state — so a spin causes ZERO re-renders per frame.
  const rotationRef = useRef(0);
  const pointerAngleRef = useRef(pointerDeg);

  // The ONE rAF handle for this component. Only ever one loop runs (a spin OR
  // a pointer roam — never both); it is always cancelled on settle, on
  // visibility-hidden/blur, and on unmount. Nothing loops while idle.
  const rafRef = useRef<number | null>(null);
  const spinningRef = useRef(false);

  const longPressTimer = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  const setWheelRotation = (deg: number): void => {
    rotationRef.current = deg;
    wheelGroupRef.current?.setAttribute("transform", `rotate(${deg} ${CX} ${CY})`);
  };
  const setPointerAngle = (deg: number): void => {
    pointerAngleRef.current = deg;
    pointerGroupRef.current?.setAttribute("transform", `rotate(${deg} ${CX} ${CY})`);
  };
  const cancelRaf = (): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  // Keep the pointer at the prop angle (top by default; the result-segment
  // centre for Chaos `blind_pointer`). Imperative, no loop. Re-applied per
  // spin so a previous roam doesn't leave it stuck.
  useEffect(() => {
    setPointerAngle(pointerDeg);
  }, [pointerDeg, spin?.seed]);

  useImperativeHandle(
    ref,
    () => ({
      getCurrentRotation: (): number => rotationRef.current,
      roamPointer: (hops): Promise<void> =>
        new Promise<void>((resolve) => {
          cancelRaf();
          if (hops.length === 0) {
            resolve();
            return;
          }
          // Reduced motion / backgrounded: snap to the final hop, no loop.
          const lastHop = hops[hops.length - 1];
          if ((prefersReducedMotion() || document.hidden) && lastHop) {
            setPointerAngle(lastHop.deg);
            resolve();
            return;
          }
          let i = 0;
          let from = pointerAngleRef.current;
          let segStart = performance.now();
          const step = (now: number): void => {
            const hop = hops[i];
            if (hop === undefined) {
              rafRef.current = null;
              resolve();
              return;
            }
            const tt = hop.ms > 0 ? Math.min((now - segStart) / hop.ms, 1) : 1;
            setPointerAngle(from + (hop.deg - from) * easeInOut(tt));
            if (tt >= 1) {
              from = hop.deg;
              i += 1;
              segStart = now;
            }
            if (i >= hops.length) {
              rafRef.current = null;
              resolve();
              return;
            }
            rafRef.current = requestAnimationFrame(step);
          };
          rafRef.current = requestAnimationFrame(step);
        }),
    }),
    [],
  );

  // The spin: ONE rAF loop. Drives the wheel transform + the decel tick
  // sound/haptic from a single frame callback. Cancelled the instant the spin
  // settles, paused while the document is hidden / the window loses focus
  // (resumes from wall-clock so it never spins in the background), and snaps
  // immediately under prefers-reduced-motion. Keyed on the spin identity so a
  // re-render mid-spin doesn't restart it.
  useEffect(() => {
    if (state !== "spinning" || spin === undefined) return undefined;

    audio.play("wheel_launch");

    const startDeg = rotationRef.current;
    const targetDeg = spin.finalAngleDeg;
    const duration = spin.durationMs;
    const ease = makeEase(spin.ease);
    const segmentCount = segments.length;
    const decelMs = duration * DECELERATE_START_FRACTION;
    const startMono = performance.now();
    let lastSector = segmentUnderPointer(startDeg, segmentCount);
    let lastTickAt = 0;
    spinningRef.current = true;

    // prefers-reduced-motion → snap straight to the result, no animation loop.
    if (prefersReducedMotion()) {
      setWheelRotation(targetDeg);
      spinningRef.current = false;
      return () => {
        spinningRef.current = false;
      };
    }

    const frame = (now: number): void => {
      const elapsed = now - startMono;
      const tt = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
      const deg = startDeg + (targetDeg - startDeg) * ease(tt);
      setWheelRotation(deg);

      if (elapsed >= decelMs) {
        const sector = segmentUnderPointer(deg, segmentCount);
        if (sector !== lastSector && now - lastTickAt >= TICK_MIN_INTERVAL_MS) {
          haptics.light();
          audio.play("wheel_tick");
          lastTickAt = now;
        }
        lastSector = sector;
      }

      if (tt >= 1) {
        setWheelRotation(targetDeg); // land exactly on the result
        spinningRef.current = false;
        rafRef.current = null;
        return;
      }
      // Don't schedule while hidden — the visibility handler resumes us.
      rafRef.current = document.hidden ? null : requestAnimationFrame(frame);
    };

    const pause = (): void => {
      cancelRaf();
    };
    const resume = (): void => {
      if (spinningRef.current && rafRef.current === null && !document.hidden) {
        rafRef.current = requestAnimationFrame(frame);
      }
    };
    const onVisibility = (): void => {
      if (document.hidden) pause();
      else resume();
    };

    rafRef.current = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", pause);
    window.addEventListener("focus", resume);

    return () => {
      cancelRaf();
      spinningRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", pause);
      window.removeEventListener("focus", resume);
    };
  }, [state, spin?.seed]);

  // Belt-and-suspenders: cancel any loop if the component unmounts mid-spin.
  useEffect(() => () => cancelRaf(), []);

  const segmentCount = segments.length;
  const highlightIndex =
    highlightSegmentId !== undefined
      ? segments.findIndex((s) => s.id === highlightSegmentId)
      : -1;
  const canSpin = isHubInteractive({
    state,
    segmentCount,
    hasHandler: onSpinClick !== undefined,
  });

  return (
    <div
      className={cn("relative w-full aspect-square select-none", className)}
      style={{ WebkitTouchCallout: "none" }}
    >
      <svg viewBox="0 0 400 400" role="img" aria-label={ariaLabel} className="w-full h-full">
        {/* Static hard offset shadow (neubrutalist) — a solid ink disc behind
            the rim, never animated. Gives the round wheel its "lifted" look
            without a blurred box-shadow. */}
        <circle cx={CX + 5} cy={CY + 7} r={OUTER_R} fill={INK} opacity={0.92} />

        {/* Static rim: thick ink ring + accent inner ring. Does NOT rotate. */}
        <circle cx={CX} cy={CY} r={OUTER_R} fill="#FFFFFF" stroke={INK} strokeWidth={6} />
        <circle cx={CX} cy={CY} r={OUTER_R - 7} fill="none" stroke="#FFB84D" strokeWidth={6} />

        {/* The rotating face — transform driven imperatively by the rAF loop. */}
        <g ref={wheelGroupRef}>
          <circle cx={CX} cy={CY} r={SEGMENT_R} fill="#FFFFFF" />
          {segments.map((s, i) => (
            <SegmentVisual key={s.id} segment={s} index={i} total={segmentCount} />
          ))}
          <circle cx={CX} cy={CY} r={SEGMENT_R} fill="none" stroke={INK} strokeWidth={3} />
          {/* Landed-segment highlight: a STATIC bright overlay on the winning
              wedge (no pulse loop) — the "this one!" cue for modes without a
              per-spin overlay (Chaos, Punishment). Rotates with the wheel. */}
          {state === "settled" && highlightIndex >= 0 ? (
            <path
              d={arcPath(
                CX,
                CY,
                SEGMENT_R,
                highlightIndex * (360 / segmentCount),
                highlightIndex * (360 / segmentCount) + 360 / segmentCount,
              )}
              fill="#FFFFFF"
              fillOpacity={0.45}
              stroke="#FFFFFF"
              strokeWidth={3}
              strokeLinejoin="round"
              pointerEvents="none"
            />
          ) : null}
        </g>

        {/* Pointer. Normally fixed at the top; Chaos blind/roaming pointer move
            it (set imperatively). */}
        {pointerHidden ? null : (
          <g ref={pointerGroupRef}>
            <path
              d={`M ${CX} ${POINTER_TIP_Y + 36} L ${CX + 18} ${POINTER_TIP_Y} L ${CX - 18} ${POINTER_TIP_Y} Z`}
              fill="#FF5C9C"
              stroke={INK}
              strokeWidth={3}
              strokeLinejoin="round"
            />
          </g>
        )}

        {/* Hub — flat fill + thick ink border (no gradient, no idle breathing
            loop). The real, focusable control is the HTML button below. */}
        <g aria-hidden>
          <circle cx={CX} cy={CY} r={HUB_R} fill="#FFFFFF" stroke={INK} strokeWidth={4} />
          {canSpin ? (
            <text
              x={CX}
              y={CY + 5}
              fontSize={15}
              fontWeight={800}
              letterSpacing={-0.5}
              fill="#5B3DF5"
              textAnchor="middle"
              fontFamily="Manrope, sans-serif"
              style={{ userSelect: "none" }}
            >
              {t("actions.spin").toUpperCase()}
            </text>
          ) : null}
        </g>
      </svg>

      {/* The actual spin control: a real, focusable, screen-reader-announced
          button overlaid on the hub. */}
      {canSpin ? (
        <button
          type="button"
          onClick={() => {
            if (longPressedRef.current) {
              longPressedRef.current = false;
              return;
            }
            onSpinClick?.();
          }}
          onPointerDown={() => {
            if (onHubLongPress === undefined) return;
            longPressedRef.current = false;
            longPressTimer.current = window.setTimeout(() => {
              longPressedRef.current = true;
              haptics.heavy();
              onHubLongPress();
            }, 1500);
          }}
          onPointerUp={() => {
            if (longPressTimer.current !== null) {
              window.clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
          }}
          onPointerLeave={() => {
            if (longPressTimer.current !== null) {
              window.clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
          }}
          aria-label={t("actions.spin")}
          style={{ WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
          className={cn(
            "absolute left-1/2 top-1/2 h-[27%] w-[27%]",
            "-translate-x-1/2 -translate-y-1/2 rounded-full",
            "select-none touch-manipulation",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/70",
          )}
        />
      ) : null}
    </div>
  );
});
