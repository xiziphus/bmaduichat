import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_COOKIE,
  SESSION_COOKIE,
  authMode,
  verifyAuthCookie,
  verifySession,
} from '@/lib/auth';

// Segment-exact public routes: /login and /api/auth (plus their subpaths),
// but NOT /login-help, /api/authorize, etc.
const PUBLIC_PATH = /^\/(?:login|api\/auth)(?:\/|$)/;

// Admin-only surfaces (multi mode): the /admin page + /api/admin/* routes.
const ADMIN_PATH = /^\/(?:admin|api\/admin)(?:\/|$)/;

// Common root-level static assets that must never be auth-redirected.
const PUBLIC_FILE =
  /^\/(?:favicon\.ico|robots\.txt|sitemap\.xml|manifest\.(?:json|webmanifest)|apple-touch-icon(?:-precomposed)?\.png)$/;

function unauthorized(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = '';
  return NextResponse.redirect(loginUrl);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATH.test(pathname) || PUBLIC_FILE.test(pathname)) {
    return NextResponse.next();
  }

  // Multi mode (Epic F): verify the signed session cookie on the edge (no DB),
  // then gate admin surfaces by the session's role. A coarse edge role check
  // redirects early; admin *mutations* re-check the role against the DB in-route.
  if (authMode() === 'multi') {
    const session = await verifySession(
      req.cookies.get(SESSION_COOKIE)?.value,
      process.env.AUTH_SECRET,
    );
    if (!session) return unauthorized(req);
    if (ADMIN_PATH.test(pathname) && session.role !== 'admin') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const home = req.nextUrl.clone();
      home.pathname = '/';
      home.search = '';
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  // Shared mode (default): unchanged — the single shared-password cookie.
  const ok = await verifyAuthCookie(req.cookies.get(AUTH_COOKIE)?.value, process.env.AUTH_SECRET);
  if (ok) return NextResponse.next();
  return unauthorized(req);
}

export const config = {
  // Skip Next.js internals; exact public-route exclusions happen in code above.
  matcher: ['/((?!_next/).*)'],
};
