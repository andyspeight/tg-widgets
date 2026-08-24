/**
 * TEMPORARY — fetches the OurAirports public-domain dataset and returns the
 * departure-airport candidates (the build sandbox cannot reach external
 * hosts, so this runs on Vercel like the other research probes). Deleted
 * once api/_data/airports-departures.json is built from its output.
 *
 * Filter: large or medium airports, scheduled service, with a real IATA
 * code. That is roughly every airport a visitor could actually fly from.
 */

const SOURCES = [
  'https://davidmegginson.github.io/ourairports-data/airports.csv',
  'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv',
];

/** Minimal correct CSV parser: quoted fields, embedded commas and quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export default async function handler(req, res) {
  let text = null;
  let source = null;
  for (const url of SOURCES) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) { text = await r.text(); source = url; break; }
    } catch (e) { /* try the mirror */ }
  }
  if (!text) { res.status(502).json({ error: 'could not fetch OurAirports' }); return; }

  const rows = parseCsv(text);
  const head = rows[0];
  const col = (name) => head.indexOf(name);
  const cType = col('type');
  const cName = col('name');
  const cCountry = col('iso_country');
  const cCity = col('municipality');
  const cSched = col('scheduled_service');
  const cIata = col('iata_code');

  const IATA = /^[A-Z]{3}$/;
  const out = [];
  let large = 0;
  let medium = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const type = r[cType];
    if (type !== 'large_airport' && type !== 'medium_airport') continue;
    if (r[cSched] !== 'yes') continue;
    const iata = String(r[cIata] || '').trim().toUpperCase();
    if (!IATA.test(iata)) continue;
    if (type === 'large_airport') large++; else medium++;
    out.push([iata, String(r[cName] || '').trim(), String(r[cCountry] || '').trim(),
      String(r[cCity] || '').trim(), type === 'large_airport' ? 'L' : 'M']);
  }

  res.setHeader('Cache-Control', 'no-store');
  const pad = Math.min(200000, Math.max(0, parseInt(req.query.pad, 10) || 0));
  res.status(200).json({ source, csvRows: rows.length - 1, total: out.length, large, medium,
    rows: out, pad: pad ? ' '.repeat(pad) : undefined });
}
