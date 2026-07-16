import { NextRequest, NextResponse } from 'next/server';
import { authMode } from '@/lib/auth';
import { generatePassword } from '@/lib/password';
import { isPersistenceEnabled } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { getById, setPassword } from '@/lib/repo/users';

// scrypt + DB → Node runtime.
export const runtime = 'nodejs';

async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (authMode() !== 'multi') {
    return NextResponse.json({ error: 'Not available in shared mode.' }, { status: 400 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ error: 'Multi-user mode requires a database.' }, { status: 500 });
  }
  const session = await currentUser(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

/**
 * POST /api/admin/users/[id] { password? } — reset a user's password. When no
 * password is given, a strong one is generated. The plaintext is returned ONCE
 * for the admin to hand over. The admin resets but NEVER reads an existing
 * password (there is no endpoint that returns a stored password).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const target = await getById(id);
  if (!target) {
    return NextResponse.json({ error: 'No such user.' }, { status: 404 });
  }

  let password: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { password?: unknown };
    if (typeof body.password === 'string' && body.password) password = body.password;
  } catch {
    // empty body is fine → auto-generate
  }

  const plaintext = password ?? (await generatePassword());
  await setPassword(id, plaintext);
  return NextResponse.json({ ok: true, password: plaintext });
}
