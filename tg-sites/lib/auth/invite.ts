/**
 * The token in an invite link. No database, no Next, no cookies.
 *
 * Separate from the query layer for the same reason token.ts is separate from
 * session.ts: everything here is a pure function of its arguments, so the
 * crypto can be tested properly and a test can forge a token to prove the
 * checks work.
 *
 * WHAT THIS TOKEN IS WORTH. Whoever holds it can join a site and edit a live
 * travel business's website. It is a credential, and it is treated like one:
 * generated from a CSPRNG, never stored, and compared only as a hash.
 *
 * WHY SHA-256 AND NOT scrypt, which is what password.ts uses. A password is
 * short, human-chosen and drawn from a tiny space, so the cost of hashing it is
 * the entire defence against somebody who has the hashes. This token is 32
 * bytes from randomBytes, which is 256 bits of entropy: there is no dictionary,
 * no reuse across sites and nothing to guess. A slow hash would buy nothing and
 * would be paid on every page load of the accept screen.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Fourteen days. A link that works forever is a credential nobody remembers. */
export const INVITE_MAX_AGE_DAYS = 14;

/**
 * A fresh token, base64url, for the link.
 *
 * 32 bytes. Long enough that guessing is not a strategy, short enough that the
 * link still fits in a WhatsApp message without wrapping into two lines, which
 * matters because an owner is going to paste this into a chat window.
 */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What goes in the database.
 *
 * Hex rather than base64url, deliberately: this value ends up in a WHERE clause
 * and in a function argument, and hex has no characters that anything between
 * here and Postgres might treat as special.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Whether a token in a URL could be one of ours, before anything is hashed.
 *
 * A CHEAP GATE, NOT A CHECK. Its only job is to keep a path like /join/../../
 * or a megabyte of junk from reaching the database at all. A token that passes
 * this is still worthless unless its hash matches a live row.
 */
export function looksLikeInviteToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(value);
}

/**
 * Constant time comparison of two hashes.
 *
 * Not used by the lookup, which is an indexed equality in Postgres and cannot
 * be made constant time anyway. It is here for anything that ever compares two
 * hashes in JavaScript, so that comparison is right by default rather than
 * being written with === by whoever needs it next.
 */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a leak of one
  // bit. Both are fixed-length hex, so a difference means one is not a hash.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The link to send somebody.
 *
 * Built from an origin the CALLER supplies rather than from a header. A host
 * header is attacker-controlled, and a link built from one is how an invite
 * ends up pointing at somebody else's server with a real token on the end of
 * it.
 */
export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/join/${token}`;
}
