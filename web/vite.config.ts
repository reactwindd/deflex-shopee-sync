import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + OAuth callback to the sync server on :8082.
// Production: `vite build` → dist/ served directly by server.js.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8082',
      '/shopee': 'http://localhost:8082',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
