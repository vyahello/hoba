import { type MouseEvent } from "react";

import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { WHEEL_PALETTE } from "../../../tailwind.config";

export interface SegmentChipProps {
  label: string;
  emoji?: string;
  /** 0–11. Picks from the deterministic wheel palette. */
  colorSeed: number;
  editable?: boolean;
  onRemove?: () => void;
  onEdit?: () => void;
  className?: string;
}

export function SegmentChip({
  label,
  emoji,
  colorSeed,
  editable = false,
  onRemove,
  onEdit,
  className,
}: SegmentChipProps): JSX.Element {
  const color = WHEEL_PALETTE[colorSeed % WHEEL_PALETTE.length];

  const handleEdit = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    haptics.selection();
    onEdit?.();
  };

  const handleRemove = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    haptics.warning();
    onRemove?.();
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 pl-2 pr-3 py-2 rounded-pill",
        "bg-surface-light-2 dark:bg-surface-dark-2",
        "border-l-4 min-h-[44px]",
        className,
      )}
      style={{ borderLeftColor: color }}
    >
      <span
        aria-hidden
        className="w-4 h-4 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      {emoji !== undefined ? (
        <span className="text-lg leading-none">{emoji}</span>
      ) : null}
      <span className="font-medium text-ink-light-1 dark:text-ink-dark-1 truncate max-w-[16ch]">
        {label}
      </span>
      {editable ? (
        <span className="ml-1 inline-flex items-center gap-1">
          <button
            type="button"
            aria-label={`Edit ${label}`}
            onClick={handleEdit}
            className="ds-tactile w-7 h-7 rounded-full inline-flex items-center justify-center text-ink-light-2 dark:text-ink-dark-2 active:bg-surface-light dark:active:bg-surface-dark"
          >
            ✏️
          </button>
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={handleRemove}
            className="ds-tactile w-7 h-7 rounded-full inline-flex items-center justify-center text-state-danger active:bg-surface-light dark:active:bg-surface-dark"
          >
            ✕
          </button>
        </span>
      ) : null}
    </div>
  );
}
