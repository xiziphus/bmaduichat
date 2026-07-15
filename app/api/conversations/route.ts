import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { isPersistenceEnabled } from '@/lib/db';
import { createConversation, listConversations } from '@/lib/repo/conversations';

// DB access → Node runtime.
export const runtime = 'nodejs';

async function authed(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  return verifyAuthCookie(cookie, process.env.AUTH_SECRET);
}

/**
 * GET /api/conversations — list non-archived conversations, newest first.
 * When persistence is disabled, returns `{ enabled: false, conversations: [] }`
 * so the client falls back to today's ephemeral behavior with no error.
 */
export async function GET(req: NextRequest) {
  if (!(await authed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, conversations: [] });
  }
  try {
    const conversations = await listConversations();
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
  if (!(await authed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, conversation: null });
  }
  try {
    const conversation = await createConversation();
    return NextResponse.json({ enabled: true, conversation }, { status: 201 });
  } catch (err) {
    console.error('[conversations] create failed', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ enabled: false, conversation: null });
  }
}
