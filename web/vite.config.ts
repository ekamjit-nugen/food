import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api to the Express backend so the browser can keep
// using same-origin requests (no CORS, no absolute URLs in code). In prod both
// are served from the same host, so the proxy is dev-only.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
