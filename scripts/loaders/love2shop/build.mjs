// Builds the Love2Shop heart loader GIFs into public/loaders/.
//
//   node scripts/loaders/love2shop/build.mjs
//
// Renders loader.html frame by frame with Playwright's Chromium (already a
// devDependency), then hands the PNG frames to make-gif.py, which needs
// Python 3 with Pillow (`pip install pillow`). Four files come out: the loader
// on white and on the primary blue, each at 1x and 2x.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../../../public/loaders');
const FRAMES = 50;   // 2 s loop at 25 fps
const FPS = 25;

const variants = [
  { theme: 'white', scale: 1, file: 'love2shop-loader.gif' },
  { theme: 'white', scale: 2, file: 'love2shop-loader@2x.gif' },
  { theme: 'blue',  scale: 1, file: 'love2shop-loader-blue.gif' },
  { theme: 'blue',  scale: 2, file: 'love2shop-loader-blue@2x.gif' }
];

const launch = {};
if (process.env.TG_CHROME) launch.executablePath = process.env.TG_CHROME;   // point at a local Chrome if Playwright's is missing
const browser = await chromium.launch(launch);
fs.mkdirSync(outDir, { recursive: true });

for (const v of variants) {
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), `love2shop-loader-${v.theme}-${v.scale}x-`));
  const page = await browser.newPage({ viewport: { width: 400, height: 200 }, deviceScaleFactor: v.scale });
  await page.goto(`file://${path.join(here, 'loader.html')}?theme=${v.theme}&play=0`);
  const { W, H } = await page.evaluate(() => window.__FRAME__);
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((t) => window.setTime(t), i / FRAMES);
    await page.screenshot({ path: path.join(frameDir, `f${String(i).padStart(3, '0')}.png`), clip: { x: 0, y: 0, width: W, height: H } });
  }
  await page.close();
  execFileSync('python3', [path.join(here, 'make-gif.py'), frameDir, path.join(outDir, v.file), String(FPS)], { stdio: 'inherit' });
  fs.rmSync(frameDir, { recursive: true, force: true });
}
await browser.close();
