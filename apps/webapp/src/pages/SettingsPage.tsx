import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Card } from "@/components/ds/Card";
import { StubPage } from "@/components/layout/StubPage";
import { type Locale, SUPPORTED_LOCALES, setLocale } from "@/i18n";
import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";

interface ToggleRowProps {
  label: string;
  on: boolean;
  onToggle: () => void;
}

function ToggleRow({ label, on, onToggle }: ToggleRowProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => {
        haptics.selection();
        onToggle();
      }}
      className="ds-tactile w-full flex items-center justify-between px-4 py-3 min-h-[48px] active:bg-surface-light-2 dark:active:bg-surface-dark-2"
    >
      <span className="font-medium text-base text-ink-light-1 dark:text-ink-dark-1">
        {label}
      </span>
      <span
        aria-hidden
        className={`w-11 h-6 rounded-pill p-0.5 transition-colors duration-medium ${
          on ? "bg-brand-primary" : "bg-surface-light-2 dark:bg-surface-dark-2"
        }`}
      >
        <span
          className={`block w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-medium ${
            on ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

export function SettingsPage(): JSX.Element {
  const { t, i18n } = useTranslation(["settings", "common", "brand", "admin"]);
  const navigate = useNavigate();
  const currentLocale = (i18n.resolvedLanguage ?? "en") as Locale;
  const [sound, setSound] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [anon, setAnon] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getMe()
      .then((me) => {
        if (!cancelled) setIsAdmin(me.is_admin);
      })
      .catch(() => {
        /* non-admin / offline: leave the entry hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <StubPage title={t("settings:title")} phase={11}>
      <div className="flex flex-col gap-5 pt-2">
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-light-2 dark:text-ink-dark-2 mb-2 px-1">
            {t("settings:language.title")}
          </h2>
          <Card padding="none" className="overflow-hidden">
            <div className="flex">
              {SUPPORTED_LOCALES.map((locale) => (
                <button
                  key={locale}
                  type="button"
                  onClick={() => {
                    haptics.selection();
                    setLocale(locale);
                  }}
                  className={`ds-tactile flex-1 min-h-[48px] font-medium ${
                    locale === currentLocale
                      ? "bg-brand-primary text-white"
                      : "bg-transparent text-ink-light-1 dark:text-ink-dark-1"
                  }`}
                >
                  {t(`settings:language.${locale}`)}
                </button>
              ))}
            </div>
          </Card>
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-light-2 dark:text-ink-dark-2 mb-2 px-1">
            {t("common:nav.settings")}
          </h2>
          <Card
            padding="none"
            className="overflow-hidden divide-y divide-ink-light-2/10 dark:divide-ink-dark-2/10"
          >
            <ToggleRow
              label={t("settings:sound")}
              on={sound}
              onToggle={() => {
                setSound((v) => !v);
              }}
            />
            <ToggleRow
              label={t("settings:haptics")}
              on={hapticsOn}
              onToggle={() => {
                setHapticsOn((v) => !v);
              }}
            />
            <ToggleRow
              label={t("settings:anonymous")}
              on={anon}
              onToggle={() => {
                setAnon((v) => !v);
              }}
            />
          </Card>
        </section>

        {isAdmin ? (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-light-2 dark:text-ink-dark-2 mb-2 px-1">
              {t("admin:moderation.title")}
            </h2>
            <Card padding="none" className="overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  haptics.selection();
                  navigate("/admin/moderation");
                }}
                className="ds-tactile w-full flex items-center justify-between px-4 py-3 min-h-[48px] active:bg-surface-light-2 dark:active:bg-surface-dark-2"
              >
                <span className="font-medium text-base text-ink-light-1 dark:text-ink-dark-1">
                  {t("admin:moderation.entry")}
                </span>
                <span aria-hidden className="text-ink-light-2 dark:text-ink-dark-2">→</span>
              </button>
            </Card>
          </section>
        ) : null}

        <section className="pt-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-light-2 dark:text-ink-dark-2 mb-2 px-1">
            {t("settings:about.title")}
          </h2>
          <Card padding="md" className="text-center">
            <p className="font-display font-bold text-lg text-brand-accent">
              {t("brand:exclamation")}
            </p>
            <p className="text-sm text-ink-light-2 dark:text-ink-dark-2 mt-1 italic">
              {t("settings:about.tagline")}
            </p>
            <p className="text-base text-ink-light-1 dark:text-ink-dark-1 mt-3">
              {t("settings:about.built_by")}{" "}
              <span className="font-semibold">
                {t("settings:about.author")}
              </span>
            </p>
            <p className="text-xs text-ink-light-2 dark:text-ink-dark-2 mt-2 opacity-70">
              {t("settings:about.copyright")}
            </p>
          </Card>
          <div className="flex items-center justify-center gap-4 mt-3">
            <button
              type="button"
              className="text-sm font-semibold text-brand-primary"
              onClick={() => {
                navigate("/privacy");
              }}
            >
              {t("settings:about.privacy")}
            </button>
            <span aria-hidden className="text-ink-light-2 dark:text-ink-dark-2">·</span>
            <button
              type="button"
              className="text-sm font-semibold text-brand-primary"
              onClick={() => {
                navigate("/terms");
              }}
            >
              {t("settings:about.terms")}
            </button>
          </div>
        </section>
      </div>
    </StubPage>
  );
}
