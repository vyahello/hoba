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
    <div className="min-h-[100dvh] bg-ds-bg text-ds-text px-6 py-10 flex flex-col items-center text-center gap-4">
      <HobaWord trigger />
      <h1 className="font-display font-bold text-2xl mt-4">
        {t("crash.title")}
      </h1>
      <p className="text-ds-text-muted text-base max-w-sm">
        {t("crash.description")}
      </p>
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
        className="ds-tactile bg-brand-primary text-white border-[3px] border-ds-border shadow-brutal active:shadow-brutal-sm px-6 py-3 min-h-[48px] rounded-md font-display font-bold"
      >
        {t("crash.reload")}
      </button>
      <details className="mt-4 max-w-full self-stretch">
        <summary className="cursor-pointer text-sm text-ds-text-muted">
          {t("crash.details_label")}
        </summary>
        <pre className="mt-2 text-xs text-state-danger whitespace-pre-wrap break-words bg-ds-surface-2 p-3 rounded-md overflow-auto text-left">
          {error.name}: {error.message}
          {"\n\n"}
          {error.stack ?? "(no stack)"}
        </pre>
      </details>
    </div>
  );
}
