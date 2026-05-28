import fs from 'node:fs';
import path from 'node:path';

/**
 * Build-time ingest URL: GitHub Actions env `VITE_INGEST_URL` wins, else `public/fleet-config.json`.
 */
export function resolveIngestUrl(env = process.env) {
  const fromEnv = env.VITE_INGEST_URL?.trim();
  if (fromEnv) return fromEnv;

  const configPath = path.resolve(process.cwd(), 'public', 'fleet-config.json');
  if (!fs.existsSync(configPath)) return '';

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const url = parsed?.ingestUrl;
    return typeof url === 'string' ? url.trim() : '';
  } catch {
    return '';
  }
}
