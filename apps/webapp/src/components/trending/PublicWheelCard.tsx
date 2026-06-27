import { useTranslation } from "react-i18next";

import { Button } from "@/components/ds/Button";
import { cn } from "@/lib/cn";
import { type SavedWheel } from "@/lib/api";

export interface PublicWheelCardProps {
  wheel: SavedWheel;
  liked: boolean;
  onUse: () => void;
  onLike: () => void;
  onReport: () => void;
  reportConfirming: boolean;
  className?: string;
}

/**
 * A public wheel as shown in Trending — title, a few segment chips, the
 * like counter (tap-to-toggle heart), a Use CTA, and a report flag with a
 * two-tap confirm (the parent owns `reportConfirming`).
 */
export function PublicWheelCard({
  wheel,
  liked,
  onUse,
  onLike,
  onReport,
  reportConfirming,
  className,
}: PublicWheelCardProps): JSX.Element {
  const { t } = useTranslation(["home", "common"]);
  return (
    <div
      className={cn(
        "rounded-xl bg-ds-surface-2 p-4 flex flex-col gap-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display font-bold text-base text-ds-text break-words">
          {wheel.title}
        </h2>
        <button
          type="button"
          onClick={onLike}
          aria-label={t("home:trending.like_aria")}
          aria-pressed={liked}
          className="shrink-0 flex items-center gap-1 text-sm font-semibold tabular-nums px-2 py-1 -my-1 rounded-full"
        >
          <span
            aria-hidden
            className={cn("inline-block", liked ? "animate-heart-beat" : "grayscale opacity-70")}
          >
            {liked ? "❤️" : "🤍"}
          </span>
          <span className="text-ds-text-muted">{wheel.like_count}</span>
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {wheel.segments.slice(0, 6).map((s) => (
          <span
            key={s.id}
            className="text-xs px-2 py-0.5 rounded-full bg-ds-surface text-ds-text"
          >
            {s.emoji ? `${s.emoji} ` : ""}{s.label}
          </span>
        ))}
        {wheel.segments.length > 6 ? (
          <span className="text-xs px-2 py-0.5 text-ds-text-muted">
            +{wheel.segments.length - 6}
          </span>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button variant="accent" size="md" className="flex-1" onClick={onUse}>
          {t("home:trending.use")}
        </Button>
        <Button
          variant={reportConfirming ? "accent" : "ghost"}
          size="md"
          onClick={onReport}
        >
          {reportConfirming ? t("home:trending.report_confirm") : t("home:trending.report")}
        </Button>
      </div>
    </div>
  );
}
