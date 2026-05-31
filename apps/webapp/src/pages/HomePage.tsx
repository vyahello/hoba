import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Card } from "@/components/ds/Card";
import { EmptyState } from "@/components/ds/EmptyState";
import { IconButton } from "@/components/ds/IconButton";
import { QuickWheelCard } from "@/components/ds/QuickWheelCard";
import { QUICK_WHEELS } from "@/data/quickWheels";
import { type SavedWheel, api } from "@/lib/api";

/**
 * Home (F2) — the screen 80% of opens land on. "Tap me, I'm fun", not
 * "configure me". A new user must reach a spin within 10s; the 6 Quick
 * Wheels are the path.
 *
 * Phase 4 ships the layout + tap → toast (Phase 5 wires real solo spin).
 */
export function HomePage(): JSX.Element {
  const { t } = useTranslation(["home", "common"]);
  const navigate = useNavigate();
  const [wheels, setWheels] = useState<SavedWheel[] | null>(null);

  useEffect(() => {
    void api
      .listWheels()
      .then(setWheels)
      .catch(() => {
        setWheels([]);
      });
  }, []);

  return (
    <>
      <header className="ds-glass-header px-4 py-3 pt-safe flex items-center justify-between">
        <span className="font-display font-extrabold text-2xl text-brand-primary">
          {t("home:header.app_name")}
        </span>
        <IconButton
          aria-label={t("home:header.settings_aria")}
          icon={<span aria-hidden>⚙️</span>}
          onClick={() => {
            navigate("/settings");
          }}
        />
      </header>

      <main className="flex-1 px-4 pt-3 pb-10 flex flex-col gap-7">
        <section>
          <h2 className="font-display font-bold text-xl mb-3 text-ink-light-1 dark:text-ink-dark-1">
            {t("home:quick_decide")}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_WHEELS.map((wheel) => (
              <QuickWheelCard
                key={wheel.id}
                wheel={wheel}
                onTap={() => {
                  navigate(`/spin/${wheel.id}`);
                }}
              />
            ))}
          </div>
        </section>

        <section>
          <Card
            interactive
            padding="lg"
            onClick={() => {
              navigate("/create");
            }}
            className="flex items-center gap-4"
          >
            <span
              aria-hidden
              className="w-14 h-14 rounded-md bg-gradient-to-br from-brand-primary/20 to-brand-accent/20 inline-flex items-center justify-center text-3xl shrink-0"
            >
              ➕
            </span>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-lg mb-0.5 truncate">
                {t("home:create_custom.title")}
              </h3>
              <p className="text-sm text-ink-light-2 dark:text-ink-dark-2 line-clamp-2">
                {t("home:create_custom.subtitle")}
              </p>
            </div>
          </Card>
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display font-bold text-xl text-ink-light-1 dark:text-ink-dark-1">
              {t("home:my_wheels.title")}
            </h2>
            {wheels !== null && wheels.length > 0 ? (
              <button
                type="button"
                className="text-sm font-semibold text-brand-primary"
                onClick={() => {
                  navigate("/library");
                }}
              >
                {t("home:my_wheels.see_all")}
              </button>
            ) : null}
          </div>
          {wheels === null || wheels.length === 0 ? (
            <Card padding="none" className="overflow-hidden">
              <EmptyState
                title={t("home:my_wheels.title")}
                description={t("home:my_wheels.empty")}
              />
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {wheels.slice(0, 3).map((w) => (
                <Card
                  key={w.id}
                  interactive
                  padding="md"
                  onClick={() => {
                    navigate("/library");
                  }}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="font-display font-semibold text-base truncate text-ink-light-1 dark:text-ink-dark-1">
                    {w.title}
                  </span>
                  <span className="shrink-0 text-xs text-ink-light-2 dark:text-ink-dark-2 tabular-nums">
                    {w.segments.length}
                  </span>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
