/**
 * URL used for `fetch` from the browser.
 *
 * In **development**, Vite proxies `/__fleet_ingest` → `VITE_INGEST_URL` so localhost is not blocked
 * by CORS (Google often omits CORS headers on 401/login HTML, which looks like a CORS failure).
 *
 * A **401** from Apps Script is still an access / deployment issue (“Who has access”, Workspace SSO,
 * etc.) — fix that on the Google side; the proxy only removes the browser cross-origin layer.
 */
export function getIngestFetchUrl(): string {
  const raw = import.meta.env.VITE_INGEST_URL?.trim() ?? '';
  if (!raw) return '';
  if (import.meta.env.DEV) {
    return '/__fleet_ingest';
  }
  return raw;
}
