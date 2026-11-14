import { defineConfig } from 'vite';

// Relative base keeps the build deployable under a sub-path such as stratolark.dev/quick-studies/ (2026-11-14).
const COACH_SERVER_PORT = Number(process.env.QS_SERVER_PORT || 8787);

export default defineConfig({
  base: './',
  server: {
    // In development the optional AI coach backend runs separately; the proxy keeps the browser on one origin (2026-11-14).
    proxy: { '/api': `http://localhost:${COACH_SERVER_PORT}` },
  },
  // three.js alone is about 490 kB and the start screen needs it at once, so splitting it gains nothing (2026-11-14).
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 700 },
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
