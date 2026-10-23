import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The static shell (index.html + assets) lives in ./public and is copied in
// verbatim, so the original markup and styling stay byte-identical.
// NOTE: after the apps/ restructure this moved from ../public to ./public;
// pointing at ../public silently emitted a page with no images or audio.

/**
 * Substitute the Monetag zone into index.html at build time.
 *
 * The SDK tag must exist before the app script runs, so it cannot be injected
 * from JS. Keeping a placeholder in the HTML and filling it here means the zone
 * lives in one place (VITE_AD_ZONE) instead of being hand-edited in markup.
 * With no zone configured the tag is removed entirely, so an unconfigured build
 * ships no third-party request rather than a broken one.
 */
function monetagZone() {
  return {
    name: 'monetag-zone',
    transformIndexHtml(html) {
      const zone = process.env.VITE_AD_ZONE ?? '';
      if (!zone) {
        return html.replace(/^.*__AD_ZONE__.*$/m, '    <!-- Monetag SDK omitted: VITE_AD_ZONE not set -->');
      }
      return html
        .replaceAll('__AD_ZONE__', zone)
        .replaceAll('__AD_SDK__', `show_${zone}`);
    },
  };
}

export default defineConfig({
  plugins: [monetagZone()],
  root: resolve(__dirname, 'src'),
  publicDir: resolve(__dirname, 'public'),
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
