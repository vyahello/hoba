import { animate, motion, useMotionValue } from "framer-motion";
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
const HUB_R = 44;
const POINTER_TIP_Y = 6;
const MAX_LABEL_CHARS = 12;
/** Decelerate phase begins at this fraction of total spin duration. */
const DECELERATE_START_FRACTION = 0.35;
const TICK_MIN_INTERVAL_MS = 1000 / 12;

function ellipsize(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
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
  const label = ellipsize(segment.label, MAX_LABEL_CHARS);

  return (
    <g>
      <path
        d={arcPath(CX, CY, SEGMENT_R, startDeg, endDeg)}
        fill={color}
        stroke="#FFFFFF"
        strokeWidth={1.5}
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
        fontWeight={700}
        fill="#FFFFFF"
        textAnchor="middle"
        dominantBaseline="central"
        transform={`rotate(${midDeg} ${labelPos.x} ${labelPos.y})`}
        style={{
          paintOrder: "stroke",
          stroke: "rgba(0,0,0,0.22)",
          strokeWidth: 2,
          userSelect: "none",
        }}
      >
        {label}
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
}

export interface WheelHandle {
  getCurrentRotation: () => number;
}

export const Wheel = forwardRef<WheelHandle, WheelProps>(function Wheel(
  { segments, state, spin, onSpinClick, ariaLabel, className },
  ref,
) {
  const { t } = useTranslation("common");
  const rotation = useMotionValue(0);
  const tickWatchActive = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      getCurrentRotation: (): number => rotation.get(),
    }),
    [rotation],
  );

  // Drive the spin animation imperatively. Effect dep keys identify the
  // spin uniquely (`seed`) so re-renders mid-spin don't re-trigger.
  useEffect(() => {
    if (state !== "spinning" || spin === undefined) return undefined;
    const spinResult = spin;
    audio.play("wheel_launch");

    const controls = animate(rotation, spinResult.finalAngleDeg, {
      duration: spinResult.durationMs / 1000,
      ease: [0.15, 0.85, 0.25, 1],
    });

    const decelerateStartMs = spinResult.durationMs * DECELERATE_START_FRACTION;
    const endMs = spinResult.durationMs + 80;
    const startMonoTime = performance.now();
    const segmentCount = segments.length;
    let lastSector = segmentUnderPointer(rotation.get(), segmentCount);
    let lastTickAt = 0;
    tickWatchActive.current = true;

    function tick(): void {
      if (!tickWatchActive.current) return;
      const elapsed = performance.now() - startMonoTime;
      if (elapsed < decelerateStartMs) {
        requestAnimationFrame(tick);
        return;
      }
      const currentSector = segmentUnderPointer(rotation.get(), segmentCount);
      if (currentSector !== lastSector) {
        const now = performance.now();
        if (now - lastTickAt >= TICK_MIN_INTERVAL_MS) {
          haptics.light();
          audio.play("wheel_tick");
          lastTickAt = now;
        }
        lastSector = currentSector;
      }
      if (elapsed < endMs) {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);

    return () => {
      tickWatchActive.current = false;
      controls.stop();
    };
  }, [state, spin, rotation, segments.length]);

  const segmentCount = segments.length;
  const canSpin = isHubInteractive({
    state,
    segmentCount,
    hasHandler: onSpinClick !== undefined,
  });

  return (
    <div className={cn("relative w-full aspect-square", className)}>
      <svg
        viewBox="0 0 400 400"
        role="img"
        aria-label={ariaLabel}
        className="w-full h-full"
      >
        <defs>
          <radialGradient id="hoba-hub-grad" cx="50%" cy="38%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="55%" stopColor="#F4F2FB" />
            <stop offset="100%" stopColor="#B8B2D6" />
          </radialGradient>
          <radialGradient id="hoba-inner-grad" cx="50%" cy="40%">
            <stop offset="80%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.18)" />
          </radialGradient>
        </defs>

        {/* Outer ring + soft glow rendered as three stacked strokes instead
            of feGaussianBlur. iOS Safari on A11-class chips (iPhone X / iOS
            16) falls off the GPU path for SVG filters and rasterizes them
            on the CPU every frame the parent layer repaints — which is
            every frame of the spin. Stacked strokes are pure compositor
            ops and stay smooth on the same hardware. */}
        <circle
          cx={CX}
          cy={CY}
          r={OUTER_R}
          fill="none"
          stroke="#7C5CFF"
          strokeWidth={18}
          opacity={0.12}
        />
        <circle
          cx={CX}
          cy={CY}
          r={OUTER_R}
          fill="none"
          stroke="#7C5CFF"
          strokeWidth={12}
          opacity={0.22}
        />
        <circle
          cx={CX}
          cy={CY}
          r={OUTER_R}
          fill="none"
          stroke="#7C5CFF"
          strokeWidth={6}
          opacity={0.85}
        />

        <motion.g
          style={{
            rotate: rotation,
            transformOrigin: `${CX}px ${CY}px`,
          }}
        >
          <circle cx={CX} cy={CY} r={SEGMENT_R} fill="#FFFFFF" />
          {segments.map((s, i) => (
            <SegmentVisual key={s.id} segment={s} index={i} total={segmentCount} />
          ))}
          <circle
            cx={CX}
            cy={CY}
            r={SEGMENT_R}
            fill="url(#hoba-inner-grad)"
            pointerEvents="none"
          />
        </motion.g>

        <g style={{ transformOrigin: `${CX}px ${POINTER_TIP_Y}px` }}>
          <path
            d={`M ${CX} ${POINTER_TIP_Y + 32} L ${CX + 16} ${POINTER_TIP_Y} L ${CX - 16} ${POINTER_TIP_Y} Z`}
            fill="#5B3DF5"
            stroke="#FFFFFF"
            strokeWidth={2}
          />
        </g>

        <g
          onClick={canSpin ? onSpinClick : undefined}
          style={{ cursor: canSpin ? "pointer" : "default" }}
          className={canSpin ? "animate-spinner-breath" : undefined}
          aria-hidden={!canSpin}
        >
          <circle
            cx={CX}
            cy={CY}
            r={HUB_R}
            fill="url(#hoba-hub-grad)"
            stroke="#7C5CFF"
            strokeWidth={3}
          />
          {canSpin ? (
            <text
              x={CX}
              y={CY + 6}
              fontSize={18}
              fontWeight={800}
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
    </div>
  );
});
