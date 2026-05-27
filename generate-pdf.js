/**
 * generate-pdf.js
 * ----------------
 * Turns a Quick Quote `quoteDocument` into a PDF Buffer.
 *
 * Matches the My Booking PDF stack exactly (api/booking-pdf.js):
 *   - ESM (import/export), repo is "type": "module"
 *   - puppeteer-core + @sparticuz/chromium, lazy-loaded
 *   - emulateMediaType('print') + waitUntil 'networkidle0'
 *   - Buffer.from() coercion so binary PDF data isn't corrupted by res.send
 *
 * Exposes: generateQuotePdf(doc) -> Promise<Buffer>, pdfFilename(doc) -> string
 */

import { renderQuoteHTML } from './render-quote.js';

// ----- Attachment merge (pdf-lib, lazy-loaded) -----
// Fetches each attachment PDF by URL and appends its pages to the end of the
// quote PDF. Used for per-client documents like Terms & Conditions. A failed
// fetch or unreadable PDF is skipped (the quote still goes out) rather than
// failing the whole request — correctness of the quote over completeness.
async function mergeAttachments(quoteBuffer, attachments) {
  const list = Array.isArray(attachments) ? attachments.filter(a => a && typeof a.url === 'string') : [];
  if (list.length === 0) return quoteBuffer;

  let PDFDocument;
  try {
    ({ PDFDocument } = await import('pdf-lib'));
  } catch (e) {
    console.error('[generate-pdf] pdf-lib unavailable, skipping merge:', e?.message);
    return quoteBuffer;
  }

  let merged;
  try {
    merged = await PDFDocument.load(quoteBuffer);
  } catch (e) {
    console.error('[generate-pdf] could not load quote PDF for merge:', e?.message);
    return quoteBuffer;
  }

  for (const att of list) {
    try {
      const r = await fetch(att.url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) { console.warn('[generate-pdf] attachment fetch failed', r.status, att.url); continue; }
      const bytes = new Uint8Array(await r.arrayBuffer());
      const src = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    } catch (e) {
      console.warn('[generate-pdf] skipping attachment (merge error):', att.url, e?.message);
    }
  }

  try {
    const out = await merged.save();
    return Buffer.isBuffer(out) ? out : Buffer.from(out);
  } catch (e) {
    console.error('[generate-pdf] merged save failed, returning quote only:', e?.message);
    return quoteBuffer;
  }
}

// ----- Puppeteer (lazy-loaded so cold start is cheap on health checks) -----
// Mirrors api/booking-pdf.js getBrowser() exactly.
let _chromium, _puppeteer;
async function getBrowser() {
  if (!_chromium) {
    _chromium = (await import('@sparticuz/chromium')).default;
    _puppeteer = (await import('puppeteer-core')).default;
  }
  return await _puppeteer.launch({
    args: [..._chromium.args, '--font-render-hinting=none'],
    defaultViewport: _chromium.defaultViewport,
    executablePath: await _chromium.executablePath(),
    headless: _chromium.headless,
  });
}

/**
 * Render a quoteDocument to a print-ready A4 PDF Buffer.
 */
async function generateQuotePdf(doc, opts) {
  const html = renderQuoteHTML(doc, opts);
  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    // Emulate print media so @media print rules fire and page-break-inside
    // CSS is honoured (same reasoning as booking-pdf).
    await page.emulateMediaType('print');
    // networkidle0 so remote hotel images finish loading before printing.
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Downscale hotel images to keep the PDF small enough to email. Supplier
    // photos are embedded at full resolution otherwise (a single quote can hit
    // multiple MB). We redraw each gallery image onto a canvas at a capped width
    // and swap in the compressed JPEG. If a canvas is CORS-tainted (export
    // throws), we leave the original image in place — correctness over size.
    try {
      await page.evaluate(async () => {
        const MAX_W = 700;
        const QUALITY = 0.72;
        const imgs = Array.from(document.querySelectorAll('.gallery-cell img'));

        // Wait for a freshly-set src to finish decoding before we move on, so
        // the image is actually painted when page.pdf() runs.
        const awaitDecode = (img) => new Promise((res) => {
          if (img.complete && img.naturalWidth) return res();
          img.onload = () => res();
          img.onerror = () => res();
          setTimeout(res, 2000); // hard backstop
        });

        await Promise.all(imgs.map(async (img) => {
          try {
            if (!img.complete || !img.naturalWidth) await awaitDecode(img);
            if (!img.naturalWidth) return;
            if (img.naturalWidth <= MAX_W) return; // already small enough
            const scale = MAX_W / img.naturalWidth;
            const c = document.createElement('canvas');
            c.width = Math.round(img.naturalWidth * scale);
            c.height = Math.round(img.naturalHeight * scale);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            const data = c.toDataURL('image/jpeg', QUALITY); // throws if tainted
            img.src = data;          // swap in the smaller version
            await awaitDecode(img);  // and wait for it to actually decode
          } catch (e) {
            // Tainted canvas or any other issue — keep the original image.
            // It already loaded fine, so it will still render.
          }
        }));
      });
    } catch (e) {
      // Non-fatal — print with original images if downscaling failed entirely.
    }
    const pdfRaw = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    await browser.close();
    browser = null;
    // Coerce to a Node Buffer. page.pdf() can return a Uint8Array depending on
    // version, and res.end/res.send can re-encode non-Buffer data as UTF-8 text
    // which corrupts the binary and yields a "file may be damaged" PDF.
    const quoteBuffer = Buffer.isBuffer(pdfRaw) ? pdfRaw : Buffer.from(pdfRaw);
    // Merge any per-client attachment PDFs (e.g. T&Cs) onto the end.
    return await mergeAttachments(quoteBuffer, opts && opts.attachments);
  } finally {
    try { await browser?.close(); } catch {}
  }
}

/** Build a safe download filename from the quote (handles both shapes). */
function pdfFilename(doc) {
  const d = (doc && doc.data && doc.data.items) ? doc.data : (doc || {});
  const id = d.quoteId || d.id || (d.setup && d.setup.quoteId) || 'document';
  const rawTitle = (d.setup && d.setup.quoteTitle) || d.name || '';
  const title = rawTitle
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return title ? `Quote-${id}-${title}.pdf` : `Quote-${id}.pdf`;
}

/**
 * Fetch each attachment PDF as a Buffer, for sending as SEPARATE email
 * attachments (in addition to the merged copy). Returns [{ name, buffer }].
 * Skips any that fail to fetch so the email still sends.
 */
async function fetchAttachmentBuffers(attachments) {
  const list = Array.isArray(attachments) ? attachments.filter(a => a && typeof a.url === 'string') : [];
  const out = [];
  for (const att of list) {
    try {
      const r = await fetch(att.url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) { console.warn('[generate-pdf] attachment fetch failed', r.status, att.url); continue; }
      const buf = Buffer.from(new Uint8Array(await r.arrayBuffer()));
      out.push({ name: (att.name && String(att.name)) || 'document.pdf', buffer: buf });
    } catch (e) {
      console.warn('[generate-pdf] could not fetch attachment for email:', att.url, e?.message);
    }
  }
  return out;
}

export { generateQuotePdf, pdfFilename, fetchAttachmentBuffers };
