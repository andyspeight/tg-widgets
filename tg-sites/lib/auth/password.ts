/**
 * Password hashing. scrypt, from node:crypto, no dependency.
 *
 * WHY SCRYPT AND NOT BCRYPT OR ARGON2
 *
 * Both are better studied for this job, and both are native modules. A native
 * module in a Vercel function is a build that can break on a platform bump,
 * for a project whose password provider is explicitly temporary: id.travelify.io
 * owns identity, and this exists so the sign-in path can be finished and tested
 * before those endpoint details arrive.
 *
 * scrypt is memory-hard, is in the standard library, and is what the schema
 * comment on auth_users.password_hash already promises. Good enough for a
 * handful of staff accounts, and the cost is in the stored string rather than
 * in this file, so raising it later does not invalidate anything.
 *
 * WHAT THE STORED STRING LOOKS LIKE
 *
 *   scrypt$16384$8$1$<salt base64url>$<hash base64url>
 *
 * Self describing on purpose. The cost parameters travel with the hash, so a
 * hash made today still verifies after the numbers below are raised, and
 * needsRehash says which rows are worth upgrading next time their owner signs
 * in. A bare hash with the cost held in code cannot be migrated without
 * asking everyone to reset their password.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const ALGORITHM = 'scrypt';

/**
 * Current cost. N is the work factor and the only one worth turning up.
 *
 * 16384 is about 16MB and something like 50 to 100ms on a Vercel function.
 * That is the right order for a sign-in: slow enough that guessing at scale is
 * pointless, fast enough that a person does not notice.
 */
const COST = { N: 16384, r: 8, p: 1 } as const;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * Node's default maxmem is 32MB and 128 * N * r is 16MB at the numbers above,
 * so the default would do. Stated explicitly and generously, because the first
 * symptom of raising N past the default is scrypt throwing at sign-in, which
 * is a confusing way to find out.
 */
const MAX_MEM = 64 * 1024 * 1024;

/** The shortest password this will accept. Length beats character classes. */
export const MIN_PASSWORD_LENGTH = 12;

// ---------------------------------------------------------------------------

/** Hash a password for storage. */
export async function hashPassword(password: string): Promise<string> {
  assertUsablePassword(password);

  const salt = randomBytes(SALT_LENGTH);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...COST,
    maxmem: MAX_MEM,
  });

  return [
    ALGORITHM,
    COST.N,
    COST.r,
    COST.p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

/**
 * Whether a password matches a stored hash.
 *
 * False for a malformed or missing hash rather than throwing. A row with no
 * password set is a real state: an account created for SSO has no hash, and
 * the answer to "does this password match" is no, not an exception.
 */
export async function verifyPassword(
  password: unknown,
  stored: unknown,
): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0) return false;

  const parsed = parse(stored);
  if (!parsed) return false;

  const computed = await scrypt(password.normalize('NFKC'), parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: MAX_MEM,
  });

  // Lengths already agree by construction, but timingSafeEqual throws rather
  // than returning false when they do not, and a thrown error at sign-in reads
  // as a server fault rather than a wrong password.
  if (computed.length !== parsed.hash.length) return false;
  return timingSafeEqual(computed, parsed.hash);
}

/**
 * Burn the same work as a real verification, and answer no.
 *
 * For an email that is not registered. Without this, an unknown email returns
 * in a millisecond and a known one takes eighty, which turns the sign-in form
 * into a "does this person have an account here" oracle. Anyone can measure
 * that, and for a travel business the customer list is worth something.
 *
 * The salt is fresh each time and the result is thrown away. The point is only
 * that the clock has moved by the right amount.
 *
 * Returns nothing. It first returned false, so a caller could write
 * `return wasteTime(...)`, and that made every call site cast its way from
 * Promise<false> to whatever it actually returns. The elapsed time is the whole
 * product; there is no value worth handing back.
 */
export async function wasteTimeLikeAVerification(password: unknown): Promise<void> {
  const input = typeof password === 'string' ? password : '';
  await scrypt(input.normalize('NFKC'), randomBytes(SALT_LENGTH), KEY_LENGTH, {
    ...COST,
    maxmem: MAX_MEM,
  });
}

/**
 * Whether a stored hash was made with weaker settings than the current ones.
 *
 * Re-hashing needs the plain password, so the only moment it can happen is a
 * successful sign-in. Nothing calls this yet; it exists so that raising N is a
 * one line change plus one call, rather than a migration nobody can write.
 */
export function needsRehash(stored: unknown): boolean {
  const parsed = parse(stored);
  if (!parsed) return false;
  return parsed.N < COST.N || parsed.r < COST.r || parsed.p < COST.p;
}

// ---------------------------------------------------------------------------

interface Parsed {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/** A stored hash, taken apart, or null if it is not one. */
function parse(stored: unknown): Parsed | null {
  if (typeof stored !== 'string') return null;

  const parts = stored.split('$');
  if (parts.length !== 6) return null;

  const [algorithm, n, r, p, salt, hash] = parts;
  if (algorithm !== ALGORITHM) return null;

  const parsed = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt, 'base64url'),
    hash: Buffer.from(hash, 'base64url'),
  };

  // Every number has to be sane before it reaches scrypt. These come out of the
  // database, and a corrupted N would either throw or allocate the machine.
  if (!Number.isInteger(parsed.N) || parsed.N < 1024 || parsed.N > 1_048_576) return null;
  if (!Number.isInteger(parsed.r) || parsed.r < 1 || parsed.r > 32) return null;
  if (!Number.isInteger(parsed.p) || parsed.p < 1 || parsed.p > 16) return null;
  if (parsed.salt.length === 0 || parsed.hash.length === 0) return null;

  // 128 * N * r is scrypt's memory cost. Refuse anything that would not fit
  // rather than letting the library decide how to fail.
  if (128 * parsed.N * parsed.r > MAX_MEM) return null;

  return parsed;
}

/**
 * A password worth accepting, or a thrown error naming the problem.
 *
 * Length only. No "must contain a symbol": those rules push people towards
 * Travelgenix1! and are worth less than four more characters. The floor is
 * high enough that a short memorable word cannot slip under it.
 */
export function assertUsablePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.trim().length === 0) {
    throw new Error('Enter a password.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `A password needs at least ${MIN_PASSWORD_LENGTH} characters. ` +
        'Three or four unrelated words is easier to remember and harder to guess ' +
        'than a short one with symbols in.',
    );
  }
  if (password.length > 1024) {
    // scrypt does not care, but an unbounded field is somewhere to put a
    // megabyte and watch the CPU.
    throw new Error('That password is too long.');
  }
}
