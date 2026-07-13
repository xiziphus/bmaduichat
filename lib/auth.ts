/**
 * Minimal shared-password auth for an audience of one.
 * Cookie value = HMAC-SHA256(AUTH_SECRET, "playground-v1") as hex.
 * Uses Web Crypto only so it runs identically in Edge middleware,
 * Node route handlers, and vitest.
 */

export const AUTH_COOKIE = 'playground_auth';
const AUTH_PAYLOAD = 'playground-v1';

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toHex(sig);
}

/** The expected auth-cookie value for a given secret. */
export async function authToken(secret: string): Promise<string> {
  return hmacSha256Hex(secret, AUTH_PAYLOAD);
}

/**
 * Constant-time string equality. Hashes both sides to fixed-length
 * digests first so timing leaks neither content nor length.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const da = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(a)));
  const db = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(b)));
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

/** True when the presented cookie value matches the expected token. */
export async function verifyAuthCookie(
  value: string | undefined,
  secret: string | undefined,
): Promise<boolean> {
  if (!value || !secret) return false;
  const expected = await authToken(secret);
  return safeEqual(value, expected);
}
