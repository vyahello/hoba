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
//
// Each track deep-links by ISRC to incompetech.com — Kevin MacLeod's own
// site and the canonical attribution domain named in the CC-BY credit line.
// We point here (not filmmusic.io) because filmmusic.io migrated to ende.app
// and its per-track pages now 404; incompetech.com is the durable source.
// The ISRCs are recorded in docs/audio-licenses.md.
const incompetech = (isrc: string): string =>
  `https://incompetech.com/music/royalty-free/index.html?isrc=${isrc}`;
const MUSIC_CREDITS: MusicCredit[] = [
  { title: "Batty McFaddin – Slower", author: "Kevin MacLeod", license: "cc_by", sourceUrl: incompetech("USUAN1200003") },
  { title: "Carpe Diem", author: "Kevin MacLeod", license: "cc_by", sourceUrl: incompetech("USUAN1600023") },
  { title: "Off to Osaka", author: "Kevin MacLeod", license: "cc_by", sourceUrl: incompetech("USUAN1100128") },
  { title: "Fig Leaf Rag – distressed", author: "Kevin MacLeod", license: "cc_by", sourceUrl: incompetech("USUAN1100702") },
  { title: "The Path of the Goblin King", author: "Kevin MacLeod", license: "cc_by", sourceUrl: incompetech("USUAN1100874") },
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
        <h1 className="font-display font-bold text-xl flex-1 truncate text-ds-text">
          {t("credits:title")}
        </h1>
      </header>

      <main className="flex-1 px-4 pt-3 pb-10 flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="font-display font-bold text-base text-ds-text">
            {t("credits:music.heading")}
          </h2>
          <p className="text-sm leading-relaxed text-ds-text-muted">
            {t("credits:music.intro")}
          </p>
          <ul className="flex flex-col gap-3">
            {MUSIC_CREDITS.map((c, i) => (
              <li
                key={i}
                className="rounded-2xl bg-ds-surface-2 px-4 py-3 flex flex-col gap-1"
              >
                <p className="text-sm font-semibold text-ds-text">
                  {c.title !== "" ? c.title : t("credits:music.pixabay_track")}
                  {c.author !== null && (
                    <span className="font-normal text-ds-text-muted">
                      {" "}
                      {t("credits:music.by")} {c.author}
                    </span>
                  )}
                </p>
                <p className="text-xs text-ds-text-muted opacity-80">
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
          <h2 className="font-display font-bold text-base text-ds-text">
            {t("credits:sound.heading")}
          </h2>
          <p className="text-sm leading-relaxed text-ds-text-muted">
            {t("credits:sound.body")}
          </p>
        </section>
      </main>
    </>
  );
}
