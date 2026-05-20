import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ds/Button";

export interface ModalAction {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  loading?: boolean;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  primaryAction: ModalAction;
  secondaryAction?: ModalAction;
}

/**
 * Centered modal — strictly for destructive confirmations per spec §3
 * ("Sheets, not modals. Centered modals only for destructive confirmations").
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
}: ModalProps): JSX.Element | null {
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 340 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="bg-surface-light dark:bg-surface-dark rounded-xl shadow-spin max-w-sm w-full p-6"
          >
            <h2
              id="modal-title"
              className="font-display font-bold text-xl mb-2 text-ink-light-1 dark:text-ink-dark-1"
            >
              {title}
            </h2>
            {description ? (
              <p className="text-base text-ink-light-2 dark:text-ink-dark-2 mb-4">
                {description}
              </p>
            ) : null}
            {children ? <div className="mb-4">{children}</div> : null}
            <div className="flex flex-col gap-2 mt-6">
              <Button
                variant={primaryAction.destructive === true ? "destructive" : "primary"}
                fullWidth
                size="lg"
                loading={primaryAction.loading}
                onClick={primaryAction.onClick}
              >
                {primaryAction.label}
              </Button>
              {secondaryAction ? (
                <Button
                  variant="ghost"
                  fullWidth
                  size="lg"
                  onClick={secondaryAction.onClick}
                >
                  {secondaryAction.label}
                </Button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
