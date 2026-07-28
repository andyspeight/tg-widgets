'use strict';

/**
 * lib/onpage.js — Pillars 2, 3 and 4, all derived from ONE homepage fetch.
 *
 *   2. Structured data      what the page tells a machine about itself
 *   3. Answer-ready content whether the content can be lifted into an answer
 *   4. Authority signals    on-page trust markers (on-page only in v1)
 *
 * Every one of these returns an honest `inconclusive` when the page cannot be
 * read or is too thin to judge. A page we cannot assess is never marked down.
 *
 * No parser dependency, so the extraction is deliberately conservative. When a
 * signal is ambiguous we do not claim it.
 */

/* ------------------------------------------------------------------ *
 * Small HTML helpers
 * ------------------------------------------------------------------ */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  pound: '£', euro: '€', hellip: '...', mdash: ' ', ndash: ' ', rsquo: "'", lsquo: "'",
  ldquo: '"', rdquo: '"',
};

function decodeEntities(str) {
  return String(str)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : m;
    });
}

/** Everything a reader would see, with script, style and markup removed. */
function visibleText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(fragment) {
  return decodeEntities(String(fragment || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function allMatches(html, regex) {
  const out = [];
  let m;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  while ((m = re.exec(String(html))) !== null) {
    out.push(m);
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

function headings(html, level) {
  return allMatches(html, new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}\\s*>`, 'gi'))
    .map((m) => textOf(m[1]))
    .filter(Boolean);
}

function attr(tag, name) {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (!m) return null;
  return decodeEntities(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || '');
}

function metaContent(html, name) {
  for (const m of allMatches(html, /<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = attr(tag, 'name') || attr(tag, 'property');
    if (key && key.toLowerCase() === name.toLowerCase()) {
      const content = attr(tag, 'content');
      if (content) return content.trim();
    }
  }
  return null;
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* ------------------------------------------------------------------ *
 * Pillar 2 — structured data
 * ------------------------------------------------------------------ */

const ORG_TYPES = new Set([
  'Organization', 'LocalBusiness', 'TravelAgency', 'Corporation', 'NGO',
  'ProfessionalService', 'Store', 'TouristInformationCenter',
]);
const OFFER_TYPES = new Set([
  'Product', 'Offer', 'AggregateOffer', 'Trip', 'TouristTrip', 'TouristDestination',
  'TouristAttraction', 'Event', 'Service', 'LodgingBusiness', 'Hotel', 'Resort', 'Flight',
]);

function collectTypes(node, out, flags) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, out, flags);
    return;
  }
  const type = node['@type'];
  if (typeof type === 'string') out.add(type.replace(/^https?:\/\/schema\.org\//i, ''));
  else if (Array.isArray(type)) for (const t of type) if (typeof t === 'string') out.add(t.replace(/^https?:\/\/schema\.org\//i, ''));

  if (node.aggregateRating) flags.hasRating = true;
  if (node.sameAs) flags.hasSameAs = true;
  if (node.potentialAction) flags.hasSearchAction = true;
  if (node.telephone) flags.hasTelephone = true;
  if (node.address) flags.hasAddress = true;

  for (const key of Object.keys(node)) {
    if (key === '@type') continue;
    const value = node[key];
    if (value && typeof value === 'object') collectTypes(value, out, flags);
  }
}

/**
 * @param {string} html
 * @returns {{score:number|null, inconclusive:boolean, blocks:number, invalid:number, microdata:number, types:string[], hasRating:boolean, hasSameAs:boolean}}
 */
function analyseSchema(html) {
  if (typeof html !== 'string' || html.length === 0) {
    return { score: null, inconclusive: true, blocks: 0, invalid: 0, microdata: 0, types: [], hasRating: false, hasSameAs: false };
  }

  const typeSet = new Set();
  const flags = { hasRating: false, hasSameAs: false, hasSearchAction: false, hasTelephone: false, hasAddress: false };
  let blocks = 0;
  let invalid = 0;

  const scripts = allMatches(html, /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  for (const m of scripts) {
    const type = attr(`<script ${m[1]}>`, 'type');
    if (!type || !/application\/ld\+json/i.test(type)) continue;
    blocks += 1;
    let parsed;
    try {
      parsed = JSON.parse(m[2].trim());
    } catch {
      invalid += 1;
      continue;
    }
    collectTypes(parsed.__proto__ === undefined ? parsed : parsed, typeSet, flags);
  }

  // Microdata is second-class but it is still structured data.
  const itemtypes = allMatches(html, /itemtype\s*=\s*("([^"]*)"|'([^']*)')/gi);
  const microdata = allMatches(html, /\bitemscope\b/gi).length;
  for (const m of itemtypes) {
    const value = (m[2] !== undefined ? m[2] : m[3]) || '';
    const name = value.split('/').pop();
    if (name) typeSet.add(name);
  }

  const types = Array.from(typeSet);
  const validBlocks = blocks - invalid;

  let score = 0;
  if (validBlocks > 0) score += 25;
  else if (microdata > 0) score += 10;

  if (types.some((t) => ORG_TYPES.has(t))) score += 20;
  if (types.includes('WebSite')) score += 10;
  if (flags.hasSearchAction) score += 5;
  if (types.includes('BreadcrumbList')) score += 10;
  if (types.includes('FAQPage') || types.includes('Question')) score += 15;
  if (types.some((t) => OFFER_TYPES.has(t))) score += 15;
  if (flags.hasRating) score += 5;

  if (invalid > 0) score -= 10 * invalid;

  return {
    score: clamp(score),
    inconclusive: false,
    blocks,
    invalid,
    microdata,
    types,
    hasRating: flags.hasRating,
    hasSameAs: flags.hasSameAs,
    hasSearchAction: flags.hasSearchAction,
  };
}

/* ------------------------------------------------------------------ *
 * Pillar 3 — answer-ready content
 * ------------------------------------------------------------------ */

const QUESTION_OPENERS = /^(how|what|why|when|where|which|who|can|do|does|is|are|should|will|shall)\b/i;
const MIN_WORDS_TO_JUDGE = 120;

/**
 * @param {string} html
 * @returns {{score:number|null, inconclusive:boolean, reason?:string, signals:object}}
 */
function analyseContent(html) {
  if (typeof html !== 'string' || html.length === 0) {
    return { score: null, inconclusive: true, reason: 'We could not read the page.', signals: {} };
  }

  const text = visibleText(html);
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const scriptCount = allMatches(html, /<script\b/gi).length;
  const h1s = headings(html, 1);
  const h2s = headings(html, 2);
  const h3s = headings(html, 3);
  const title = (() => {
    const m = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
    return m ? textOf(m[1]) : null;
  })();
  const description = metaContent(html, 'description');
  const lists = allMatches(html, /<(ul|ol)\b/gi).length;
  const paragraphs = allMatches(html, /<p\b/gi).length;

  const allHeadings = h1s.concat(h2s, h3s);
  const questionHeadings = allHeadings.filter((h) => h.trim().endsWith('?') || QUESTION_OPENERS.test(h.trim())).length;

  const likelyClientRendered =
    words < 150 && (scriptCount >= 3 || /\bid\s*=\s*["'](root|app|__next|__nuxt)["']/i.test(html));

  const signals = {
    words,
    title,
    titleLength: title ? title.length : 0,
    description,
    descriptionLength: description ? description.length : 0,
    h1Count: h1s.length,
    h2Count: h2s.length,
    headingCount: allHeadings.length,
    questionHeadings,
    lists,
    paragraphs,
    scriptCount,
    likelyClientRendered,
  };

  // A page with almost no readable text cannot be judged on answer-readiness.
  // Saying so is more useful than inventing a fail.
  if (words < MIN_WORDS_TO_JUDGE) {
    return {
      score: null,
      inconclusive: true,
      reason: likelyClientRendered
        ? 'The home page arrives almost empty and fills in with JavaScript, so there is no text for us to judge.'
        : 'There is too little text on the home page to judge fairly.',
      signals,
    };
  }

  let score = 0;

  if (title) score += title.length >= 15 && title.length <= 70 ? 12 : 6;
  if (description) score += description.length >= 50 && description.length <= 160 ? 12 : 6;

  if (h1s.length === 1) score += 12;
  else if (h1s.length > 1) score += 4;

  if (h2s.length >= 3) score += 12;
  else if (h2s.length >= 1) score += 6;

  if (words >= 600) score += 15;
  else if (words >= 300) score += 10;
  else score += 5;

  if (questionHeadings >= 2) score += 12;
  else if (questionHeadings === 1) score += 6;

  if (lists >= 1) score += 8;
  if (!likelyClientRendered) score += 10;

  // Short, self-contained sentences lift cleanly into an answer. Very long ones do not.
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0);
  const avgSentenceWords = sentences.length ? words / sentences.length : words;
  if (avgSentenceWords > 0 && avgSentenceWords <= 25) score += 7;
  else if (avgSentenceWords <= 35) score += 4;

  signals.avgSentenceWords = Math.round(avgSentenceWords);

  return { score: clamp(score), inconclusive: false, signals };
}

/* ------------------------------------------------------------------ *
 * Pillar 4 — on-page authority
 * ------------------------------------------------------------------ */

const TRADE_BODIES = [
  ['ABTA', /\bABTA\b/i],
  ['ATOL', /\bATOL\b/i],
  ['IATA', /\bIATA\b/i],
  ['CLIA', /\bCLIA\b/i],
  ['AITO', /\bAITO\b/i],
  ['ABTOT', /\bABTOT\b/i],
  ['PTS', /\bProtected Trust Services\b/i],
];

const REVIEW_PLATFORMS = /trustpilot\.com|feefo\.com|reviews\.io|reviewcentre|google\.com\/(maps|search)\?[^"']*review|yotpo\.com|trustindex\.io|reviews\.co\.uk/i;
const SOCIAL_PLATFORMS = /facebook\.com|instagram\.com|linkedin\.com|x\.com\/|twitter\.com|youtube\.com|tiktok\.com/i;
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

/**
 * @param {string} html
 * @param {{types?: string[], hasRating?: boolean, hasSameAs?: boolean}} [schemaInfo]
 */
function analyseAuthority(html, schemaInfo = {}) {
  if (typeof html !== 'string' || html.length === 0) {
    return { score: null, inconclusive: true, signals: {} };
  }

  const text = visibleText(html);
  const hrefs = allMatches(html, /href\s*=\s*("([^"]*)"|'([^']*)')/gi).map((m) =>
    decodeEntities((m[2] !== undefined ? m[2] : m[3]) || '')
  );
  const joinedHrefs = hrefs.join(' ');

  const tradeBodies = TRADE_BODIES.filter(([, re]) => re.test(text)).map(([name]) => name);

  const signals = {
    phone: /href\s*=\s*["']tel:/i.test(html) || /\b(?:\+44\s?|0)\d[\d\s()-]{8,}\d\b/.test(text),
    email: /href\s*=\s*["']mailto:/i.test(html),
    address: Boolean(schemaInfo.hasAddress) || UK_POSTCODE.test(text),
    tradeBodies,
    registration: /\bcompany (?:registration )?(?:number|no\.?)\s*:?\s*[A-Z]{0,2}\d{6,8}\b/i.test(text)
      || /\bregistered in (?:england|scotland|wales|northern ireland)\b/i.test(text)
      || /\bVAT\s*(?:registration\s*)?(?:number|no\.?)?\s*:?\s*(?:GB)?\s?\d{9}\b/i.test(text),
    reviewPlatform: REVIEW_PLATFORMS.test(joinedHrefs) || REVIEW_PLATFORMS.test(html),
    rating: Boolean(schemaInfo.hasRating),
    about: /href\s*=\s*["'][^"']*\/?about/i.test(html),
    privacy: /href\s*=\s*["'][^"']*privacy/i.test(html),
    terms: /href\s*=\s*["'][^"']*(terms|conditions)/i.test(html),
    social: SOCIAL_PLATFORMS.test(joinedHrefs),
    sameAs: Boolean(schemaInfo.hasSameAs),
  };

  let score = 0;
  if (signals.phone) score += 12;
  if (signals.email) score += 8;
  if (signals.address) score += 10;
  if (tradeBodies.length) score += 15;
  if (signals.registration) score += 8;
  if (signals.reviewPlatform) score += 12;
  if (signals.rating) score += 8;
  if (signals.about) score += 7;
  if (signals.privacy) score += 5;
  if (signals.terms) score += 3;
  if (signals.social) score += 7;
  if (signals.sameAs) score += 5;

  return { score: clamp(score), inconclusive: false, signals };
}

/* ------------------------------------------------------------------ *
 * The three pillars from one page
 * ------------------------------------------------------------------ */

/**
 * @param {string|null} html the body from the single homepage fetch
 */
function run(html) {
  if (typeof html !== 'string' || html.trim().length === 0) {
    const blank = { score: null, inconclusive: true, signals: {} };
    return {
      schema: Object.assign({}, blank, { blocks: 0, invalid: 0, microdata: 0, types: [] }),
      content: Object.assign({}, blank, { reason: 'We could not read the page.' }),
      authority: Object.assign({}, blank),
    };
  }
  const schema = analyseSchema(html);
  const content = analyseContent(html);
  const authority = analyseAuthority(html, schema);
  return { schema, content, authority };
}

module.exports = {
  analyseSchema,
  analyseContent,
  analyseAuthority,
  visibleText,
  run,
};
