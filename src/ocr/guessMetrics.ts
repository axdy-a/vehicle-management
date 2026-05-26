/**
 * Heuristic extraction of mileage (km, usually integer-ish) and small money amounts
 * (e.g. cashcard balance). OCR text is noisy; users must confirm values before submit.
 */

export type MetricGuess = {
  mileageKm?: string;
  cashBalance?: string;
};

/** Prefer whole-ish odometer readings in a plausible KM range for commercial vehicles. */
function guessMileageKm(text: string): string | undefined {
  const t = text.replace(/[Oo]/g, '0'); // crude fix for OCR on digits
  const candidates: number[] = [];

  for (const m of t.matchAll(/\b\d{1,3}(,\d{3})+\b/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) candidates.push(Math.round(n));
  }

  for (const m of t.matchAll(/\b\d{5,7}\b/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) candidates.push(Math.round(n));
  }

  // Some dashes omit thousands separators → long digit runs embedded in OCR noise
  for (const m of t.matchAll(/\b\d{8}\b/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) candidates.push(Math.round(n));
  }

  const inRange = candidates.filter((n) => n >= 800 && n <= 9_999_999);
  if (!inRange.length) return undefined;
  // Largest plausible KM reading dominates noisy smaller numbers.
  return String(Math.max(...inRange));
}

/** Typical stored-value balance: decimal with 2 places, $< 999. */
function guessCashBalance(text: string): string | undefined {
  const candidates: number[] = [];

  for (const m of text.matchAll(/\$\s*(\d{1,3})\s*[.,]\s*(\d{2})\b/g)) {
    const n = Number(`${m[1]}.${m[2]}`);
    if (Number.isFinite(n) && n >= 0 && n <= 999.99) candidates.push(n);
  }

  for (const m of text.matchAll(/\b(\d{1,3})\s*[.,]\s*(\d{2})\b/g)) {
    const n = Number(`${m[1]}.${m[2]}`);
    const intPart = Number(m[1]);
    // Exclude likely years (avoid 2024.56 type junk) unless it's clearly currency-sized
    if (intPart >= 1900 && intPart <= 2100 && n >= 1900 && n <= 2100) continue;
    if (Number.isFinite(n) && n >= 0 && n <= 999.99) candidates.push(Number(n.toFixed(2)));
  }

  if (!candidates.length) return undefined;

  candidates.sort((a, b) => a - b);
  // Prefer values that feel like POS balances (often first money-like token on cards)
  const pick = candidates[Math.floor((candidates.length - 1) / 2)];
  return pick.toFixed(2);
}

export function guessMetricsFromOcr(raw: string): MetricGuess {
  const mileageKm = guessMileageKm(raw);
  const cashBalance = guessCashBalance(raw);
  return {
    ...(mileageKm ? { mileageKm } : {}),
    ...(cashBalance ? { cashBalance } : {}),
  };
}
