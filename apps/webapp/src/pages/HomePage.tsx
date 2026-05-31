import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ds/Button";
import { Card } from "@/components/ds/Card";
import { EmptyState } from "@/components/ds/EmptyState";
import { IconButton } from "@/components/ds/IconButton";
import { QuickWheelCard } from "@/components/ds/QuickWheelCard";
import { Skeleton } from "@/components/ds/Skeleton";
import { type SavedWheel, type Template, api } from "@/lib/api";
import { useCustomWheel } from "@/stores/spinHistory";

/**
 * Home (F2) — the screen 80% of opens land on. "Tap me, I'm fun", not
 * "configure me". A new user must reach a spin within 10s; the built-in
 * templates (server-localized, the "expanded Quick Wheels") are the path.
 */
export function HomePage(): JSX.Element {
  const { t, i18n } = useTranslation(["home", "common"]);
  const navigate = useNavigate();
  const setCustomWheel = useCustomWheel((s) => s.set);
  const [wheels, setWheels] = useState<SavedWheel[] | null>(null);
  const [trending, setTrending] = useState<SavedWheel[] | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [templatesFailed, setTemplatesFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    void api
      .listWheels()
      .then(setWheels)
      .catch(() => {
        setWheels([]);
      });
    void api
      .listTrending({ limit: 10 })
      .then(setTrending)
      .catch(() => {
        setTrending([]);
      });
  }, []);

  const locale = i18n.language;
  useEffect(() => {
    let cancelled = false;
    setTemplatesFailed(false);
    setTemplates(null);
    void api
      .listTemplates(locale)
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch(() => {
        if (!cancelled) setTemplatesFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, reloadKey]);

  function spinTemplate(template: Template): void {
    // We already hold the localized segments — load straight into the solo
    // spin store so the wheel renders instantly (no second round-trip).
    setCustomWheel({
      id: `template:${template.key}`,
      source: "template",
      templateKey: template.key,
      questionText: template.title,
      segments: template.segments.map((s) => ({
        id: s.key,
        label: s.label,
        emoji: s.emoji ?? undefined,
        colorSeed: s.color_seed,
      })),
    });
    navigate("/spin/custom");
  }

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
          {templatesFailed ? (
            <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-ink-light-2 dark:text-ink-dark-2">
                {t("home:templates.load_failed")}
              </p>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setReloadKey((k) => k + 1);
                }}
              >
                {t("home:templates.retry")}
              </Button>
            </Card>
          ) : templates === null ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[5/4] w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {templates.map((template) => (
                <QuickWheelCard
                  key={template.key}
                  title={template.title}
                  emoji={template.emoji}
                  gradient={template.gradient}
                  onTap={() => {
                    spinTemplate(template);
                  }}
                />
              ))}
            </div>
          )}
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

        {trending !== null && trending.length > 0 ? (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-display font-bold text-xl text-ink-light-1 dark:text-ink-dark-1">
                {t("home:trending.title")}
              </h2>
              <button
                type="button"
                className="text-sm font-semibold text-brand-primary"
                onClick={() => {
                  navigate("/trending");
                }}
              >
                {t("home:my_wheels.see_all")}
              </button>
            </div>
            <div className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-1">
              {trending.map((w) => (
                <Card
                  key={w.id}
                  interactive
                  padding="md"
                  onClick={() => {
                    navigate("/trending");
                  }}
                  className="shrink-0 w-40 flex flex-col gap-2"
                >
                  <span className="font-display font-semibold text-base line-clamp-2 text-ink-light-1 dark:text-ink-dark-1">
                    {w.title}
                  </span>
                  <span className="text-xs text-ink-light-2 dark:text-ink-dark-2 tabular-nums">
                    ❤️ {w.like_count}
                  </span>
                </Card>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
