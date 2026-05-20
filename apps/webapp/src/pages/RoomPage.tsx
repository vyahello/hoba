import { useParams } from "react-router-dom";

import { RoomCodePill } from "@/components/ds/RoomCodePill";
import { StubPage } from "@/components/layout/StubPage";

export function RoomPage(): JSX.Element {
  const { code = "TEST01" } = useParams<{ code: string }>();
  return (
    <StubPage title="Room" phase={6}>
      <div className="flex flex-col items-center pt-8 gap-4">
        <RoomCodePill code={code.toUpperCase()} />
        <p className="text-sm text-ink-light-2 dark:text-ink-dark-2 text-center max-w-xs">
          Multiplayer lobby + spin sync arrive in Phase 6.
        </p>
      </div>
    </StubPage>
  );
}
