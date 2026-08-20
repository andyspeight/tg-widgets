/**
 * What a member is allowed to change, capability by capability.
 *
 * A LEAF MODULE WITH NO IMPORTS, the same rule roles.ts follows and for the same
 * reason: the permissions screen is a client component and the enforcement is
 * server-only, and both need this exact vocabulary. Anything imported here would
 * be dragged into the browser bundle, so nothing is.
 *
 * THE MODEL. A member's permissions are a set of granted capability keys, stored
 * as a JSON array on their tenant_users row. Every capability is an independent
 * tick box set per person (Andy, 19 Aug 2026), so there is no fixed "content
 * only" tier baked in: content-only and full-restyle are just PRESETS that fill
 * the boxes a sensible way, and staff can tick or untick any one afterwards.
 *
 * UNSET MEANS FULL, FOR BACKWARD COMPATIBILITY. A member whose row predates this
 * feature has no stored set (null). Rather than lock them out, an unset owner or
 * editor resolves to every capability, exactly what they could do before; only a
 * viewer resolves to nothing, which is what a viewer was always meant to be and
 * never was on the server. A new member is stamped with a real set at invite
 * time, so "unset" only ever means "from before this existed".
 *
 * STAFF BYPASS EVERYTHING. A Travelgenix staff member (isStaffEmail) is the
 * platform operator, not a client, so the per-member set never limits them.
 */

import type { MemberRole } from './roles';

/**
 * The capabilities, in the order the screen shows them. Each is a tick box a
 * member has or does not. Mapped to what tg-sites actually has, so Duda's
 * eCommerce, bookings and apps are not here.
 */
export const CAPABILITIES = [
  { key: 'content', label: 'Edit content', note: 'Change text, swap photos and edit links.' },
  {
    key: 'structure',
    label: 'Restructure and design',
    note: 'Add, remove and move sections, and change the layout and styling.',
  },
  { key: 'theme', label: 'Change the theme', note: 'The site colours, fonts and spacing.' },
  { key: 'pages', label: 'Add and remove pages', note: 'Create, rename, move and delete pages.' },
  { key: 'blog', label: 'Blog', note: 'Write and manage blog posts.' },
  { key: 'collections', label: 'Collections', note: 'The Content Library and its collections.' },
  { key: 'seo', label: 'SEO and AEO', note: 'Search and AI visibility settings.' },
  {
    key: 'settings',
    label: 'Site settings',
    note: 'The company name, contact details and branding.',
  },
  { key: 'publish', label: 'Publish', note: 'Put changes live, and take them down.' },
] as const;

export type Capability = (typeof CAPABILITIES)[number]['key'];

/** Every capability key, for a full grant and for validating a stored set. */
export const ALL_CAPABILITIES: readonly Capability[] = CAPABILITIES.map((c) => c.key);

const KNOWN = new Set<string>(ALL_CAPABILITIES);

/** A stored permission set: the capability keys a member has been granted. */
export type PermissionSet = Capability[];

/**
 * The named starting points the screen offers. Not tiers: once applied, every
 * box is still editable per person. content-only is edit-and-publish-your-own;
 * full-restyle is everything.
 */
export const PRESETS: Record<'content-only' | 'full-restyle', PermissionSet> = {
  'content-only': ['content', 'publish'],
  'full-restyle': [...ALL_CAPABILITIES],
};

/**
 * A stored value made safe: an array of known capability keys, de-duplicated and
 * put in the canonical order, or null when there is nothing usable (which the
 * resolver reads as "unset", not "none"). Free input from the database or a
 * request, so anything unexpected becomes null rather than a throw.
 */
export function parsePermissions(value: unknown): PermissionSet | null {
  // A non-array is "unset" (null); ANY array is an explicit set, even one that
  // filters down to empty. This matters for safety: a stored set whose keys are
  // all now-unknown (a capability was renamed) must lock down to [], never fall
  // through to null and hand back the legacy full grant.
  if (!Array.isArray(value)) return null;
  const granted = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && KNOWN.has(entry)) granted.add(entry);
  }
  // Canonical order, so a stored set reads and compares the same every time.
  return ALL_CAPABILITIES.filter((cap) => granted.has(cap));
}

/**
 * The capabilities a member actually has, resolved from their role, whether they
 * are staff, and their stored set. This is the one place the rules live, so the
 * enforcement and the editor read the same answer.
 */
export function effectiveCapabilities(input: {
  role: MemberRole;
  staff: boolean;
  stored: PermissionSet | null;
}): Set<Capability> {
  // Staff are the platform operator: never limited by a client's per-member set.
  if (input.staff) return new Set(ALL_CAPABILITIES);

  // An explicit set is the truth, even when it is empty (a genuinely locked-down
  // member). Only a truly absent set falls through to the legacy default.
  if (input.stored !== null) return new Set(input.stored);

  // Unset, from before this feature: an owner or editor keeps everything they
  // could always do; a viewer becomes the read-only member they were meant to be.
  if (input.role === 'viewer') return new Set();
  return new Set(ALL_CAPABILITIES);
}

/** Whether a resolved capability set allows a capability. */
export function can(caps: Set<Capability>, capability: Capability): boolean {
  return caps.has(capability);
}
