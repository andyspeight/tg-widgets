/**
 * In-memory stand-ins for the domains actions, harness only.
 *
 * THIS IS A TEST DOUBLE, NOT A SECOND IMPLEMENTATION. Nothing in the app imports it.
 * The Domains panel is unchanged: it calls the same functions with the same
 * signatures and gets the same shapes back, and the satisfies clauses at the bottom
 * are what make that a checked claim rather than a hope.
 *
 * WHY IT HAS TO EXIST. The real actions reach Postgres through lib/db/tenants and
 * talk to Vercel, so bundling them for a browser drags in the driver and node:crypto
 * and the build fails. That failure is the right way round, and it is half of what
 * broke `npm run verify:browser` from 17 Aug 2026 until this landed: the Domains
 * screen arrived in 2787689 and nothing added the swap for it.
 *
 * IT KEEPS STATE ACROSS CALLS, because the panel is worth driving rather than just
 * drawing: adding a domain should make a row appear, making one primary should move
 * the badge, and removing one should empty the list back to the preview address. A
 * double that returned a frozen list would let all three break silently.
 *
 * NOTHING HERE TALKS TO VERCEL, so `refresh` promotes a pending domain to active on
 * the second look. That is the state change the screen has to handle and cannot be
 * exercised here any other way; a live check is named in the handover rather than
 * quietly counted as covered.
 */

import type { SiteDomain } from '../lib/db/tenants';
import type { DomainsView } from '../app/actions/domains';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const PREVIEW_URL = 'https://sandpiper.travelgenixsites.com';

function domain(hostname: string, over: Partial<SiteDomain> = {}): SiteDomain {
  return {
    hostname,
    isPrimary: false,
    sslStatus: 'pending',
    kind: 'custom',
    provider: null,
    verification: [{ type: 'TXT', domain: '_vercel', value: 'vc-domain-verify=abc123' }],
    verifiedAt: null,
    ...over,
  } as SiteDomain;
}

let domains: SiteDomain[] = [
  domain('sandpipertravel.co.uk', { isPrimary: true, sslStatus: 'active', verifiedAt: '2026-08-18T09:00:00Z' }),
  domain('www.sandpipertravel.co.uk'),
];

export async function listDomainsAction(): Promise<Result<DomainsView>> {
  return { ok: true, data: { domains, hostingConnected: true, previewUrl: PREVIEW_URL } };
}

export async function addDomainAction(hostname: string): Promise<Result<SiteDomain>> {
  const clean = hostname.trim().toLowerCase();
  if (!clean) return { ok: false, error: 'Enter a domain name.' };
  if (domains.some((d) => d.hostname === clean)) {
    return { ok: false, error: 'That domain is already on this site.' };
  }
  const added = domain(clean);
  domains = [...domains, added];
  return { ok: true, data: added };
}

export async function refreshDomainAction(hostname: string): Promise<Result<SiteDomain | null>> {
  const found = domains.find((d) => d.hostname === hostname);
  if (!found) return { ok: true, data: null };
  // The one state change worth showing: a pending domain comes back active.
  const next: SiteDomain = { ...found, sslStatus: 'active', verifiedAt: '2026-08-21T10:00:00Z' };
  domains = domains.map((d) => (d.hostname === hostname ? next : d));
  return { ok: true, data: next };
}

export async function removeDomainAction(hostname: string): Promise<Result<boolean>> {
  const before = domains.length;
  domains = domains.filter((d) => d.hostname !== hostname);
  return { ok: true, data: domains.length < before };
}

export async function setPrimaryDomainAction(hostname: string): Promise<Result<boolean>> {
  if (!domains.some((d) => d.hostname === hostname)) {
    return { ok: false, error: 'That domain is not on this site.' };
  }
  domains = domains.map((d) => ({ ...d, isPrimary: d.hostname === hostname }));
  return { ok: true, data: true };
}

/* The panel imports the type from this module too, so it has to leave by this door. */
export type { DomainsView } from '../app/actions/domains';

import type * as real from '../app/actions/domains';

const _list = listDomainsAction satisfies typeof real.listDomainsAction;
const _add = addDomainAction satisfies typeof real.addDomainAction;
const _refresh = refreshDomainAction satisfies typeof real.refreshDomainAction;
const _remove = removeDomainAction satisfies typeof real.removeDomainAction;
const _primary = setPrimaryDomainAction satisfies typeof real.setPrimaryDomainAction;
void _list; void _add; void _refresh; void _remove; void _primary;
