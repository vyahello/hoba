import { useTranslation } from "react-i18next";

import { HobaWord } from "@/components/ds/HobaWord";

/**
 * Brand-keyed crash screen rendered by `AppErrorBoundary` when render
 * throws. Lives outside the design system because it must be reachable
 * even when bigger DS surfaces are part of what crashed — keep its
 * dependencies minimal (just `HobaWord` for the brand mark).
 */
export function CrashScreen({ error }: { error: Error }): JSX.Element {
  const { t } = useTranslation("common");
  return (
    <div className="min-h-[100dvh] bg-bg-light dark:bg-bg-dark text-ink-light-1 dark:text-ink-dark-1 px-6 py-10 flex flex-col items-center text-center gap-4">
      <HobaWord trigger />
      <h1 className="font-display font-bold text-2xl mt-4">
        {t("crash.title")}
      </h1>
      <p className="text-ink-light-2 dark:text-ink-dark-2 text-base max-w-sm">
        {t("crash.description")}
      </p>
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
        className="ds-tactile bg-brand-primary text-white px-6 py-3 min-h-[48px] rounded-md font-medium active:bg-brand-primary-strong"
      >
        {t("crash.reload")}
      </button>
      <details className="mt-4 max-w-full self-stretch">
        <summary className="cursor-pointer text-sm text-ink-light-2 dark:text-ink-dark-2">
          {t("crash.details_label")}
        </summary>
        <pre className="mt-2 text-xs text-state-danger whitespace-pre-wrap break-words bg-surface-light-2 dark:bg-surface-dark-2 p-3 rounded-md overflow-auto text-left">
          {error.name}: {error.message}
          {"\n\n"}
          {error.stack ?? "(no stack)"}
        </pre>
      </details>
    </div>
  );
}
