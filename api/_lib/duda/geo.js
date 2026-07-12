/**
 * Travelgenix — Duda GEO/AEO remediation builders.
 *
 * Pure, dependency-free, offline-testable functions that turn a validated
 * business-profile object into the structured-data + SEO + llms.txt assets we
 * push to a Duda site. NO network, NO env, NO Duda SDK here — that lives in
 * ./client.js. Keeping the generators pure means every string that ends up in
 * a live client page is unit-tested for injection safety (see
 * test/duda-geo-smoke.mjs).
 *
 * Security posture (per CLAUDE.md + the GEO handover):
 *   - Every business field is validated and clamped before it reaches output.
 *   - JSON-LD is built as a JS object, JSON.stringify'd, then HTML-escaped so a
 *     stray `</script>`, quote, or `<!--` in business data can never break out
 *     of the <script> block. A single bad character must not corrupt the graph.
 *   - URLs are whitelisted to http/https. javascript:, data:, etc. are dropped.
 *   - Empty optional fields are omitted, never emitted as "".
 *
 * The @id anchors are derived from the site URL and kept stable
 * (`<url>#org`, `<url>#website`) so the graph resolves and re-runs are
 * idempotent.
 */

'use strict';

const MAX_TEXT = 500;      // description / free text
const MAX_NAME = 200;      // business / site name
const MAX_SAMEAS = 12;     // social profile links

// ---------------------------------------------------------------- validators

/**
 * Trim, strip control characters, collapse whitespace, and clamp length.
 * Returns '' for anything non-string or empty. Never throws.
 */
export function sanitiseText(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return '';
  // C0/C1 control chars + U+2028/U+2029 line/paragraph separators -> space,
  // then collapse whitespace (a JSON-LD value is single-line).
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, max);
}

/**
 * Return a normalised http(s) URL string, or '' if not a valid web URL.
 * Rejects javascript:, data:, mailto:, relative paths, and garbage.
 */
export function validUrl(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (!s) return '';
  let u;
  try {
    u = new URL(s);
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  return u.toString();
}

/** ISO 3166-1 alpha-2 country code, upper-cased. '' if not two letters. */
export function validCountry(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : '';
}

/** Phone: keep +, digits, spaces, dashes, parens. Clamp. '' if implausible. */
export function validPhone(value) {
  if (typeof value !== 'string') return '';
  const s = value.replace(/[^\d+()\-\s]/g, '').trim().slice(0, 40);
  // Need at least a handful of digits to be a real number.
  return (s.replace(/\D/g, '').length >= 6) ? s : '';
}

/** Very light email check. '' if it does not look like an address. */
export function validEmail(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

/** Normalise a sameAs list to unique valid URLs, capped. */
export function validSameAs(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const url = validUrl(item);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
      if (out.length >= MAX_SAMEAS) break;
    }
  }
  return out;
}

/**
 * A SearchAction target must be a URL containing the {search_term_string}
 * placeholder. Validate the URL with the placeholder stripped so the template
 * itself (not a literal URL) still passes.
 */
export function validSearchTemplate(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (!s || !s.includes('{search_term_string}')) return '';
  const probe = validUrl(s.replace('{search_term_string}', 'x'));
  return probe ? s : '';
}

// ---------------------------------------------------------------- normalise

/**
 * Validate and normalise a raw business profile into the canonical shape the
 * builders consume. Throws if the two hard-required fields (name, url) are
 * missing or invalid — everything else degrades gracefully to omitted.
 */
export function normaliseBusiness(raw = {}) {
  const name = sanitiseText(raw.name, MAX_NAME);
  const url = validUrl(raw.url);
  if (!name) throw new Error('normaliseBusiness: name is required');
  if (!url) throw new Error('normaliseBusiness: a valid http(s) url is required');

  const addr = raw.address || {};
  const address = {
    streetAddress: sanitiseText(addr.streetAddress, MAX_NAME),
    addressLocality: sanitiseText(addr.addressLocality, MAX_NAME),
    addressRegion: sanitiseText(addr.addressRegion, MAX_NAME),
    postalCode: sanitiseText(addr.postalCode, 20),
    addressCountry: validCountry(addr.addressCountry),
  };

  return {
    name,
    url,
    logo: validUrl(raw.logo),
    image: validUrl(raw.image),
    description: sanitiseText(raw.description, MAX_TEXT),
    telephone: validPhone(raw.telephone),
    email: validEmail(raw.email),
    address,
    sameAs: validSameAs(raw.sameAs),
    // Optional site search route. If absent, the SearchAction is dropped.
    searchUrlTemplate: validSearchTemplate(raw.searchUrlTemplate),
    // schema.org @type for the org node. TravelAgency is a valid LocalBusiness
    // subtype; callers may pass 'TravelAgency' or 'Organization'.
    orgType: raw.orgType === 'Organization' ? 'Organization' : 'TravelAgency',
    inLanguage: /^[a-zA-Z-]{2,10}$/.test(raw.inLanguage || '') ? raw.inLanguage : 'en-GB',
  };
}

// ---------------------------------------------------------------- JSON-LD

/**
 * Build the JSON-LD @graph object (plain data, not a string). Only includes
 * fields that survived validation, so no empty values leak into the graph.
 */
