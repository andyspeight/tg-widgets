/**
 * Tripbuster database access.
 *
 * Tripbuster has its own Postgres project, separate from Travelgenix, because it
 * is a separate product. Access uses the same dependency-free PostgREST-over-
 * fetch approach as api/_lib/telemetry.js rather than pulling in an SDK.
 *
 * Every table has RLS enabled with no policies, so the anon key can do nothing
 * at all. Reads and writes only work with the service role, which lives here on
 * the server and must never reach the browser.
 *
 * Required env (Vercel, server-side only):
 *   TRIPBUSTER_SUPABASE_URL               — https://<ref>.supabase.co
 *   TRIPBUSTER_SUPABASE_SERVICE_ROLE_KEY  — service role; NEVER shipped to a client
 */

const TB_URL = process.env.TRIPBUSTER_SUPABASE_URL || '';
const TB_KEY = process.env.TRIPBUSTER_SUPABASE_SERVICE_ROLE_KEY || '';

const TIMEOUT_MS = 6000;

/** True when the Tripbuster database is wired up. Lets callers 503 cleanly. */
export function tbConfigured() {
  return !!(TB_URL && TB_KEY);
}

function authHeaders() {
  return {
    apikey: TB_KEY,
    Authorization: `Bearer ${TB_KEY}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Error carrying a machine-readable code. Callers turn this into a generic
 * client-facing message — the detail stays in the server log, never the body.
 */
export class TbError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'TbError';
    this.code = code;
    this.status = status || 0;
  }
}

/**
 * Call a Postgres function. Arguments are bound by the database as typed
 * parameters, so caller input can never alter the query shape — this is why the
 * read path is a function rather than PostgREST filter strings assembled in JS.
 */
export async function tbRpc(fn, args = {}) {
  if (!tbConfigured()) throw new TbError('not_configured', 'Tripbuster database not configured');
  if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new TbError('bad_function', 'Invalid function name');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${TB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Log for us, not for the caller.
      console.warn(`[tripbuster] rpc ${fn} ${res.status}`, body.slice(0, 300));
      throw new TbError('rpc_failed', `RPC ${fn} returned ${res.status}`, res.status);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof TbError) throw e;
    const aborted = e && e.name === 'AbortError';
    console.warn(`[tripbuster] rpc ${fn} ${aborted ? 'timeout' : 'error'}`, e && e.message);
    throw new TbError(aborted ? 'timeout' : 'network', 'Database request failed');
  } finally {
    clearTimeout(timer);
  }
}

// PostgREST column names appear in the query string, so they are checked against
// a strict pattern. Values go through URLSearchParams, which encodes them, so a
// value can never break out into filter syntax.
function buildQuery(params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (!/^[a-z_][a-z0-9_.]*$/.test(key)) throw new TbError('bad_column', `Invalid column "${key}"`);
    qs.append(key, String(value));
  }
  return qs.toString();
}

async function tbFetch(pathAndQuery, init, label) {
  if (!tbConfigured()) throw new TbError('not_configured', 'Tripbuster database not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${TB_URL}/rest/v1/${pathAndQuery}`, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[tripbuster] ${label} ${res.status}`, body.slice(0, 300));
      throw new TbError('request_failed', `${label} returned ${res.status}`, res.status);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (e) {
    if (e instanceof TbError) throw e;
    const aborted = e && e.name === 'AbortError';
    console.warn(`[tripbuster] ${label} ${aborted ? 'timeout' : 'error'}`, e && e.message);
    throw new TbError(aborted ? 'timeout' : 'network', 'Database request failed');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read rows. `params` maps directly onto PostgREST query syntax, e.g.
 *   tbSelect('agents', { select: 'id,slug', email: 'eq.a@b.co', limit: 1 })
 */
export async function tbSelect(table, params = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new TbError('bad_table', 'Invalid table name');
  const qs = buildQuery(params);
  return tbFetch(`${table}${qs ? `?${qs}` : ''}`, { headers: authHeaders() }, `select ${table}`);
}

/** Patch rows matching `params`. Always constrain by owner as well as id. */
export async function tbUpdate(table, params, patch, { returning = true } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new TbError('bad_table', 'Invalid table name');
  const qs = buildQuery(params);
  if (!qs) throw new TbError('unfiltered_update', 'Refusing to update every row');
  return tbFetch(`${table}?${qs}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), Prefer: returning ? 'return=representation' : 'return=minimal' },
    body: JSON.stringify(patch),
  }, `update ${table}`);
}

/** Delete rows matching `params`. Refuses to run without a filter. */
export async function tbDelete(table, params, { returning = true } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new TbError('bad_table', 'Invalid table name');
  const qs = buildQuery(params);
  if (!qs) throw new TbError('unfiltered_delete', 'Refusing to delete every row');
  return tbFetch(`${table}?${qs}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), Prefer: returning ? 'return=representation' : 'return=minimal' },
  }, `delete ${table}`);
}

/**
 * Insert rows into a table. Used by the click recorder and the deal importers.
 * `returning: false` keeps the response empty, which is what fire-and-forget
 * writes want.
 */
export async function tbInsert(table, rows, { returning = false } = {}) {
  if (!tbConfigured()) throw new TbError('not_configured', 'Tripbuster database not configured');
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new TbError('bad_table', 'Invalid table name');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${TB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...authHeaders(), Prefer: returning ? 'return=representation' : 'return=minimal' },
      body: JSON.stringify(rows),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[tripbuster] insert ${table} ${res.status}`, body.slice(0, 300));
      throw new TbError('insert_failed', `Insert into ${table} returned ${res.status}`, res.status);
    }
    return returning ? await res.json() : null;
  } catch (e) {
    if (e instanceof TbError) throw e;
    const aborted = e && e.name === 'AbortError';
    console.warn(`[tripbuster] insert ${table} ${aborted ? 'timeout' : 'error'}`, e && e.message);
    throw new TbError(aborted ? 'timeout' : 'network', 'Database request failed');
  } finally {
    clearTimeout(timer);
  }
}
