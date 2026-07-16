/**
 * Minimal shared-password auth for an audience of one.
 * Cookie value = HMAC-SHA256(AUTH_SECRET, "playground-v1") as hex.
 * Uses Web Crypto only so it runs identically in Edge middleware,
 * Node route handlers, and vitest.
 */

export const AUTH_COOKIE = 'playground_auth';
/** Multi-user signed-session cookie (Epic F). Separate name so shared mode is
 *  byte-identical: with AUTH_MODE unset/shared this cookie is never set/read. */
export const SESSION_COOKIE = 'playground_session';
const AUTH_PAYLOAD = 'playground-v1';

const encoder = new TextEncoder();

export type AuthMode = 'shared' | 'multi';
export type Role = 'admin' | 'user';
export type Session = { uid: string; role: Role };

/**
 * The auth mode. Default (env unset or anything other than exactly "multi") is
 * `shared` — the single-password, no-accounts behavior identical to today. Only
 * AUTH_MODE=multi turns on the multi-user account system.
 */
export function authMode(): AuthMode {
  return process.env.AUTH_MODE === 'multi' ? 'multi' : 'shared';
}

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

// ---------------------------------------------------------------------------
// Multi-user signed session (Epic F). Edge-safe: uses the SAME Web Crypto HMAC
// primitive as the shared cookie above, so middleware verifies on the edge with
// no database hit. Cookie value = `${uid}.${role}.${hmacHex}` where the HMAC is
// over `${uid}.${role}`. uid is a uuid and role is admin|user — neither contains
// a ".", so splitting on "." is unambiguous.
// ---------------------------------------------------------------------------

function isRole(v: string): v is Role {
  return v === 'admin' || v === 'user';
}

/** Issue a signed session cookie value for `{uid, role}`. */
export async function issueSession(session: Session, secret: string): Promise<string> {
  const payload = `${session.uid}.${session.role}`;
  const sig = await hmacSha256Hex(secret, payload);
  return `${payload}.${sig}`;
}

/**
 * Verify a signed session cookie. Returns `{uid, role}` when the signature is
 * valid (constant-time) and the role is recognized, else null. Any tampering
 * with uid/role/signature fails the HMAC check.
 */
export async function verifySession(
  value: string | undefined,
  secret: string | undefined,
): Promise<Session | null> {
  if (!value || !secret) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [uid, role, sig] = parts;
  if (!uid || !isRole(role)) return null;
  const expected = await hmacSha256Hex(secret, `${uid}.${role}`);
  if (!(await safeEqual(sig, expected))) return null;
  return { uid, role };
}

// Password hashing (scrypt) lives in lib/password.ts — a SEPARATE module — so
// this edge-imported module never pulls in `node:crypto`. See lib/password.ts.
