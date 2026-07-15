import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { isPersistenceEnabled } from '@/lib/db';
import {
  listBuilderNotes,
  markBuilderNotesSent,
  type BuilderNoteStatus,
} from '@/lib/repo/builder-notes';

// DB access → Node runtime.
export const runtime = 'nodejs';

async function authed(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  return verifyAuthCookie(cookie, process.env.AUTH_SECRET);
}

function parseStatus(raw: string | null): BuilderNoteStatus | undefined {
  return raw === 'collected' || raw === 'sent' ? raw : undefined;
}

/**
 * GET /api/builder-notes?status=collected|sent — the server-side outbox.
 * When persistence is off, returns `enabled:false` with an empty list so the
 * client falls back to its localStorage notes. Never errors.
 */
export async function GET(req: NextRequest) {
  if (!(await authed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, notes: [] });
  }
  const status = parseStatus(req.nextUrl.searchParams.get('status'));
  try {
    const notes = await listBuilderNotes(status);
    return NextResponse.json({ enabled: true, notes });
  } catch (err) {
    console.error('[builder-notes] list failed', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ enabled: false, notes: [] });
  }
}

/**
 * POST /api/builder-notes — consent action. Body `{ ids: string[] }` flips those
 * notes to status 'sent' (builder-visible). No-op / graceful when the DB is off.
 */
export async function POST(req: NextRequest) {
  if (!(await authed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, ok: false });
  }
  let body: { ids?: unknown };
  try {
    body = (await req.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array of note ids' }, { status: 400 });
  }
  try {
    await markBuilderNotesSent(ids);
    return NextResponse.json({ enabled: true, ok: true });
  } catch (err) {
    console.error('[builder-notes] mark sent failed', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ error: 'Failed to update notes' }, { status: 500 });
  }
}
