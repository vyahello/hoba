/**
 * Realtime room state — Phase 6.
 *
 * One Socket.IO connection per app lifetime, lazily created on first
 * `joinRoom`. Inbound events update Zustand state; React components
 * read snapshots via selectors.
 *
 * The store also owns the auto-dismiss timeline for flying reactions:
 * each one lives ~2.2s before it's pulled from the queue.
 */

import WebApp from "@twa-dev/sdk";
import { type Socket, io } from "socket.io-client";
import { create } from "zustand";

import { reactionLaneFor } from "@/features/rooms/reactionLanes";
import {
  api,
  type PunishmentOutcome,
  type RoomState as ServerRoomState,
} from "@/lib/api";

const NAMESPACE = "/rooms";
const REACTION_TTL_MS = 2200;

/** Chaos mode (§5.4) per-spin effects, folded into `spin:started`. */
export interface SpinModeEffects {
  /** One of: multi_spin | slow_burn | reverse | swap | nudge_fwd | nudge_back. */
  chaos_event?: string;
  /** Swap event only: segment ids in the order to render this spin. */
  segment_order?: number[];
  /** Swap event only: the two segment ids that traded places. */
  swap_pair?: number[];
  /** multi_spin only: how many short fast spins to fire (last one counts). */
  spin_reps?: number;
  /** nudge_* only: the pre-nudge stop angle (wheel settles here, then creeps). */
  nudge_from_angle?: number;
  /** blind_pointer only: screen angle (deg) the pointer reappears at on stop. */
  pointer_deg?: number;
  dramatic?: boolean;
}

export interface SpinStartedEvent {
  spin_id: number;
  question_id: number;
  triggered_by: number;
  result_segment_id: number;
  final_angle_deg: number;
  duration_ms: number;
  seed: number;
  started_at_server: string;
  mode_effects?: SpinModeEffects;
}

export interface SpinSettledEvent {
  spin_id: number;
  result_segment_id: number;
  mode_aftereffects?: {
    eliminated_segment_id?: number;
    remaining?: number;
    round_over?: boolean;
    survivor_segment_id?: number | null;
    punishment_outcome?: PunishmentOutcome;
  };
}

export interface FlyingReaction {
  id: string;
  emoji: string;
  user_id: number;
  at: string;
  /** Random horizontal anchor `[0, 1)`. Pinned at creation to keep render stable. */
  x: number;
}

interface RoomStore {
  connected: boolean;
  joinedCode: string | null;
  snapshot: ServerRoomState | null;
  currentSpin: SpinStartedEvent | null;
  spinSettled: SpinSettledEvent | null;
  /** Last error code received from the server (e.g. `not_allowed_to_spin`). */
  lastError: string | null;
  /**
   * Set when the room ends from under this client — `"kicked"` (host removed
   * me) or `"closed"` (host closed the room). RoomPage watches this and
   * navigates home with a toast, then calls `clearEnded()`.
   */
  endedReason: "kicked" | "closed" | null;
  reactions: FlyingReaction[];

  joinRoom(code: string): void;
  leaveRoom(): void;
  /**
   * Trigger a spin. `force: true` is the host "Spin anyway" path in
   * Punishment mode — spin before every present player has locked a guess.
   */
  triggerSpin(force?: boolean): void;
  sendReaction(emoji: string): void;
  resetSpinState(): void;
  /**
   * Replace the snapshot with a fresh one fetched via REST (e.g. after a
   * host-only PATCH /api/v1/rooms/{code}). Until the server broadcasts
   * room:updated, this is how the calling client refreshes its view.
   */
  setSnapshot(state: ServerRoomState): void;
  /** Emit round:reset to the server (host-only, Elimination mode). */
  resetRound(): void;
  /** Place (or change) this player's bet before the game starts. */
  placeBet(segmentId: number): void;
  /** The punished player performs (refuse=false) or refuses (refuse=true, -1). */
  resolvePunishment(refuse: boolean): void;
  /** The chosen approver confirms the punished player did their dare. */
  approvePunishment(): void;
  /** The chosen approver rejects the dare — the player must do it again. */
  rejectPunishment(): void;
  /** Emit bon:reset (host) to start a new best-of-N round. */
  bestOfNReset(): void;
  /** Acknowledge an `endedReason` after RoomPage has navigated away. */
  clearEnded(): void;
}

// --- Pure reducers (exported for unit testing) ---------------------------

export function applyEliminated(
  snap: ServerRoomState,
  eliminatedSegmentId: number,
): ServerRoomState {
  if (snap.active_question === null) return snap;
  return {
    ...snap,
    active_question: {
      ...snap.active_question,
      segments: snap.active_question.segments.map((s) =>
        s.id === eliminatedSegmentId ? { ...s, is_eliminated: true } : s,
      ),
    },
  };
}

