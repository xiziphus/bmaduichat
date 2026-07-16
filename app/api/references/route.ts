import { NextRequest, NextResponse } from 'next/server';
import { isPersistenceEnabled } from '@/lib/db';
import { authContext } from '@/lib/session';
import { searchConversations } from '@/lib/repo/conversations';
import { searchArtifacts } from '@/lib/repo/artifacts';

// DB access → Node runtime.
export const runtime = 'nodejs';

/**
 * GET /api/references?q= — search conversations + artifacts by title for the
 * `@`-mention autocomplete. Returns items tagged with their {type,id,title}.
 * When persistence is off, returns empty lists (autocomplete shows no matches)
 * with zero errors.
 */
export async function GET(req: NextRequest) {
  const ctx = await authContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, conversations: [], artifacts: [] });
  }
  const q = req.nextUrl.searchParams.get('q') ?? '';
  try {
    const [convos, arts] = await Promise.all([
      searchConversations(q, 8, undefined, ctx.userId),
      searchArtifacts(q, 8, undefined, ctx.userId),
    ]);
    return NextResponse.json({
      enabled: true,
      conversations: convos.map((c) => ({ type: 'conversation', id: c.id, title: c.title })),
      artifacts: arts.map((a) => ({ type: 'artifact', id: a.id, title: a.title })),
    });
  } catch (err) {
    console.error('[references] search failed', err instanceof Error ? err.name : typeof err);
    // Degrade rather than surface a DB error — autocomplete just shows nothing.
    return NextResponse.json({ enabled: false, conversations: [], artifacts: [] });
  }
}
