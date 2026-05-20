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

import { type RoomState as ServerRoomState } from "@/lib/api";

const NAMESPACE = "/rooms";
const REACTION_TTL_MS = 2200;

export interface SpinStartedEvent {
  spin_id: number;
  question_id: number;
  triggered_by: number;
  result_segment_id: number;
  final_angle_deg: number;
  duration_ms: number;
  seed: number;
  started_at_server: string;
}

export interface SpinSettledEvent {
  spin_id: number;
  result_segment_id: number;
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
  reactions: FlyingReaction[];

  joinRoom(code: string): void;
  leaveRoom(): void;
  triggerSpin(): void;
  sendReaction(emoji: string): void;
  resetSpinState(): void;
}

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
    setState({ spinSettled: payload });
  });

  s.on(
    "reaction:received",
    (payload: { emoji: string; user_id: number; at: string }) => {
      const id = `${payload.at}-${payload.user_id}-${Math.random().toString(36).slice(2, 8)}`;
      const next: FlyingReaction = { ...payload, id, x: Math.random() };
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
      reactions: [],
    });
  },

  triggerSpin(): void {
    socket?.emit("spin:trigger", {});
  },

  sendReaction(emoji: string): void {
    socket?.emit("reaction:send", { emoji });
  },

  resetSpinState(): void {
    useRoomStore.setState({ spinSettled: null });
    void get; // ergonomics: keep `get` in scope for future selectors
  },
}));

// --- Lifecycle helpers ---------------------------------------------------

export function disconnectRoomSocket(): void {
  socket?.disconnect();
  socket = null;
}

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
