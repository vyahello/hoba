import { create } from "zustand";

import { haptics } from "@/lib/haptics";

export type ToastIntent = "info" | "success" | "warning" | "error";

export interface ToastEntry {
  id: number;
  title: string;
  description?: string;
  intent: ToastIntent;
}

interface ToastStore {
  toasts: ToastEntry[];
  push: (entry: Omit<ToastEntry, "id">) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

const TOAST_AUTO_DISMISS_MS = 3500;
let nextId = 1;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (entry) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { ...entry, id }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, TOAST_AUTO_DISMISS_MS);
    return id;
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative toast API — fires the matching haptic on push. */
export function toast(input: {
  title: string;
  description?: string;
  intent?: ToastIntent;
}): void {
  const intent: ToastIntent = input.intent ?? "info";
  if (intent === "success") haptics.success();
  else if (intent === "warning") haptics.warning();
  else if (intent === "error") haptics.error();
  useToastStore.getState().push({
    title: input.title,
    description: input.description,
    intent,
  });
}
