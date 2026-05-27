import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev-tunnel hosts (cloudflared, ngrok, localtunnel, DuckDNS). A leading
// "." matches the domain and any subdomain — the trycloudflare hostname
// changes every time `cloudflared tunnel --url ...` is restarted, and
// DuckDNS-routed soft-launch deployments use a `*.duckdns.org` hostname.
// Real production hosts (custom domain) come in via the env var below.
const DEV_TUNNEL_HOSTS = [
  ".trycloudflare.com",
  ".ngrok.io",
  ".ngrok-free.app",
  ".loca.lt",
  ".duckdns.org",
];

// Extra hostnames Vite's dev server should accept on the Host header.
// Comma-separated, set in `.env` (read at build/dev start). Use this
// when the soft-launch domain isn't covered by DEV_TUNNEL_HOSTS — e.g.
// VITE_ALLOWED_HOSTS=hoba.example.com,play.example.com
const ENV_ALLOWED_HOSTS = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

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
    allowedHosts: ["localhost", ...DEV_TUNNEL_HOSTS, ...ENV_ALLOWED_HOSTS],
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
