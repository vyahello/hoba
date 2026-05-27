import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { AuroraBackground } from "@/components/ds/AuroraBackground";
import { Toaster } from "@/components/ds/Toast";
import { parseRoomDeepLink } from "@/lib/startParam";
import { readStartParam, tg } from "@/lib/telegram";

/**
 * Root layout — owns Telegram BackButton binding and the document scroll
 * container. Every page renders inside the `<Outlet />`. BackButton shows
 * on non-root routes only and calls `navigate(-1)` on press, matching the
 * native back gesture users expect.
 */
export function RootLayout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const handledStartParam = useRef(false);

  // Deep-link entry: if Telegram opened us with `?startapp=room_XYZ`,
  // jump straight to that room. Runs once on first mount. `readStartParam`
  // reads SDK → URL hash → URL query in that order — the hash fallback
  // is what makes Direct Link Mini App launches work on @twa-dev/sdk
  // v7.10.1, which does not surface top-level `tgWebAppStartParam`.
  useEffect(() => {
    if (handledStartParam.current) return;
    handledStartParam.current = true;
    const startParam = readStartParam();
    if (startParam === undefined) return;
    const roomCode = parseRoomDeepLink(startParam);
    if (roomCode !== undefined) {
      navigate(`/room/${roomCode}`, { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (location.pathname === "/") {
      tg.BackButton?.hide?.();
    } else {
      tg.BackButton?.show?.();
    }
  }, [location.pathname]);

  useEffect(() => {
    const handler = (): void => {
      navigate(-1);
    };
    tg.BackButton?.onClick?.(handler);
    return () => {
      tg.BackButton?.offClick?.(handler);
    };
  }, [navigate]);

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <AuroraBackground />
      <Outlet />
      <Toaster />
    </div>
  );
}
