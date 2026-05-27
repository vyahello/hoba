import { type WheelState } from "./types";

export interface HubInteractivityInput {
  state: WheelState;
  segmentCount: number;
  hasHandler: boolean;
}

/**
 * Whether the wheel's hub button (centered "SPIN" target) should respond
 * to taps. Stays alive across the idle → spinning → settled cycle so a
 * single tap from anywhere re-spins; goes dead during the animation and
 * whenever no click handler is wired (guests in host_only rooms).
 */
export function isHubInteractive(input: HubInteractivityInput): boolean {
  if (!input.hasHandler) return false;
  if (input.segmentCount < 2) return false;
  return input.state === "idle" || input.state === "settled";
}
