/**
 * Password hashing with node:crypto scrypt (built-in, no dependency). Lives in
 * its OWN module — separate from lib/auth.ts — because lib/auth is imported by
 * the Edge middleware, and the Edge bundler cannot resolve the `node:` scheme.
 * These functions are only ever imported by Node route handlers / repos.
 *
 * Stored form is self-describing: `scrypt$<saltHex>$<hashHex>`.
 */

const SCRYPT_KEYLEN = 64;

/** Hash a plaintext password: random 16-byte salt + scrypt, self-describing. */
export async function hashPassword(plain: string): Promise<string> {
  const { randomBytes, scrypt } = await import('node:crypto');
  const salt = randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(plain, salt, SCRYPT_KEYLEN, (err, dk) => (err ? reject(err) : resolve(dk)));
  });
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Constant-time verify a plaintext password against a stored `scrypt$salt$hash`. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const { scrypt, timingSafeEqual } = await import('node:crypto');
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(plain, salt, expected.length, (err, dk) => (err ? reject(err) : resolve(dk)));
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** A URL-safe random password (for admin create/reset auto-generation). */
export async function generatePassword(bytes = 12): Promise<string> {
  const { randomBytes } = await import('node:crypto');
  return randomBytes(bytes).toString('base64url');
}
