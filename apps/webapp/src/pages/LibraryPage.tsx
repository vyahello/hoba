import { useTranslation } from "react-i18next";

import { StubPage } from "@/components/layout/StubPage";

export function LibraryPage(): JSX.Element {
  const { t } = useTranslation("home");
  return <StubPage title={t("my_wheels.title")} phase={9} />;
}
