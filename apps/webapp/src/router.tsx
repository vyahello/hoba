import { createBrowserRouter } from "react-router-dom";

import { RootLayout } from "@/components/layout/RootLayout";
import { CreatePage } from "@/pages/CreatePage";
import { DevDSPage } from "@/pages/DevDSPage";
import { HomePage } from "@/pages/HomePage";
import { LibraryPage } from "@/pages/LibraryPage";
import { RoomPage } from "@/pages/RoomPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SpinPage } from "@/pages/SpinPage";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/spin/:wheelId", element: <SpinPage /> },
      { path: "/create", element: <CreatePage /> },
      { path: "/room/:code", element: <RoomPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/dev/ds", element: <DevDSPage /> },
    ],
  },
]);
