import { cn } from "@/lib/cn";

type Size = "sm" | "md" | "lg" | "xl";

export interface AvatarProps {
  /** Photo URL. Falls back to initials when absent or load fails. */
  src?: string;
  /** Initials or short name shown when no photo. Required for a11y. */
  fallback: string;
  size?: Size;
  status?: "online" | "offline";
  className?: string;
}

const SIZE_STYLES: Record<Size, { ring: string; text: string; dot: string }> = {
  sm: { ring: "w-8 h-8", text: "text-xs", dot: "w-2 h-2 border-[1.5px]" },
  md: { ring: "w-10 h-10", text: "text-sm", dot: "w-2.5 h-2.5 border-2" },
  lg: { ring: "w-14 h-14", text: "text-lg", dot: "w-3 h-3 border-2" },
  xl: { ring: "w-20 h-20", text: "text-2xl", dot: "w-4 h-4 border-2" },
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u, 2);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function Avatar({
  src,
  fallback,
  size = "md",
  status,
  className,
}: AvatarProps): JSX.Element {
  const s = SIZE_STYLES[size];
  return (
    <span className={cn("relative inline-block shrink-0", className)}>
      {src !== undefined && src !== "" ? (
        <img
          src={src}
          alt={fallback}
          className={cn(
            s.ring,
            "rounded-full object-cover bg-surface-light-2 dark:bg-surface-dark-2",
          )}
        />
      ) : (
        <span
          aria-label={fallback}
          className={cn(
            s.ring,
            s.text,
            "rounded-full inline-flex items-center justify-center font-semibold",
            "bg-gradient-to-br from-brand-primary to-brand-pink text-white",
          )}
        >
          {initialsOf(fallback)}
        </span>
      )}
      {status !== undefined ? (
        <span
          aria-label={status}
          className={cn(
            "absolute right-0 bottom-0 rounded-full",
            s.dot,
            "border-surface-light dark:border-surface-dark",
            status === "online" ? "bg-state-success" : "bg-ink-light-2",
          )}
        />
      ) : null}
    </span>
  );
}
