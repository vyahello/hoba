import { create } from "zustand";

import { type WheelDef } from "@/features/wheel/types";

export interface SpinHistoryEntry {
  wheelId: string;
  questionText: string;
  segmentLabel: string;
  segmentEmoji?: string;
  segmentColor: string;
  timestamp: number;
}

interface SpinHistoryState {
  entries: SpinHistoryEntry[];
  add: (entry: SpinHistoryEntry) => void;
  forWheel: (wheelId: string) => SpinHistoryEntry[];
}

const MAX_ENTRIES = 50;

export const useSpinHistory = create<SpinHistoryState>((set, get) => ({
  entries: [],
  add: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
    })),
  forWheel: (wheelId) => get().entries.filter((e) => e.wheelId === wheelId),
}));

interface CustomWheelState {
  current?: WheelDef;
  set: (wheel: WheelDef) => void;
  clear: () => void;
}

/** Holds the most recently created custom wheel for the /spin/custom route. */
export const useCustomWheel = create<CustomWheelState>((set) => ({
  current: undefined,
  set: (wheel) => set({ current: wheel }),
  clear: () => set({ current: undefined }),
}));
