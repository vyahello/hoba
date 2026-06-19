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
  const dotColor = active ? "bg-state-success" : "bg-ds-text-muted";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider",
        active ? "text-state-success" : "text-ds-text-muted",
        className,
      )}
    >
      {/* Static dot — the old `live-pulse` was an always-on infinite loop
          (thermal budget). A solid bordered dot conveys connected/live. */}
      <span
        className={cn(
          "inline-flex w-2.5 h-2.5 rounded-full border border-ds-border",
          dotColor,
        )}
      />
      {label}
    </span>
  );
}
