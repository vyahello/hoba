import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Card } from "@/components/ds/Card";
import { EmptyState } from "@/components/ds/EmptyState";
import { IconButton } from "@/components/ds/IconButton";
import { QuickWheelCard } from "@/components/ds/QuickWheelCard";
import { QUICK_WHEELS } from "@/data/quickWheels";

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
          <h2 className="font-display font-bold text-xl mb-3 text-ink-light-1 dark:text-ink-dark-1">
            {t("home:my_wheels.title")}
          </h2>
          <Card padding="none" className="overflow-hidden">
            <EmptyState
              title={t("home:my_wheels.title")}
              description={t("home:my_wheels.empty")}
            />
          </Card>
        </section>
      </main>
    </>
  );
}
