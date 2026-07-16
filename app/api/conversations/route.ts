import { NextRequest, NextResponse } from 'next/server';
import { isPersistenceEnabled } from '@/lib/db';
import { authContext } from '@/lib/session';
import { createConversation, listConversations } from '@/lib/repo/conversations';

// DB access → Node runtime.
export const runtime = 'nodejs';

/**
 * GET /api/conversations — list non-archived conversations, newest first.
 * In multi mode the list is scoped to the logged-in user; in shared mode it is
 * unscoped (byte-identical to today). When persistence is disabled, returns
 * `{ enabled: false, conversations: [] }` so the client falls back with no error.
 */
export async function GET(req: NextRequest) {
  const ctx = await authContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, conversations: [] });
  }
  try {
    const conversations = await listConversations(undefined, ctx.userId);
    return NextResponse.json({ enabled: true, conversations });
  } catch (err) {
    console.error('[conversations] list failed', err instanceof Error ? err.name : typeof err);
    // Degrade rather than surface a DB error to the user.
    return NextResponse.json({ enabled: false, conversations: [] });
  }
}

/**
 * POST /api/conversations — create a new conversation (archived=false).
 * Never deletes or archives the previous one. No-op envelope when disabled.
 */
export async function POST(req: NextRequest) {
  const ctx = await authContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, conversation: null });
  }
  try {
    const conversation = await createConversation({ owner: ctx.userId });
    return NextResponse.json({ enabled: true, conversation }, { status: 201 });
  } catch (err) {
    console.error('[conversations] create failed', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ enabled: false, conversation: null });
  }
}
