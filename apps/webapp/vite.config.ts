import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev-tunnel hosts (cloudflared, ngrok, localtunnel). A leading "." matches
// the domain and any subdomain — the trycloudflare hostname changes every
// time `cloudflared tunnel --url ...` is restarted. Production hosts join
// this list in Phase 12.
const DEV_TUNNEL_HOSTS = [
  ".trycloudflare.com",
  ".ngrok.io",
  ".ngrok-free.app",
  ".loca.lt",
];

// API target for the dev proxy. Inside Docker the api container is
// reachable as `http://api:8000`; bare `pnpm dev` on the host needs
// `http://localhost:8000`. Override via `VITE_API_TARGET=...` if needed.
const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: ["localhost", ...DEV_TUNNEL_HOSTS],
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/socket.io": {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
