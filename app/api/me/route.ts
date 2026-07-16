import { NextRequest, NextResponse } from 'next/server';
import { authMode } from '@/lib/auth';
import { isPersistenceEnabled } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { getById } from '@/lib/repo/users';

// DB access in multi mode → Node runtime.
export const runtime = 'nodejs';

/**
 * GET /api/me — who is signed in. Powers the profile menu.
 * Shared mode: `{ mode: 'shared' }` (no user identity — the menu renders nothing).
 * Multi mode: `{ mode: 'multi', username, role }` for the current session.
 */
export async function GET(req: NextRequest) {
  if (authMode() !== 'multi') {
    return NextResponse.json({ mode: 'shared' });
  }
  const session = await currentUser(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let username: string | null = null;
  if (isPersistenceEnabled()) {
    const user = await getById(session.uid);
    username = user?.username ?? null;
  }
  return NextResponse.json({ mode: 'multi', username, role: session.role });
}
