import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { isPersistenceEnabled } from '@/lib/db';
import { searchConversations } from '@/lib/repo/conversations';
import { searchArtifacts } from '@/lib/repo/artifacts';

// DB access → Node runtime.
export const runtime = 'nodejs';

async function authed(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  return verifyAuthCookie(cookie, process.env.AUTH_SECRET);
}

/**
 * GET /api/references?q= — search conversations + artifacts by title for the
 * `@`-mention autocomplete. Returns items tagged with their {type,id,title}.
 * When persistence is off, returns empty lists (autocomplete shows no matches)
 * with zero errors.
 */
export async function GET(req: NextRequest) {
  if (!(await authed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPersistenceEnabled()) {
    return NextResponse.json({ enabled: false, conversations: [], artifacts: [] });
  }
  const q = req.nextUrl.searchParams.get('q') ?? '';
  try {
    const [convos, arts] = await Promise.all([searchConversations(q, 8), searchArtifacts(q, 8)]);
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