export function buildStructuredData(raw) {
  const b = raw && raw.__normalised ? raw : normaliseBusiness(raw);

  const org = {
    '@type': b.orgType,
    '@id': `${b.url}#org`,
    name: b.name,
    url: b.url,
  };
  if (b.logo) org.logo = b.logo;
  if (b.image) org.image = b.image;
  if (b.description) org.description = b.description;
  if (b.telephone) org.telephone = b.telephone;
  if (b.email) org.email = b.email;

  const postal = {};
  if (b.address.streetAddress) postal.streetAddress = b.address.streetAddress;
  if (b.address.addressLocality) postal.addressLocality = b.address.addressLocality;
  if (b.address.addressRegion) postal.addressRegion = b.address.addressRegion;
  if (b.address.postalCode) postal.postalCode = b.address.postalCode;
  if (b.address.addressCountry) postal.addressCountry = b.address.addressCountry;
  if (Object.keys(postal).length) {
    postal['@type'] = 'PostalAddress';
    org.address = postal;
  }
  if (b.sameAs.length) org.sameAs = b.sameAs;

  const website = {
    '@type': 'WebSite',
    '@id': `${b.url}#website`,
    url: b.url,
    name: b.name,
    publisher: { '@id': `${b.url}#org` },
    inLanguage: b.inLanguage,
  };
  if (b.searchUrlTemplate) {
    website.potentialAction = {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: b.searchUrlTemplate,
      },
      'query-input': 'required name=search_term_string',
    };
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [org, website],
  };
}

/**
 * HTML-escape a JSON string so it is safe to embed inside a <script> element.
 * Neutralises `</script>`, `<!--`, and the U+2028/U+2029 line separators.
 * The value stays valid JSON (these are legal JSON string escapes).
 */
export function escapeForScript(json) {
  return String(json)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Render the full `<script type="application/ld+json">...</script>` block ready
 * for site-wide HTML injection. Throws on an invalid business profile.
 */
export function renderJsonLdScript(raw) {
  const data = buildStructuredData(raw);
  const json = JSON.stringify(data, null, 2);
  return `<script type="application/ld+json">\n${escapeForScript(json)}\n</script>`;
}

// ---------------------------------------------------------------- site_seo

/**
 * The site_seo object applied site-wide (page-level SEO overrides it).
 * Only includes keys we actually have values for.
 */
export function buildSiteSeo(raw) {
  const b = raw && raw.__normalised ? raw : normaliseBusiness(raw);
  const seo = { no_index: false };
  const title = sanitiseText(b.name, 60);
  if (title) seo.title = title;
  if (b.description) seo.description = b.description;
  if (b.image || b.logo) seo.og_image = b.image || b.logo;
  return seo;
}

// ---------------------------------------------------------------- llms.txt

/**
 * Build an llms.txt body from the business profile and a list of key pages.
 * pages: [{ url, title, description }]. Invalid pages are skipped.
 */
export function buildLlmsTxt({ business, pages = [] } = {}) {
  const b = business && business.__normalised ? business : normaliseBusiness(business);
  const lines = [];
  lines.push(`# ${b.name}`);
  if (b.description) lines.push(`> ${b.description}`);
  lines.push('');

  const keyPages = (Array.isArray(pages) ? pages : [])
    .map(p => ({
      url: validUrl(p && p.url),
      title: sanitiseText(p && p.title, MAX_NAME),
      description: sanitiseText(p && p.description, MAX_TEXT),
    }))
    .filter(p => p.url && p.title);

  if (keyPages.length) {
    lines.push('## Key pages');
    for (const p of keyPages) {
      lines.push(p.description
        ? `- [${p.title}](${p.url}): ${p.description}`
        : `- [${p.title}](${p.url})`);
    }
    lines.push('');
  }

  if (b.telephone || b.email) {
    lines.push('## Contact');
    if (b.telephone) lines.push(`- Phone: ${b.telephone}`);
    if (b.email) lines.push(`- Email: ${b.email}`);
    lines.push('');
  }

  return lines.join('\n').replace(/\n+$/, '') + '\n';
}

// ---------------------------------------------------------------- Duda content

/**
 * Map the normalised business profile onto the Duda content-library payload
 * used by content.update ({ location_data, business_data }). Duda builds its
 * native LocalBusiness schema from this, so populate it before enabling the
 * schema toggle.
 *
 * NOTE: Duda's exact content schema should be confirmed against the live Luna
 * integration's usage before a production run; this mirrors the documented
 * fields (name, address, phone, email, logo, social). Only populated keys are
 * included so a partial profile does not wipe existing content.
 */
export function buildContentUpdate(raw) {
  const b = raw && raw.__normalised ? raw : normaliseBusiness(raw);

  const location = {};
  if (b.telephone) location.phones = [{ phoneNumber: b.telephone, primary: true }];
  if (b.email) location.emails = [{ emailAddress: b.email, primary: true }];

  const address = {};
  if (b.address.streetAddress) address.streetAddress = b.address.streetAddress;
  if (b.address.addressLocality) address.city = b.address.addressLocality;
  if (b.address.addressRegion) address.region = b.address.addressRegion;
  if (b.address.postalCode) address.postalCode = b.address.postalCode;
  if (b.address.addressCountry) address.country = b.address.addressCountry;
  if (Object.keys(address).length) location.address_geolocation = address;

  const business = {};
  if (b.name) business.name = b.name;
  if (b.description) business.overview = { business_description: b.description };
  if (b.logo) business.logo_url = b.logo;

  const payload = {};
  if (Object.keys(location).length) payload.location_data = location;
  if (Object.keys(business).length) payload.business_data = business;
  if (b.sameAs.length) payload.social_accounts_raw = b.sameAs.slice();
  return payload;
}

/**
 * Convenience: produce every asset for a site in one call.
 */
export function buildAssets(raw, pages = []) {
  const b = normaliseBusiness(raw);
  b.__normalised = true;
  return {
    business: b,
    jsonLdScript: renderJsonLdScript(b),
    structuredData: buildStructuredData(b),
    siteSeo: buildSiteSeo(b),
    contentUpdate: buildContentUpdate(b),
    llmsTxt: buildLlmsTxt({ business: b, pages }),
  };
}
