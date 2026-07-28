'use strict';

/**
 * lib/access.js — Pillar 1: can the AI crawlers actually reach the site.
 *
 * This is the pillar no competitor tool has. It does two things:
 *
 *   1. Reads robots.txt and works out what each bot is told it may do.
 *   2. Sends a real request as each bot, with that bot's honest User-Agent,
 *      and compares the answer against a browser control probe.
 *
 * The control probe is the whole credibility mechanism. A 403 to a bot only
 * means something if a browser got through. If the site refuses both, we say
 * inconclusive and mean it.
 *
 * We never spoof a browser UA on a bot probe. The point is to see how the site
 * treats a request that honestly says what it is.
 */

const { safeFetch, NetError } = require('./net');

/** The retrieval and citation bots that drive AI answers. */
const CRAWLERS = [
  {
    id: 'oai-search',
    label: 'ChatGPT Search',
    engine: 'OpenAI',
    token: 'OAI-SearchBot',
    ua: 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  },
  {
    id: 'chatgpt-user',
    label: 'ChatGPT live fetch',
    engine: 'OpenAI',
    token: 'ChatGPT-User',
    ua: 'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    engine: 'Perplexity',
    token: 'PerplexityBot',
    ua: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  },
  {
    id: 'claudebot',
    label: 'Claude',
    engine: 'Anthropic',
    token: 'ClaudeBot',
    ua: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  },
  {
    id: 'google-extended',
    label: 'Gemini and AI Overviews',
    engine: 'Google',
    token: 'Google-Extended',
    // Google-Extended is a robots.txt control token, not a separate crawler.
    // Google fetches with Googlebot and applies the token afterwards, so the
    // honest live probe here is the Googlebot UA. The report says so.
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    robotsOnly: true,
  },
  {
    id: 'googlebot',
    label: 'Google index',
    engine: 'Google',
    token: 'Googlebot',
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
];

/** A real browser string. Used only for the control probe. */
const CONTROL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

const PROBE_BYTES = 96 * 1024;
const PAGE_BYTES = 1.5 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * robots.txt
 * ------------------------------------------------------------------ */

/**
 * Parse robots.txt into user-agent groups.
 * @param {string} text
 * @returns {{groups: Array<{agents: string[], rules: Array<{allow: boolean, path: string}>}>, sitemaps: string[]}}
 */
function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastLineWasAgent = false;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group of rules.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === 'disallow' || field === 'allow') {
      if (!current) continue;
      // "Disallow:" with no value means no restriction, so it is skipped.
      if (field === 'disallow' && value === '') continue;
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }

  return { groups, sitemaps };
}

/** Turn a robots path pattern into a regex. Supports * and a trailing $. */
function patternToRegex(pattern) {
  let p = pattern;
  let anchored = false;
  if (p.endsWith('$')) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + (anchored ? '$' : ''));
}

/**
 * What does this robots.txt say about this bot fetching this path.
 *
 * Follows the real matching rules rather than a simplification: a group naming
 * the bot wins outright over the wildcard group, and inside a group the longest
 * matching pattern wins, with a tie going to Allow.
 *
 * @param {ReturnType<parseRobots>} parsed
 * @param {string} token
 * @param {string} path
 * @returns {{allowed: boolean, rule: string|null}}
 */
function robotsVerdict(parsed, token, path) {
  const wanted = String(token).toLowerCase();
  const specific = parsed.groups.filter((g) => g.agents.includes(wanted));
  const wildcard = parsed.groups.filter((g) => g.agents.includes('*'));
  const applicable = specific.length ? specific : wildcard;

  if (!applicable.length) return { allowed: true, rule: null };

  let best = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (!patternToRegex(rule.path).test(path)) continue;
      const weight = rule.path.length;
      if (!best || weight > best.weight || (weight === best.weight && rule.allow && !best.allow)) {
        best = { allow: rule.allow, weight, path: rule.path };
      }
    }
  }

  if (!best) return { allowed: true, rule: null };
  return {
    allowed: best.allow,
    rule: `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}`,
  };
}

/* ------------------------------------------------------------------ *
 * Probing
 * ------------------------------------------------------------------ */

