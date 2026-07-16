import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_COOKIE,
  SESSION_COOKIE,
  authMode,
  authToken,
  issueSession,
  safeEqual,
} from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { isPersistenceEnabled } from '@/lib/db';
import { ensureAdminFromEnv, findByUsername } from '@/lib/repo/users';

// scrypt + DB in multi mode → Node runtime.
export const runtime = 'nodejs';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days
};

/** Multi-user login: {username, password} → signed session cookie. */
async function multiLogin(req: NextRequest, secret: string): Promise<NextResponse> {
  if (!isPersistenceEnabled()) {
    return NextResponse.json(
      { error: 'Multi-user mode (AUTH_MODE=multi) requires a database.' },
      { status: 500 },
    );
  }
  // Idempotent: seeds the admin from ADMIN_USERNAME/ADMIN_PASSWORD if none exists.
  try {
    await ensureAdminFromEnv();
  } catch (err) {
    console.error('[auth] admin bootstrap failed', err instanceof Error ? err.name : typeof err);
  }

  let username = '';
  let password = '';
  try {
    const body = (await req.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username === 'string') username = body.username;
    if (typeof body.password === 'string') password = body.password;
  } catch {
    // fall through → generic 401
  }

  const user = username ? await findByUsername(username) : null;
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ error: "That's not it — try again?" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set(
    SESSION_COOKIE,
    await issueSession({ uid: user.id, role: user.role }, secret),
    COOKIE_OPTS,
  );
  return res;
}

/** Shared-password login (default): {password} → shared HMAC cookie. Unchanged. */
async function sharedLogin(req: NextRequest, secret: string): Promise<NextResponse> {
  const password = process.env.PLAYGROUND_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: 'Server is missing PLAYGROUND_PASSWORD or AUTH_SECRET.' },
      { status: 500 },
    );
  }
  let candidate = '';
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body.password === 'string') candidate = body.password;
  } catch {
    // fall through with empty candidate → 401
  }
  if (!(await safeEqual(candidate, password))) {
    return NextResponse.json({ error: "That's not it — try again?" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authToken(secret), COOKIE_OPTS);
  return res;
}

export async function POST(req: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server is missing AUTH_SECRET.' }, { status: 500 });
  }
  return authMode() === 'multi' ? multiLogin(req, secret) : sharedLogin(req, secret);
}

/**
 * GET /api/auth — public: report the auth mode so the login page can show the
 * right fields (username+password in multi, password only in shared). Leaks no
 * secret — just which door to render.
 */
export async function GET() {
  return NextResponse.json({ mode: authMode() });
}
