import { createWorker, type Worker } from 'tesseract.js';
import { guessMetricsFromOcr } from './guessMetrics';

/** Same-origin assets (see `scripts/copy-ocr-assets.mjs`) — avoids CDN/worker issues on mobile. */
function ocrUrls() {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return {
    workerPath: `${base}ocr/worker.min.js`,
    corePath: `${base}ocr/core/`,
    langPath: `${base}ocr/lang/4.0.0_best_int`,
  } as const;
}

function formatProgress(m: {
  status: string;
  progress?: number;
}): string {
  if (typeof m.progress === 'number' && Number.isFinite(m.progress)) {
    const pct = Math.round(m.progress * 100);
    return `${m.status} (${pct}%)`;
  }
  return m.status;
}

async function createOcrWorker(
  setStatus: (s: string) => void,
): Promise<Worker> {
  const paths = ocrUrls();
  const worker = await createWorker('eng', 1, {
    workerPath: paths.workerPath,
    corePath: paths.corePath,
    langPath: paths.langPath,
    gzip: true,
    /** Load worker script by URL (same origin). Blob+CDN often hangs on iOS/Android. */
    workerBlobURL: false,
    logger: (evt) =>
      setStatus(formatProgress(evt as { status: string; progress?: number })),
  });

  return worker;
}

export type ScanPhotosResult = {
  mileageKm?: string;
  cashBalance?: string;
  snippets: string[];
};

/**
 * Run on-device OCR (no paid APIs). Concatenates text across images until heuristics
 * find guesses or all files have been scanned.
 */
export async function scanPhotosForMetrics(
  files: readonly File[],
  onStatus: (line: string) => void,
): Promise<ScanPhotosResult> {
  if (!files.length) {
    throw new Error('Add at least one photo before scanning.');
  }

  const snippets: string[] = [];
  let merged = '';

  let worker: Worker | undefined;
  try {
    onStatus('Loading OCR engine (first time may take ~10–20s on mobile)…');
    worker = await createOcrWorker(onStatus);
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      onStatus(`Reading image ${i + 1}/${files.length}…`);
      const result = await worker.recognize(file);
      const text = result.data.text?.trim() ?? '';
      snippets.push(text);
      merged += `\n${text}`;
      const guess = guessMetricsFromOcr(merged);
      if (guess.mileageKm && guess.cashBalance) {
        return {
          mileageKm: guess.mileageKm,
          cashBalance: guess.cashBalance,
          snippets,
        };
      }
    }

    return {
      ...guessMetricsFromOcr(merged),
      snippets,
    };
  } finally {
    if (worker) {
      await worker.terminate().catch(() => undefined);
    }
  }
}
