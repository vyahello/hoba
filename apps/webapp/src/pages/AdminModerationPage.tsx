import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { IconButton } from "@/components/ds/IconButton";
import { Skeleton } from "@/components/ds/Skeleton";
import { ApiError, type ReportedWheel, api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { safeNavigateBack } from "@/lib/navigation";
import { toast } from "@/stores/toast";

export function AdminModerationPage(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const navigate = useNavigate();

  const [wheels, setWheels] = useState<ReportedWheel[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listModerationReports()
      .then((list) => {
        if (!cancelled) setWheels(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.statusCode === 403) setForbidden(true);
        else setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function act(
    id: number, fn: (id: number) => Promise<ReportedWheel>, successKey: string,
  ): Promise<void> {
    if (busyId !== null) return;
    setBusyId(id);
    haptics.medium();
    try {
      await fn(id);
      // Both actions resolve the item: unhide clears it from the queue,
      // hide removes a not-yet-hidden item we just took down. Drop it locally.
      setWheels((prev) => (prev ?? []).filter((w) => w.id !== id));
      haptics.success();
      toast({ title: t(successKey), intent: "success" });
    } catch {
      haptics.warning();
      toast({ title: t("admin:moderation.action_failed"), intent: "error" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className="ds-glass-header px-4 py-3 pt-safe flex items-center gap-3">
        <IconButton
          aria-label={t("common:actions.back")}
          variant="ghost"
          icon={<span aria-hidden>←</span>}
          onClick={() => {
            safeNavigateBack(navigate);
          }}
        />
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-xl truncate text-ink-light-1 dark:text-ink-dark-1">
            {t("admin:moderation.title")}
          </h1>
          <p className="text-xs text-ink-light-2 dark:text-ink-dark-2 truncate">
            {t("admin:moderation.subtitle")}
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 pt-3 pb-6 flex flex-col gap-4">
        {forbidden ? (
          <EmptyState emoji="🔒" text={t("admin:moderation.forbidden")} />
        ) : failed ? (
          <EmptyState emoji="⚠️" text={t("admin:moderation.load_failed")} />
        ) : wheels === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        ) : wheels.length === 0 ? (
          <EmptyState emoji="✨" text={t("admin:moderation.empty")} />
        ) : (
          <div className="flex flex-col gap-3">
            {wheels.map((w) => (
              <ReportCard
                key={w.id}
                wheel={w}
                busy={busyId === w.id}
                onUnhide={() => {
                  void act(w.id, api.unhideWheel, "admin:moderation.unhidden");
                }}
                onHide={() => {
                  void act(w.id, api.hideWheel, "admin:moderation.hidden");
                }}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function EmptyState({ emoji, text }: { emoji: string; text: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="text-5xl" aria-hidden>{emoji}</span>
      <p className="text-sm text-ink-light-2 dark:text-ink-dark-2 px-6">{text}</p>
    </div>
  );
}

function ReportCard({
  wheel,
  busy,
  onUnhide,
  onHide,
}: {
  wheel: ReportedWheel;
  busy: boolean;
  onUnhide: () => void;
  onHide: () => void;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  return (
    <Card padding="md" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display font-bold text-lg truncate text-ink-light-1 dark:text-ink-dark-1">
            {wheel.title}
          </h2>
          <p className="text-xs text-ink-light-2 dark:text-ink-dark-2">
            {t("admin:moderation.owner", { id: wheel.owner_id })}
          </p>
        </div>
        <span
          className={`shrink-0 px-2 py-1 rounded-full text-xs font-semibold ${
            wheel.is_hidden
              ? "bg-state-danger/15 text-state-danger"
              : "bg-brand-accent/15 text-brand-accent"
          }`}
        >
          {wheel.is_hidden
            ? t("admin:moderation.hidden_badge")
            : t("admin:moderation.reported_badge")}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {wheel.segments.map((s) => (
          <span
            key={s.id}
            className="px-2 py-0.5 rounded-md text-xs bg-surface-light-2 dark:bg-surface-dark-2 text-ink-light-1 dark:text-ink-dark-1"
          >
            {s.emoji ? `${s.emoji} ` : ""}
            {s.label}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-ink-light-2/10 dark:border-ink-dark-2/10 pt-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-light-2 dark:text-ink-dark-2">
          {t("admin:moderation.reports_count", { count: wheel.report_count })}
        </p>
        {wheel.reports.map((r, i) => (
          <p
            key={`${r.reporter_id}-${i}`}
            className="text-sm text-ink-light-1 dark:text-ink-dark-1"
          >
            <span className="text-ink-light-2 dark:text-ink-dark-2">
              {r.reporter_name}:
            </span>{" "}
            {r.reason ?? <em className="opacity-60">{t("admin:moderation.no_reason")}</em>}
          </p>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        {wheel.is_hidden ? (
          <Button variant="primary" className="flex-1" disabled={busy} onClick={onUnhide}>
            {t("admin:moderation.unhide")}
          </Button>
        ) : (
          <Button variant="destructive" className="flex-1" disabled={busy} onClick={onHide}>
            {t("admin:moderation.hide")}
          </Button>
        )}
      </div>
    </Card>
  );
}
