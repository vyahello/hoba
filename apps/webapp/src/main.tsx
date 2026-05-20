import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import "@/i18n";
import "@/index.css";

import { expand, ready } from "@/lib/telegram";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { router } from "@/router";

ready();
expand();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);
