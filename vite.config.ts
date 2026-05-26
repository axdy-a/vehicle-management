import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CI sets VITE_BASE_PATH=/repository-name/ for GitHub Project Pages asset URLs.
function baseUrl(): string {
  const raw = process.env.VITE_BASE_PATH?.trim();
  if (!raw) return './';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`;
}

export default defineConfig({
  plugins: [react()],
  base: baseUrl(),
});
