/**
 * Domain types for the Wheel feature.
 *
 * `WheelDef` is what the editor produces and the SpinPage consumes.
 * `SpinResult` describes a single resolved spin — deterministic given
 * `{seed, segmentCount, winningIndex}`. Server-authoritative in
 * multiplayer (Phase 6+); locally generated for solo (Phase 5).
 */

export interface SegmentDef {
  id: string;
  label: string;
  emoji?: string;
  /** 0–11 — picks from the deterministic wheel palette in tailwind.config. */
  colorSeed: number;
  /** Relative weight for Rigged Mode; defaults to 1 (uniform). */
  weight?: number;
}

export interface WheelDef {
  id: string;
  /** 'quick' = built-in F2 preset; 'custom' = user-built via CreatePage. */
  source: "quick" | "custom" | "saved";
  questionText: string;
  segments: SegmentDef[];
}

export interface SpinResult {
  resultSegmentIndex: number;
  finalAngleDeg: number;
  durationMs: number;
  seed: number;
  /**
   * Optional cubic-bezier easing override `[x1,y1,x2,y2]`. Defaults to the
   * wheel's fast-whip curve. Chaos `slow_burn` passes a gentle ease-in-out so
   * the wheel starts slow instead of flinging.
   */
  ease?: [number, number, number, number];
}

export type WheelState = "idle" | "spinning" | "settled";
