import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The built UI goes to `dist/`, which the server serves at `/` on its own port (one origin per address).
 * `pnpm dev` here proxies the API to a test server: REELNOTE_DEV_API (default http://127.0.0.1:3911, never the real
 * server on 3900: a dev run must not touch the real data dir).
 */
const api = process.env.REELNOTE_DEV_API ?? 'http://127.0.0.1:3911';

export default defineConfig({
  plugins: [react()],
  publicDir: 'static',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true, chunkSizeWarningLimit: 1200 },
  // changeOrigin off: the server checks a write's Origin against the Host the browser used.
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: api, changeOrigin: false }, '/images': { target: api, changeOrigin: false } } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
