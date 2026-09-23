// Usage: node eurostat-series.cjs <ES-code e.g. DE_EDDN> <IATA-folder>
// Saves Eurostat avia_paoa passengers carried for one airport, every year Eurostat has, as
// $SWEEP_EVIDENCE/<IATA>/eurostat-series.txt, and names the highest year (for 'a record year' claims).
const fs = require('fs'), path = require('path');
const EVIDENCE = process.env.SWEEP_EVIDENCE || '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/evidence';
const [code, folder] = process.argv.slice(2);
const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/avia_paoa?format=JSON&lang=EN&freq=A&unit=PAS&tra_meas=PAS_CRD&rep_airp=${code}`;
(async () => {
  const r = await fetch(url); if (r.status !== 200) { console.error('HTTP ' + r.status); process.exit(1); }
  const j = await r.json();
  const t = j.dimension.time.category.index, name = j.dimension.rep_airp.category.label[code];
  const rows = Object.entries(t).sort((a, b) => a[1] - b[1]).map(([y, k]) => [y, j.value[String(k)]]).filter(([, v]) => v != null);
  const max = rows.reduce((a, b) => (b[1] > a[1] ? b : a));
  const out = `URL: ${url}\nFETCHED: ${new Date().toISOString()}\nHTTP: 200\nKIND: Eurostat avia_paoa, passengers carried (arrivals plus departures), every year Eurostat reports for ${code}\n----\n` +
    rows.map(([y, v]) => `Eurostat ${code} ${name.trim()}: passengers carried in ${y}: ${v.toLocaleString('en-GB')}`).join('\n') +
    `\nHighest year in the series: ${max[0]} (${max[1].toLocaleString('en-GB')})\n`;
  const dir = path.join(EVIDENCE, folder); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'eurostat-series.txt'), out); console.log(out);
})();
