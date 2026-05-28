import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveIngestUrl } from './scripts/resolve-ingest-url.mjs';

// CI sets VITE_BASE_PATH=/repository-name/ for GitHub Project Pages asset URLs.
function baseUrl(): string {
  const raw = process.env.VITE_BASE_PATH?.trim();
  if (!raw) return './';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ingest = resolveIngestUrl({ ...process.env, ...env });

  /** Dev-only: POST from the browser to same-origin path, Vite forwards to Apps Script (no CORS). */
  const fleetIngestProxy =
    ingest && mode === 'development'
      ? {
          '/__fleet_ingest': {
            target: new URL(ingest).origin,
            changeOrigin: true,
            rewrite: () => `${new URL(ingest).pathname}${new URL(ingest).search}`,
          },
        }
      : undefined;

  return {
    plugins: [react()],
    base: baseUrl(),
    /** Baked into the client bundle — empty string ⇒ live app shows “Not sent — no server.” */
    define: {
      'import.meta.env.VITE_INGEST_URL': JSON.stringify(ingest),
    },
    server: {
      proxy: fleetIngestProxy,
    },
  };
});
