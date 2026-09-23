// Usage: node eurostat-pair-series.cjs <ISO2> <IATA-folder> <label> <PAIR> [<PAIR> ...]
// e.g.   node eurostat-pair-series.cjs FR SXB paris-routes FR_LFST_FR_LFPG FR_LFST_FR_LFPO
// Saves every year Eurostat has for the named airport pairs (avia_par_<country>, passengers carried) to
// $SWEEP_EVIDENCE/<IATA>/eurostat-<label>.txt. For 'the route ended in 20xx' claims: a route that stops
// carrying passengers stops appearing (added 23 Sep late evening, for Strasbourg's Paris flights).
const fs = require('fs'), path = require('path');
const EVIDENCE = process.env.SWEEP_EVIDENCE || '/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad/sweep/evidence';
const [cc, folder, label, ...pairs] = process.argv.slice(2);
const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/avia_par_${cc.toLowerCase()}?format=JSON&lang=EN&freq=A&unit=PAS&tra_meas=PAS_CRD&` + pairs.map(p => 'airp_pr=' + p).join('&');
(async () => {
  const r = await fetch(url);
  if (r.status !== 200) { console.error('HTTP ' + r.status); process.exit(1); }
  const j = await r.json();
  const ids = j.id, size = j.size;
  const pi = ids.indexOf('airp_pr'), ti = ids.indexOf('time');
  const strides = size.map((_, i) => size.slice(i + 1).reduce((a, b) => a * b, 1));
  const pcat = j.dimension.airp_pr.category, tcat = j.dimension.time.category;
  let out = `URL: ${url}\nFETCHED: ${new Date().toISOString()}\nHTTP: 200\nKIND: Eurostat avia_par_${cc.toLowerCase()}, passengers carried on the named airport pairs, every year published (a year with no line has no data)\n----\n`;
  for (const [code, pk] of Object.entries(pcat.index)) {
    const lines = [];
    for (const [t, tk] of Object.entries(tcat.index)) {
      const v = j.value[String(pk * strides[pi] + tk * strides[ti])];
      if (v != null) lines.push(`Eurostat ${code} ${pcat.label[code].trim()}: ${v.toLocaleString('en-GB')} passengers in ${t}`);
    }
    out += lines.length ? lines.join('\n') + '\n' : `Eurostat ${code} ${pcat.label[code].trim()}: no year has data\n`;
  }
  const f = path.join(EVIDENCE, folder, `eurostat-${label}.txt`); fs.writeFileSync(f, out);
  console.log(out); console.log('saved ' + f);
})();
