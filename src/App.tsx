import { useCallback, useMemo, useState } from 'react';
import { scanPhotosForMetrics } from './ocr/scanPhotos';

const STORAGE_KEY = 'fleet_access_ok_v1';
/** Fallback when `VITE_FLEET_PASSWORD` is not set at build time. */
const DEFAULT_FLEET_PASSWORD = 'grabmapssg';

const DEMO_VEHICLES = [
  {
    id: 'vh-snc3154m',
    label: 'SNC 3154 M — Black (4W LIDAR)',
    plate: 'SNC3154M',
  },
  {
    id: 'vh-snb9492c',
    label: 'SNB 9492 C — Red (KC2 Car)',
    plate: 'SNB9492C',
  },
];

function readStoredUnlock(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Strip symbols ($, commas, spaces, etc.); keep digits and one decimal point. */
function sanitizeCashcardInput(raw: string): string {
  const chars = [...raw.replace(/[^\d.]/g, '')];
  let out = '';
  let decimalUsed = false;
  for (const ch of chars) {
    if (/\d/.test(ch)) out += ch;
    else if (ch === '.' && !decimalUsed) {
      out += '.';
      decimalUsed = true;
    }
  }
  return out;
}

type LogPayload = {
  vehicleId: string;
  plate: string;
  vehicleLabel: string;
  purpose: string;
  mileageKm: string;
  cashcardBalance: string;
  photoCount: number;
  photoNames: string[];
  submittedAt: string;
};

function buildLogPayload(
  vehicleId: string,
  purpose: string,
  mileage: string,
  cashcard: string,
  files: File[],
): LogPayload {
  const v = DEMO_VEHICLES.find((x) => x.id === vehicleId);
  return {
    vehicleId,
    plate: v?.plate ?? '',
    vehicleLabel: v?.label ?? '',
    purpose,
    mileageKm: mileage,
    cashcardBalance: cashcard,
    photoCount: files.length,
    photoNames: files.map((f) => f.name),
    submittedAt: new Date().toISOString(),
  };
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
  const [purpose, setPurpose] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrLine, setOcrLine] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

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
    setSubmitMsg(null);
    setSubmitErr(null);
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

  const previewPayload = useCallback(() => {
    const payload = buildLogPayload(vehicleId, purpose, mileage, cashcard, files);
    window.alert(JSON.stringify(payload, null, 2));
  }, [vehicleId, purpose, mileage, cashcard, files]);

  const submitLog = useCallback(async () => {
    setSubmitErr(null);
    setSubmitMsg(null);

    const payload = buildLogPayload(vehicleId, purpose, mileage, cashcard, files);
    const ingestUrl = import.meta.env.VITE_INGEST_URL?.trim();

    if (!ingestUrl) {
      setSubmitMsg(
        'Tap received. Set VITE_INGEST_URL (Apps Script web app URL) in your build to sync to Google Sheets. Draft payload is in the browser console (F12 → Console).',
      );
      console.info('[fleet-log draft]', payload);
      return;
    }

    setSubmitBusy(true);
    try {
      const secret =
        typeof import.meta.env.VITE_FLEET_PASSWORD === 'string' &&
        import.meta.env.VITE_FLEET_PASSWORD.length > 0
          ? import.meta.env.VITE_FLEET_PASSWORD
          : DEFAULT_FLEET_PASSWORD;

      /** Body includes auth; use `text/plain` so the browser avoids CORS preflight (Apps Script often cannot answer OPTIONS). */
      const body = JSON.stringify({
        ...payload,
        fleetSecret: secret,
      });

      const res = await fetch(ingestUrl, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body,
      });

      if (!res.ok) {
        const hint = await res.text().catch(() => '');
        throw new Error(
          hint ? `Server ${res.status}: ${hint.slice(0, 200)}` : `Server ${res.status}`,
        );
      }

      setSubmitMsg('Submitted to your sheet.');
    } catch (e) {
      setSubmitErr(
        e instanceof Error ? e.message : 'Submit failed. Check network and CORS.',
      );
    } finally {
      setSubmitBusy(false);
    }
  }, [vehicleId, purpose, mileage, cashcard, files]);

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
    <div className="app-shell app-shell--session">
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

      <div className="session-scroll">
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
          <label className="label" htmlFor="purpose">
            Purpose
          </label>
          <textarea
            id="purpose"
            className="input"
            rows={3}
            autoComplete="off"
            placeholder="e.g. Deliveries — Bedok hub, customer returns"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
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
              onChange={(e) =>
                setCashcard(sanitizeCashcardInput(e.target.value))
              }
            />
          </div>
        </div>
        </main>
      </div>

      <div className="session-footer">
        {submitErr ? (
          <div className="error-banner" aria-live="assertive">
            {submitErr}
          </div>
        ) : null}
        {submitMsg ? (
          <div className="success-banner" aria-live="polite">
            {submitMsg}
          </div>
        ) : null}
        <footer className="bottom-bar">
          <button type="button" className="btn btn-secondary" onClick={previewPayload}>
            Preview
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={submitBusy || ocrBusy}
            onClick={() => void submitLog()}
          >
            {submitBusy ? 'Sending…' : 'Submit log'}
          </button>
        </footer>
        <p className="footer-hint">
          Submit works offline: without <code>VITE_INGEST_URL</code> we only log JSON to the
          console — add your Apps Script URL in GitHub Actions to sync rows.
        </p>
      </div>
    </div>
  );
}
