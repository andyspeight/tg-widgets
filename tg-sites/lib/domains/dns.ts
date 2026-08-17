/**
 * The DNS record a client sets to point their domain at us.
 *
 * PURE, AND CLIENT SAFE ON PURPOSE. The domains screen runs in the browser and
 * has to tell the client exactly what to type into their registrar, so this holds
 * no secret and reaches no network: given a hostname it says which record. It is
 * kept apart from lib/domains/vercel.ts, which is server-only, so importing "what
 * record do I show" into a client component does not drag the API client with it.
 *
 * WHY THIS IS NOT JUST "two labels is an apex". A UK travel agency's address is as
 * likely to be theiragency.co.uk as theiragency.com, and co.uk is three labels
 * with an apex that still needs an A record, while book.theiragency.com is three
 * labels that is a subdomain and needs a CNAME. Getting that wrong tells a client
 * to put a CNAME on a zone apex, which is invalid DNS and simply will not work. So
 * this carries a short list of the multi-part suffixes our market actually buys,
 * enough to tell those two apart. It is not the whole Public Suffix List, and it
 * does not need to be: an address on a suffix not listed is treated as a
 * subdomain, which is the safe way to be wrong because a CNAME on a real subdomain
 * is correct and a client on an unusual apex can be helped by hand.
 */

/** The fixed targets Vercel gives every custom domain on the project. */
export const VERCEL_A_RECORD = '76.76.21.21';
export const VERCEL_CNAME_TARGET = 'cname.vercel-dns.com';

/**
 * Multi-part public suffixes common where our clients are, UK first.
 *
 * The point is only to tell an apex like theiragency.co.uk from a subdomain like
 * book.theiragency.com. Anything not here falls through to "subdomain", which is
 * the safe default.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz', 'co.za', 'com.br', 'co.in',
  'com.sg', 'com.mt', 'com.es', 'co.il',
]);

/** Whether a hostname is the registrable apex rather than a subdomain of it. */
export function isApexDomain(hostname: string): boolean {
  const labels = hostname.toLowerCase().trim().replace(/\.$/, '').split('.');
  if (labels.length < 2) return false;
  if (labels.length === 2) return true; // example.com
  if (labels.length === 3 && MULTI_PART_SUFFIXES.has(labels.slice(1).join('.'))) {
    return true; // example.co.uk
  }
  return false; // www.example.com, book.example.co.uk, anything deeper
}

export interface DnsRecord {
  type: 'A' | 'CNAME';
  /** What goes in the registrar's "host" or "name" field. '@' means the apex. */
  host: string;
  value: string;
}

/**
 * The single pointing record for a hostname.
 *
 * An apex points with an A record on the zone root; a subdomain points with a
 * CNAME on its own leftmost label. The ownership TXT, when Vercel asks for one
 * because the domain is registered to another Vercel account, is separate: it
 * lives on the domain row as its verification and the screen shows it alongside.
 */
export function pointingRecord(hostname: string): DnsRecord {
  const clean = hostname.toLowerCase().trim().replace(/\.$/, '');
  if (isApexDomain(clean)) {
    return { type: 'A', host: '@', value: VERCEL_A_RECORD };
  }
  return { type: 'CNAME', host: clean.split('.')[0], value: VERCEL_CNAME_TARGET };
}
