import { NextRequest, NextResponse } from 'next/server';
import { authContext } from '@/lib/session';
import { getAgentActivation } from '@/lib/agents/activation';

// fs read of .claude/skills/** → Node runtime (not Edge).
export const runtime = 'nodejs';

/**
 * Authed activation feed for ONE agent (Epic D). The browser fetches this when
 * the user picks an agent in the tree, then composes the deterministic greeting
 * client-side (lib/agents/greeting.ts) — no LLM call.
 *
 * Returns the agent's identity, the REAL relative filenames the loader read, and
 * its command menu joined with honest parity. Server-only + DB-independent.
 *
 * Flag-gated: with `PLAYGROUND_TREE` unset/off this 404s, matching /api/agents
 * returning an empty tree — so the client (AgentTree returns null) never calls it.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  if (!(await authContext(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.PLAYGROUND_TREE !== 'on') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { slug } = await ctx.params;
  try {
    const activation = getAgentActivation(slug);
    // Only real agents (with a command menu) activate; a bare skill slug 404s.
    if (activation.commands.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(activation);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
