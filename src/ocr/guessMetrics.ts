/**
 * Heuristic extraction of mileage (km, usually integer-ish) and small money amounts
 * (e.g. cashcard balance). OCR text is noisy; users must confirm values before submit.
 */

export type MetricGuess = {
  mileageKm?: string;
  cashBalance?: string;
};

const MIN_KM = 800;
const MAX_KM = 9_999_999;
const MIN_BAL = 0;
const MAX_BAL = 999.99;

function inKmRange(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_KM && n <= MAX_KM;
}

function inBalanceRange(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_BAL && n <= MAX_BAL;
}

function normalizeDigitNoise(s: string): string {
  return s.replace(/[Oo]/g, '0');
}

/** Prefer numbers immediately before a "km" label (avoid speedometer km/h). */
function guessMileageFromKmSuffix(text: string): string | undefined {
  const t = normalizeDigitNoise(text);
  const candidates: number[] = [];

  for (const m of t.matchAll(
    /(\d[\d\s,]{2,}?)\s*k\s*m(?:s)?\b(?!\/\s*h\b)/gi,
  )) {
    const raw = m[1]?.replace(/\D/g, '') ?? '';
    if (raw.length < 3) continue;
    const n = Number(raw);
    if (inKmRange(n)) candidates.push(Math.round(n));
  }

  if (!candidates.length) return undefined;
  return String(Math.max(...candidates));
}

/** Prefer larger comma-formatted integers and long digit runs (no KM label). */
function guessMileageFromBareNumbers(text: string): string | undefined {
  const t = normalizeDigitNoise(text);
  const candidates: number[] = [];

  for (const m of t.matchAll(/\b\d{1,3}(,\d{3})+\b/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) candidates.push(Math.round(n));
  }

  for (const m of t.matchAll(/\b\d{5,7}\b/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) candidates.push(Math.round(n));
  }

  for (const m of t.matchAll(/\b\d{8}\b/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) candidates.push(Math.round(n));
  }

  const inRange = candidates.filter((n) => inKmRange(n));
  if (!inRange.length) return undefined;
  return String(Math.max(...inRange));
}

function guessMileageKm(text: string): string | undefined {
  return guessMileageFromKmSuffix(text) ?? guessMileageFromBareNumbers(text);
}

/** Prefer decimals anchored by `$` / `S$` (Singapore cards). */
function guessCashFromDollarSign(text: string): string | undefined {
  const t = normalizeDigitNoise(text);
  const candidates: number[] = [];

  for (const m of t.matchAll(
    /\b(?:S\$|\$\s*|S\s*\$\s*)(\d{1,4})\s*[.,](\d{2})\b/gi,
  )) {
    const n = Number(`${m[1]}.${m[2]}`);
    if (inBalanceRange(n)) candidates.push(Number(n.toFixed(2)));
  }

  if (!candidates.length) return undefined;

  candidates.sort((a, b) => a - b);
  const pick = candidates[Math.floor((candidates.length - 1) / 2)];
  return pick.toFixed(2);
}

/** Fallback: plausible decimals without `$` — last resort only. */
function guessCashBareDecimals(text: string): string | undefined {
  const t = normalizeDigitNoise(text);
  const candidates: number[] = [];

  for (const m of t.matchAll(/\b(\d{1,3})\s*[.,]\s*(\d{2})\b/g)) {
    const n = Number(`${m[1]}.${m[2]}`);
    const intPart = Number(m[1]);
    if (intPart >= 1900 && intPart <= 2100 && n >= 1900 && n <= 2100)
      continue;
    if (inBalanceRange(n)) candidates.push(Number(n.toFixed(2)));
  }

  if (!candidates.length) return undefined;

  candidates.sort((a, b) => a - b);
  const pick = candidates[Math.floor((candidates.length - 1) / 2)];
  return pick.toFixed(2);
}

function guessCashBalance(text: string): string | undefined {
  return guessCashFromDollarSign(text) ?? guessCashBareDecimals(text);
}

export function guessMetricsFromOcr(raw: string): MetricGuess {
  const mileageKm = guessMileageKm(raw);
  const cashBalance = guessCashBalance(raw);
  return {
    ...(mileageKm ? { mileageKm } : {}),
    ...(cashBalance ? { cashBalance } : {}),
  };
}
