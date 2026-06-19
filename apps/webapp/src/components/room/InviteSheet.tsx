import { useTranslation } from "react-i18next";

import { Sheet } from "@/components/ds/Sheet";

export interface InviteSheetProps {
  open: boolean;
  onClose: () => void;
  /** Open Telegram's native share sheet (forwards within Telegram). */
  onShare: () => void;
  /** Copy the raw invite link to the clipboard (for other messengers). */
  onCopy: () => void;
}

/**
 * Invite action sheet — collapses the two share affordances (Telegram
 * forward vs. plain copy-link) into one entry point so the room header
 * keeps a single icon instead of two crowding the code pill.
 */
export function InviteSheet({ open, onClose, onShare, onCopy }: InviteSheetProps): JSX.Element {
  const { t } = useTranslation(["room"]);

  return (
    <Sheet open={open} onClose={onClose} title={t("room:invite.title")}>
      <div className="flex flex-col gap-3 pt-1">
        <InviteRow
          emoji="📤"
          label={t("room:invite.share")}
          hint={t("room:invite.share_hint")}
          onClick={() => {
            onShare();
            onClose();
          }}
        />
        <InviteRow
          emoji="🔗"
          label={t("room:invite.copy")}
          hint={t("room:invite.copy_hint")}
          onClick={() => {
            onCopy();
            onClose();
          }}
        />
      </div>
    </Sheet>
  );
}

function InviteRow({
  emoji,
  label,
  hint,
  onClick,
}: {
  emoji: string;
  label: string;
  hint: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ds-tactile flex w-full items-center gap-4 rounded-xl bg-ds-surface-2 border-[3px] border-ds-border shadow-brutal active:shadow-brutal-sm px-4 py-4 text-left"
    >
      <span aria-hidden className="text-2xl">{emoji}</span>
      <span className="min-w-0">
        <span className="block font-display font-bold text-base text-ds-text">
          {label}
        </span>
        <span className="block text-sm text-ds-text-muted">
          {hint}
        </span>
      </span>
    </button>
  );
}
