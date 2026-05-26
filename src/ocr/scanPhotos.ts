import { createWorker, type Worker } from 'tesseract.js';
import { guessMetricsFromOcr } from './guessMetrics';

/** Stable CDN URLs so OCR works under GitHub Pages `{base}` without broken worker-relative paths */
const OCR_CDN = {
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/',
  langPath: 'https://tessdata.projectnaptha.com/4.0.0',
} as const;

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
  const worker = await createWorker('eng', 1, {
    workerPath: OCR_CDN.workerPath,
    corePath: OCR_CDN.corePath,
    langPath: OCR_CDN.langPath,
    gzip: false,
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
