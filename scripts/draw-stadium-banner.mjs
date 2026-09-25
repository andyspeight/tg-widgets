/**
 * Draws public/images/events/stadium-night.jpg: a floodlit football stadium at
 * night, for the Club Picker's banner background (25 Sep 2026, Andy: "add a
 * football stadium-type image in the background of them all", for Tailor
 * Events' Premier League page).
 *
 * Drawn from scratch rather than taken from a photo library, so it is ours to
 * use on any client's site with no credit line: the Wikimedia venue photos in
 * api/_data/venue-facts.json need a visible credit a banner has no room for.
 * No club, crest or brand appears in it. Seeded, so a rerun draws the same
 * picture. It is brighter than it looks on its own on purpose: the banner lays
 * a 64 to 86% navy tint over it for the white club name.
 *
 * Run: npm run build:stadium-banner   (needs Playwright's Chromium; TG_CHROMIUM
 * overrides its path)
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const OUT = process.argv[2] || new URL('../public/images/events/stadium-night.jpg', import.meta.url);
const browser = await chromium.launch({ executablePath: process.env.TG_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const dataUrl = await page.evaluate(() => {
  const W = 1600, H = 400;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  // Seeded random, so the image is the same every time it is drawn.
  let s = 20260925; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

  // Night sky.
  const sky = g.createLinearGradient(0, 0, 0, 120);
  sky.addColorStop(0, '#05070f'); sky.addColorStop(1, '#0c1430');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);

  // The far stand: three tiers, each a band of crowd.
  const tiers = [[62, 118], [124, 178], [184, 232]];
  tiers.forEach(([y0, y1], t) => {
    const band = g.createLinearGradient(0, y0, 0, y1);
    band.addColorStop(0, ['#10182e', '#131c34', '#172039'][t]); band.addColorStop(1, ['#1a2440', '#1d2745', '#222c4a'][t]);
    g.fillStyle = band; g.fillRect(0, y0, W, y1 - y0);
    // The crowd: thousands of small specks in shirt colours, dimmer towards the top.
    const n = 5200;
    for (let i = 0; i < n; i++) {
      const x = rnd() * W, y = y0 + 2 + rnd() * (y1 - y0 - 4);
      const pick = rnd();
      const col = pick < .30 ? [220, 40, 50] : pick < .48 ? [240, 240, 245] : pick < .60 ? [40, 90, 200] : pick < .70 ? [250, 200, 60] : [120, 130, 160];
      const a = (0.25 + rnd() * 0.45) * (0.7 + t * 0.15);
      g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(2)})`;
      g.fillRect(x, y, 1.6 + rnd() * 1.4, 1.6 + rnd() * 1.4);
    }
    // The tier's front edge: a thin lit rail.
    g.fillStyle = 'rgba(160,180,220,.35)'; g.fillRect(0, y1 - 2, W, 2);
  });

  // Advertising boards round the pitch: a glowing strip, no words.
  const board = g.createLinearGradient(0, 234, W, 234);
  board.addColorStop(0, '#0f6fa8'); board.addColorStop(.33, '#1aa6d6'); board.addColorStop(.5, '#e8f6ff'); board.addColorStop(.67, '#1aa6d6'); board.addColorStop(1, '#0f6fa8');
  g.fillStyle = board; g.fillRect(0, 234, W, 12);
  g.fillStyle = 'rgba(120,200,255,.18)'; g.fillRect(0, 226, W, 26);

  // The pitch, striped by the mower, the stripes widening towards us.
  const top = 246;
  let y = top, k = 0, h = 10;
  while (y < H) {
    g.fillStyle = k % 2 ? '#1f8a3c' : '#26a047';
    g.fillRect(0, y, W, h + 1);
    y += h; h *= 1.28; k++;
  }
  // Floodlight wash on the grass: brighter in the middle.
  const wash = g.createRadialGradient(W / 2, 300, 40, W / 2, 330, 900);
  wash.addColorStop(0, 'rgba(255,255,230,.28)'); wash.addColorStop(1, 'rgba(0,0,0,.35)');
  g.fillStyle = wash; g.fillRect(0, top, W, H - top);

  // Markings: the touchline, the halfway line and the centre circle in perspective.
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(0, top + 6); g.lineTo(W, top + 6); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(W / 2, top + 6); g.lineTo(W / 2, H); g.stroke();
  g.beginPath(); g.ellipse(W / 2, 352, 250, 62, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.ellipse(W / 2, 352, 5, 2.5, 0, 0, Math.PI * 2); g.fill();

  // The roof edge and its floodlight banks, with bloom.
  g.fillStyle = '#03050b'; g.fillRect(0, 0, W, 40);
  g.fillStyle = 'rgba(40,52,80,.9)'; g.fillRect(0, 40, W, 6);
  for (let i = 0; i < 26; i++) {
    const x = 30 + i * (W - 60) / 25 + (rnd() - .5) * 6;
    const bloom = g.createRadialGradient(x, 44, 0, x, 44, 140);
    bloom.addColorStop(0, 'rgba(255,255,250,.55)'); bloom.addColorStop(.12, 'rgba(210,225,255,.28)'); bloom.addColorStop(1, 'rgba(120,150,220,0)');
    g.fillStyle = bloom; g.fillRect(x - 140, 0, 280, 200);
    g.fillStyle = '#ffffff'; g.fillRect(x - 9, 41, 18, 5);
  }

  // A soft haze in the air under the lights, and a vignette.
  const haze = g.createLinearGradient(0, 40, 0, 260);
  haze.addColorStop(0, 'rgba(180,200,255,.10)'); haze.addColorStop(1, 'rgba(180,200,255,0)');
  g.fillStyle = haze; g.fillRect(0, 40, W, 220);
  const vig = g.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 950);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = vig; g.fillRect(0, 0, W, H);

  // A touch of depth of field: draw the whole thing back through a light blur.
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const o = out.getContext('2d');
  o.filter = 'blur(1.6px) brightness(1.7) contrast(1.12) saturate(1.2)'; o.drawImage(cv, 0, 0);
  return out.toDataURL('image/jpeg', 0.82);
});
writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
await browser.close();
console.log('wrote', OUT);
