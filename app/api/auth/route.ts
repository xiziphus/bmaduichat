import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, authToken, safeEqual } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const password = process.env.PLAYGROUND_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!password || !secret) {
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
  res.cookies.set(AUTH_COOKIE, await authToken(secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
