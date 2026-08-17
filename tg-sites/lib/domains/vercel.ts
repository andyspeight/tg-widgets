/**
 * The only place the Vercel platform API is touched.
 *
 * Same shape and same reason as lib/media/blob.ts: api.vercel.com is not
 * reachable from the environment this was written in, and attaching a client's
 * domain to our project has real, outward consequences, so the code that talks
 * to it is confined to one short file that everything else can stay pure around.
 * When the first real domain is attached in production and something is wrong,
 * this is the file to read, and it is meant to be read in one go.
 *
 * WHAT THIS DOES AND DOES NOT DO. It adds a client's hostname to the tg-sites
 * Vercel project, asks Vercel whether that hostname is verified and its DNS is
 * pointed correctly, and removes it again. It does NOT provision a certificate:
 * Vercel does that on its own the moment a domain is verified and its DNS is
 * right, which is the whole reason this provider was chosen (see
 * db/migrations/0012_site_settings.sql). So "active" here means "Vercel says the
 * domain is verified and configured", and the cert follows from that with nothing
 * for us to call.
 *
 * NOTHING HERE READS THE DATABASE. It is given a hostname and returns what Vercel
 * said. The row, the tenant scoping and the status column are lib/db/tenants.ts's
 * job, so this file has no way to touch another client's data even by mistake.
 */

import 'server-only';

/**
 * The tg-sites Vercel project and team.
 *
 * These are identifiers, not secrets: they sit in dashboard URLs and deploy
 * logs. They are defaulted so that switching this feature on is a single secret
 * to add (the token below) rather than three variables to get right, and left
 * overridable so the day the project moves is one environment change rather than
 * a code edit.
 */
const DEFAULT_PROJECT_ID = 'prj_xuFAM7ItJaBZM0S9hlPQQy2VBPUs';
const DEFAULT_TEAM_ID = 'team_60GtIq862EeN5iuKz2mbafeR';

/** The fixed targets Vercel gives every custom domain. Exported for the screen
 *  that tells a client which record to set. An apex points with an A record, a
 *  subdomain with a CNAME. */
export const VERCEL_A_RECORD = '76.76.21.21';
export const VERCEL_CNAME_TARGET = 'cname.vercel-dns.com';

export function vercelToken(): string | undefined {
  return process.env.VERCEL_API_TOKEN;
}

function projectId(): string {
  return process.env.VERCEL_PROJECT_ID || DEFAULT_PROJECT_ID;
}

function teamId(): string {
  return process.env.VERCEL_TEAM_ID || DEFAULT_TEAM_ID;
}

/**
 * Whether attaching a domain can work at all.
 *
 * The token is the one thing that has to be added by hand, so it is the one
 * thing checked. The screens use this to explain what is missing rather than
 * offer a button that fails, in the same spirit as blobConfigured().
 */
export function vercelConfigured(): boolean {
  return Boolean(vercelToken());
}

/** Throw with something a person can act on, rather than a bare 401. */
function requireToken(): string {
  const value = vercelToken();
  if (!value) {
    throw new Error(
      'Domain hosting is not connected yet. Add a VERCEL_API_TOKEN to this project ' +
        'in Vercel and redeploy, and adding a domain will start working.',
    );
  }
  return value;
}

/** A DNS ownership challenge, as Vercel gives it, to show the client verbatim. */
export interface DomainVerification {
  type: string;
  domain: string;
  value: string;
  reason?: string;
}

/** What Vercel says about a domain on our project, reduced to what we store. */
export interface DomainState {
  /** Vercel accepts this domain belongs to us (ownership settled). */
  verified: boolean;
  /** DNS is not yet pointed at us, so the certificate cannot issue. */
  misconfigured: boolean;
  /** Ownership challenges to show, empty once verified. */
  verification: DomainVerification[];
  /** What lib/db/tenants.ts records: 'active' only when Vercel is fully happy. */
  sslStatus: 'pending' | 'active';
}

const API = 'https://api.vercel.com';

