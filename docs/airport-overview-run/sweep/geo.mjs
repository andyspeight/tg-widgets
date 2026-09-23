/* Independent check for WHERE an airport is: distance, bearing, runways,
   elevation. Computed from data that owes nothing to Wikipedia:
     - the airport's position, elevation and runways from OurAirports
       (public domain, davidmegginson.github.io/ourairports-data)
     - the city centre from GeoNames cities15000 (download.geonames.org)

   Usage: node geo.mjs <IATA> [...]    or    node geo.mjs --all

   Writes $SWEEP_EVIDENCE/<IATA>/geo.txt, a file the quote checker can read, and
   prints every distance or bearing the current Overview states next to what the
   coordinates say, so a wrong bearing (the Enfidha class of error) shows up.

   Tolerance, stated once so it is applied the same way everywhere:
     bearing   the stated compass point must be the computed one or an adjacent
               one on the 8-point rose (within 45 degrees)
     distance  stated / straight-line must fall between 0.8 and 1.6, because an
               Overview may quote the road distance, which is never shorter */
import fs from 'node:fs';
import path from 'node:path';

const SP = '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep';
const EVIDENCE = process.env.SWEEP_EVIDENCE || SP + '/evidence';
const snap = JSON.parse(fs.readFileSync(SP + '/snapshot-0923.json', 'utf8')).records;

function csv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const airports = csv(fs.readFileSync(SP + '/airports.csv', 'utf8'));
const runways = csv(fs.readFileSync(SP + '/runways.csv', 'utf8'));
const cities = fs.readFileSync(SP + '/cities15000.txt', 'utf8').split('\n').filter(Boolean).map(l => {
  const c = l.split('\t');
  return { id: c[0], name: c[1], ascii: c[2], alt: c[3], lat: +c[4], lng: +c[5], cc: c[8], pop: +c[14] };
});

const R = 6371.0088, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const dist = (a, b) => { const dl = rad(b.lat - a.lat), dn = rad(b.lng - a.lng);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)); };
const bearing = (a, b) => { const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360; };
const ROSE = ['north', 'north east', 'east', 'south east', 'south', 'south west', 'west', 'north west'];
const point8 = b => ROSE[Math.round(b / 45) % 8];
const ROSE16 = { 'north north east': 22.5, 'east north east': 67.5, 'east south east': 112.5, 'south south east': 157.5,
  'south south west': 202.5, 'west south west': 247.5, 'west north west': 292.5, 'north north west': 337.5 };
const angleOf = d => (d in ROSE16) ? ROSE16[d] : (ROSE.indexOf(d) >= 0 ? ROSE.indexOf(d) * 45 : null);
const canon = s => s.toLowerCase().replace(/ern\b/g, '').replace(/[\s-]+/g, ' ').replace(/northeast/, 'north east')
  .replace(/northwest/, 'north west').replace(/southeast/, 'south east').replace(/southwest/, 'south west').trim();
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function findCity(name, cc, ap) {
  if (!name) return null;
  const parts = [name, name.replace(/\s*\(.*?\)\s*/g, ' ').trim(), ...(name.match(/\(([^)]+)\)/g) || []).map(x => x.slice(1, -1))];
  if (parts.length > 1 && parts[1] !== name) {
    for (const p of parts.slice(1)) { const hit = findCity(p, cc, ap); if (hit) return hit; }
  }
  const n = fold(name);
  const cands = cities.filter(c => c.cc === cc && (fold(c.name) === n || fold(c.ascii) === n ||
    c.alt.split(',').some(a => fold(a) === n)));
  let near = cands.map(c => ({ ...c, d: dist(ap, c) })).filter(c => c.d < 250).sort((a, b) => b.pop - a.pop);
  if (!near.length) near = cities.filter(c => fold(c.name) === n || fold(c.ascii) === n)
    .map(c => ({ ...c, d: dist(ap, c) })).filter(c => c.d < 100).sort((a, b) => b.pop - a.pop);
  return near[0] || null;
}
// The city a sentence measures FROM: "12 km south east of Cologne", "7 km from central Lille".
function refCity(tail, cc, ap) {
  const m = tail.match(/\b(?:of|from)\s+(?:the\s+)?(?:(?:city|town)\s+(?:centre|center)\s+of\s+|centre\s+of\s+|center\s+of\s+|central\s+|downtown\s+)?([A-ZÀ-Þ][\wÀ-ÿ'’.-]+(?:\s+[A-ZÀ-Þ][\wÀ-ÿ'’.-]+){0,3})/);
  if (!m) return null;
  const words = m[1].replace(/[.,;:]+$/, '').split(/\s+/).map(w => w.replace(/[.,;:]+$/, ''));
  for (let k = words.length; k >= 1; k--) { const hit = findCity(words.slice(0, k).join(' '), cc, ap); if (hit) return hit; }
  return null;
}

