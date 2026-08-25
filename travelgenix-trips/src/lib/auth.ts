// =============================================================================
//  lib/auth.ts
// =============================================================================
//
//  One identity for the whole estate. Trips does NOT issue its own login: it
//  asks tg-widgets who is signed in, over the existing cookie SSO.
//
//  THE CONSTRAINT THAT DECIDES OUR DOMAIN. The session cookie is `tg_session`
//  and it is set on `.travelify.io` for cross-subdomain SSO. So this app must be
//  served from a *.travelify.io host (trips.travelify.io) or the browser will
//  simply not send it and every visitor looks signed out. That is not a branding
//  preference, it is why the domain choice is what it is. An operator custom
//  domain therefore only ever serves PUBLIC trip pages, never the console.
//
//  Never set a manual Authorization header here. tg-widgets prefers a Bearer
//  token over the cookie, and a stale token silently outranking the live session
//  is exactly the act-as bug fixed on 2 Aug 2026. Forward the cookie, nothing
//  else.
//
// =============================================================================

import 'server-only';
import { cookies } from 'next/headers';

const TG_ORIGIN = (process.env.TG_WIDGETS_ORIGIN || 'https://tg-widgets.vercel.app').replace(/\/+$/, '');
const SESSION_COOKIE = 'tg_session';

export interface Session {
  userRecordId: string;
  email: string;
  role: string;
  clientRecordId: string | null;
  clientName: string;
  plan: string;
}

interface MeResponse {
  user?: { recordId?: string; email?: string; role?: string };
  client?: { recordId?: string; clientName?: string; plan?: string };
}

/**
 * Who is signed in, or null. Never throws: an unreachable auth service reads as
 * signed out, which fails closed.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${TG_ORIGIN}/api/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const body = (await res.json()) as MeResponse;
    if (!body?.user?.recordId) return null;

    return {
      userRecordId: body.user.recordId,
      email: body.user.email || '',
      role: body.user.role || '',
      clientRecordId: body.client?.recordId || null,
      clientName: body.client?.clientName || '',
      plan: body.client?.plan || '',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The operator the signed-in user acts for, or null.
 *
 * A trip belongs to an OPERATOR, and an operator is keyed to the client record,
 * never to the email of whoever happened to build it. That is the ownership bug
 * fixed across 65 widgets on 2 Aug 2026 and it must not come back here.
 */
export async function getOperatorId(session: Session | null): Promise<string | null> {
  if (!session?.clientRecordId) return null;

  const { sbRequest } = await import('./supabase');
  const rows = await sbRequest<Array<{ id: string }>>(
    `gt_operators?client_record_id=eq.${encodeURIComponent(session.clientRecordId)}&select=id&limit=1`,
  ).catch(() => null);

  return rows?.[0]?.id ?? null;
}

/** Fails closed: no session, or a session with no operator, owns nothing. */
export async function requireOperator(): Promise<{ session: Session; operatorId: string } | null> {
  const session = await getSession();
  if (!session) return null;
  const operatorId = await getOperatorId(session);
  if (!operatorId) return null;
  return { session, operatorId };
}
