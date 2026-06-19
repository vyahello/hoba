import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("room");
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      haptics.success();
      toast({ title: t("code_pill.copied_title"), intent: "success" });
      onCopied?.();
    } catch {
      haptics.error();
      toast({ title: t("code_pill.copy_failed_title"), intent: "error" });
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleCopy();
      }}
      aria-label={t("code_pill.aria_label", { code })}
      className={cn(
        "ds-tactile inline-flex items-center justify-center",
        "font-mono font-bold text-2xl tracking-[0.3em] uppercase",
        "px-6 py-3 rounded-lg",
        "bg-ds-surface-2 text-ds-text",
        // Static neubrutalist pill — was an infinite box-shadow `code-pulse`
        // loop (PERF_AUDIT R6: animated box-shadow + always-on). Bold border
        // + hard shadow reads as "shareable" without a loop.
        "border-[3px] border-ds-border shadow-brutal active:shadow-brutal-sm",
        className,
      )}
    >
      {code}
    </button>
  );
}