const CHALLENGE_MARKERS = [
  'just a moment',
  'attention required! | cloudflare',
  'checking your browser',
  'cf-browser-verification',
  'cf_chl_opt',
  'cf-chl-',
  '_cf_chl',
  'enable javascript and cookies to continue',
  'ddos protection by cloudflare',
  'please verify you are a human',
  'verifying you are human',
  'incapsula incident id',
  'request unsuccessful. incapsula',
  'access denied | ',
  'sorry, you have been blocked',
  'why have i been blocked',
];

/**
 * Does this response look like a bot challenge rather than a real page.
 * Only ever consulted for statuses that could plausibly be a challenge, so a
 * page that happens to contain the words is not mistaken for one.
 * @param {number} status
 * @param {string} body
 * @returns {boolean}
 */
function looksLikeChallenge(status, body) {
  if (status !== 403 && status !== 401 && status !== 429 && status !== 503 && status !== 406) return false;
  const haystack = String(body || '').slice(0, 20000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => haystack.includes(marker));
}

/** Fire one probe and reduce it to the facts the verdict needs. */
async function probe(url, ua, { maxBytes = PROBE_BYTES, timeoutMs = 8000 } = {}) {
  try {
    const res = await safeFetch(url, {
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'identity',
        Connection: 'close',
      },
      maxBytes,
      timeoutMs,
      totalTimeoutMs: timeoutMs * 2,
    });
    return {
      reached: true,
      status: res.status,
      challenge: looksLikeChallenge(res.status, res.body),
      body: res.body,
      finalUrl: res.finalUrl,
      redirects: res.redirects.length,
      // A cf-ray header is a reliable tell that Cloudflare sits in front, which
      // is worth knowing when a block turns up.
      edge: res.headers && res.headers['cf-ray'] ? 'cloudflare' : (res.headers && res.headers.server) || null,
    };
  } catch (err) {
    return {
      reached: false,
      error: err instanceof NetError ? err.code : 'NETWORK',
      status: null,
      challenge: false,
      body: '',
    };
  }
}

/** Did the browser control probe get a real page back. */
function controlSucceeded(control) {
  return Boolean(control && control.reached && control.status >= 200 && control.status < 400 && !control.challenge);
}

/**
 * The verdict rules, in one place, so the credibility principle is auditable.
 *
 * @param {{robots: object, probe: object, control: object}} input
 * @returns {{state: 'pass'|'warn'|'blocked'|'inconclusive', source: string, detail: string}}
 */
function combineVerdict({ robots, probe: p, control }) {
  // robots.txt is authoritative. A Disallow is a hard block whatever the wire says.
  if (robots && robots.allowed === false) {
    return {
      state: 'blocked',
      source: 'robots',
      detail: `robots.txt says ${robots.rule || 'Disallow: /'}`,
    };
  }

  const controlOk = controlSucceeded(control);

  if (!p || !p.reached) {
    if (!controlSucceeded(control)) {
      return { state: 'inconclusive', source: 'network', detail: 'Neither the bot nor a browser could reach the site.' };
    }
    if (p && p.error === 'TOO_MANY_REDIRECTS') {
      return { state: 'warn', source: 'network', detail: 'The request ended in a redirect loop.' };
    }
    if (p && p.error === 'TIMEOUT') {
      return { state: 'warn', source: 'network', detail: 'The request timed out.' };
    }
    return { state: 'warn', source: 'network', detail: 'The request did not complete.' };
  }

  const blockedStatus = p.status === 403 || p.status === 401 || p.status === 451 || p.status === 406;

  if (blockedStatus || p.challenge) {
    if (controlOk) {
      return {
        state: 'blocked',
        source: 'edge',
        detail: p.challenge
          ? `The site returned a bot challenge page (HTTP ${p.status}) to the crawler but served a browser normally.`
          : `The site returned HTTP ${p.status} to the crawler but served a browser normally.`,
      };
    }
    return {
      state: 'inconclusive',
      source: 'edge',
      detail: 'The site refused the crawler, but it refused a browser too, so we cannot call this a crawler block.',
    };
  }

  if (p.status === 429) {
    return { state: 'warn', source: 'edge', detail: 'The site rate limited the crawler (HTTP 429).' };
  }
  if (p.status >= 500) {
    return { state: 'warn', source: 'origin', detail: `The site returned a server error (HTTP ${p.status}).` };
  }
  if (p.status === 404 || p.status === 410) {
    return { state: 'warn', source: 'origin', detail: `The home page returned HTTP ${p.status}.` };
  }
  if (p.status >= 400) {
    return { state: 'warn', source: 'origin', detail: `The site returned HTTP ${p.status}.` };
  }

  return { state: 'pass', source: 'probe', detail: `The crawler was served the page normally (HTTP ${p.status}).` };
}

