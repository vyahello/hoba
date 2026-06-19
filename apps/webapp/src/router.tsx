import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";

import { RootLayout } from "@/components/layout/RootLayout";

// Routes are code-split (PERF_AUDIT S1): only the matched screen's chunk
// loads, keeping the first-paint bundle small. The shell (RootLayout) stays
// eager; the Suspense boundary lives there, around <Outlet />. Pages are
// named exports, so map them to the default export React.lazy expects.
const HomePage = lazy(() => import("@/pages/HomePage").then((m) => ({ default: m.HomePage })));
const SpinPage = lazy(() => import("@/pages/SpinPage").then((m) => ({ default: m.SpinPage })));
const CreatePage = lazy(() => import("@/pages/CreatePage").then((m) => ({ default: m.CreatePage })));
const RoomPage = lazy(() => import("@/pages/RoomPage").then((m) => ({ default: m.RoomPage })));
const LibraryPage = lazy(() => import("@/pages/LibraryPage").then((m) => ({ default: m.LibraryPage })));
const TrendingPage = lazy(() => import("@/pages/TrendingPage").then((m) => ({ default: m.TrendingPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const AdminModerationPage = lazy(() =>
  import("@/pages/AdminModerationPage").then((m) => ({ default: m.AdminModerationPage })),
);
const LegalPage = lazy(() => import("@/pages/LegalPage").then((m) => ({ default: m.LegalPage })));
const CreditsPage = lazy(() => import("@/pages/CreditsPage").then((m) => ({ default: m.CreditsPage })));
const DevDSPage = lazy(() => import("@/pages/DevDSPage").then((m) => ({ default: m.DevDSPage })));

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/spin/:wheelId", element: <SpinPage /> },
      { path: "/create", element: <CreatePage /> },
      { path: "/room/:code", element: <RoomPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/trending", element: <TrendingPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/admin/moderation", element: <AdminModerationPage /> },
      { path: "/privacy", element: <LegalPage doc="privacy" /> },
      { path: "/terms", element: <LegalPage doc="terms" /> },
      { path: "/credits", element: <CreditsPage /> },
      { path: "/dev/ds", element: <DevDSPage /> },
    ],
  },
]);
