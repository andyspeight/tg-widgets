#!/usr/bin/env node
/**
 * Duda GEO/AEO remediation — site-level, via the Duda Partner API.
 *
 * Makes a Duda travel site AI-search ready without page-by-page editing:
 *   1. Populate the content library business info (content.update)
 *   2. Enable Duda's native LocalBusiness schema and assert status VALID
 *   3. Inject custom site-wide JSON-LD (TravelAgency + WebSite + SearchAction)
 *   4. Set site-wide SEO defaults (site_seo)
 *   5. Publish
 *   6. Print an llms.txt to host at the site root
 *
 * Safe by default: runs as --dry-run unless you pass --apply. Nothing is ever
 * written to a live site, and nothing is published, without --apply.
 *
 * Credentials come from env only (reuse the existing Luna Duda integration —
 * do NOT mint new ones):
 *   DUDA_API_USER, DUDA_API_PASS, DUDA_API_ENDPOINT [, DUDA_APP_UUID]
 *
 * The per-site business profile is supplied as a JSON file so no business data
 * is hardcoded. See docs/duda-geo-handover.md for the profile shape and a
 * traveldemo.site example.
 *
 * Usage:
 *   node scripts/duda-geo-remediate.js --site=<siteName> --profile=<file.json>
 *   node scripts/duda-geo-remediate.js --site=<siteName> --profile=p.json --apply
 *   node scripts/duda-geo-remediate.js --site=<siteName> --profile=p.json --apply --no-publish
 *   node scripts/duda-geo-remediate.js --list                 # list sites, then exit
 *   node scripts/duda-geo-remediate.js --profile=p.json --emit # print assets only, no API
 */

import { readFileSync } from 'node:fs';
import { DudaClient } from '../api/_lib/duda/client.js';
import { buildAssets } from '../api/_lib/duda/geo.js';

function parseArgs() {
  const a = { site: null, profile: null, apply: false, publish: true, inject: true,
              schema: true, seo: true, content: true, list: false, emit: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--apply') a.apply = true;
    else if (arg === '--no-publish') a.publish = false;
    else if (arg === '--no-inject') a.inject = false;
    else if (arg === '--no-schema') a.schema = false;
    else if (arg === '--no-seo') a.seo = false;
    else if (arg === '--no-content') a.content = false;
    else if (arg === '--list') a.list = true;
    else if (arg === '--emit') a.emit = true;
    else if (arg.startsWith('--site=')) a.site = arg.slice(7);
    else if (arg.startsWith('--profile=')) a.profile = arg.slice(10);
  }
  return a;
}

function log(...p) { console.log('[geo]', ...p); }
function warn(...p) { console.warn('[geo]', ...p); }

function loadProfile(path) {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  // Profile: { business: {...}, pages: [...] }  OR just the business object.
  if (parsed.business) return { business: parsed.business, pages: parsed.pages || [] };
  return { business: parsed, pages: parsed.pages || [] };
}

async function main() {
  const opts = parseArgs();

  // --emit: pure, offline. Build and print every asset, no API, no creds.
  if (opts.emit) {
    if (!opts.profile) { console.error('--emit needs --profile=<file.json>'); process.exit(2); }
    const { business, pages } = loadProfile(opts.profile);
    const assets = buildAssets(business, pages);
    log('site_seo:', JSON.stringify(assets.siteSeo, null, 2));
    log('content.update payload:', JSON.stringify(assets.contentUpdate, null, 2));
    log('site-wide JSON-LD block:\n' + assets.jsonLdScript);
    log('llms.txt:\n' + assets.llmsTxt);
    return;
  }

  const duda = new DudaClient();
  if (!duda.configured()) {
    console.error('Duda credentials missing. Set DUDA_API_USER and DUDA_API_PASS.');
    console.error('These are the existing Luna Duda integration credentials — do not mint new ones.');
    process.exit(1);
  }
  log('client:', duda.describe());
  log(opts.apply ? 'MODE: APPLY (will write + publish)' : 'MODE: dry-run (no writes; pass --apply to execute)');

  // --list: enumerate sites and exit (helps resolve the site_name).
  if (opts.list) {
    const sites = await duda.listSites({ limit: 200 });
    log(`${sites.length} sites:`);
    for (const s of sites) {
      const name = s.site_name || s.name || s.id || '?';
      const domain = s.site_domain || s.external_uri || s.preview_site_url || '';
      console.log(`  ${name}\t${domain}`);
    }
    return;
  }

  if (!opts.site) { console.error('Missing --site=<siteName> (use --list to find it)'); process.exit(2); }
  if (!opts.profile) { console.error('Missing --profile=<file.json>'); process.exit(2); }

  const { business, pages } = loadProfile(opts.profile);
  let assets;
  try {
    assets = buildAssets(business, pages);
  } catch (e) {
    console.error('Invalid business profile:', e.message);
    process.exit(2);
  }

  // Confirm the site exists and show current schema status before touching it.
  const site = await duda.getSite(opts.site).catch(e => {
    console.error(`Could not fetch site "${opts.site}": ${e.message}`);
    process.exit(1);
  });
  const beforeStatus = site?.schemas?.local_business?.status || '(none)';
  log(`site "${opts.site}" found. LocalBusiness schema status before: ${beforeStatus}`);

  const steps = [];

  if (opts.content) {
    steps.push(['content.update (business info)', () =>
      duda.updateContent(opts.site, assets.contentUpdate)]);
  }
  if (opts.schema) {
    steps.push(['enable native LocalBusiness schema', () =>
      duda.updateSite(opts.site, { schemas: { local_business: { enabled: true } } })]);
  }
  if (opts.inject) {
    steps.push(['inject site-wide JSON-LD', () =>
      duda.injectSiteWideHtml(opts.site, assets.jsonLdScript, { location: 'BODY' })]);
  }
  if (opts.seo) {
    steps.push(['set site_seo defaults', () =>
      duda.updateSite(opts.site, { site_seo: assets.siteSeo })]);
  }

  for (const [label, run] of steps) {
    if (!opts.apply) { log(`[dry-run] would: ${label}`); continue; }
    try {
      await run();
      log(`ok: ${label}`);
      await new Promise(r => setTimeout(r, 300)); // gentle pacing
    } catch (e) {
      console.error(`FAILED: ${label} — ${e.message}`);
      process.exit(1);
    }
  }

  // Assert native schema is VALID (after content + toggle).
  if (opts.apply && opts.schema) {
    const after = await duda.getSite(opts.site).catch(() => null);
    const status = after?.schemas?.local_business?.status || '(unknown)';
    if (status === 'VALID') log('LocalBusiness schema status after: VALID');
    else warn(`LocalBusiness schema status after: ${status} — check content library required fields`);
  }

  // Publish.
  if (opts.publish) {
    if (!opts.apply) log('[dry-run] would: publish');
    else {
      await duda.publish(opts.site);
      log('ok: published');
    }
  } else {
    log('skipping publish (--no-publish); changes are staged but not live');
  }

  // llms.txt is served at the site root by Duda config, not this script.
  log('\nllms.txt to host at the site root:\n' + assets.llmsTxt);

  if (opts.apply && opts.publish) {
    log(`\nNext: verify with  node scripts/duda-geo-verify.js ${business.url || 'https://<site>/'}`);
  }
}

main().catch(err => {
  console.error('[geo] fatal:', err.message);
  process.exit(1);
});
