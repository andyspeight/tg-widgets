/**
 * /api/sea-route — the cruise route stays off land (Andrea, Aug 2026).
 *
 * Given ordered ports, computeRoute stitches a maritime polyline from the sea
 * path between each consecutive pair (searoute-js over a bundled marine
 * network, no external calls). The key requirement: the line must go AROUND
 * land, not across it.
 *
 * We assert the classic land-crossing case — Barcelona -> Rome (Civitavecchia).
 * A straight line cuts across Sardinia/Corsica; a real sea route threads the
 * Strait of Bonifacio between the two islands (~9E, ~41.3N). We check an
 * intermediate waypoint lands in that strait, plus continuity and bounds.
 *
 * Run: node test/sea-route-smoke.mjs   (npm run test:sea-route)
 */
import { computeRoute } from '../api/sea-route.js';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

const P = (name, lng, lat) => ({ name, lng, lat });

console.log('A single leg routes around land, not across it');
{
  const { line, nm } = computeRoute([P('Barcelona', 2.17, 41.38), P('Rome', 11.79, 42.09)]);
  ok('a line is produced', Array.isArray(line) && line.length >= 3);
  ok('every point is a valid [lng, lat] pair', line.every((c) => Array.isArray(c) && isFinite(c[0]) && isFinite(c[1])));
  ok('the leg length is a sensible sea distance (400-900 nm)', nm >= 400 && nm <= 900);
  // The give-away that it went around, not through: a waypoint in the Strait of
  // Bonifacio (between Corsica and Sardinia).
  const throughStrait = line.some((c) => c[0] >= 8.4 && c[0] <= 10.0 && c[1] >= 40.8 && c[1] <= 41.7);
  ok('it threads the Strait of Bonifacio (does not cross Sardinia/Corsica)', throughStrait);
  ok('every waypoint sits in the western Med bounds', line.every((c) => c[0] >= -1 && c[0] <= 15 && c[1] >= 36 && c[1] <= 45));
}

console.log('A multi-stop cruise stitches into one continuous line');
{
  const ports = [P('Barcelona', 2.17, 41.38), P('Marseille', 5.35, 43.30), P('Genoa', 8.93, 44.40), P('Rome', 11.79, 42.09)];
  const { line } = computeRoute(ports);
  ok('the stitched line has more points than the ports (it curves at sea)', line.length > ports.length);
  // No duplicated join point where two legs meet.
  let dupes = 0;
  for (let i = 1; i < line.length; i++) if (line[i][0] === line[i - 1][0] && line[i][1] === line[i - 1][1]) dupes++;
  ok('no duplicated consecutive points at the leg joins', dupes === 0);
  ok('the line starts at the first port', Math.abs(line[0][0] - 2.17) < 1.5 && Math.abs(line[0][1] - 41.38) < 1.5);
}

console.log('Edge handling');
{
  const two = computeRoute([P('Miami', -80.19, 25.77), P('Nassau', -77.35, 25.06)]);
  ok('a two-port route works (Caribbean)', two.line.length >= 2 && two.nm > 0);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