/** A Vercel error body, teased into a sentence a person can read. */
async function vercelError(response: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const body = (await response.json()) as { error?: { message?: string; code?: string } };
    if (body?.error?.message) message = body.error.message;
  } catch {
    // No JSON body. The fallback and the status are all there is.
  }
  return new Error(`${message} (Vercel ${response.status}).`);
}

function withTeam(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${API}${path}${sep}teamId=${encodeURIComponent(teamId())}`;
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${requireToken()}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Attach a hostname to the project.
 *
 * Idempotent enough to retry: Vercel answers 409 when the domain is already on
 * the project, which is a success for our purposes, so it is folded into the
 * same "here is where it stands" answer as a fresh add. A domain held by another
 * Vercel account comes back as an ownership challenge rather than an error, which
 * is exactly the text the client needs to see.
 */
export async function attachDomain(hostname: string): Promise<{
  verified: boolean;
  verification: DomainVerification[];
}> {
  const response = await fetch(withTeam(`/v10/projects/${encodeURIComponent(projectId())}/domains`), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name: hostname }),
  });

  if (response.status === 409) {
    // Already on the project. Ask where it stands instead of treating it as new.
    return getProjectDomain(hostname);
  }
  if (!response.ok) {
    throw await vercelError(response, 'That domain could not be added');
  }

  const body = (await response.json()) as {
    verified?: boolean;
    verification?: DomainVerification[];
  };
  return { verified: Boolean(body.verified), verification: body.verification ?? [] };
}

/** Where a domain already on the project stands: verified, and any challenge. */
export async function getProjectDomain(hostname: string): Promise<{
  verified: boolean;
  verification: DomainVerification[];
}> {
  const response = await fetch(
    withTeam(`/v9/projects/${encodeURIComponent(projectId())}/domains/${encodeURIComponent(hostname)}`),
    { headers: authHeaders() },
  );
  if (!response.ok) {
    throw await vercelError(response, 'That domain could not be read');
  }
  const body = (await response.json()) as {
    verified?: boolean;
    verification?: DomainVerification[];
  };
  return { verified: Boolean(body.verified), verification: body.verification ?? [] };
}

/** Whether the domain's DNS is pointed at us yet. `misconfigured` false is good. */
export async function getDomainConfig(hostname: string): Promise<{ misconfigured: boolean }> {
  const response = await fetch(withTeam(`/v6/domains/${encodeURIComponent(hostname)}/config`), {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw await vercelError(response, 'That domain could not be checked');
  }
  const body = (await response.json()) as { misconfigured?: boolean };
  return { misconfigured: Boolean(body.misconfigured) };
}

/**
 * Everything about a domain in one answer, and the status we store.
 *
 * Two calls because Vercel keeps ownership (is this domain ours) apart from
 * configuration (is its DNS pointed at us). A domain is only "active", and only
 * getting a certificate, when both are settled; anything short of that is
 * "pending" with the reason visible in `verification` or `misconfigured`.
 */
export async function domainState(hostname: string): Promise<DomainState> {
  const [{ verified, verification }, { misconfigured }] = await Promise.all([
    getProjectDomain(hostname),
    getDomainConfig(hostname),
  ]);

  const sslStatus: DomainState['sslStatus'] = verified && !misconfigured ? 'active' : 'pending';
  return { verified, misconfigured, verification, sslStatus };
}

/**
 * Remove a hostname from the project.
 *
 * Never throws on a domain that is already gone: removing a client's domain is a
 * two step act, the row and the attachment, and the row is the one that decides
 * whether their site still answers on that host. A 404 here means the
 * attachment is already gone, which is the state we wanted.
 */
export async function detachDomain(hostname: string): Promise<void> {
  const response = await fetch(
    withTeam(`/v9/projects/${encodeURIComponent(projectId())}/domains/${encodeURIComponent(hostname)}`),
    { method: 'DELETE', headers: authHeaders() },
  );
  if (!response.ok && response.status !== 404) {
    throw await vercelError(response, 'That domain could not be removed');
  }
}
