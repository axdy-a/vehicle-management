/**
 * Self-host Tesseract worker, WASM core(s), and English traineddata under public/ocr/.
 * Same-origin assets fix mobile browsers where CDN + worker Blob loads stall at 0%.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pubOcr = path.join(root, 'public', 'ocr');
const coreDest = path.join(pubOcr, 'core');
const langDest = path.join(pubOcr, 'lang', '4.0.0_best_int');

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn('[copy-ocr-assets] missing:', src);
    return;
  }
  fs.copyFileSync(src, dest);
}

mkdirp(coreDest);
mkdirp(langDest);

const workerSrc = path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');
copyIfExists(workerSrc, path.join(pubOcr, 'worker.min.js'));

const coreNm = path.join(root, 'node_modules', 'tesseract.js-core');
for (const ent of fs.existsSync(coreNm) ? fs.readdirSync(coreNm) : []) {
  if (/^tesseract-core/.test(ent) && /\.(wasm|js)$/.test(ent)) {
    copyIfExists(path.join(coreNm, ent), path.join(coreDest, ent));
  }
}

const engPack = path.join(
  root,
  'node_modules',
  '@tesseract.js-data',
  'eng',
  '4.0.0_best_int',
  'eng.traineddata.gz',
);
copyIfExists(engPack, path.join(langDest, 'eng.traineddata.gz'));

console.log('[copy-ocr-assets] wrote worker, core blobs, eng.traineddata.gz → public/ocr/');
