import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    open: false,
    watch: {
      // The capture/compare harness lives in tools/ and writes scratch files.
      // Without this, touching it forces a full page reload mid-screenshot.
      ignored: ['**/tools/**', '**/dist/**', '**/*.md', '**/*.py', '**/public/**'],
    },
  },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500, sourcemap: false },
});
