import { type ReactNode } from "react";

import { Button } from "@/components/ds/Button";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  /** Slot for an SVG illustration. Phase 11 fills in custom artwork. */
  illustration?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({
  illustration,
  title,
  description,
  action,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center px-6 py-10 gap-3",
        className,
      )}
    >
      {illustration ?? (
        <div
          aria-hidden
          className="w-20 h-20 rounded-full bg-gradient-to-br from-brand-primary/20 to-brand-accent/20 flex items-center justify-center text-3xl"
        >
          ✨
        </div>
      )}
      <h3 className="font-display font-bold text-xl text-ink-light-1 dark:text-ink-dark-1">
        {title}
      </h3>
      {description !== undefined ? (
        <p className="text-base text-ink-light-2 dark:text-ink-dark-2 max-w-xs">
          {description}
        </p>
      ) : null}
      {action !== undefined ? (
        <Button variant="primary" size="lg" onClick={action.onClick} className="mt-2">
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
