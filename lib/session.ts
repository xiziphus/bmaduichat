/**
 * Request-scoped auth context (Epic F). Bridges the two auth modes for route
 * handlers so a route asks one question — "who is this and what may they touch?"
 * — without caring which mode is active.
 *
 * - shared mode: the single shared-password cookie is verified; there is no user
 *   concept, so `userId` is null (repos then run their byte-identical, unscoped
 *   SQL). This is exactly today's behavior.
 * - multi mode: the signed session cookie is verified (edge-safe HMAC); `userId`
 *   is the session uid and every repo call is scoped to it.
 *
 * Verification is pure crypto (no DB), matching the middleware edge check.
 */
import type { NextRequest } from 'next/server';
import {
  AUTH_COOKIE,
  SESSION_COOKIE,
  authMode,
  verifyAuthCookie,
  verifySession,
  type Role,
  type Session,
} from '@/lib/auth';

/** The logged-in user in multi mode, or null when unauthenticated / shared. */
export async function currentUser(req: NextRequest): Promise<Session | null> {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  return verifySession(raw, process.env.AUTH_SECRET);
}

export type AuthContext = {
  /** The user id to scope repo reads/writes to, or null in shared mode. */
  userId: string | null;
  /** The role in multi mode; undefined in shared mode. */
  role?: Role;
};

/**
 * Resolve the request's auth context, or null when the caller is not
 * authenticated for the active mode. Routes do:
 *   const ctx = await authContext(req);
 *   if (!ctx) return 401;
 *   ...use ctx.userId to scope...
 */
export async function authContext(req: NextRequest): Promise<AuthContext | null> {
  if (authMode() === 'multi') {
    const user = await currentUser(req);
    if (!user) return null;
    return { userId: user.uid, role: user.role };
  }
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (!(await verifyAuthCookie(cookie, process.env.AUTH_SECRET))) return null;
  return { userId: null };
}
