import { NextRequest, NextResponse } from 'next/server';
import { authContext } from '@/lib/session';
import { getConversation } from '@/lib/repo/conversations';
import { buildMarySystemPrompt } from '@/lib/mary';
import {
  streamChat,
  ProviderError,
  providerLabel,
  modelForProvider,
  type ChatStream,
  type Msg,
  type MsgPart,
  type Provider,
} from '@/lib/llm';
import { runWorkflow } from '@/lib/runtime/engine';
import { BRAINSTORMING_SLUG, inferPhase } from '@/lib/runtime/brainstorming';
import { planLaunch } from '@/lib/runtime/launch';
import type { ToolMsg } from '@/lib/runtime/types';
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
  /** Epic D launch descriptor: an agent + command from the tree. */
  agentSlug?: unknown;
  code?: unknown;
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

/** Map the posted chat history into the engine's canonical `ToolMsg[]`. */
function toEngineHistory(msgs: ChatMessage[]): ToolMsg[] {
  return msgs.map((m) =>
    m.role === 'user'
      ? { role: 'user', content: m.content, ...(m.parts && m.parts.length ? { parts: m.parts } : {}) }
      : { role: 'assistant', content: m.content },
  );
}

type EngineChatParams = {
  provider: Provider;
  model: string;
  free: boolean;
  /** Full history for this request, @-references already injected. */
  messages: ChatMessage[];
  technique?: string;
  conversationId?: string;
  persist: boolean;
  userTurn?: string;
  userAttachments?: AttachmentMeta[];
  /** The skill to run (Epic D command launch). Defaults to brainstorming. */
  skillSlug?: string;
  /** The active agent whose persona composes the run (Epic D). */
  agentSlug?: string;
};

/**
 * The PLAYGROUND_ENGINE path: route the brainstorming conversation through the
 * runtime engine (runWorkflow) instead of the hardcoded Mary prompt. It resumes
 * the conversation's active workflow_run when one is awaiting_user (state.ts),
 * else starts a fresh one seeded with the prior turns. Text/chips/<document> are
 * re-encoded as the SAME `{ token }` / `{ artifact }` SSE frames the hardcoded
 * path emits, so the client renders them with no change; a HALT adds an
 * `{ awaiting }` frame for the "Mary is waiting on you" affordance.
 *
 * Persistence (messages), usage metering, and builder-note capture mirror the
 * hardcoded flush so budget/notes/attachments/@refer keep working on this path.
 * On any engine failure the stream still closes with an honest, visible bubble —
 * never a blank.
 */
