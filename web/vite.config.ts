import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the page is served by Vite and the API by uvicorn (uv run uvicorn server:app).
// ws: the text chat's WebSocket (/api/chat).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": { target: "http://127.0.0.1:8000", ws: true } } },
});
