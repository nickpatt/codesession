import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite dev/build config. During development we proxy API + WebSocket traffic
 * to the session-server on :8080 so the browser only ever talks to one origin
 * (:5173) — this sidesteps CORS and mirrors how a reverse proxy behaves in prod.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/control": { target: "ws://localhost:8080", ws: true },
    },
  },
});
