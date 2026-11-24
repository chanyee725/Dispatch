import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('../public', import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    host: '127.0.0.1',
    // changeOrigin: the server rejects Host headers other than its own port.
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.DRAW_PORT ?? 4330}`, changeOrigin: true } },
  },
});