export function reviveAllSegments(snap: ServerRoomState): ServerRoomState {
  if (snap.active_question === null) return snap;
  if (snap.active_question.segments.every((s) => !s.is_eliminated)) return snap;
  return {
    ...snap,
    active_question: {
      ...snap.active_question,
      segments: snap.active_question.segments.map((s) =>
        s.is_eliminated ? { ...s, is_eliminated: false } : s,
      ),
    },
  };
}

// -------------------------------------------------------------------------

let socket: Socket | null = null;

function ensureSocket(): Socket {
  if (socket !== null) return socket;
  socket = io(NAMESPACE, {
    auth: { initData: WebApp.initData ?? "" },
    autoConnect: true,
  });
  wireListeners(socket);
  return socket;
}

function wireListeners(s: Socket): void {
  const setState = useRoomStore.setState;
  const getState = useRoomStore.getState;

  s.on("connect", () => {
    setState({ connected: true, lastError: null });
  });
  s.on("disconnect", () => {
    setState({ connected: false });
  });
  s.on("connect_error", (err: Error) => {
    setState({ lastError: err.message });
  });

  s.on("error", (payload: { code: string }) => {
    setState({ lastError: payload?.code ?? "unknown" });
  });

  s.on("room:state", (state: ServerRoomState) => {
    setState({ snapshot: state });
  });

  s.on("room:updated", (payload: { patch: Partial<ServerRoomState["room"]> }) => {
    // Server broadcasts this on a successful PATCH /api/v1/rooms/{code}.
    // Each connected client merges the patch into its local snapshot.room
    // so the UI stays in sync without a reconnect — e.g. spin_policy
    // flipping from "anyone" to "host_only" needs to hide the SPIN button
    // for guests immediately.
    const snap = getState().snapshot;
    if (snap === null) return;
    setState({
      snapshot: {
        ...snap,
        room: { ...snap.room, ...payload.patch },
      },
    });
  });

  s.on(
    "room:participant_joined",
    (payload: { user_id: number }) => {
      const snap = getState().snapshot;
      if (snap === null) return;
      if (snap.participants.some((p) => p.user_id === payload.user_id)) return;
      const now = new Date().toISOString();
      setState({
        snapshot: {
          ...snap,
          participants: [
            ...snap.participants,
            {
              user_id: payload.user_id,
              role: "guest",
              display_name: null,
              joined_at: now,
              last_seen_at: now,
            },
          ],
        },
      });
    },
  );

  s.on(
    "room:participant_left",
    (payload: { user_id: number }) => {
      const snap = getState().snapshot;
      if (snap === null) return;
      setState({
        snapshot: {
          ...snap,
          participants: snap.participants.filter(
            (p) => p.user_id !== payload.user_id,
          ),
        },
      });
    },
  );

  s.on("spin:announced", () => {
    setState({ currentSpin: null, spinSettled: null });
  });

  s.on("spin:started", (payload: SpinStartedEvent) => {
    setState({ currentSpin: payload, spinSettled: null });
  });

  s.on("spin:settled", (payload: SpinSettledEvent) => {
    const eliminatedId = payload.mode_aftereffects?.eliminated_segment_id;
    const snap = getState().snapshot;
    if (eliminatedId !== undefined && snap !== null) {
      setState({ spinSettled: payload, snapshot: applyEliminated(snap, eliminatedId) });
    } else {
      setState({ spinSettled: payload });
    }
  });

  s.on("round:reset", () => {
    const snap = getState().snapshot;
    if (snap !== null) setState({ snapshot: reviveAllSegments(snap) });
  });

  // Rigged Mode 🎭 reveal: the secret is out. Refetch the (now un-redacted)
  // room so every client sees the real mode + weights + 🎭 title, then plays
  // the reveal. The weights aren't in a flat patch, so a refetch is cleanest.
  s.on("rigged:revealed", () => {
    const code = getState().joinedCode;
    if (code === null) return;
    void api
      .getRoom(code)
      .then((state) => {
        getState().setSnapshot(state);
      })
      .catch(() => {
        /* a failed refetch just means the reveal animation is skipped */
      });
  });

  // punishment:cleared is a per-card "done" signal. The authoritative state
  // (card.done flip + done_count bump) arrives in the accompanying
  // room:updated patch, which the generic merge above already applies — so
  // this handler is intentionally a no-op subscription, kept explicit so the
  // server event is acknowledged rather than silently dropped.
  s.on("punishment:cleared", () => {
    /* state flows through the paired room:updated patch */
  });

  // Host kicked someone. If it's me, the room is over for me; otherwise drop
  // the kicked player from the roster (the server also blocks their re-join).
  s.on("room:kicked", (payload: { user_id: number }) => {
    const snap = getState().snapshot;
    if (snap === null) return;
    if (payload.user_id === snap.me_user_id) {
      setState({ endedReason: "kicked" });
      return;
    }
    setState({
      snapshot: {
        ...snap,
        participants: snap.participants.filter((p) => p.user_id !== payload.user_id),
      },
    });
  });

  // Host closed the room — it's over for everyone.
  s.on("room:closed", () => {
    setState({ endedReason: "closed" });
  });

  // Join-approval: a guest is awaiting approval (host refetches the pending
  // list), or one was approved (the approved guest + everyone refetch). The
  // pending data isn't in a flat patch, so a refetch is cleanest.
  const refetchRoom = (): void => {
    const code = getState().joinedCode;
    if (code === null) return;
    void api
      .getRoom(code)
      .then((state) => {
        getState().setSnapshot(state);
      })
      .catch(() => {
        /* transient refetch failure is non-fatal */
      });
  };
  s.on("room:join_request", refetchRoom);
  s.on("room:approved", refetchRoom);

  s.on(
    "reaction:received",
    (payload: { emoji: string; user_id: number; at: string }) => {
      const id = `${payload.at}-${payload.user_id}-${Math.random().toString(36).slice(2, 8)}`;
      // Lane = horizontal position of the emoji's button in the bar
      // (deterministic). Jitter is a small ±2.5% wobble so a burst of
      // identical reactions doesn't pixel-stack.
      const jitter = (Math.random() - 0.5) * 0.05;
      const next: FlyingReaction = {
        ...payload,
        id,
        x: reactionLaneFor(payload.emoji, jitter),
      };
      setState((state) => ({
        reactions: [...state.reactions, next],
      }));
      window.setTimeout(() => {
        setState((state) => ({
          reactions: state.reactions.filter((r) => r.id !== id),
        }));
      }, REACTION_TTL_MS);
    },
  );
}

