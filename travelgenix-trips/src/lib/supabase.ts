// =============================================================================
//  lib/supabase.ts
// =============================================================================
//
//  Server-only access to the Trips database (Supabase project `group-trips`,
//  uzyckitibyfudnboaezm). The browser NEVER connects: RLS is on with no policies,
//  so the service-role key is the only way in and it must never be shipped to
//  the client.
//
//  Raw PostgREST over fetch, no client dependency. This is a direct port of
//  api/_lib/trips/supabase.js in tg-widgets, deliberately: the two must not
//  drift while the old widget endpoints are still live.
//
//    Env: TRIPS_SUPABASE_URL, TRIPS_SUPABASE_SERVICE_ROLE_KEY
//
// =============================================================================

import 'server-only';

const SUPABASE_URL = (process.env.TRIPS_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.TRIPS_SUPABASE_SERVICE_ROLE_KEY || '';

export function tripsDbConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

export interface SbRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Bounded so a slow database can never hold a function open. */
  timeoutMs?: number;
}

export class SupabaseError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'SupabaseError';
    this.statusCode = statusCode;
  }
}

/**
 * Low-level PostgREST request. The service-role key bypasses RLS, so every
 * caller is responsible for its own ownership check. Throws on non-2xx, returns
 * parsed JSON, or null on 204.
 */
export async function sbRequest<T = unknown>(
  path: string,
  { method = 'GET', body, headers, timeoutMs = 4000 }: SbRequestOptions = {},
): Promise<T | null> {
  if (!tripsDbConfigured()) throw new SupabaseError('Trips DB not configured', 500);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SupabaseError(`Supabase ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    if (res.status === 204) return null;
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Insert and return the created rows. */
export async function sbInsert<T = unknown>(table: string, rows: unknown): Promise<T[]> {
  const out = await sbRequest<T[]>(table, {
    method: 'POST',
    body: rows,
    headers: { Prefer: 'return=representation' },
  });
  return out ?? [];
}

/** Patch rows matching a PostgREST filter string, returning what changed. */
export async function sbUpdate<T = unknown>(
  table: string,
  filter: string,
  patch: unknown,
): Promise<T[]> {
  const out = await sbRequest<T[]>(`${table}?${filter}`, {
    method: 'PATCH',
    body: patch,
    headers: { Prefer: 'return=representation' },
  });
  return out ?? [];
}
