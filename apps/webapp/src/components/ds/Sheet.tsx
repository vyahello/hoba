import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Set false to disable drag-to-dismiss + ESC key handling. */
  dismissable?: boolean;
  /** Optional title rendered as the sheet header. */
  title?: string;
  className?: string;
}

const DRAG_DISMISS_OFFSET = 120;
const DRAG_DISMISS_VELOCITY = 320;

/**
 * Bottom sheet — primary overlay for everything that's not a destructive
 * confirmation. Drag-to-dismiss is on by default per spec §3.
 */
export function Sheet({
  open,
  onClose,
  children,
  dismissable = true,
  title,
  className,
}: SheetProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && dismissable) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, [open, onClose, dismissable]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={dismissable ? onClose : undefined}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            drag={dismissable ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_e, info: PanInfo) => {
              if (
                info.offset.y > DRAG_DISMISS_OFFSET ||
                info.velocity.y > DRAG_DISMISS_VELOCITY
              ) {
                onClose();
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              "fixed inset-x-0 bottom-0 z-50 max-h-[90dvh]",
              "rounded-t-xl bg-surface-light dark:bg-surface-dark",
              "shadow-spin pb-safe flex flex-col",
              className,
            )}
          >
            {dismissable ? (
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-ink-light-2/30 dark:bg-ink-dark-2/30" />
              </div>
            ) : null}
            {title ? (
              <h2 className="px-6 pt-2 pb-3 font-display font-bold text-xl shrink-0">
                {title}
              </h2>
            ) : null}
            <div className="overflow-y-auto px-6 pb-6 grow">{children}</div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
