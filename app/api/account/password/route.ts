import { NextRequest, NextResponse } from 'next/server';
import { authMode } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { isPersistenceEnabled } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { findById, setPassword } from '@/lib/repo/users';

// scrypt + DB → Node runtime.
export const runtime = 'nodejs';

/** Minimum length for a new password. Basic guard, not a policy engine. */
const PASSWORD_MIN = 8;

/**
 * POST /api/account/password — a signed-in user changes their OWN password.
 * Body: { current, next }. Verifies `current`, enforces a minimum length, sets
 * the new scrypt hash. Multi mode only (shared mode has no user passwords).
 */
export async function POST(req: NextRequest) {
  if (authMode() !== 'multi') {
    return NextResponse.json({ error: 'Not available in shared mode.' }, { status: 400 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ error: 'Multi-user mode requires a database.' }, { status: 500 });
  }
  const session = await currentUser(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let current = '';
  let next = '';
  try {
    const body = (await req.json()) as { current?: unknown; next?: unknown };
    if (typeof body.current === 'string') current = body.current;
    if (typeof body.next === 'string') next = body.next;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (next.length < PASSWORD_MIN) {
    return NextResponse.json(
      { error: `New password must be at least ${PASSWORD_MIN} characters.` },
      { status: 400 },
    );
  }

  const user = await findById(session.uid);
  if (!user || !(await verifyPassword(current, user.password_hash))) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
  }

  await setPassword(user.id, next);
  return NextResponse.json({ ok: true });
}
