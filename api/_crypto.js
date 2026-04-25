/**
 * Travelgenix Widget Suite — Crypto helper
 *
 * AES-256-GCM symmetric encryption for sensitive credential storage.
 * Used by client-integrations.js for Travelify API keys, future Duda/Metricool/etc.
 *
 * Output format: base64(iv || ciphertext || authTag)
 *   - iv: 12 bytes
 *   - authTag: 16 bytes (last 16 bytes of buffer)
 *   - ciphertext: variable
 *
 * Env required:
 *   TG_ENCRYPTION_KEY — 32 bytes hex-encoded (64 hex chars)
 *
 * To generate a key:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;       // GCM standard
const AUTH_TAG_LENGTH = 16; // GCM standard
const KEY_LENGTH = 32;      // AES-256

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.TG_ENCRYPTION_KEY;
  if (!raw) throw new Error('TG_ENCRYPTION_KEY env var missing');
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error('TG_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  const buf = Buffer.from(raw, 'hex');
  if (buf.length !== KEY_LENGTH) {
    throw new Error('TG_ENCRYPTION_KEY decoded length must be 32 bytes');
  }
  cachedKey = buf;
  return cachedKey;
}

/**
 * Encrypt a plaintext string.
 * Returns: base64-encoded string of (iv || ciphertext || authTag)
 */
export function encrypt(plaintext) {
  if (typeof plaintext !== 'string') throw new Error('encrypt: plaintext must be a string');
  if (plaintext.length === 0) throw new Error('encrypt: plaintext cannot be empty');

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

/**
 * Decrypt a base64-encoded string previously produced by encrypt().
 * Throws on tampering, wrong key, or malformed input.
 */
export function decrypt(payload) {
  if (typeof payload !== 'string') throw new Error('decrypt: payload must be a string');
  if (payload.length === 0) throw new Error('decrypt: payload cannot be empty');

  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('decrypt: payload too short');
  }

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

/**
 * Mask a sensitive string for logging — shows only first 4 + last 4 chars.
 * Use this anywhere you might log a credential identifier (never the value itself).
 */
export function mask(s) {
  if (typeof s !== 'string' || s.length < 8) return '***';
  return s.slice(0, 4) + '…' + s.slice(-4);
}