export const useRoomStore = create<RoomStore>((_set, get) => ({
  connected: false,
  joinedCode: null,
  snapshot: null,
  currentSpin: null,
  spinSettled: null,
  lastError: null,
  endedReason: null,
  reactions: [],

  joinRoom(code: string): void {
    const s = ensureSocket();
    useRoomStore.setState({ joinedCode: code });
    if (s.connected) {
      s.emit("room:join", { code });
    } else {
      s.once("connect", () => {
        s.emit("room:join", { code });
      });
    }
  },

  leaveRoom(): void {
    socket?.emit("room:leave");
    useRoomStore.setState({
      joinedCode: null,
      snapshot: null,
      currentSpin: null,
      spinSettled: null,
      endedReason: null,
      reactions: [],
    });
  },

  clearEnded(): void {
    useRoomStore.setState({ endedReason: null });
  },

  triggerSpin(force = false): void {
    socket?.emit("spin:trigger", force ? { force: true } : {});
  },

  sendReaction(emoji: string): void {
    socket?.emit("reaction:send", { emoji });
  },

  resetSpinState(): void {
    useRoomStore.setState({ spinSettled: null });
    void get; // ergonomics: keep `get` in scope for future selectors
  },

  setSnapshot(state: ServerRoomState): void {
    useRoomStore.setState({ snapshot: state });
  },

  resetRound(): void {
    socket?.emit("round:reset");
  },

  placeBet(segmentId: number): void {
    socket?.emit("punishment:bet", { segment_id: segmentId });
    // Optimistic: show my bet immediately; reconciled by the next snapshot.
    const snap = useRoomStore.getState().snapshot;
    if (snap !== null) {
      const bets = { ...(snap.room.punishment_bets ?? {}) };
      bets[String(snap.me_user_id)] = segmentId;
      useRoomStore.setState({
        snapshot: { ...snap, room: { ...snap.room, punishment_bets: bets } },
      });
    }
  },

  resolvePunishment(refuse: boolean): void {
    socket?.emit("punishment:resolve", refuse ? { refuse: true } : {});
  },

  approvePunishment(): void {
    socket?.emit("punishment:approve", {});
  },

  rejectPunishment(): void {
    socket?.emit("punishment:reject", {});
  },

  bestOfNReset(): void {
    socket?.emit("bon:reset");
  },
}));

// --- Lifecycle helpers ---------------------------------------------------

const PRESENCE_PING_INTERVAL_MS = 20_000;
let presenceTimer: number | null = null;

export function startPresenceLoop(): void {
  if (presenceTimer !== null) return;
  presenceTimer = window.setInterval(() => {
    socket?.emit("presence:ping");
  }, PRESENCE_PING_INTERVAL_MS);
}

export function stopPresenceLoop(): void {
  if (presenceTimer !== null) {
    window.clearInterval(presenceTimer);
    presenceTimer = null;
  }
}