const codes = process.argv[2] === '--all'
  ? snap.filter(r => r.cellValuesByFieldId.fldjvujj14Q9QNLLq.name === 'In progress').map(r => r.cellValuesByFieldId.fldcS9uu4NWMVaIVP)
  : process.argv.slice(2).map(s => s.toUpperCase());

const summary = [];
for (const code of codes) {
  const rec = snap.find(r => r.cellValuesByFieldId.fldcS9uu4NWMVaIVP === code);
  const f = rec ? rec.cellValuesByFieldId : {};
  const oa = airports.filter(a => a.iata_code === code).sort((a, b) => (b.scheduled_service === 'yes') - (a.scheduled_service === 'yes'))[0];
  if (!oa) { console.log(code + '  NOT IN OURAIRPORTS'); summary.push({ code, problem: 'not in OurAirports' }); continue; }
  const ap = { lat: +oa.latitude_deg, lng: +oa.longitude_deg };
  const cityName = f.fldgrJ2uFjzPcAxUx || oa.municipality;
  let city = findCity(cityName, oa.iso_country, ap);
  if (!city && oa.municipality && oa.municipality !== cityName) city = findCity(oa.municipality, oa.iso_country, ap);
  // last resort: the city in the airport's own name ("Lille Airport", "Cologne Bonn Airport")
  if (!city) {
    const w = oa.name.replace(/\b(International|Intl|Regional|Airport|Aeropuerto|Aeroporto|Aéroport|Flughafen|Airfield|Air Base)\b.*$/i, '').trim().split(/\s+/);
    for (let k = Math.min(3, w.length); k >= 1 && !city; k--) city = findCity(w.slice(0, k).join(' '), oa.iso_country, ap);
  }
  const rws = runways.filter(r => r.airport_ident === oa.ident && r.closed !== '1' && +r.length_ft > 0);
  const lines = [];
  lines.push(`Airport: ${oa.name} (OurAirports ${oa.ident}, IATA ${oa.iata_code}) at ${ap.lat.toFixed(4)}, ${ap.lng.toFixed(4)}` +
    (oa.elevation_ft ? `, elevation ${(+oa.elevation_ft).toLocaleString('en-GB')} ft (${Math.round(+oa.elevation_ft * 0.3048).toLocaleString('en-GB')} m)` : ''));
  let d = null, b = null;
  if (city) {
    d = dist(city, ap); b = bearing(city, ap);
    lines.push(`City centre: ${city.name} (GeoNames ${city.id}) at ${city.lat.toFixed(4)}, ${city.lng.toFixed(4)}, population ${city.pop.toLocaleString('en-GB')}`);
    lines.push(`Straight-line distance from the city centre: ${d.toFixed(1)} km (${(d / 1.609344).toFixed(1)} miles)`);
    lines.push(`Bearing from the city centre: ${Math.round(b)} degrees, which is ${point8(b)}`);
  } else lines.push(`City centre: no GeoNames match for "${cityName}" in ${oa.iso_country}`);
  for (const r of rws) lines.push(`Runway ${r.le_ident}/${r.he_ident}: ${Math.round(+r.length_ft * 0.3048).toLocaleString('en-GB')} m (${(+r.length_ft).toLocaleString('en-GB')} ft), ${r.surface || 'surface not given'}`);
  lines.push(`Runways listed: ${rws.length}`);
  const dir = path.join(EVIDENCE, code); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'geo.txt'),
    `URL: computed from OurAirports airports.csv and runways.csv plus GeoNames cities15000, both fetched 2026-09-23\nFETCHED: ${new Date().toISOString()}\nHTTP: computed\nKIND: geo\n----\n` + lines.join('\n') + '\n');

  // compare with what the Overview says
  const ov = f.fldmRELkLWrUGL5Ss || '';
  const found = [];
  const rx = /(\d+(?:[.,]\d+)?)\s*(km|kilometres|kilometers|miles?|mi)\b[^.;]{0,40}?\b((?:(?:north|south|east|west)[\s-]+)?(?:north[\s-]?east|north[\s-]?west|south[\s-]?east|south[\s-]?west)|north|south|east|west)(?:ern)?\b/gi;
  let m; while ((m = rx.exec(ov))) {
    const km = (/mi/i.test(m[2]) ? 1.609344 : 1) * parseFloat(m[1].replace(',', '.'));
    const tail = ov.slice(m.index + m[0].length, m.index + m[0].length + 80);
    found.push({ said: m[0], km, dir: canon(m[3]), ref: refCity(tail, oa.iso_country, ap) });
  }
  const dirOnly = [...ov.matchAll(/\b(north[\s-]?east|north[\s-]?west|south[\s-]?east|south[\s-]?west|north|south|east|west)(?:ern)?\s+of\s+(?:the\s+)?(?:city|centre|center|downtown|town|capital)/gi)].map(x => canon(x[1]));
  const verdicts = [];
  for (const x of found) {
    const c = x.ref || city;
    if (!c) { verdicts.push(`NOCITY "${x.said}"  (no city to compare)`); continue; }
    const dx = dist(c, ap), bx = bearing(c, ap), ang = angleOf(x.dir);
    const ratio = x.km / dx, dd = ang == null ? 999 : Math.abs(((ang - bx) + 540) % 360 - 180);
    const okD = ratio >= 0.8 && ratio <= 1.6, okB = dd <= 45;
    if (x.ref && x.ref !== city) lines.push(`Straight-line distance from ${c.name} (GeoNames ${c.id}): ${dx.toFixed(1)} km (${(dx / 1.609344).toFixed(1)} miles), bearing ${Math.round(bx)} degrees, which is ${point8(bx)}`);
    verdicts.push(`${okD && okB ? 'OK  ' : 'CHECK'} "${x.said}" [from ${c.name}]  -> computed ${dx.toFixed(1)} km ${point8(bx)} (${Math.round(bx)} deg); ratio ${ratio.toFixed(2)}, bearing off ${Math.round(dd)} deg`);
  }
  fs.writeFileSync(path.join(dir, 'geo.txt'),
    `URL: computed from OurAirports airports.csv and runways.csv plus GeoNames cities15000, both fetched 2026-09-23\nFETCHED: ${new Date().toISOString()}\nHTTP: computed\nKIND: geo\n----\n` + lines.join('\n') + '\n');
  for (const dirW of dirOnly) if (!found.some(x => x.dir === dirW) && b != null) {
    const dd = Math.abs(((ROSE.indexOf(dirW) * 45 - b) + 540) % 360 - 180);
    verdicts.push(`${dd <= 45 ? 'OK  ' : 'CHECK'} "${dirW} of the city" -> computed ${point8(b)} (${Math.round(b)} deg)`);
  }
  summary.push({ code, city: city ? city.name : null, km: d, bearing: b, verdicts });
  if (process.argv[2] !== '--all') { console.log(lines.join('\n')); for (const v of verdicts) console.log('  ' + v); }
}
if (process.argv[2] === '--all') {
  fs.writeFileSync(SP + '/geo-summary.json', JSON.stringify(summary, null, 1));
  const noCity = summary.filter(s => !s.city && !(s.verdicts || []).some(v => /\[from /.test(v))).map(s => s.code);
  const checks = summary.filter(s => (s.verdicts || []).some(v => v.startsWith('CHECK')));
  const oks = summary.filter(s => (s.verdicts || []).some(v => v.startsWith('OK')));
  console.log(`airports ${summary.length}; with a stated distance or bearing confirmed: ${oks.length}; needing a look: ${checks.length}; no GeoNames city: ${noCity.length} (${noCity.join(' ')})`);
  for (const s of checks) console.log(s.code.padEnd(4) + ' ' + s.verdicts.filter(v => v.startsWith('CHECK')).join(' | '));
}
