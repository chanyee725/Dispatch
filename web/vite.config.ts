import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Builds into ../public, which the Dispatch server serves. `npm run dev` proxies the API to a running server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { outDir: "../public", emptyOutDir: true },
  server: { proxy: { "/api": `http://127.0.0.1:${process.env.DISPATCH_PORT || 4317}` } },
});
