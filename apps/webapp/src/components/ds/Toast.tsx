import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { type ToastIntent, useToastStore } from "@/stores/toast";

const INTENT_STYLES: Record<ToastIntent, string> = {
  info: "bg-ds-surface border-brand-primary",
  success: "bg-ds-surface border-state-success",
  warning: "bg-ds-surface border-state-warning",
  error: "bg-ds-surface border-state-danger",
};

const INTENT_DOTS: Record<ToastIntent, string> = {
  info: "bg-brand-primary",
  success: "bg-state-success",
  warning: "bg-state-warning",
  error: "bg-state-danger",
};

/**
 * Mounted once near the app root — renders the stack from `useToastStore`.
 * Top-anchored per spec §9, auto-dismiss after 3.5s.
 */
export function Toaster(): JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-x-0 top-0 z-[60] pt-safe px-4 flex flex-col items-center pointer-events-none">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ y: -32, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -32, opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 30, stiffness: 360 }}
            className={cn(
              "pointer-events-auto mt-3 w-full max-w-sm rounded-lg shadow-brutal",
              "border-[3px] px-4 py-3 flex items-start gap-3",
              INTENT_STYLES[t.intent],
            )}
            role="status"
            aria-live="polite"
            onClick={() => dismiss(t.id)}
          >
            <span
              aria-hidden
              className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", INTENT_DOTS[t.intent])}
            />
            <div className="grow">
              <p className="font-medium text-ds-text">
                {t.title}
              </p>
              {t.description ? (
                <p className="text-sm text-ds-text-muted mt-0.5">
                  {t.description}
                </p>
              ) : null}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
