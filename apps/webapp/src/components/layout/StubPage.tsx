import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/ds/EmptyState";

export interface StubPageProps {
  title: string;
  /** Spec §15 phase number that fills this route in. */
  phase: number;
  children?: ReactNode;
}

export function StubPage({ title, phase, children }: StubPageProps): JSX.Element {
  const { t } = useTranslation("common");
  return (
    <>
      <header className="ds-glass-header px-4 py-3 pt-safe">
        <h1 className="font-display font-bold text-xl text-ds-text">
          {title}
        </h1>
      </header>
      <main className="flex-1 px-4 pt-3 pb-10">
        {children ?? (
          <EmptyState
            title={t("status.coming_soon")}
            description={t("status.phase_label", { phase })}
          />
        )}
      </main>
    </>
  );
}
