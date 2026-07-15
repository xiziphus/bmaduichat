import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { getTechniques } from '@/lib/techniques-catalog';

// fs read of brain-methods.csv → Node runtime (not Edge).
export const runtime = 'nodejs';

/** Authed catalog feed so the browser never does an fs read for techniques. */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (!(await verifyAuthCookie(cookie, process.env.AUTH_SECRET))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ techniques: getTechniques() });
}
