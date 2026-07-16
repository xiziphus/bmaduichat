import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { getAgentTree } from '@/lib/agents/tree';

// fs read of .claude/skills/** → Node runtime (not Edge).
export const runtime = 'nodejs';

/**
 * Authed agent→command tree feed (Epic D). The browser fetches this like it
 * fetches /api/techniques, so it never does an fs read for the manifest.
 *
 * Flag-gated: with `PLAYGROUND_TREE` unset/off this returns `enabled:false` +
 * an empty tree, so the client renders NOTHING new and the app stays
 * byte-identical to today (Mary single front door). Only when `PLAYGROUND_TREE=on`
 * does it return the full tree.
 */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (!(await verifyAuthCookie(cookie, process.env.AUTH_SECRET))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.PLAYGROUND_TREE !== 'on') {
    return NextResponse.json({ enabled: false, agents: [] });
  }
  return NextResponse.json({ enabled: true, agents: getAgentTree() });
}
