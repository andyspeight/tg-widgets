/**
 * Travelgenix — thin Duda Partner REST client.
 *
 * Just the endpoints the GEO remediation needs, nothing more. Mirrors the
 * thin-client style of api/brain/_luna.js: no SDK dependency, credentials from
 * env only, secrets never logged, light retry/backoff on 429/5xx.
 *
 * Auth (Partner REST): HTTP Basic with an API username + password.
 *   DUDA_API_USER      Partner API username
 *   DUDA_API_PASS      Partner API password
 *   DUDA_API_ENDPOINT  Base URL. Duda has regional hosts; default is the EU
 *                      partner host. Set to the US host for US accounts:
 *                        EU: https://api.eu.duda.co
 *                        US: https://api.duda.co
 *
 * These are the SAME credentials the Luna Marketing blog-publishing integration
 * uses (see the GEO handover, decisions locked). Do NOT mint new ones. In this
 * repo the per-client Duda key can also live encrypted in the ClientIntegrations
 * Airtable table (service "Duda"); a caller may decrypt that and pass it in via
 * the constructor instead of env.
 *
 * Nothing is live on a Duda site until publish() is called.
 */

'use strict';

const DEFAULT_ENDPOINT = 'https://api.eu.duda.co';

function mask(s) {
  if (typeof s !== 'string' || s.length < 8) return '***';
  return s.slice(0, 3) + '…' + s.slice(-3);
}

export class DudaClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.user]     defaults to env DUDA_API_USER
   * @param {string} [opts.pass]     defaults to env DUDA_API_PASS
   * @param {string} [opts.endpoint] defaults to env DUDA_API_ENDPOINT or EU host
   * @param {function} [opts.fetchImpl] injectable fetch (for tests)
   */
  constructor(opts = {}) {
    this.user = opts.user || process.env.DUDA_API_USER || '';
    this.pass = opts.pass || process.env.DUDA_API_PASS || '';
    this.endpoint = (opts.endpoint || process.env.DUDA_API_ENDPOINT || DEFAULT_ENDPOINT)
      .replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
  }

  configured() {
    return !!(this.user && this.pass);
  }

  /** For logs: never reveals the secret, only that creds are present. */
  describe() {
    return `Duda(${this.endpoint}, user=${this.user ? mask(this.user) : 'MISSING'}, pass=${this.pass ? 'set' : 'MISSING'})`;
  }

  authHeader() {
    const token = Buffer.from(`${this.user}:${this.pass}`).toString('base64');
    return `Basic ${token}`;
  }

  async request(method, path, body, attempt = 1) {
    if (!this.configured()) {
      throw new Error('DudaClient: credentials missing (set DUDA_API_USER / DUDA_API_PASS)');
    }
    const url = `${this.endpoint}${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body == null ? undefined : JSON.stringify(body),
    });

    // Retry on rate limit / transient server errors: 1s, 2s, 4s.
    if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt <= 3) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      return this.request(method, path, body, attempt + 1);
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      // Never echo the request body (may contain business data); include status
      // + a bounded slice of Duda's error message only.
      const err = new Error(`Duda ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  // ---- Sites -----------------------------------------------------------

  /** List all sites the account can see (paginated by Duda; returns the array). */
  async listSites({ limit = 100, offset = 0 } = {}) {
    const data = await this.request('GET', `/api/sites/multiscreen?limit=${limit}&offset=${offset}`);
    return data.results || data.sites || (Array.isArray(data) ? data : []);
  }

  /**
   * Site Details — includes schemas.local_business.status (VALID /
   * MISSING_REQUIRED_FIELDS) and site_seo. Used to assert readiness.
   */
  async getSite(siteName) {
    return this.request('GET', `/api/sites/multiscreen/${encodeURIComponent(siteName)}`);
  }

  /**
   * Update the Site object: schemas toggle and/or site_seo defaults.
   *   updateSite(name, { schemas: { local_business: { enabled: true } } })
   *   updateSite(name, { site_seo: { title, description, og_image, no_index } })
   */
  async updateSite(siteName, patch) {
    return this.request('POST', `/api/sites/multiscreen/update/${encodeURIComponent(siteName)}`, patch);
  }

  /** Publish — nothing is live until this runs. */
  async publish(siteName) {
    return this.request('POST', `/api/sites/multiscreen/publish/${encodeURIComponent(siteName)}`);
  }

  // ---- Content library --------------------------------------------------

  /**
   * Update the content library business info (location_data / business_data).
   * Duda builds its native LocalBusiness schema from this, so call it before
   * enabling the schema toggle. Merge semantics are Duda's.
   */
  async updateContent(siteName, contentPatch) {
    return this.request('POST', `/api/sites/multiscreen/${encodeURIComponent(siteName)}/content`, contentPatch);
  }

  // ---- Site-wide HTML injection (custom JSON-LD) ------------------------

  /**
   * Inject markup on every page of the site (Integration Hub site-wide HTML).
   * location is 'BODY' (end of body) or 'HEAD'. JSON-LD is valid in either;
   * BODY is the documented default. POST an empty markup string to remove.
   *
   * appUuid identifies the app context; supplied via env DUDA_APP_UUID when the
   * integration runs through an Integration Hub app. For the plain partner-REST
   * snippet path, callers can override the path via opts.path.
   */
  async injectSiteWideHtml(siteName, markup, { location = 'BODY', appUuid = process.env.DUDA_APP_UUID, path } = {}) {
    const p = path
      || `/api/integrationhub/application/${encodeURIComponent(appUuid || '')}/site/${encodeURIComponent(siteName)}/sitewidehtml`;
    return this.request('POST', p, { markup: String(markup == null ? '' : markup), location });
  }

  /** Remove previously injected site-wide markup (empty string). */
  async removeSiteWideHtml(siteName, opts = {}) {
    return this.injectSiteWideHtml(siteName, '', opts);
  }
}

export default DudaClient;
