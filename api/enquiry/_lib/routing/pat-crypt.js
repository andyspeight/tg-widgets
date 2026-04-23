/**
 * PAT encryption helper — symmetric AES-256-GCM.
 *
 * Used to encrypt client-supplied Airtable PATs before storing them in the
 * Enquiry Forms table, and to decrypt them at submission time so we can
 * actually route submissions to the client's own base.
 *
 * Format: `v1:<iv_hex>:<ciphertext_hex>:<auth_tag_hex>`
 *   - v1 is a version prefix — lets us migrate to v2 in future without
 *     breaking existing stored values.
 *   - IV is 12 bytes (GCM standard) and is generated fresh per encryption.
 *   - Auth tag is 16 bytes (GCM standard) and provides tamper detection.
 *
 * Env vars required:
 *   TG_PAT_ENCRYPTION_KEY — 64-char hex string (32 bytes of entropy).
 *     Generate one with:
 *       node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Security notes:
 *  - Never log plaintext PATs. Never return them in API responses.
 *  - Decryption is only performed server-side in submit.js routing code.
 *  - If the encryption key leaks, rotate it and re-encrypt all PATs. Any
 *    new encrypt() calls with a new key will produce v1 blobs that existing
 *    decrypt() calls can still read if you keep both keys handy during
 *    rotation. See MIGRATION note at end of file.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;       // GCM standard
const AUTH_TAG_LENGTH = 16; // GCM standard
const VERSION = 'v1';

function getKey() {
  const hex = process.env.TG_PAT_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('TG_PAT_ENCRYPTION_KEY not configured. Generate with: node -e "console.log(require(\\"crypto\\").randomBytes(32).toString(\\"hex\\"))"');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('TG_PAT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext PAT.
 * @param {string} plaintext — the raw PAT from the client
 * @returns {string} — the v1 blob to store in Airtable
 */
export function encryptPat(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptPat: plaintext must be a non-empty string');
  }
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${VERSION}:${iv.toString('hex')}:${ciphertext.toString('hex')}:${authTag.toString('hex')}`;
}

/**
 * Decrypt a stored PAT blob.
 * @param {string} stored — the v1 blob from Airtable
 * @returns {string} — the original PAT plaintext
 * @throws if the blob is malformed, tampered, or the key is wrong
 */
export function decryptPat(stored) {
  if (typeof stored !== 'string' || stored.length === 0) {
    throw new Error('decryptPat: stored value must be a non-empty string');
  }
  const parts = stored.split(':');
  if (parts.length !== 4) {
    throw new Error('decryptPat: malformed blob (expected 4 colon-separated parts)');
  }
  const [version, ivHex, ciphertextHex, authTagHex] = parts;

  if (version !== VERSION) {
    throw new Error(`decryptPat: unsupported version "${version}" (expected "${VERSION}")`);
  }

  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`decryptPat: invalid IV length (got ${iv.length}, expected ${IV_LENGTH})`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`decryptPat: invalid auth tag length (got ${authTag.length}, expected ${AUTH_TAG_LENGTH})`);
  }

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    return plaintext;
  } catch (err) {
    // GCM auth tag verification failed — blob was tampered with, or the
    // key is wrong. Surface a generic message; the real reason goes to logs.
    throw new Error('decryptPat: authentication failed (tamper or wrong key)');
  }
}

/**
 * Quick check if a stored value looks like a v1 blob (for UI display).
 * Doesn't validate contents, just the structural shape.
 */
export function isPatBlob(value) {
  if (typeof value !== 'string') return false;
  return /^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(value);
}

/*
 * MIGRATION — key rotation playbook
 * ---------------------------------
 * 1. Generate a new key, set it as TG_PAT_ENCRYPTION_KEY_NEW.
 * 2. Keep the old key as TG_PAT_ENCRYPTION_KEY for decryption during migration.
 * 3. Update this module to try both keys on decrypt, using the new key on encrypt.
 * 4. Run a one-shot migration: for each stored blob, decrypt with old key,
 *    re-encrypt with new key, write back to Airtable.
 * 5. Once all blobs are re-encrypted, remove the old key env var.
 *
 * For now, single-key mode is fine. Revisit if the key is ever suspected
 * of being compromised.
 */
