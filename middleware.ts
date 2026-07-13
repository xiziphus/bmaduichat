import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';

// Segment-exact public routes: /login and /api/auth (plus their subpaths),
// but NOT /login-help, /api/authorize, etc.
const PUBLIC_PATH = /^\/(?:login|api\/auth)(?:\/|$)/;

// Common root-level static assets that must never be auth-redirected.
const PUBLIC_FILE =
  /^\/(?:favicon\.ico|robots\.txt|sitemap\.xml|manifest\.(?:json|webmanifest)|apple-touch-icon(?:-precomposed)?\.png)$/;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATH.test(pathname) || PUBLIC_FILE.test(pathname)) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  const ok = await verifyAuthCookie(cookie, process.env.AUTH_SECRET);
  if (ok) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip Next.js internals; exact public-route exclusions happen in code above.
  matcher: ['/((?!_next/).*)'],
};
