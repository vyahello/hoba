import { Avatar, type AvatarProps } from "@/components/ds/Avatar";
import { cn } from "@/lib/cn";

type Size = "sm" | "md";

export interface AvatarStackProps {
  users: Pick<AvatarProps, "src" | "fallback">[];
  max?: number;
  size?: Size;
  className?: string;
}

const OVERLAP_STYLES: Record<Size, string> = {
  sm: "-ml-2.5",
  md: "-ml-3.5",
};

const RING_STYLES: Record<Size, string> = {
  sm: "ring-2",
  md: "ring-2",
};

const COUNTER_SIZES: Record<Size, string> = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
};

export function AvatarStack({
  users,
  max = 4,
  size = "md",
  className,
}: AvatarStackProps): JSX.Element {
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;

  return (
    <div className={cn("inline-flex items-center", className)}>
      {visible.map((user, index) => (
        <span
          key={`${user.fallback}-${index}`}
          className={cn(
            "ring-ds-bg rounded-full",
            RING_STYLES[size],
            index > 0 && OVERLAP_STYLES[size],
          )}
          style={{ zIndex: visible.length - index }}
        >
          <Avatar src={user.src} fallback={user.fallback} size={size} />
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            "rounded-full inline-flex items-center justify-center font-semibold",
            "bg-ds-surface-2 text-ds-text",
            "ring-ds-bg",
            RING_STYLES[size],
            OVERLAP_STYLES[size],
            COUNTER_SIZES[size],
          )}
          aria-label={`and ${overflow} more`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
