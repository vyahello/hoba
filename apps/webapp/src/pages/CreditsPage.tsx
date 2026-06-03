import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { audio } from "@/audio";
import { IconButton } from "@/components/ds/IconButton";
import { haptics } from "@/lib/haptics";
import { safeNavigateBack } from "@/lib/navigation";
import { openExternalLink } from "@/lib/telegram";

const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/";

/**
 * One background-music track's attribution. Titles + author are proper-noun
 * source data (not translatable copy); the surrounding labels go through t().
 */
interface MusicCredit {
  /** Track title as published (proper noun — not translated). */
  title: string;
  /** Author, or null for the no-attribution Pixabay track. */
  author: string | null;
  license: "cc_by" | "pixabay";
  /** Where the track came from. */
  sourceUrl: string;
}

// Kevin MacLeod tracks are CC-BY 4.0 → attribution is mandatory (see
// docs/audio-licenses.md). The Pixabay track needs none but is credited too.
const INCOMPETECH = "https://incompetech.com/music/royalty-free/";
const MUSIC_CREDITS: MusicCredit[] = [
  { title: "Batty McFadden – Slower", author: "Kevin MacLeod", license: "cc_by", sourceUrl: INCOMPETECH },
  { title: "Carpe Diem", author: "Kevin MacLeod", license: "cc_by", sourceUrl: INCOMPETECH },
  { title: "Off to Osaka", author: "Kevin MacLeod", license: "cc_by", sourceUrl: INCOMPETECH },
  { title: "Fig Leaf Rag – distressed", author: "Kevin MacLeod", license: "cc_by", sourceUrl: INCOMPETECH },
  { title: "The Path of the Goblin King", author: "Kevin MacLeod", license: "cc_by", sourceUrl: INCOMPETECH },
  { title: "", author: null, license: "pixabay", sourceUrl: "https://pixabay.com/music/" },
];

/** Credits / attributions (Settings → Credits). Satisfies the CC-BY 4.0
 *  attribution requirement for the Kevin MacLeod music tracks. */
export function CreditsPage(): JSX.Element {
  const { t } = useTranslation(["credits", "common"]);
  const navigate = useNavigate();

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
          {t("credits:title")}
        </h1>
      </header>

      <main className="flex-1 px-4 pt-3 pb-10 flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="font-display font-bold text-base text-ink-light-1 dark:text-ink-dark-1">
            {t("credits:music.heading")}
          </h2>
          <p className="text-sm leading-relaxed text-ink-light-2 dark:text-ink-dark-2">
            {t("credits:music.intro")}
          </p>
          <ul className="flex flex-col gap-3">
            {MUSIC_CREDITS.map((c, i) => (
              <li
                key={i}
                className="rounded-2xl bg-surface-light-2 dark:bg-surface-dark-2 px-4 py-3 flex flex-col gap-1"
              >
                <p className="text-sm font-semibold text-ink-light-1 dark:text-ink-dark-1">
                  {c.title !== "" ? c.title : t("credits:music.pixabay_track")}
                  {c.author !== null && (
                    <span className="font-normal text-ink-light-2 dark:text-ink-dark-2">
                      {" "}
                      {t("credits:music.by")} {c.author}
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-light-2 dark:text-ink-dark-2 opacity-80">
                  {c.license === "cc_by"
                    ? t("credits:music.license_cc_by")
                    : t("credits:music.license_pixabay")}
                </p>
                <div className="flex items-center gap-4 mt-1">
                  <button
                    type="button"
                    className="text-xs font-semibold text-brand-primary"
                    onClick={() => {
                      haptics.selection();
                      audio.play("ui_tap");
                      openExternalLink(c.sourceUrl);
                    }}
                  >
                    {t("credits:music.view_source")}
                  </button>
                  {c.license === "cc_by" && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand-primary"
                      onClick={() => {
                        haptics.selection();
                        audio.play("ui_tap");
                        openExternalLink(CC_BY_URL);
                      }}
                    >
                      {t("credits:music.view_license")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-display font-bold text-base text-ink-light-1 dark:text-ink-dark-1">
            {t("credits:sound.heading")}
          </h2>
          <p className="text-sm leading-relaxed text-ink-light-2 dark:text-ink-dark-2">
            {t("credits:sound.body")}
          </p>
        </section>
      </main>
    </>
  );
}
