import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { runWorkflow, type RunWorkflowInput } from '@/lib/runtime/engine';
import type { Provider } from '@/lib/llm';
import type { RunEvent } from '@/lib/runtime/types';

/**
 * Guarded entry to EXERCISE the dormant runtime engine. This route is NOT called
 * by the live Mary UI — it exists so the engine can be driven end-to-end without
 * touching app/api/chat. Adding it changes nothing about the live chat flow.
 *
 * It is additionally gated behind PLAYGROUND_ENGINE=on, so it 404s in normal
 * operation and cannot be reached accidentally.
 */
export const runtime = 'nodejs';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
};

type RunBody = {
  conversationId?: unknown;
  skillSlug?: unknown;
  input?: unknown;
  provider?: unknown;
  model?: unknown;
  resumeRunId?: unknown;
};

export async function POST(req: NextRequest) {
  // Off by default — the engine ships dormant.
  if (process.env.PLAYGROUND_ENGINE !== 'on') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (!(await verifyAuthCookie(cookie, process.env.AUTH_SECRET))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const provider = body.provider;
  if (provider !== 'gemini' && provider !== 'openrouter') {
    return NextResponse.json({ error: 'provider must be "gemini" or "openrouter"' }, { status: 400 });
  }
  if (typeof body.conversationId !== 'string' || !body.conversationId) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
  }
  if (typeof body.skillSlug !== 'string' || !body.skillSlug) {
    return NextResponse.json({ error: 'skillSlug is required' }, { status: 400 });
  }
  if (typeof body.input !== 'string') {
    return NextResponse.json({ error: 'input is required' }, { status: 400 });
  }

  const opts: RunWorkflowInput = {
    conversationId: body.conversationId,
    skillSlug: body.skillSlug,
    input: body.input,
    provider: provider as Provider,
    model: typeof body.model === 'string' ? body.model : undefined,
    resumeRunId: typeof body.resumeRunId === 'string' ? body.resumeRunId : undefined,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: RunEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        for await (const ev of runWorkflow(opts)) send(ev);
      } catch {
        send({ type: 'error', message: 'Engine error.' });
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
