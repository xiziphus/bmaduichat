import { NextRequest, NextResponse } from 'next/server';
import { isPersistenceEnabled } from '@/lib/db';
import { authContext } from '@/lib/session';
import { getConversation, setArchived, updateTitle } from '@/lib/repo/conversations';
import { listMessages } from '@/lib/repo/messages';
import { getLatestForConversation } from '@/lib/repo/artifacts';

// DB access → Node runtime.
export const runtime = 'nodejs';

/**
 * GET /api/conversations/[id] — rehydrate a full message thread, in order.
 * 404 when the conversation is missing OR owned by another user (multi mode) —
 * the ownership check here gates the message/artifact reads below.
 */
export async function GET(req: NextRequest, routeCtx: { params: Promise<{ id: string }> }) {
  const auth = await authContext(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, messages: [] });
  }
  const { id } = await routeCtx.params;
  try {
    const conversation = await getConversation(id, undefined, auth.userId);
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const messages = await listMessages(id);
    // Latest saved document (if any) → doc pane rehydrates on reopen/refresh.
    const latest = await getLatestForConversation(id);
    const artifact =
      latest && latest.markdown
        ? { title: latest.title, body: latest.markdown, artifactId: latest.id }
        : null;
    return NextResponse.json({ enabled: true, conversation, messages, artifact });
  } catch (err) {
    console.error('[conversations] thread failed', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ enabled: false, messages: [] });
  }
}

type PatchBody = { archived?: unknown; title?: unknown };

/**
 * PATCH /api/conversations/[id] — rename (`title`) or archive/unarchive
 * (`archived`). Never deletes. An empty/blank title clears it so the effective
 * title falls back to an auto-title.
 */
export async function PATCH(req: NextRequest, routeCtx: { params: Promise<{ id: string }> }) {
  const auth = await authContext(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, conversation: null });
  }
  const { id } = await routeCtx.params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const hasTitle = 'title' in body && (typeof body.title === 'string' || body.title === null);
  const hasArchived = typeof body.archived === 'boolean';
  if (!hasTitle && !hasArchived) {
    return NextResponse.json(
      { error: 'provide a string/null "title" or a boolean "archived"' },
      { status: 400 },
    );
  }

  try {
    const conversation = hasTitle
      ? await updateTitle(id, body.title as string | null, undefined, auth.userId)
      : await setArchived(id, body.archived as boolean, undefined, auth.userId);
    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ enabled: true, conversation });
  } catch (err) {
    console.error('[conversations] patch failed', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ enabled: false, conversation: null });
  }
}
