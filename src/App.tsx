import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scanPhotosForMetrics } from './ocr/scanPhotos';
import { encodePhotosForDrive } from './upload/encodePhotosForDrive';

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

/** Some mobile pickers leave MIME type empty (e.g. HEIC); still allow by extension. */
function isProbablyImageFile(f: File): boolean {
  const t = (f.type || '').toLowerCase();
  if (t.startsWith('image/')) return true;
  const n = f.name.toLowerCase();
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/.test(n);
}

/** Map-pin mark in the header (replaces the old full-width hero banner). */
function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={22}
        height={22}
        fill="currentColor"
        focusable="false"
      >
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z" />
      </svg>
    </div>
  );
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
  /** Driver attestation (checkbox) before Submit. */
  fitToDriveDeclared: boolean;
};

function buildLogPayload(
  vehicleId: string,
  purpose: string,
  mileage: string,
  cashcard: string,
  files: File[],
  fitToDriveDeclared: boolean,
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
    fitToDriveDeclared,
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
  const [fitToDriveConfirmed, setFitToDriveConfirmed] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrLine, setOcrLine] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraSnapFlash, setCameraSnapFlash] = useState(false);
  /** Non-zero drives remount animation for capture toast banner. */
  const [captureBannerKey, setCaptureBannerKey] = useState(0);
  const captureBannerTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const cameraSnapFlashTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );

  const stopCamera = useCallback(() => {
    if (captureBannerTimerRef.current) {
      window.clearTimeout(captureBannerTimerRef.current);
      captureBannerTimerRef.current = null;
    }
    if (cameraSnapFlashTimerRef.current) {
      window.clearTimeout(cameraSnapFlashTimerRef.current);
      cameraSnapFlashTimerRef.current = null;
    }
    setCameraSnapFlash(false);
    setCaptureBannerKey(0);

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.srcObject = null;
    }
    setCameraOpen(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Camera API not available in this browser. Use “Add from gallery” or try Safari/Chrome on HTTPS.',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : 'Could not open camera (check permissions / site is HTTPS).';
      setCameraError(msg);
      stopCamera();
    }
  }, [stopCamera]);

  const snapPhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const name = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const file = new File([blob], name, { type: 'image/jpeg' });
        setFiles((prev) => [...prev, file]);
        setOcrLine(null);
        setOcrError(null);

        if (cameraSnapFlashTimerRef.current) {
          window.clearTimeout(cameraSnapFlashTimerRef.current);
        }
        setCameraSnapFlash(true);
        cameraSnapFlashTimerRef.current = window.setTimeout(() => {
          setCameraSnapFlash(false);
          cameraSnapFlashTimerRef.current = null;
        }, 240);

        if (captureBannerTimerRef.current) {
          window.clearTimeout(captureBannerTimerRef.current);
        }
        setCaptureBannerKey((k) => k + 1);
        captureBannerTimerRef.current = window.setTimeout(() => {
          setCaptureBannerKey(0);
          captureBannerTimerRef.current = null;
        }, 2400);

        try {
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(40);
          }
        } catch {
          /* ignore */
        }
      },
      'image/jpeg',
      0.88,
    );
  }, []);

  useEffect(() => {
    if (!cameraOpen || !streamRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = streamRef.current;
    void video.play().catch(() => undefined);
  }, [cameraOpen]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (captureBannerTimerRef.current) {
        window.clearTimeout(captureBannerTimerRef.current);
      }
      if (cameraSnapFlashTimerRef.current) {
        window.clearTimeout(cameraSnapFlashTimerRef.current);
      }
    };
  }, []);

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
    stopCamera();

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setUnlocked(false);
    setCode('');
    setFitToDriveConfirmed(false);
    setSubmitMsg(null);
    setSubmitErr(null);
  }, [stopCamera]);

  /** Appends so multi-capture + gallery can combine. */
  const onGalleryPick = useCallback((picked: File[]) => {
    setOcrLine(null);
    if (!picked.length) return;

    const usable = picked.filter((f) => f.size > 0 && isProbablyImageFile(f));
    if (!usable.length) {
      setOcrError(
        'Could not use those files as images (empty or unrecognized type). Try JPEG/PNG, or pick one album photo at a time if multi-select fails on your phone.',
      );
      return;
    }

    setOcrError(null);
    setFiles((prev) => [...prev, ...usable]);
  }, []);

  const removePhotoAt = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setOcrLine(null);
    setOcrError(null);
  }, []);

  const clearPhotos = useCallback(() => {
    setFiles([]);
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
    const payload = buildLogPayload(
      vehicleId,
      purpose,
      mileage,
      cashcard,
      files,
      fitToDriveConfirmed,
    );
    window.alert(JSON.stringify(payload, null, 2));
  }, [vehicleId, purpose, mileage, cashcard, files, fitToDriveConfirmed]);

  const submitLog = useCallback(async () => {
    setSubmitErr(null);
    setSubmitMsg(null);

    if (!fitToDriveConfirmed) {
      setSubmitErr('Confirm you are fit to drive before submitting.');
      return;
    }

    const payload = buildLogPayload(
      vehicleId,
      purpose,
      mileage,
      cashcard,
      files,
      fitToDriveConfirmed,
    );
    const ingestUrl = import.meta.env.VITE_INGEST_URL?.trim();

    if (!ingestUrl) {
      setSubmitMsg(
        'Tap received. Set VITE_INGEST_URL (Apps Script web app URL) in your build to sync to Google Sheets. Draft payload is in the browser console (F12 → Console). Photos are not attached in draft mode.',
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

      let photoUploads: Awaited<ReturnType<typeof encodePhotosForDrive>> | undefined;
      if (files.length > 0) {
        setSubmitMsg('Preparing photos for Google Drive…');
        try {
          photoUploads = await encodePhotosForDrive(files);
        } catch (enc) {
          throw new Error(
            enc instanceof Error
              ? enc.message
              : 'Could not read photos for upload. Try fewer or smaller images.',
          );
        }
      }

      /** Body includes auth; use `text/plain` so the browser avoids CORS preflight (Apps Script often cannot answer OPTIONS). */
      const body = JSON.stringify({
        ...payload,
        fleetSecret: secret,
        ...(photoUploads && photoUploads.length > 0 ? { photoUploads } : {}),
      });

      setSubmitMsg(null);

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

      setSubmitMsg(
        files.length > 0
          ? 'Submitted — row added; photos uploaded to Drive (see photoDriveLinks in Sheet).'
          : 'Submitted to your sheet.',
      );
    } catch (e) {
      setSubmitMsg(null);
      setSubmitErr(
        e instanceof Error ? e.message : 'Submit failed. Check network and CORS.',
      );
    } finally {
      setSubmitBusy(false);
    }
  }, [vehicleId, purpose, mileage, cashcard, files, fitToDriveConfirmed]);

  if (!unlocked) {
    return (
      <div className="app-shell">
        <header className="brand-strip">
          <div className="brand-leading">
            <BrandMark />
            <div className="brand-title">
              <h1>Fleet Logs</h1>
              <p className="brand-sub">Photos → Sheet (fleet access)</p>
            </div>
          </div>
          <span className="pill-muted">Mobile</span>
        </header>

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
        <div className="brand-leading">
          <BrandMark />
          <div className="brand-title">
            <h1>Fleet Logs</h1>
            <p className="brand-sub">{selectedVehicleLabel}</p>
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={handleLock}>
          Lock
        </button>
      </header>

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
          <div className="label" id="photos-section-label">
            Photos
          </div>
          <div className="upload-zone" aria-labelledby="photos-section-label">
            <strong>Capture or pick multiple</strong>
            <p>Use the camera for several snaps (odometer, cashcard, etc.), or add shots from gallery.</p>

            {!cameraOpen ? (
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 12, width: '100%' }}
                onClick={() => void startCamera()}
              >
                Open camera (multi-capture)
              </button>
            ) : (
              <div className="camera-panel">
                <div
                  className={
                    cameraSnapFlash
                      ? 'camera-video-wrap camera-video-wrap--snap'
                      : 'camera-video-wrap'
                  }
                >
                  <video ref={videoRef} muted playsInline autoPlay />
                </div>
                {captureBannerKey > 0 ? (
                  <div
                    key={captureBannerKey}
                    className="capture-banner"
                    role="status"
                    aria-live="polite"
                  >
                    ✓ Image taken — added to list
                  </div>
                ) : null}
                <div className="camera-actions">
                  <button type="button" className="btn btn-primary" onClick={snapPhoto}>
                    Snap photo
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={stopCamera}>
                    Done / close camera
                  </button>
                </div>
                <p className="camera-hint">
                  Tap <strong>Snap</strong> for each photo — they accumulate below. Allowed on HTTPS only
                  (your GitHub Pages site is OK).
                </p>
              </div>
            )}

            {cameraError ? <div className="error-banner">{cameraError}</div> : null}

            <div className="gallery-picker-row">
              <label className="btn btn-secondary gallery-picker-label">
                <span className="gallery-picker-label-text">
                  Add from gallery (multi-select)
                </span>
                {/*
                  Full-size transparent input over the button — clipped 1×1 “visually hidden”
                  inputs often fail to receive touches or return files on iOS / some Android.
                */}
                <input
                  id="photos-gallery-input"
                  type="file"
                  accept="image/*,image/heic,image/heif,.heic,.heif"
                  multiple
                  className="gallery-picker-input"
                  aria-label="Add photos from gallery, multiple selection allowed"
                  onChange={(e) => {
                    const input = e.currentTarget;
                    const picked = input.files?.length ? Array.from(input.files) : [];
                    input.value = '';
                    onGalleryPick(picked);
                  }}
                />
              </label>
              {files.length ? (
                <button type="button" className="btn btn-ghost btn-compact-danger" onClick={clearPhotos}>
                  Clear all photos
                </button>
              ) : null}
            </div>

            <div className="hint-row" style={{ marginTop: 12, justifyContent: 'center' }}>
              <span className="hint-chip">Multi snap</span>
              <span className="hint-chip">Gallery</span>
              <span className="hint-chip">OCR</span>
            </div>
          </div>
          {files.length > 0 ? (
            <ul className="file-list" aria-label="Selected photos">
              {files.map((f, i) => (
                <li key={`${f.name}-${f.size}-${f.lastModified}-${i}`}>
                  <span className="file-list-name">{f.name}</span>
                  <span className="file-list-meta">
                    <span>{(f.size / 1024).toFixed(0)} KB</span>
                    <button
                      type="button"
                      className="file-list-remove"
                      onClick={() => removePhotoAt(i)}
                    >
                      Remove
                    </button>
                  </span>
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
            Free: OCR runs on your phone; the engine is served from this same site (first run can
            take 10–20s). Always verify numbers before submitting.
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

        <label className="checkbox-field" htmlFor="fit-to-drive">
          <input
            id="fit-to-drive"
            type="checkbox"
            checked={fitToDriveConfirmed}
            onChange={(e) => setFitToDriveConfirmed(e.target.checked)}
          />
          <span>
            I confirm I feel rested, alert, and fit to drive this vehicle safely (not impaired by
            fatigue, medication, illness, alcohol, or other factors that could affect driving).
          </span>
        </label>
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
            disabled={submitBusy || ocrBusy || !fitToDriveConfirmed}
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
