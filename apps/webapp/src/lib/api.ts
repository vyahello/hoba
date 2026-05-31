/**
 * Typed fetch wrapper for the `/api/v1/*` REST surface.
 *
 * Every request carries `X-Telegram-Init-Data` so the server can
 * HMAC-validate the caller. Phase 6 wires only the `/rooms` endpoints
 * — the helpers grow as later phases add endpoints.
 */

import WebApp from "@twa-dev/sdk";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(`API ${statusCode}: ${code}`);
  }
}

interface FetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

async function request<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const initData = WebApp.initData || "";
  const response = await fetch(`/api/v1${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!response.ok) {
    let code = `http_${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail !== undefined) code = body.detail;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(response.status, code);
  }
  return response.json() as Promise<T>;
}

// --- Shared types (mirror `apps/api/src/hoba_api/schemas/room.py`) -------

export type GameMode =
  | "classic"
  | "elimination"
  | "punishment"
  | "chaos"
  | "rigged";
export type PunishmentDeck = "mild" | "spicy" | "chaos";
export type SpinPolicy = "host_only" | "anyone" | "turn_based";
export type SuggestionPolicy = "off" | "approval" | "free";
export type RoomStatus = "lobby" | "active" | "closed";
export type ParticipantRole = "host" | "guest";

/** The dare card dealt when a spin misses the spinner's bet. */
export interface PunishmentCard {
  text: string;
  deck: PunishmentDeck;
  card_index: number;
}

/** Result of one spin in Punishment v3, broadcast to ALL players. */
export interface PunishmentOutcome {
  spinner_id: number;
  result_segment_id: number;
  kind: "lucky" | "punish";
  card: PunishmentCard | null;
  /** False while a `punish` card is pending the spinner's done/refuse. */
  resolved: boolean;
  /** True after spinner presses "Done" — awaiting approver confirmation. */
  pending_approval?: boolean;
  /** The user_id of the randomly-chosen approver (only set when pending_approval). */
  approver_user_id?: number | null;
}

export interface ServerSegment {
  id: number;
  label: string;
  emoji: string | null;
  color_seed: number;
  weight: number;
  position: number;
  is_eliminated: boolean;
}

export interface ServerQuestion {
  id: number;
  text: string;
  is_active: boolean;
  segments: ServerSegment[];
}

export interface ServerParticipant {
  user_id: number;
  role: ParticipantRole;
  display_name: string | null;
  joined_at: string;
  last_seen_at: string;
}

export interface ServerSpin {
  id: number;
  question_id: number;
  triggered_by: number;
  result_segment_id: number;
  final_angle_deg: number;
  duration_ms: number;
  seed: number;
  started_at: string;
  settled_at: string | null;
}

export interface ServerRoom {
  id: number;
  code: string;
  host_id: number;
  title: string | null;
  status: RoomStatus;
  game_mode: GameMode;
  spin_policy: SpinPolicy;
  suggestion_policy: SuggestionPolicy;
  is_locked: boolean;
  is_anonymous: boolean;
  current_turn_user_id: number | null;
  punishment_deck: PunishmentDeck | null;
  punishment_done_count: number;
  punishment_done_counts?: Record<string, number> | null;
  punishment_unique_bets?: boolean;
  // Punishment v3 (turn-based personal-bet race). All PUBLIC (anti-cheat).
  punishment_bets: Record<string, number> | null;
  punishment_match_counts: Record<string, number> | null;
  punishment_winner_user_id: number | null;
  punishment_last_outcome: PunishmentOutcome | null;
  spin_count: number;
  bon_attempts: number;
  bon_tally: Record<string, number> | null;
  bon_winner_segment_id: number | null;
  /**
   * Rigged Mode 🎭 — true once the host reveals (un-redacts mode + weights).
   * Optional on the client type so older fixtures/payloads stay valid; the
   * server always sends it. Consumers default with `?? false`.
   */
  rigged_revealed?: boolean;
  /** Spins taken while rigged (0 for non-host viewers until the reveal). */
  rigged_spin_count?: number;
  created_at: string;
  closed_at: string | null;
}

export interface RoomState {
  room: ServerRoom;
  participants: ServerParticipant[];
  active_question: ServerQuestion | null;
  last_spin: ServerSpin | null;
  /**
   * Internal user_id of the caller. Use this — not
   * `tg.initDataUnsafe.user.id` (which is the Telegram tg_id, a
   * different number space) — when comparing against
   * `participants[*].user_id` to figure out host vs guest.
   */
  me_user_id: number;
}

export interface RoomCreatePayload {
  question_text: string;
  segments: Array<{
    label: string;
    emoji?: string | null;
    color_seed?: number;
    weight?: number;
  }>;
  title?: string;
  spin_policy?: SpinPolicy;
  suggestion_policy?: SuggestionPolicy;
  game_mode?: GameMode;
  punishment_deck?: PunishmentDeck;
  spin_count?: number;
}

export interface RoomPatchPayload {
  title?: string;
  spin_policy?: SpinPolicy;
  suggestion_policy?: SuggestionPolicy;
  is_locked?: boolean;
  game_mode?: GameMode;
  punishment_deck?: PunishmentDeck;
  spin_count?: number;
}

// --- API surface ---------------------------------------------------------

export const api = {
  createRoom: (payload: RoomCreatePayload): Promise<RoomState> =>
    request("/rooms", { method: "POST", body: payload }),

  getRoom: (code: string): Promise<RoomState> =>
    request(`/rooms/${encodeURIComponent(code)}`),

  patchRoom: (code: string, patch: RoomPatchPayload): Promise<RoomState> =>
    request(`/rooms/${encodeURIComponent(code)}`, { method: "PATCH", body: patch }),

  /** Rigged Mode 🎭 (host only): set secret per-segment weights `{segId: 0..100}`. */
  setRig: (code: string, weights: Record<number, number>): Promise<RoomState> =>
    request(`/rooms/${encodeURIComponent(code)}/rig`, { method: "PATCH", body: { weights } }),

  /** Rigged Mode 🎭 (host only): reveal the rig — un-redacts for everyone. */
  revealRig: (code: string): Promise<RoomState> =>
    request(`/rooms/${encodeURIComponent(code)}/reveal`, { method: "POST" }),

  closeRoom: (code: string): Promise<RoomState> =>
    request(`/rooms/${encodeURIComponent(code)}/close`, { method: "POST" }),

  listSpins: (code: string, limit = 50): Promise<ServerSpin[]> =>
    request(`/rooms/${encodeURIComponent(code)}/spins?limit=${limit}`),

  patchMe: (patch: Record<string, unknown>): Promise<unknown> =>
    request("/me", { method: "PATCH", body: patch }),
};
