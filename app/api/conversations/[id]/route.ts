import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { isPersistenceEnabled } from '@/lib/db';
import { getConversation, setArchived } from '@/lib/repo/conversations';
import { listMessages } from '@/lib/repo/messages';

// DB access → Node runtime.
export const runtime = 'nodejs';

async function authed(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  return verifyAuthCookie(cookie, process.env.AUTH_SECRET);
}

/**
 * GET /api/conversations/[id] — rehydrate a full message thread, in order.
 * 404 when the conversation is missing so the client can refresh the sidebar.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await authed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, messages: [] });
  }
  const { id } = await ctx.params;
  try {
    const conversation = await getConversation(id);
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const messages = await listMessages(id);
    return NextResponse.json({ enabled: true, conversation, messages });
  } catch (err) {
    console.error('[conversations] thread failed', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ enabled: false, messages: [] });
  }
}

type PatchBody = { archived?: unknown };

/**
 * PATCH /api/conversations/[id] — archive/unarchive (never deletes).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await authed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, conversation: null });
  }
  const { id } = await ctx.params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.archived !== 'boolean') {
    return NextResponse.json({ error: 'archived must be a boolean' }, { status: 400 });
  }

  try {
    const conversation = await setArchived(id, body.archived);
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ enabled: true, conversation });
  } catch (err) {
    console.error('[conversations] archive failed', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ enabled: false, conversation: null });
  }
}