const STATE_POINTS = { pass: 100, warn: 60, blocked: 0 };

/**
 * Roll the six per-bot verdicts into a pillar score.
 * If the control probe did not get through, the pillar is inconclusive and
 * carries no score at all. It is never scored as a fail.
 */
function summarise({ control, bots, robotsUnknown }) {
  if (!controlSucceeded(control)) {
    return {
      score: null,
      inconclusive: true,
      reason: control && control.reached
        ? 'A normal browser request was refused too, so we cannot tell a crawler block from a general block.'
        : 'We could not reach the site at all, so there is nothing honest to report yet.',
    };
  }

  const scored = bots.filter((b) => b.verdict.state !== 'inconclusive');
  if (!scored.length) {
    return { score: null, inconclusive: true, reason: 'No crawler probe returned a result we can stand behind.' };
  }

  const total = scored.reduce((sum, b) => sum + STATE_POINTS[b.verdict.state], 0);
  return {
    score: Math.round(total / scored.length),
    inconclusive: false,
    robotsUnknown: Boolean(robotsUnknown),
  };
}

/* ------------------------------------------------------------------ *
 * The pillar run
 * ------------------------------------------------------------------ */

/**
 * Run the whole access pillar against a site.
 *
 * The control probe runs first and its body is handed back so the on-page
 * pillars can work from that single page fetch rather than fetching again.
 *
 * @param {URL} url
 * @returns {Promise<object>}
 */
async function run(url) {
  const origin = new URL(url.href);
  const path = origin.pathname || '/';

  // 1. Control probe first. Everything downstream is judged against it.
  const control = await probe(origin.href, CONTROL_UA, { maxBytes: PAGE_BYTES, timeoutMs: 9000 });

  // 2. robots.txt and the six bot probes, in parallel.
  const robotsUrl = new URL('/robots.txt', origin.href).href;
  const [robotsRes, ...probes] = await Promise.all([
    probe(robotsUrl, CONTROL_UA, { maxBytes: 512 * 1024, timeoutMs: 7000 }),
    ...CRAWLERS.map((c) => probe(origin.href, c.ua, { timeoutMs: 8000 })),
  ]);

  let robotsParsed = { groups: [], sitemaps: [] };
  let robotsFound = false;
  let robotsUnknown = false;

  if (robotsRes.reached && robotsRes.status >= 200 && robotsRes.status < 300) {
    robotsFound = true;
    robotsParsed = parseRobots(robotsRes.body);
  } else if (robotsRes.reached && robotsRes.status === 404) {
    // No robots.txt means no restrictions. That is a definite answer, not a gap.
    robotsFound = false;
  } else {
    robotsUnknown = true;
  }

  const bots = CRAWLERS.map((crawler, i) => {
    const verdictFromRobots = robotsUnknown
      ? { allowed: true, unknown: true, rule: null }
      : robotsVerdict(robotsParsed, crawler.token, path);
    const p = probes[i];
    return {
      id: crawler.id,
      label: crawler.label,
      engine: crawler.engine,
      token: crawler.token,
      robotsOnly: Boolean(crawler.robotsOnly),
      robots: verdictFromRobots,
      probe: { reached: p.reached, status: p.status, challenge: p.challenge, error: p.error || null },
      verdict: combineVerdict({ robots: verdictFromRobots, probe: p, control }),
    };
  });

  const summary = summarise({ control, bots, robotsUnknown });

  return Object.assign(summary, {
    control: {
      reached: control.reached,
      status: control.status,
      challenge: control.challenge,
      error: control.error || null,
    },
    bots,
    robots: {
      found: robotsFound,
      unknown: robotsUnknown,
      sitemaps: robotsParsed.sitemaps,
      groups: robotsParsed.groups.length,
    },
    // Handed to the on-page pillars so the whole scan is one page fetch.
    page: controlSucceeded(control) ? { html: control.body, finalUrl: control.finalUrl } : null,
  });
}

module.exports = {
  CRAWLERS,
  CONTROL_UA,
  parseRobots,
  robotsVerdict,
  looksLikeChallenge,
  combineVerdict,
  controlSucceeded,
  summarise,
  probe,
  run,
};
