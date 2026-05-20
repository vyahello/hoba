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

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: ["localhost", ...DEV_TUNNEL_HOSTS],
  },
});
