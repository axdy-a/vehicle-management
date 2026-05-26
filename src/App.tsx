import { useCallback, useMemo, useState } from 'react';
import { scanPhotosForMetrics } from './ocr/scanPhotos';

const STORAGE_KEY = 'fleet_access_ok_v1';
/** Fallback when `VITE_FLEET_PASSWORD` is not set at build time. */
const DEFAULT_FLEET_PASSWORD = 'grabmapssg';

const DEMO_VEHICLES = [
  { id: 'vh-001', label: 'SBA1234Z — Toyota Hiace', plate: 'SBA1234Z' },
  { id: 'vh-002', label: 'SBS5678H — Mitsubishi Fuso', plate: 'SBS5678H' },
  { id: 'vh-003', label: 'SHC9012X — Renault Master', plate: 'SHC9012X' },
];

function readStoredUnlock(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const [unlocked, setUnlocked] = useState<boolean>(() =>
    typeof window !== 'undefined' ? readStoredUnlock() : false,
  );
  const [code, setCode] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [vehicleId, setVehicleId] = useState(DEMO_VEHICLES[0]?.id ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [mileage, setMileage] = useState('');
  const [cashcard, setCashcard] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrLine, setOcrLine] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const passwordOk = useCallback((entered: string) => {
    // Client check is UX-only; Apps Script / Cloud must validate fleet secret server-side.
    const fromEnv = import.meta.env.VITE_FLEET_PASSWORD;
    const expected =
      typeof fromEnv === 'string' && fromEnv.length > 0
        ? fromEnv
        : DEFAULT_FLEET_PASSWORD;
    return entered === expected;
  }, []);

  const handleUnlock = useCallback(() => {
    if (!passwordOk(code)) {
      setUnlockError('Access code not recognised. Check with your fleet admin.');
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setUnlockError(null);
    setUnlocked(true);
  }, [code, passwordOk]);

  const handleLock = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setUnlocked(false);
    setCode('');
  }, []);

  const onFiles = useCallback((list: FileList | null) => {
    if (!list?.length) return;
    setFiles(Array.from(list));
    setOcrLine(null);
    setOcrError(null);
  }, []);

  const runOcrGuess = useCallback(async () => {
    if (!files.length) return;
    setOcrBusy(true);
    setOcrError(null);
    setOcrLine('Starting on-device OCR (Tesseract)…');

    try {
      const guess = await scanPhotosForMetrics(files, (status) =>
        setOcrLine(status),
      );

      if (guess.mileageKm) setMileage(guess.mileageKm);
      if (guess.cashBalance) setCashcard(guess.cashBalance);

      if (!guess.mileageKm && !guess.cashBalance) {
        setOcrError(
          'Could not confidently read mileage or balance. Try sharper photos or edit fields manually.',
        );
        setOcrLine(null);
      } else {
        setOcrLine('Done — check numbers before submitting.');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'OCR failed. Try again or enter values manually.';
      setOcrError(msg);
      setOcrLine(null);
    } finally {
      setOcrBusy(false);
    }
  }, [files]);

  const selectedVehicleLabel = useMemo(() => {
    return DEMO_VEHICLES.find((v) => v.id === vehicleId)?.label ?? 'Select vehicle';
  }, [vehicleId]);

  if (!unlocked) {
    return (
      <div className="app-shell">
        <header className="brand-strip">
          <div className="brand-title">
            <h1>Fleet Logs</h1>
            <p className="brand-sub">Photos → Sheet (fleet access)</p>
          </div>
          <span className="pill-muted">Mobile</span>
        </header>

        <div className="hero-map" aria-hidden>
          <div className="hero-pin">
            <div className="hero-pin-dot" />
          </div>
        </div>

        <main className="card stack">
          <div>
            <label className="label" htmlFor="fleet-code">
              Fleet access code
            </label>
            <input
              id="fleet-code"
              className="input"
              type="password"
              placeholder="Enter code"
              autoComplete="off"
              value={code}
              onChange={(e) => {
                setUnlockError(null);
                setCode(e.target.value);
              }}
            />
          </div>
          {unlockError ? <div className="error-banner">{unlockError}</div> : null}
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--grab-ink-muted)' }}>
            This screen is themed like a Grab-style map app — green primary, light map
            canvas, rounded cards. Wire the code check to your Apps Script / Cloud
            endpoint (see README).
          </p>
          <button type="button" className="btn btn-primary" onClick={handleUnlock}>
            Unlock app
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="brand-strip">
        <div className="brand-title">
          <h1>Fleet Logs</h1>
          <p className="brand-sub">{selectedVehicleLabel}</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={handleLock}>
          Lock
        </button>
      </header>

      <div className="hero-map" aria-hidden>
        <div className="hero-pin">
          <div className="hero-pin-dot" />
        </div>
      </div>

      <main className="card stack">
        <div>
          <label className="label" htmlFor="vehicle">
            Vehicle
          </label>
          <select
            id="vehicle"
            className="select"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            {DEMO_VEHICLES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="photos">
            Photos
          </label>
          <div className="upload-zone">
            <strong>Bulk add photos</strong>
            <p>Dash, odometer, cashcard, fuel — multiple files ok.</p>
            <div style={{ marginTop: 12 }}>
              <input
                id="photos"
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                onChange={(e) => onFiles(e.target.files)}
              />
            </div>
            <div className="hint-row" style={{ marginTop: 12, justifyContent: 'center' }}>
              <span className="hint-chip">Camera</span>
              <span className="hint-chip">Gallery</span>
              <span className="hint-chip">Tesseract OCR</span>
            </div>
          </div>
          {files.length > 0 ? (
            <ul className="file-list" aria-label="Selected files">
              {files.map((f) => (
                <li key={`${f.name}-${f.size}`}>
                  <span>{f.name}</span>
                  <span>{(f.size / 1024).toFixed(0)} KB</span>
                </li>
              ))}
            </ul>
          ) : null}

          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 12, width: '100%' }}
            disabled={files.length === 0 || ocrBusy}
            onClick={runOcrGuess}
          >
            {ocrBusy ? 'Scanning on device…' : 'Guess mileage & cashcard'}
          </button>
          <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--grab-ink-muted)' }}>
            Free: runs locally in your browser (first load downloads language pack from CDN).
            Always verify before submitting.
          </p>
          {ocrLine ? (
            <div className="ocr-strip" aria-live="polite">
              <strong>Status:</strong> {ocrLine}
            </div>
          ) : null}
          {ocrError ? <div className="error-banner">{ocrError}</div> : null}
        </div>

        <div className="field-row-grid">
          <div>
            <label className="label" htmlFor="mileage">
              Mileage (km)
            </label>
            <input
              id="mileage"
              className="input"
              inputMode="decimal"
              placeholder="e.g. 128450"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="cashcard">
              Cashcard ($)
            </label>
            <input
              id="cashcard"
              className="input"
              inputMode="decimal"
              placeholder="e.g. 24.80"
              value={cashcard}
              onChange={(e) => setCashcard(e.target.value)}
            />
          </div>
        </div>
      </main>

      <footer className="bottom-bar">
        <button type="button" className="btn btn-secondary">
          Preview
        </button>
        <button type="button" className="btn btn-primary">
          Submit log
        </button>
      </footer>
      <p
        style={{
          margin: '8px 0 0',
          fontSize: '0.76rem',
          color: 'var(--grab-ink-muted)',
          textAlign: 'center',
        }}
      >
        Buttons are UI-only until you connect your ingest URL.
      </p>
    </div>
  );
}
