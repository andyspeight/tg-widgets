/**
 * A self-check for the functions that start Chromium, run ONLY on preview
 * deployments (24 Sep 2026).
 *
 * Why: Vercel stops building Node 20 on 1 October 2026, so the project moved to
 * Node 24. The one part of the stack that cares which Node it runs on is
 * @sparticuz/chromium. It must recognise the runtime as Amazon Linux 2023 to
 * unpack the libraries Chromium needs, and version 138 names Node 20 and 22
 * explicitly but finds Node 24 only through the VERCEL environment variable.
 * If that check ever fails, every booking PDF and quote PDF fails with it. Unit
 * tests cannot see that; only the deployed function can. So a preview build of
 * the real function answers `GET ?selfcheck=1` by starting Chromium and drawing
 * a PDF, and says what happened, step by step.
 *
 * Production never runs it: the gate is VERCEL_ENV === 'preview', which Vercel
 * sets, not the caller. Nothing personal is involved: the booking is the
 * made-up one the ATOL preview uses.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function selfCheckAllowed(req) {
  return req.method === 'GET'
    && process.env.VERCEL_ENV === 'preview'
    && String((req.query && req.query.selfcheck) || '') === '1';
}

/** The runtime as the function sees it. No secrets: names and flags only. */
export function runtimeFacts() {
  return {
    node: process.version,
    vercelEnv: process.env.VERCEL_ENV || '',
    VERCEL: !!process.env.VERCEL,
    awsExecutionEnv: process.env.AWS_EXECUTION_ENV || '',
    awsLambdaJsRuntime: process.env.AWS_LAMBDA_JS_RUNTIME || '',
    region: process.env.VERCEL_REGION || process.env.AWS_REGION || '',
    platform: process.platform,
    arch: process.arch,
  };
}

/** Run named steps in order; each is timed, and a failure stops the rest. */
export async function runSteps(steps) {
  const out = [];
  let ok = true;
  for (const [name, fn] of steps) {
    if (!ok) { out.push({ name, ok: false, skipped: true }); continue; }
    const t = Date.now();
    try {
      const detail = await fn();
      out.push({ name, ok: true, ms: Date.now() - t, detail });
    } catch (err) {
      ok = false;
      out.push({ name, ok: false, ms: Date.now() - t, error: String((err && err.message) || err).slice(0, 500) });
    }
  }
  return { ok, steps: out };
}

/** How many pages a PDF has, read with pdf-lib (a text search misses page
 *  objects inside compressed object streams, which pdf-lib writes). */
export async function pdfPageCount(buf) {
  const { PDFDocument } = await import('pdf-lib');
  return (await PDFDocument.load(buf)).getPageCount();
}

/** Whether Chromium's Amazon Linux libraries were unpacked where it looks. */
export function al2023LibsPresent() {
  return existsSync(join(tmpdir(), 'al2023', 'lib'));
}
