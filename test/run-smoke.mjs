import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolve paths relative to this script so the harness runs from any cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = process.argv[2] || "tg-slicer";
const PREFIX = process.argv[3] || "f";      // which fixture set: f, g, h or i
const DIR = path.join(__dirname, "fixtures");
const OUT = path.join(__dirname, "smoke");
fs.mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(new Date().toISOString().slice(11, 19), m);

const MIME = { ".html":"text/html",".svg":"image/svg+xml",".jpg":"image/jpeg",".css":"text/css",".js":"text/javascript",".png":"image/png" };
function serve(dir, port) {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/favicon.ico") { rsp.statusCode = 204; return rsp.end(); }
      const fp = path.join(dir, p);
      if (!fp.startsWith(dir) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { rsp.statusCode = 404; return rsp.end("nf"); }
      rsp.setHeader("Content-Type", MIME[path.extname(fp)] || "application/octet-stream");
      rsp.setHeader("Access-Control-Allow-Origin", "*");
      fs.createReadStream(fp).pipe(rsp);
    });
    s.listen(port, () => res(s));
  });
}

// Capture-fidelity harness. The slicer's job is now capture-and-hand-off: it
// sends the raw { html, css } to Travelgenix Sites, which rebuilds it into
// blocks. So this tests the one thing still the slicer's, capture.js, by
// reconstructing the captured slice on its own and screenshotting it against the
// original. No emit step, that moved into the CMS import.
const captureJs = fs.readFileSync(path.join(__dirname, "..", EXT, "capture.js"), "utf8");
const ids = fs.readdirSync(DIR).filter((f) => new RegExp(`^${PREFIX}\\d+\\.html$`).test(f))
  .map((f) => f.replace(".html","")).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)));

// Reconstruct a captured slice as a standalone document, the same way the
// extension's Copy HTML+CSS does and the Sites import receives it.
function rebuild(slice) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} html,body{margin:0;background:#fff;font-family:system-ui,sans-serif}
    ${slice.css || ""}</style></head><body>${slice.html || ""}</body></html>`;
}

const server = await serve(DIR, 8000);
// Optional: point at a pre-installed Chromium when the Playwright browser CDN is blocked.
// Unset on a normal machine so Playwright uses its own downloaded browser.
const executablePath = process.env.TGS_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox","--disable-dev-shm-usage"] });
log(`testing ${ids.length} fixtures: ${ids.join(",")}`);
const report = [];
for (const id of ids) {
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("console", (m) => { if (m.type()==="error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://localhost:8000/${id}.html`, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(250);
    const label = await page.title();
    const origEl = await page.$("#target");
    await origEl.screenshot({ path: `${OUT}/${id}-original.png` });
    await page.addScriptTag({ content: captureJs });
    const slice = await page.evaluate(async () => {
      const s = await window.TGSCapture.capture(document.querySelector("#target"));
      return { css: s.css, html: s.html };
    });
    fs.writeFileSync(`${OUT}/${id}-slice.css`, slice.css);
    fs.writeFileSync(`${OUT}/${id}-slice.html`, slice.html);
    const rp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await rp.setContent(rebuild(slice), { waitUntil: "load" });
    await rp.waitForTimeout(300);
    const rebuiltEl = await rp.$("body > *");
    await (rebuiltEl || rp).screenshot({ path: `${OUT}/${id}-rebuilt.png` });
    await rp.close(); await page.close();
    const css = slice.css, html = slice.html;
    report.push({ id, label,
      phantomBorder: /border-(top|right|bottom|left)-style:\s*solid/.test(css) && !/border-(top|right|bottom|left)-width:\s*[1-9]/.test(css),
      hasGradient: /linear-gradient|radial-gradient/.test(css),
      hasBgImage: /background-image:[^;]*url\(/.test(css),
      imgTags: (html.match(/<img/g)||[]).length,
      spriteRemaining: /<use[\s>]/.test(html),
      svgInlined: /<svg/.test(html),
      errors: errors.slice(0,3) });
    log(`${id} done`);
  } catch (e) { report.push({ id, error: String(e&&e.message||e) }); log(`${id} FAILED: ${e}`); }
}
await browser.close(); server.close();
fs.writeFileSync(`${OUT}/report-${PREFIX}.json`, JSON.stringify(report, null, 2));
console.log("\n===== REPORT ("+PREFIX+") =====");
for (const r of report) console.log(JSON.stringify(r));
