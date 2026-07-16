import { NextRequest, NextResponse } from 'next/server';
import { authMode } from '@/lib/auth';
import { generatePassword } from '@/lib/password';
import { isPersistenceEnabled } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { createUser, findByUsername, list } from '@/lib/repo/users';

// scrypt + DB → Node runtime.
export const runtime = 'nodejs';

/** Guard: multi mode, DB on, caller is an admin. Returns an error response or null. */
async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (authMode() !== 'multi') {
    return NextResponse.json({ error: 'Not available in shared mode.' }, { status: 400 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ error: 'Multi-user mode requires a database.' }, { status: 500 });
  }
  const session = await currentUser(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // The role is part of the HMAC-signed session, so it can't be forged.
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

/** GET /api/admin/users — list all users (never any hash). Admin only. */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const users = await list();
  return NextResponse.json({ users });
}

/**
 * POST /api/admin/users { username, password? } — create a user. When no
 * password is given, a strong one is generated. The plaintext password is
 * returned ONCE (the only time it is ever exposed) so the admin can hand it over.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let username = '';
  let password: string | undefined;
  try {
    const body = (await req.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username === 'string') username = body.username.trim();
    if (typeof body.password === 'string' && body.password) password = body.password;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!username) {
    return NextResponse.json({ error: 'username is required' }, { status: 400 });
  }
  if (await findByUsername(username)) {
    return NextResponse.json({ error: 'That username is taken.' }, { status: 409 });
  }

  const plaintext = password ?? (await generatePassword());
  try {
    const user = await createUser({ username, password: plaintext, role: 'user' });
    // The plaintext is returned exactly once, here, for the admin to pass on.
    return NextResponse.json({ user, password: plaintext }, { status: 201 });
  } catch (err) {
    console.error('[admin] create user failed', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ error: 'Could not create that user.' }, { status: 409 });
  }
}
