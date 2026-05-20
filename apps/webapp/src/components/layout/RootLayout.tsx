import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { Toaster } from "@/components/ds/Toast";
import { tg } from "@/lib/telegram";

/**
 * Root layout — owns Telegram BackButton binding and the document scroll
 * container. Every page renders inside the `<Outlet />`. BackButton shows
 * on non-root routes only and calls `navigate(-1)` on press, matching the
 * native back gesture users expect.
 */
export function RootLayout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

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
      <Outlet />
      <Toaster />
    </div>
  );
}
