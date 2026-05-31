import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { IconButton } from "@/components/ds/IconButton";
import { safeNavigateBack } from "@/lib/navigation";

interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalPageProps {
  /** Which document to render — selects the `legal:<doc>.*` keys. */
  doc: "privacy" | "terms";
}

/**
 * Privacy Policy / Terms of Service (spec §12). Locale-aware, public — the
 * SPA serves these at `/privacy` and `/terms`, so the same URLs work in a
 * browser (for BotFather's privacy link) and inside Telegram.
 */
export function LegalPage({ doc }: LegalPageProps): JSX.Element {
  const { t } = useTranslation(["legal", "common"]);
  const navigate = useNavigate();

  const sections =
    doc === "privacy"
      ? (t("legal:privacy.sections", { returnObjects: true }) as LegalSection[])
      : (t("legal:terms.sections", { returnObjects: true }) as LegalSection[]);
  const title = doc === "privacy" ? t("legal:privacy.title") : t("legal:terms.title");
  const updated = doc === "privacy" ? t("legal:privacy.updated") : t("legal:terms.updated");

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
        <h1 className="font-display font-bold text-xl flex-1 truncate text-ink-light-1 dark:text-ink-dark-1">
          {title}
        </h1>
      </header>

      <main className="flex-1 px-4 pt-3 pb-10 flex flex-col gap-6">
        <p className="text-xs text-ink-light-2 dark:text-ink-dark-2">{updated}</p>
        {sections.map((section, i) => (
          <section key={i} className="flex flex-col gap-2">
            <h2 className="font-display font-bold text-base text-ink-light-1 dark:text-ink-dark-1">
              {section.heading}
            </h2>
            {section.body.map((para, j) => (
              <p key={j} className="text-sm leading-relaxed text-ink-light-2 dark:text-ink-dark-2">
                {para}
              </p>
            ))}
          </section>
        ))}
      </main>
    </>
  );
}
