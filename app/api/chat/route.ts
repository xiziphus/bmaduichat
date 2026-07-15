import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyAuthCookie } from '@/lib/auth';
import { buildMarySystemPrompt } from '@/lib/mary';
import {
  streamChat,
  ProviderError,
  providerLabel,
  modelForProvider,
  type ChatStream,
  type Msg,
  type Provider,
} from '@/lib/llm';
import { isPersistenceEnabled, transaction } from '@/lib/db';
import { buildAppendMessageQuery } from '@/lib/repo/messages';
import type { AttachmentMeta } from '@/lib/attachments';
import { createVersion } from '@/lib/repo/artifacts';
import { parseChips } from '@/lib/chips';
import { parseDocument } from '@/lib/document';
import { parseReferences, resolveReferences } from '@/lib/references';
import {
  isFreeModel,
  estimateCost,
  tokensOrEstimate,
  capStatus,
  budgetCap,
  blockedMessage,
} from '@/lib/usage';
import { insertUsage, monthToDateSpend } from '@/lib/repo/usage';
import { insertBuilderNote } from '@/lib/repo/builder-notes';
import { extractBuilderNotes } from '@/lib/builder-notes';

export const runtime = 'nodejs';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
};

/**
 * A complete, self-contained SSE response that streams a single honest assistant
 * bubble and closes. Used for the budget hard-stop — the client renders it as a
 * normal Mary reply (visible, never silent) and nothing is persisted.
 */
function honestBubbleResponse(message: string): Response {
  const encoder = new TextEncoder();
  const body =
    `data: ${JSON.stringify({ token: message })}\n\n` + 'data: [DONE]\n\n';
  return new Response(encoder.encode(body), { headers: SSE_HEADERS });
}

type ChatBody = {
  messages?: unknown;
  provider?: unknown;
  technique?: unknown;
  conversationId?: unknown;
  references?: unknown;
};

/**
 * Append resolved reference context to the LAST user turn for THIS request only.
 * Injected content is never persisted (we persist the original `userTurn`).
 */
function injectReferenceContext(messages: ChatMessage[], context: string): ChatMessage[] {
  if (!context) return messages;
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') {
      out[i] = {
        ...out[i],
        content: `${out[i].content}\n\n${context}`,
      };
      break;
    }
  }
  return out;
}

/** A chat message as posted by the client: an LLM `Msg` plus optional
 *  attachment metadata (persisted, not sent to the model). */
type ChatMessage = Msg & { attachments?: AttachmentMeta[] };

function isMsg(m: unknown): m is ChatMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    ((m as Msg).role === 'user' || (m as Msg).role === 'assistant') &&
    typeof (m as Msg).content === 'string' &&
    // `parts` (image/pdf) is optional but must be an array when present.
    ((m as Msg).parts === undefined || Array.isArray((m as Msg).parts))
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

  const lastMsg = body.messages[body.messages.length - 1] as ChatMessage;
  const userTurn = persist && lastMsg.role === 'user' ? lastMsg.content : undefined;
  const userAttachments =
    persist && lastMsg.role === 'user' && Array.isArray(lastMsg.attachments)
      ? lastMsg.attachments
      : undefined;

  // Resolve @-references SERVER-SIDE (never trust client-sent content). Needs the
  // DB; when persistence is off, references are silently skipped. Injected into
  // this request's context only — not persisted.
  const references = parseReferences(body.references);
  let modelMessages = body.messages as ChatMessage[];
  if (isPersistenceEnabled() && references.length > 0) {
    try {
      const { context } = await resolveReferences(references);
      modelMessages = injectReferenceContext(modelMessages, context);
    } catch (err) {
      console.error('[chat] reference resolution failed', err instanceof Error ? err.name : typeof err);
      // Degrade gracefully — send the turn without injected references.
    }
  }

  // Budget cap (metering requires a DB — no DATABASE_URL means no cap at all).
  // Free models are ALWAYS allowed and never checked. A billable request at
  // 100% of the monthly cap is blocked with an honest, visible bubble.
  const model = modelForProvider(provider as Provider);
  const free = isFreeModel(provider as Provider, model);
  if (isPersistenceEnabled() && !free) {
    try {
      const spent = await monthToDateSpend();
      const cap = budgetCap();
      if (capStatus(spent, cap).level === 'blocked') {
        return honestBubbleResponse(blockedMessage(cap));
      }
    } catch (err) {
      // Fail OPEN — a metering hiccup must never block chat.
      console.error('[chat] cap check failed', err instanceof Error ? err.name : typeof err);
    }
  }

  let chat: ChatStream;
  try {
    chat = await streamChat(provider as Provider, system, modelMessages);
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
  // Metering runs whenever a DB is configured (independent of a conversation id).
  const meter = isPersistenceEnabled();
  // Rough prompt text (all turns) for a token estimate when the provider doesn't
  // report counts. Cheap and only used as a fallback.
  const promptText = meter ? modelMessages.map((m) => m.content).join('\n') : '';
  let assistantRaw = '';
  const sse = chat.stream.pipeThrough(
    new TransformStream<string, Uint8Array>({
      transform(token, controller) {
        if (meter) assistantRaw += token;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
      },
      async flush(controller) {
        // Parse the finished reply once — needed for persistence, builder notes,
        // and to keep chips/doc tags out of stored text.
        const { text: afterDoc, document } = meter
          ? parseDocument(assistantRaw)
          : { text: '', document: undefined };
        const { text, chips } = meter ? parseChips(afterDoc) : { text: '', chips: [] as string[] };

        if (persist && userTurn !== undefined && conversationId !== undefined) {
          try {
            if (text || chips.length > 0) {
              await transaction([
                buildAppendMessageQuery({
                  conversationId,
                  role: 'user',
                  content: userTurn,
                  attachments: userAttachments,
                }),
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

        // Metering + builder-note outbox (DB on only). Failures are swallowed —
        // the reply already streamed.
        if (meter) {
          // Bill the call (free models are never counted).
          if (!free) {
            try {
              const tokensIn = tokensOrEstimate(chat.usage.tokensIn, promptText);
              const tokensOut = tokensOrEstimate(chat.usage.tokensOut, assistantRaw);
              const costEst = estimateCost({
                provider: provider as Provider,
                model,
                tokensIn,
                tokensOut,
              });
              await insertUsage({ provider: provider as Provider, model, tokensIn, tokensOut, costEst });
            } catch (err) {
              console.error('[chat] usage write failed', err instanceof Error ? err.name : typeof err);
            }
          }
          // Persist any "noted for the builder" excerpts server-side.
          try {
            const excerpts = extractBuilderNotes(text);
            for (const excerpt of excerpts) {
              await insertBuilderNote({ conversationId: conversationId ?? null, excerpt });
            }
          } catch (err) {
            console.error('[chat] builder-note write failed', err instanceof Error ? err.name : typeof err);
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      },
    }),
  );

  return new Response(sse, { headers: SSE_HEADERS });
}
