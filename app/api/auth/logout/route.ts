import { NextResponse } from 'next/server';
import { AUTH_COOKIE, SESSION_COOKIE } from '@/lib/auth';

/**
 * POST /api/auth/logout — clear the session. Under /api/auth so it's a public
 * path (no auth needed to sign out). Clears BOTH the shared-password cookie and
 * the multi-user session cookie, so it works in either mode.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  const expire = { path: '/', maxAge: 0 };
  res.cookies.set(SESSION_COOKIE, '', expire);
  res.cookies.set(AUTH_COOKIE, '', expire);
  return res;
}
