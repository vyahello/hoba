import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { toast } from "@/stores/toast";

export interface RoomCodePillProps {
  code: string;
  /** Fires after the code is written to clipboard. */
  onCopied?: () => void;
  className?: string;
}

/**
 * Big monospace room code, copy-on-tap, soft pulsing ring so it reads as
 * shareable. JetBrains Mono per §1.
 */
export function RoomCodePill({
  code,
  onCopied,
  className,
}: RoomCodePillProps): JSX.Element {
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      haptics.success();
      toast({ title: "Code copied", intent: "success" });
      onCopied?.();
    } catch {
      haptics.error();
      toast({ title: "Copy failed", intent: "error" });
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleCopy();
      }}
      aria-label={`Copy room code ${code}`}
      className={cn(
        "ds-tactile inline-flex items-center justify-center",
        "font-mono font-bold text-2xl tracking-[0.3em] uppercase",
        "px-6 py-3 rounded-lg",
        "bg-surface-light-2 dark:bg-surface-dark-2 text-ink-light-1 dark:text-ink-dark-1",
        "ring-2 ring-brand-primary/60 animate-code-pulse",
        className,
      )}
    >
      {code}
    </button>
  );
}
