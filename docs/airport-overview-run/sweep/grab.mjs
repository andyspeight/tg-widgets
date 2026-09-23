/* Fetch one source page for the verification sweep and keep its text.

   Usage: node grab.mjs <IATA> <label> <url> [regex]

   Saves the page, as text, to $SWEEP_EVIDENCE/<IATA>/<label>.txt with a
   header recording the URL, the HTTP status and when it was fetched, then
   prints the lines matching [regex] so the reader can see what the page says.
   PDFs are converted with pypdf when a venv is available.

   Why a saved copy and not a browser summary: the sweep's quote checker
   (check.mjs) proves each second-source quote is on the page by reading this
   file. A quote that is not in the saved text does not count, whatever a
   summary said. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const EVIDENCE = process.env.SWEEP_EVIDENCE ||
  '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/evidence';
const PYTHON = process.env.SWEEP_PYTHON ||
  '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/pdfenv/bin/python';

const [iata, label, url, re] = process.argv.slice(2);
if (!iata || !label || !url) {
  console.error('usage: node grab.mjs <IATA> <label> <url> [regex]');
  process.exit(2);
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const res = await fetch(url, {
  redirect: 'follow',
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
  },
  signal: AbortSignal.timeout(60000),
}).catch(e => ({ ok: false, status: 0, error: String(e.cause?.code || e.message) }));

const dir = path.join(EVIDENCE, iata.toUpperCase());
fs.mkdirSync(dir, { recursive: true });
let text = '', kind = 'none', bytes = 0;
if (res.status) {
  const buf = Buffer.from(await res.arrayBuffer());
  bytes = buf.length;
  if (buf.subarray(0, 5).toString() === '%PDF-') {
    kind = 'pdf';
    const tmp = path.join(dir, label + '.pdf');
    fs.writeFileSync(tmp, buf);
    try {
      text = execFileSync(PYTHON, ['-c',
        'import sys,pypdf\nr=pypdf.PdfReader(sys.argv[1])\nfor i,p in enumerate(r.pages):\n  sys.stdout.write("\\n[[page %d]]\\n"%(i+1)+(p.extract_text() or ""))',
        tmp], { maxBuffer: 1 << 28 }).toString();
    } catch (e) { text = '[[pdf text extraction failed]]'; }
  } else {
    kind = 'html';
    // Honour the page's own charset: many Chinese and Russian official sites
    // still serve GBK, GB2312 or windows-1251, which read as noise if decoded
    // as UTF-8.
    const head = buf.subarray(0, 4096).toString('latin1');
    const cs = ((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) ||
      head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
    let decoded;
    try { decoded = new TextDecoder(cs && !/utf-?8/i.test(cs) ? cs.toLowerCase() : 'utf-8').decode(buf); }
    catch { decoded = buf.toString('utf8'); }
    if (cs && !/utf-?8/i.test(cs)) kind = 'html ' + cs.toLowerCase();
    text = decoded
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h\d|section|article|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&#8217;|&rsquo;|&#39;|&#x27;/g, "'")
      .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
      .replace(/&#8211;|&ndash;/g, '-').replace(/&#8212;|&mdash;/g, '-')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n');
  }
}
const header = `URL: ${url}\nFETCHED: ${new Date().toISOString()}\nHTTP: ${res.status || 'ERR ' + (res.error || '')}\nKIND: ${kind}\nBYTES: ${bytes}\n----\n`;
const file = path.join(dir, label + '.txt');
fs.writeFileSync(file, header + text);
console.log(`HTTP ${res.status || 'ERR'}  ${kind}  ${bytes} bytes  -> ${file} (${text.length} chars)`);
if (re) {
  const rx = new RegExp(re, 'i');
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  let n = 0;
  for (const [i, l] of lines.entries()) {
    if (rx.test(l)) { console.log(String(i).padStart(5) + ': ' + l.slice(0, 400)); if (++n >= 40) break; }
  }
  if (!n) console.log('  (no lines match /' + re + '/)');
}
