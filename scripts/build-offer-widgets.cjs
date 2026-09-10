#!/usr/bin/env node
/**
 * build-offer-widgets.cjs · Travelgenix Widget Suite
 *
 * Turn a JSON offer file into one Widgets-table row per offer, each holding the
 * whole offer in its Config so widget-offer-page.js can render a complete offer
 * page from the widget id alone. This is the same shape the Escorted Tour rows
 * use (GLOBAL TRAVEL SOLUTION, Aug 2026): the trip lives in the config, not in
 * a feed, so no signed-in session is needed to publish one.
 *
 *   node scripts/build-offer-widgets.cjs <offers.json> <out.json> [--client rec...]
 *
 * Writes the Airtable field payloads. Creating the rows is a separate, explicit
 * step so this never writes to a live client account as a side effect.
 */
const fs = require('fs');
const path = require('path');

const BRAND = '#12263F';   // deep navy
const ACCENT = '#8A6A2F';  // bronze, dark enough to carry white button text

// WCAG relative luminance, so the palette is checked rather than eyeballed.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// tgw_<epoch-ms>_<6 base36>, matching every other widget id in the table.
function widgetId(offsetMs) {
  const rnd = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return 'tgw_' + (Date.now() + offsetMs) + '_' + rnd;
}

function main(argv) {
  const src = argv[0];
  const out = argv[1];
  const clientFlag = argv.indexOf('--client');
  const clientRecordId = clientFlag !== -1 ? argv[clientFlag + 1] : '';
  if (!src || !out) {
    console.error('Usage: node scripts/build-offer-widgets.cjs <offers.json> <out.json> [--client rec...]');
    process.exit(2);
  }

  // The craft floor asks for 4.5:1 on text; the accent carries white CTA text.
  const accentOnWhite = contrast(ACCENT, '#FFFFFF');
  if (accentOnWhite < 4.5) {
    console.error('Accent ' + ACCENT + ' is only ' + accentOnWhite.toFixed(2) + ':1 on white. Pick a darker accent.');
    process.exit(1);
  }

  const doc = JSON.parse(fs.readFileSync(src, 'utf8'));
  const meta = doc._meta || {};
  const nowIso = new Date().toISOString();

  const rows = doc.offers.map((offer, i) => {
    const config = {
      offer,
      template: 'classic',
      theme: 'light',
      brandColor: BRAND,
      accentColor: ACCENT,
      radius: 18,
      currency: offer.currency || 'GBP',
      agencyName: meta.agencyName || ''
    };
    return {
      widgetId: widgetId(i),
      name: offer.fields.title,
      widgetType: 'Special Offers',
      status: 'Active',
      clientName: meta.agencyName || '',
      clientEmail: meta.ownerEmail || '',
      clientDomain: meta.website || '',
      clientRecordId: clientRecordId || meta.clientRecordId || '',
      createdAt: nowIso,
      updatedAt: nowIso,
      config: JSON.stringify(config)
    };
  });

  fs.writeFileSync(out, JSON.stringify({ rows }, null, 2) + '\n', 'utf8');
  console.log('Wrote ' + path.relative(process.cwd(), out) + ' (' + rows.length + ' widget rows).');
  console.log('Accent contrast on white: ' + accentOnWhite.toFixed(2) + ':1');
  rows.forEach((r) => console.log('  ' + r.widgetId + '  ' + r.name + '  (' + r.config.length + ' bytes of config)'));
}

main(process.argv.slice(2));
