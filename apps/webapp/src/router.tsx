import { createBrowserRouter } from "react-router-dom";

import { RootLayout } from "@/components/layout/RootLayout";
import { CreatePage } from "@/pages/CreatePage";
import { DevDSPage } from "@/pages/DevDSPage";
import { HomePage } from "@/pages/HomePage";
import { LegalPage } from "@/pages/LegalPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { RoomPage } from "@/pages/RoomPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SpinPage } from "@/pages/SpinPage";
import { TrendingPage } from "@/pages/TrendingPage";

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
      { path: "/privacy", element: <LegalPage doc="privacy" /> },
      { path: "/terms", element: <LegalPage doc="terms" /> },
      { path: "/dev/ds", element: <DevDSPage /> },
    ],
  },
]);
