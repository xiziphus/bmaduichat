import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { buildMarySystemPrompt } from '@/lib/mary';
import { streamChat, ProviderError, providerLabel, type Msg, type Provider } from '@/lib/llm';
import { isPersistenceEnabled, transaction } from '@/lib/db';
import { buildAppendMessageQuery } from '@/lib/repo/messages';
import { createVersion } from '@/lib/repo/artifacts';
import { parseChips } from '@/lib/chips';
import { parseDocument } from '@/lib/document';

export const runtime = 'nodejs';

type ChatBody = {
  messages?: unknown;
  provider?: unknown;
  technique?: unknown;
  conversationId?: unknown;
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

  // Persistence is best-effort and server-side only. It engages only when
  // DATABASE_URL is configured AND the client supplied a real conversation id.
  // We persist NOTHING here — the user turn and the assistant turn are written
  // together in one transaction only after the stream completes (see below), so
  // a provider error never leaves a dangling user message with no reply.
  const conversationId =
    typeof body.conversationId === 'string' && body.conversationId.length > 0
      ? body.conversationId
      : undefined;
  const persist = isPersistenceEnabled() && conversationId !== undefined;

  const lastMsg = body.messages[body.messages.length - 1] as Msg;
  const userTurn = persist && lastMsg.role === 'user' ? lastMsg.content : undefined;

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

  // Re-encode the normalized token stream as SSE for the client. When
  // persistence is on we accumulate the raw assistant text and, once the
  // upstream stream flushes (i.e. it completed WITHOUT error), write the user
  // turn and the assistant turn together in ONE transaction. `flush` is async
  // and awaited, so the response stream stays open until the write lands — on
  // Vercel serverless the function can't freeze before the Neon write commits.
  // If the stream errors mid-flight, flush never runs and nothing is persisted
  // (matches the spec I/O matrix: tx rolled back / nothing on failure).
  const encoder = new TextEncoder();
  let assistantRaw = '';
  const sse = tokens.pipeThrough(
    new TransformStream<string, Uint8Array>({
      transform(token, controller) {
        if (persist) assistantRaw += token;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
      },
      async flush(controller) {
        if (persist && userTurn !== undefined && conversationId !== undefined) {
          // Strip the <document> block first, then chips, so the persisted chat
          // bubble carries neither tag. A wrap-up turn yields both a chat reply
          // and a durable document; each is stored in its own place.
          const { text: afterDoc, document } = parseDocument(assistantRaw);
          const { text, chips } = parseChips(afterDoc);
          try {
            if (text || chips.length > 0) {
              await transaction([
                buildAppendMessageQuery({ conversationId, role: 'user', content: userTurn }),
                buildAppendMessageQuery({ conversationId, role: 'assistant', content: text, chips }),
              ]);
            }
            if (document) {
              // New version row — prior versions retained (regenerate keeps history).
              const artifact = await createVersion({
                conversationId,
                title: document.title,
                markdown: document.body,
              });
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ artifact: { id: artifact.id } })}\n\n`),
              );
            }
          } catch (err) {
            // DB failure must never surface to the client — the reply already
            // streamed. Log and move on.
            console.error(
              '[chat] persist turn failed',
              err instanceof Error ? err.name : err,
            );
          }
        }
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
