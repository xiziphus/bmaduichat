import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { buildMarySystemPrompt } from '@/lib/mary';
import { streamChat, ProviderError, providerLabel, type Msg, type Provider } from '@/lib/llm';

export const runtime = 'nodejs';

type ChatBody = {
  messages?: unknown;
  provider?: unknown;
  technique?: unknown;
};

function isMsg(m: unknown): m is Msg {
  return (
    typeof m === 'object' &&
    m !== null &&
    ((m as Msg).role === 'user' || (m as Msg).role === 'assistant') &&
    typeof (m as Msg).content === 'string'
  );
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (!(await verifyAuthCookie(cookie, process.env.AUTH_SECRET))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const provider = body.provider;
  if (provider !== 'gemini' && provider !== 'openrouter') {
    return NextResponse.json({ error: 'provider must be "gemini" or "openrouter"' }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || !body.messages.every(isMsg) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array of {role, content}' }, { status: 400 });
  }

  const technique = typeof body.technique === 'string' ? body.technique : undefined;
  const system = buildMarySystemPrompt(technique);

  let tokens: ReadableStream<string>;
  try {
    tokens = await streamChat(provider as Provider, system, body.messages);
  } catch (err) {
    if (err instanceof ProviderError) {
      // Log provider + status only — never upstream response bodies.
      console.error(`[chat] ${err.provider} ${err.kind} error (status ${err.status})`);
      const label = providerLabel(err.provider);
      // Missing env key → 500 with a config message; anything upstream → 502.
      const status = err.kind === 'missing-key' ? 500 : 502;
      const error =
        err.kind === 'missing-key'
          ? `${label} isn't configured — switch provider in the header.`
          : err.kind === 'timeout'
            ? `${label} timed out — try again or switch model.`
            : `${label} hit a snag — try again or switch model.`;
      return NextResponse.json({ error, provider: err.provider }, { status });
    }
    console.error('[chat] unexpected error', err instanceof Error ? err.name : typeof err);
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 });
  }

  // Re-encode the normalized token stream as SSE for the client.
  const encoder = new TextEncoder();
  const sse = tokens.pipeThrough(
    new TransformStream<string, Uint8Array>({
      transform(token, controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
      },
      flush(controller) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      },
    }),
  );

  return new Response(sse, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
