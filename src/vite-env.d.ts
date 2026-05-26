/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FLEET_PASSWORD?: string;
  /** Google Apps Script (or other) POST endpoint for sheet sync */
  readonly VITE_INGEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
