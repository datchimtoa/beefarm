import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The static shell (index.html + assets) lives in ../public and is copied in
// verbatim, so the original markup and styling stay byte-identical.
export default defineConfig({
  root: resolve(__dirname, 'src'),
  publicDir: resolve(__dirname, '../public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    port: 5173,
    // Local dev: forward /api to the Node server.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8800',
        changeOrigin: true,
      },
    },
  },
});
