/**
 * Offer builder — same-origin photo upload (Tullys Travel, Aug 2026).
 *
 * THE REPORT. Andrew at Tullys Travel could not upload offer photos — file
 * picker and drag both failed with "Could not upload those photos…".
 *
 * WHY. The uploader loaded the @vercel/blob SDK from a third-party CDN (esm.sh)
 * and then uploaded straight to blob.vercel-storage.com. A locked-down agency
 * network blocks one or both of those external hosts, and the upload silently
 * failed for every file.
 *
 * THE FIX. A same-origin server route (/api/upload-photo-direct) that the
 * browser POSTs the raw bytes to; the server streams them to Blob. Nothing
 * external is contacted, so it works behind corporate firewalls. It is the
 * primary path for photos up to ~4MB; the CDN client route stays as the fallback
 * for larger files, so the 8MB ceiling still holds when the network allows it.
 *
 * The endpoint imports jsonwebtoken (via the auth middleware), absent in the dev
 * sandbox, so the pure helpers are extracted + evaluated and the handler wiring
 * is source-guarded — the same approach as the other suites.
 *
 * Run: node test/offer-photo-direct-upload-smoke.mjs  (npm run test:offer-photo-direct)
 */
import { readFileSync } from 'node:fs';

const API = readFileSync(new URL('../api/upload-photo-direct.js', import.meta.url), 'utf8');
const WIDGET = readFileSync(new URL('../public/widget-offer-builder.js', import.meta.url), 'utf8');
const EDITOR = readFileSync(new URL('../public/editor-offer-builder.html', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// ── The real endpoint helpers, extracted + evaluated ──
const typesM = API.match(/const ALLOWED_TYPES = \[[^\]]*\];/);
const allowM = API.match(/export function isAllowedImageType\(ct\) \{[\s\S]*?\n\}/);
const sanM = API.match(/export function sanitiseUploadName\(name\) \{[\s\S]*?\n\}/);
ok('endpoint defines its helpers', !!typesM && !!allowM && !!sanM);
let isAllowedImageType = () => { throw new Error('x'); };
let sanitiseUploadName = () => { throw new Error('x'); };
if (typesM && allowM && sanM) {
  ({ isAllowedImageType, sanitiseUploadName } = new Function(
    typesM[0] + '\n' +
    allowM[0].replace(/^export /, '') + '\n' +
    sanM[0].replace(/^export /, '') + '\n' +
    'return { isAllowedImageType, sanitiseUploadName };')());
}

console.log('isAllowedImageType admits the image types and nothing else');
{
  ok('jpeg/png/webp/gif/avif accepted', ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].every(isAllowedImageType));
  ok('tolerates a charset parameter', isAllowedImageType('image/jpeg; charset=binary'));
  ok('case-insensitive', isAllowedImageType('IMAGE/PNG'));
  ok('rejects non-images', !isAllowedImageType('application/json') && !isAllowedImageType('text/html') && !isAllowedImageType('image/svg+xml'));
  ok('rejects empty/garbage', !isAllowedImageType('') && !isAllowedImageType(null));
}

console.log('sanitiseUploadName keeps a short, path-free name');
{
  ok('keeps a normal name', sanitiseUploadName('beach.jpg') === 'beach.jpg');
  ok('strips slashes so a name can never escape the prefix',
    !sanitiseUploadName('../../etc/passwd').includes('/') && !sanitiseUploadName('offer-photos/x/y.png').includes('/'));
  ok('a slashed name collapses to a plain one', sanitiseUploadName('offer-photos/x/y.png') === 'offer-photosxy.png');
  ok('falls back to "photo" when empty', sanitiseUploadName('') === 'photo' && sanitiseUploadName(null) === 'photo');
  ok('caps the length at 80', sanitiseUploadName('a'.repeat(200)).length === 80);
}