function engineChatResponse(params: EngineChatParams): Response {
  const { provider, model, free, messages, technique, conversationId, persist } = params;
  const skillSlug = params.skillSlug ?? BRAINSTORMING_SLUG;
  const meter = isPersistenceEnabled();
  // Only drive the DB-backed run store when we have a real conversation to bind
  // it to; otherwise the engine runs a single, unpersisted session.
  const enginePersistence = isPersistenceEnabled() && conversationId !== undefined;
  const engineConvId = conversationId ?? 'ephemeral';

  const last = messages[messages.length - 1];
  const input = last?.content ?? '';
  const inputParts: MsgPart[] | undefined =
    last?.role === 'user' && last.parts && last.parts.length > 0 ? last.parts : undefined;
  const history = toEngineHistory(messages.slice(0, -1));
  const promptText = meter ? messages.map((m) => m.content).join('\n') : '';

  const encoder = new TextEncoder();
  const send = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

  const snagMessage = `${providerLabel(provider)} hit a snag — try again or switch model.`;
  const emptyMessage = `${providerLabel(provider)} returned an empty response — try again or switch model.`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantRaw = '';
      let awaitingRunId: string | null | undefined;
      let errored = false;
      // Never let a stream-write throw abort the whole handler — that would
      // strand the client with no [DONE] (empty output + hang).
      const enqueue = (obj: unknown) => {
        try {
          controller.enqueue(send(obj));
        } catch {
          /* controller already closed/errored */
        }
      };

      try {
        try {
          for await (const ev of runWorkflow({
            conversationId: engineConvId,
            skillSlug,
            agentSlug: params.agentSlug,
            input,
            inputParts,
            history,
            technique,
            // Fresh runs re-derive phase from the latest user message so a full
            // session still reaches converge/finalize (the engine finalizes each
            // turn, so phase isn't carried in run state across turns).
            phase: inferPhase(input),
            provider,
            model,
            deps: { persistence: enginePersistence },
          })) {
            if (ev.type === 'text') {
              if (ev.delta) {
                assistantRaw += ev.delta;
                enqueue({ token: ev.delta });
              }
            } else if (ev.type === 'checkpoint') {
              // The HALT question is Mary's user-facing turn — stream it as text.
              if (ev.prompt) {
                assistantRaw += ev.prompt;
                enqueue({ token: ev.prompt });
              }
              awaitingRunId = ev.runId;
            } else if (ev.type === 'error') {
              errored = true;
              if (!assistantRaw.trim()) {
                assistantRaw = ev.message || snagMessage;
                enqueue({ token: assistantRaw });
              }
            }
            // progress/tool/tool_result/done → not surfaced into the bubble.
          }
        } catch (err) {
          // Any throw out of the engine (provider/tool/serialization). Surface an
          // honest, VISIBLE bubble — never a silent empty stream.
          console.error(
            '[chat] engine run failed',
            err instanceof Error ? err.name : typeof err,
          );
          errored = true;
          if (!assistantRaw.trim()) {
            assistantRaw = snagMessage;
            enqueue({ token: assistantRaw });
          }
        }

        // Parse the accumulated reply (pure, no DB) so the empty-guarantee and
        // persistence both see the real content, regardless of metering.
        const { text: afterDoc, document } = parseDocument(assistantRaw);
        const { text, chips } = parseChips(afterDoc);

        // GUARANTEE a visible reply. A tiny free model can return an empty
        // completion; without this the client would get zero tokens (blank).
        if (!assistantRaw.trim()) {
          assistantRaw = errored ? snagMessage : emptyMessage;
          enqueue({ token: assistantRaw });
        }

        // Persist the turn (DB on + a real conversation). A DB failure only skips
        // persistence — the reply already streamed.
        if (!errored && persist && params.userTurn !== undefined && conversationId !== undefined) {
          try {
            if (text || chips.length > 0) {
              await transaction([
                buildAppendMessageQuery({
                  conversationId,
                  role: 'user',
                  content: params.userTurn,
                  attachments: params.userAttachments,
                }),
                buildAppendMessageQuery({ conversationId, role: 'assistant', content: text, chips }),
              ]);
            }
            if (document) {
              const artifact = await createVersion({
                conversationId,
                title: document.title,
                markdown: document.body,
              });
              enqueue({ artifact: { id: artifact.id } });
            }
          } catch (err) {
            console.error('[chat] engine persist turn failed', err instanceof Error ? err.name : err);
          }
        }

        // Metering + builder-note outbox (DB on). Never on an errored/empty turn.
        if (meter && !errored && text) {
          if (!free) {
            try {
              const tokensIn = tokensOrEstimate(null, promptText);
              const tokensOut = tokensOrEstimate(null, assistantRaw);
              const costEst = estimateCost({ provider, model, tokensIn, tokensOut });
              await insertUsage({ provider, model, tokensIn, tokensOut, costEst });
            } catch (err) {
              console.error('[chat] engine usage write failed', err instanceof Error ? err.name : typeof err);
            }
          }
          try {
            const excerpts = extractBuilderNotes(text);
            for (const excerpt of excerpts) {
              await insertBuilderNote({ conversationId: conversationId ?? null, excerpt });
            }
          } catch (err) {
            console.error('[chat] engine builder-note write failed', err instanceof Error ? err.name : typeof err);
          }
        }

        // Signal the awaiting_user checkpoint AFTER the turn so the client can
        // show the "Mary is waiting on you" affordance.
        if (awaitingRunId !== undefined) {
          enqueue({ awaiting: { runId: awaitingRunId } });
        }
      } catch (err) {
        // Last-ditch: anything unexpected in the flush must still close cleanly.
        console.error('[chat] engine stream failed', err instanceof Error ? err.name : typeof err);
      } finally {
        // ALWAYS terminate the SSE stream — the client waits for [DONE].
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch {
          /* already closed */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

export async function POST(req: NextRequest) {
  const auth = await authContext(req);
  if (!auth) {
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

  // Multi mode: a user may only post to a conversation they own. Verify once,
  // up front — a foreign or missing id is rejected before any persistence or
  // model call. Shared mode (auth.userId === null) skips this (unchanged).
  if (auth.userId !== null && conversationId !== undefined && isPersistenceEnabled()) {
    const owned = await getConversation(conversationId, undefined, auth.userId);
    if (!owned) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

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
      const { context } = await resolveReferences(references, undefined, auth.userId);
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

  // Epic D — flag-gated agent→command tree launch. Default (PLAYGROUND_TREE
  // unset/off) IGNORES any launch descriptor entirely, so the request is
  // byte-identical to today. Only when PLAYGROUND_TREE=on and a valid
  // {agentSlug, code} descriptor is present do we route the launch:
  //   verified skill/prompt → the engine (reusing engineChatResponse, the C-4
  //   path); unverified → an honest degrade bubble + a builder note (FR-43).
  const agentSlug = typeof body.agentSlug === 'string' ? body.agentSlug : undefined;
  const code = typeof body.code === 'string' ? body.code : undefined;
  if (process.env.PLAYGROUND_TREE === 'on' && agentSlug && code) {
    const plan = planLaunch(agentSlug, code);
    if (plan && plan.kind === 'degrade') {
      // Honest, VISIBLE bubble (contains "noted for the builder" → B-5 capture).
      // Persist the builder note server-side when a DB is configured; with no DB
      // the client extracts it from the streamed bubble into localStorage (B-5).
      if (isPersistenceEnabled()) {
        try {
          await insertBuilderNote({ conversationId: conversationId ?? null, excerpt: plan.message });
        } catch (err) {
          console.error('[chat] degrade note write failed', err instanceof Error ? err.name : typeof err);
        }
      }
      return honestBubbleResponse(plan.message);
    }
    if (plan && (plan.kind === 'skill' || plan.kind === 'prompt')) {
      // skill → run that skill; prompt → run persona-only (skillSlug = agentSlug)
      // and the client already posted the prompt text as the launch turn.
      return engineChatResponse({
        provider: provider as Provider,
        model,
        free,
        messages: modelMessages,
        technique,
        conversationId,
        persist,
        userTurn,
        userAttachments,
        skillSlug: plan.kind === 'skill' ? plan.skillSlug : plan.agentSlug,
        agentSlug: plan.agentSlug,
      });
    }
    // plan === null (unknown agent/code) → fall through to the normal path.
  }

  // Flag-gated engine path. Default (unset/off) falls straight through to the
  // hardcoded Mary path below — byte-identical to today. Only when
  // PLAYGROUND_ENGINE=on does the brainstorming conversation run through the
  // runtime engine (with usage/budget/notes/attachments/@refer preserved).
  if (process.env.PLAYGROUND_ENGINE === 'on') {
    return engineChatResponse({
      provider: provider as Provider,
      model,
      free,
      messages: modelMessages,
      technique,
      conversationId,
      persist,
      userTurn,
      userAttachments,
    });
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
