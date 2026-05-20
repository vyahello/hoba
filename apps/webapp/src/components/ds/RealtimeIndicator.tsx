import { cn } from "@/lib/cn";

export interface RealtimeIndicatorProps {
  label?: string;
  className?: string;
  /** Set to false to stop the breathing pulse (e.g. when disconnected). */
  active?: boolean;
}

export function RealtimeIndicator({
  label = "live",
  className,
  active = true,
}: RealtimeIndicatorProps): JSX.Element {
  const dotColor = active ? "bg-state-success" : "bg-ink-light-2 dark:bg-ink-dark-2";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider",
        active ? "text-state-success" : "text-ink-light-2 dark:text-ink-dark-2",
        className,
      )}
    >
      <span className="relative inline-flex w-2 h-2">
        {active ? (
          <span className="absolute inset-0 rounded-full bg-state-success animate-live-pulse" />
        ) : null}
        <span className={cn("relative inline-flex w-2 h-2 rounded-full", dotColor)} />
      </span>
      {label}
    </span>
  );
}
