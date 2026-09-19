/**
 * Build the showcase QR codes.
 *
 * Reads the qr.url off every product in public/showcase-data.js and writes
 * one SVG per product into public/showcase/qr/. The SVGs are committed, so
 * the stand needs no network and the page needs no QR library at runtime.
 *
 *   npm run build:showcase-qr
 *
 * Re-run it whenever a product's qr.url changes. test/showcase-smoke.mjs
 * fails if a product has a qr block with no committed SVG beside it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'showcase', 'qr');

let QRCode;
try {
  QRCode = (await import('qrcode')).default;
} catch {
  console.error('qrcode is not installed. Run: npm install');
  process.exit(1);
}

global.window = {};
new Function(readFileSync(join(ROOT, 'public', 'showcase-data.js'), 'utf8'))();

mkdirSync(OUT, { recursive: true });

let n = 0;
for (const p of global.window.TG_SHOWCASE.products) {
  if (!p.qr) continue;
  const svg = await QRCode.toString(p.qr.url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
    color: { dark: '#0F172A', light: '#FFFFFF' },
  });
  writeFileSync(join(OUT, `${p.id}.svg`), svg);
  console.log(`wrote ${p.id}.svg -> ${p.qr.url}`);
  n++;
}
console.log(`${n} QR code(s) written to public/showcase/qr/`);
