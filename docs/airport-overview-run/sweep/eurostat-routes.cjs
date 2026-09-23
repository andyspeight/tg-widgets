// Usage: node eurostat-routes.cjs <ISO2> <ICAO> <IATA-folder> [year] [top]
// Lists an airport's routes (Eurostat avia_par_<iso2>, passengers carried on each airport pair,
// both directions as Eurostat reports them), high to low, and saves the list as
// $SWEEP_EVIDENCE/<IATA>/eurostat-routes.txt. Only helps show what KIND of flying an airport has:
// the latest year Eurostat publishes by route lags the airport totals (2024 as of Sep 2026).
const fs = require('fs'), path = require('path');
const EVIDENCE = process.env.SWEEP_EVIDENCE ||
  '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/evidence';
const [cc, icao, folder, year = '2024', top = '30'] = process.argv.slice(2);
const ES = ({ GR: 'EL', GB: 'UK' }[cc] || cc).toUpperCase();
const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/avia_par_${ES.toLowerCase()}?format=JSON&lang=EN&freq=A&unit=PAS&tra_meas=PAS_CRD&time=${year}`;
(async () => {
  const r = await fetch(url);
  if (r.status !== 200) { console.error('HTTP ' + r.status); process.exit(1); }
  const j = await r.json();
  const ids = j.id, size = j.size, pos = ids.indexOf('airp_pr');
  const stride = size.slice(pos + 1).reduce((a, b) => a * b, 1);
  const cat = j.dimension.airp_pr.category;
  // Only the pairs this airport reports (its code first): a domestic route is also reported by the
  // other airport, and counting both would count the same passengers twice.
  const want = `${ES}_${icao}_`;
  const yr = Object.keys(j.dimension.time.category.index)[0] || year;
  const rows = [];
  for (const [code, k] of Object.entries(cat.index)) {
    if (!code.startsWith(want)) continue;
    const v = j.value[String(k * stride)];
    if (v != null) rows.push({ code, label: cat.label[code], v });
  }
  rows.sort((a, b) => b.v - a.v);
  const total = rows.reduce((a, b) => a + b.v, 0);
  const n = Math.min(rows.length, +top);
  const out = `URL: ${url}\nFETCHED: ${new Date().toISOString()}\nHTTP: 200\nKIND: Eurostat avia_par_${ES.toLowerCase()}, passengers carried on each route ${icao} reports in ${yr} (both directions; a domestic route counted once, as this airport reports it), high to low, top ${n} of ${rows.length}\n----\n` +
    `Eurostat routes reported for ${icao} in ${yr}: ${rows.length}, carrying ${total.toLocaleString('en-GB')} passengers in all\n` +
    rows.slice(0, n).map((o, i) => `${i + 1}. Eurostat ${o.code} ${o.label.replace(/^[A-Z_]+\s+/, '').trim()}: ${o.v.toLocaleString('en-GB')} passengers in ${yr} (${(100 * o.v / total).toFixed(1)}% of the routes listed)`).join('\n') + '\n';
  const dir = path.join(EVIDENCE, folder); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'eurostat-routes.txt'); fs.writeFileSync(f, out);
  console.log(out); console.log('saved ' + f);
})();