console.log('Endpoint wiring');
{
  ok('uses reliable JSON body parsing, not a raw stream (which hung on Vercel)',
    /typeof req\.body === 'string' \? JSON\.parse\(req\.body\)/.test(API)
    && !/bodyParser: false/.test(API) && !/readRawBody/.test(API));
  ok('the image rides as base64 in the JSON body', /body\.dataBase64/.test(API) && /Buffer\.from\(dataBase64, 'base64'\)/.test(API));
  ok('auth is required before the body is decoded', API.indexOf('requireAuth(req, res)') < API.indexOf('body.dataBase64'));
  ok('the decoded size is capped (under Vercel\'s 4.5MB body limit)',
    /MAX_PHOTO_BYTES = 3\.3 \* 1024 \* 1024/.test(API) && /buf\.length > MAX_PHOTO_BYTES/.test(API) && /413/.test(API));
  ok('content-type is validated against the allow-list', /if \(!isAllowedImageType\(contentType\)\)/.test(API));
  ok('uploads are scoped to the offer-photos/ prefix', /put\('offer-photos\/' \+ name/.test(API));
  ok('a random suffix prevents overwrites', /addRandomSuffix: true/.test(API));
  ok('storage errors are handled, not thrown', /put failed/.test(API) && /502/.test(API));
  ok('writes to the PUBLIC store (the private default rejects public offer photos)',
    /const blobToken = process\.env\.TG_Blob_READ_WRITE_TOKEN \|\| process\.env\.BLOB_READ_WRITE_TOKEN;/.test(API)
    && /token: blobToken/.test(API));
}

console.log('Widget wiring');
{
  ok('config derives the direct endpoint from uploadEndpoint',
    /directUploadEndpoint: c\.directUploadEndpoint[\s\S]*?replace\(\/upload-photo\\b\/, 'upload-photo-direct'\)/.test(WIDGET));
  ok('the same-origin route is tried first for files up to ~3MB',
    /DIRECT_MAX = 3 \* 1024 \* 1024/.test(WIDGET) && /usable\.size <= DIRECT_MAX/.test(WIDGET) && /this\._uploadDirect\(usable\)/.test(WIDGET));
  ok('a 401 on the direct route is not retried on the CDN route',
    /if \(this\._uploadAuthFailed\) return '';/.test(WIDGET) && /res\.status === 401.*_uploadAuthFailed = true/.test(WIDGET));
  ok('the direct upload posts base64 JSON same-origin with the cookie',
    /_uploadDirect\(file\)[\s\S]*?credentials: 'include'[\s\S]*?dataBase64: dataBase64/.test(WIDGET));
  ok('the file is read to base64 via FileReader (no external dependency)',
    /_fileToBase64\(file\)/.test(WIDGET) && /readAsDataURL\(file\)/.test(WIDGET));
  ok('oversized photos are downscaled so they fit the reliable path',
    /_shrinkIfLarge\(file\)/.test(WIDGET) && /canvas\.toBlob\(/.test(WIDGET));
  ok('the downscale falls back to the original on any failure (can only help)',
    /done\(file\)/.test(WIDGET) && /blob\.size >= file\.size\) \{ done\(file\)/.test(WIDGET));
  ok('large files fall back to the CDN client route (8MB ceiling kept)',
    /_uploadViaClient\(file\)[\s\S]*?getBlobClient\(\)/.test(WIDGET));
  ok('the final error tells the truth (auth vs generic), no false "signed in" guess',
    /_uploadAuthFailed\s*\?\s*'Your session has expired/.test(WIDGET) && !/or your network may be blocking the uploader/.test(WIDGET));
  ok('the auth flag resets at the start of each upload batch', /this\._uploadAuthFailed = false;/.test(WIDGET));
  const vm = WIDGET.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/);
  ok('widget version >= 0.3.1', vm && (+vm[1] > 0 || (+vm[1] === 0 && (+vm[2] > 3 || (+vm[2] === 3 && +vm[3] >= 1)))));
}

console.log('Editor wiring');
{
  ok('the editor passes the direct endpoint', /directUploadEndpoint: '\/api\/upload-photo-direct'/.test(EDITOR));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
