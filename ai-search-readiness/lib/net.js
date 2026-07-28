'use strict';

/**
 * lib/net.js — SSRF guard and safe fetch.
 *
 * This is the highest-risk module in the repo. The public endpoint fetches
 * arbitrary user-supplied URLs server-side, so every request that leaves this
 * process goes through here.
 *
 * Guarantees:
 *   - http and https schemes only
 *   - default web ports only (none, 80, 443)
 *   - every resolved IP is validated at connect time via a custom dns lookup,
 *     which closes the DNS-rebinding window that a resolve-then-fetch design
 *     leaves open
 *   - if a hostname resolves to several addresses, ALL of them must be public
 *   - every redirect hop is re-validated from scratch
 *   - hard byte cap and hard overall deadline
 *
 * No runtime dependencies. Node 18+.
 */

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 1.5 * 1024 * 1024; // 1.5MB
const DEFAULT_MAX_REDIRECTS = 5;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set(['', '80', '443']);

/** Typed error so callers can branch without string matching. */
class NetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NetError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ *
 * IP parsing and classification
 * ------------------------------------------------------------------ */

function parseIPv4(str) {
  const parts = String(str).split('.');
  if (parts.length !== 4) return null;
  const bytes = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function parseIPv6(str) {
  let s = String(str).split('%')[0]; // drop any zone id

  // A trailing dotted-quad (::ffff:127.0.0.1) is rewritten to two hex groups.
  const lastColon = s.lastIndexOf(':');
  if (lastColon !== -1 && s.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = s.slice(0, lastColon + 1) + hi + ':' + lo;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = head.concat(new Array(fill).fill('0'), tail);
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const n = parseInt(group, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

function inV4Range(bytes, a, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const ip = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const base = ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0;
  return (ip & mask) >>> 0 === (base & mask) >>> 0;
}

/**
 * Everything that is not globally routable unicast is blocked. The list is
 * deliberately wider than "private" — link-local carries the cloud metadata
 * endpoints, and the reserved and documentation ranges have no business being
 * reachable from a public scanner.
 */
const BLOCKED_V4 = [
  [[0, 0, 0, 0], 8],        // this network
  [[10, 0, 0, 0], 8],       // private
  [[100, 64, 0, 0], 10],    // carrier-grade NAT
  [[127, 0, 0, 0], 8],      // loopback
  [[169, 254, 0, 0], 16],   // link-local, includes 169.254.169.254 metadata
  [[172, 16, 0, 0], 12],    // private
  [[192, 0, 0, 0], 24],     // IETF protocol assignments
  [[192, 0, 2, 0], 24],     // TEST-NET-1
  [[192, 88, 99, 0], 24],   // 6to4 relay anycast
  [[192, 168, 0, 0], 16],   // private
  [[198, 18, 0, 0], 15],    // benchmarking
  [[198, 51, 100, 0], 24],  // TEST-NET-2
  [[203, 0, 113, 0], 24],   // TEST-NET-3
  [[224, 0, 0, 0], 4],      // multicast
  [[240, 0, 0, 0], 4],      // reserved, includes 255.255.255.255
];

function classifyV4(bytes) {
  for (const [base, prefix] of BLOCKED_V4) {
    if (inV4Range(bytes, base, prefix)) return { public: false, reason: 'reserved IPv4 range' };
  }
  return { public: true };
}

function classifyV6(bytes) {
  const isZero = (from, to) => bytes.slice(from, to).every((b) => b === 0);

  if (isZero(0, 16)) return { public: false, reason: 'unspecified address' };
  if (isZero(0, 15) && bytes[15] === 1) return { public: false, reason: 'IPv6 loopback' };

  // ::ffff:0:0/96 IPv4-mapped — judge by the embedded IPv4.
  if (isZero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return classifyV4(bytes.slice(12, 16));
  }
  // 64:ff9b::/96 NAT64 — judge by the embedded IPv4.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && isZero(4, 12)) {
    return classifyV4(bytes.slice(12, 16));
  }
  // 2002::/16 6to4 — the embedded IPv4 can be anything, so block the range.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return { public: false, reason: '6to4 range' };
  // 100::/64 discard-only
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && isZero(2, 8)) return { public: false, reason: 'discard range' };
  // 2001:db8::/32 documentation
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return { public: false, reason: 'documentation range' };
  }
  // 2001::/23 IETF protocol assignments (includes Teredo 2001:0::/32)
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2] & 0xfe) === 0x00) {
    return { public: false, reason: 'IETF protocol assignment range' };
  }
  // fc00::/7 unique local
  if ((bytes[0] & 0xfe) === 0xfc) return { public: false, reason: 'IPv6 unique local address' };
  // fe80::/10 link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return { public: false, reason: 'IPv6 link-local' };
  // ff00::/8 multicast
  if (bytes[0] === 0xff) return { public: false, reason: 'IPv6 multicast' };

  return { public: true };
}

/**
 * True only for addresses we are willing to open a socket to.
 * @param {string} address
 * @returns {{public: boolean, reason?: string}}
 */
function classifyIp(address) {
  const kind = net.isIP(address);
  if (kind === 4) {
    const bytes = parseIPv4(address);
    return bytes ? classifyV4(bytes) : { public: false, reason: 'unparseable IPv4' };
  }
  if (kind === 6) {
    const bytes = parseIPv6(address);
    return bytes ? classifyV6(bytes) : { public: false, reason: 'unparseable IPv6' };
  }
  return { public: false, reason: 'not an IP address' };
}

/* ------------------------------------------------------------------ *
 * URL validation
 * ------------------------------------------------------------------ */

/**
 * Parse and structurally validate a URL. Does not touch the network.
 * @param {string} raw
 * @returns {URL}
 */
function validateUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    throw new NetError('BAD_URL', 'That does not look like a web address.');
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new NetError('BAD_URL', 'That does not look like a web address.');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new NetError('BAD_SCHEME', 'Only http and https addresses can be checked.');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new NetError('BAD_PORT', 'Only standard web ports can be checked.');
  }
  if (!url.hostname) {
    throw new NetError('BAD_URL', 'That does not look like a web address.');
  }
  // A bare IP literal is checked here; hostnames are checked at connect time.
  const literal = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (net.isIP(literal)) {
    const verdict = classifyIp(literal);
    if (!verdict.public) {
      throw new NetError('BLOCKED_IP', 'That address is not publicly reachable.');
    }
  }
  return url;
}

/**
 * Normalise whatever the visitor typed into a URL we can scan.
 * Bare hostnames get https:// put in front of them.
 * @param {string} raw
 * @returns {URL}
 */
function normaliseInput(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  return validateUrl(withScheme);
}

/* ------------------------------------------------------------------ *
 * Guarded DNS lookup
 * ------------------------------------------------------------------ */

function guardedLookup(hostname, options, callback) {
  const opts = Object.assign({}, options, { all: true });
  dns.lookup(hostname, opts, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    if (list.length === 0) {
      const e = new NetError('DNS_FAIL', 'That address could not be resolved.');
      return callback(e);
    }
    // Every answer must be public. A single private record poisons the lot,
    // which stops an attacker pairing a public A record with a private one.
    for (const entry of list) {
      const verdict = classifyIp(entry.address);
      if (!verdict.public) {
        const e = new NetError('BLOCKED_IP', 'That address is not publicly reachable.');
        return callback(e);
      }
    }
    if (options && options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

/* ------------------------------------------------------------------ *
 * Safe fetch
 * ------------------------------------------------------------------ */

function requestOnce(url, { method, headers, timeoutMs, maxBytes, signalDeadline }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const remaining = Math.max(1, Math.min(timeoutMs, signalDeadline - Date.now()));

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    let req;
    try {
      req = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          headers: Object.assign({ Host: url.host }, headers),
          lookup: guardedLookup,
          timeout: remaining,
          // Redirects are followed by hand so every hop is re-validated.
        },
        (res) => {
          const chunks = [];
          let bytes = 0;
          let truncated = false;

          res.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
              truncated = true;
              chunks.push(chunk.slice(0, Math.max(0, chunk.length - (bytes - maxBytes))));
              res.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            finish(resolve, {
              status: res.statusCode || 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
              truncated,
              bytes,
            });
          });
          res.on('close', () => {
            if (truncated) {
              finish(resolve, {
                status: res.statusCode || 0,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
                truncated: true,
                bytes,
              });
            }
          });
          res.on('error', () => finish(reject, new NetError('NETWORK', 'That site could not be reached.')));
        }
      );
    } catch {
      return finish(reject, new NetError('NETWORK', 'That site could not be reached.'));
    }

    req.on('timeout', () => {
      req.destroy();
      finish(reject, new NetError('TIMEOUT', 'That site took too long to answer.'));
    });
    req.on('error', (err) => {
      if (err && err.code === 'BLOCKED_IP') {
        return finish(reject, new NetError('BLOCKED_IP', 'That address is not publicly reachable.'));
      }
      if (err instanceof NetError) return finish(reject, err);
      finish(reject, new NetError('NETWORK', 'That site could not be reached.'));
    });
    req.end();
  });
}

/**
 * Fetch a URL with the full guard applied, following redirects by hand so that
 * every hop is validated from scratch.
 *
 * Non-2xx responses resolve normally. Only guard failures and transport
 * failures reject, so callers can tell "the site said 403" from "we could not
 * get there at all".
 *
 * @param {string|URL} input
 * @param {object} [opts]
 * @returns {Promise<{status:number, headers:object, body:string, finalUrl:string, redirects:string[], truncated:boolean, bytes:number}>}
 */
async function safeFetch(input, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    totalTimeoutMs = timeoutMs * 2,
  } = opts;

  let url = input instanceof URL ? validateUrl(input.href) : validateUrl(String(input));
  const deadline = Date.now() + totalTimeoutMs;
  const redirects = [];
  const seen = new Set([url.href]);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (Date.now() >= deadline) {
      throw new NetError('TIMEOUT', 'That site took too long to answer.');
    }

    const res = await requestOnce(url, { method, headers, timeoutMs, maxBytes, signalDeadline: deadline });
    const location = res.headers && res.headers.location;

    const isRedirect = res.status >= 300 && res.status < 400 && location;
    if (!isRedirect) {
      return {
        status: res.status,
        headers: res.headers,
        body: res.body,
        finalUrl: url.href,
        redirects,
        truncated: res.truncated,
        bytes: res.bytes,
      };
    }

    if (hop === maxRedirects) {
      throw new NetError('TOO_MANY_REDIRECTS', 'That site redirects in a loop.');
    }

    let next;
    try {
      next = new URL(location, url);
    } catch {
      throw new NetError('BAD_URL', 'That site redirected somewhere invalid.');
    }
    // Full re-validation of the new target. A public host is perfectly capable
    // of redirecting to 169.254.169.254.
    url = validateUrl(next.href);
    if (seen.has(url.href)) {
      throw new NetError('TOO_MANY_REDIRECTS', 'That site redirects in a loop.');
    }
    seen.add(url.href);
    redirects.push(url.href);
  }

  throw new NetError('TOO_MANY_REDIRECTS', 'That site redirects in a loop.');
}

module.exports = {
  NetError,
  classifyIp,
  validateUrl,
  normaliseInput,
  safeFetch,
  parseIPv4,
  parseIPv6,
  DEFAULT_MAX_BYTES,
};
