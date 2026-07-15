/**
 * Thin fetch-based streaming adapters — no SDKs.
 * Both providers are normalized to a plain text-token ReadableStream<string>.
 * Model names come from env only (with documented defaults); never hardcoded elsewhere.
 */

export type Provider = 'gemini' | 'openrouter';

/**
 * A non-text attachment carried alongside a message's text. Images and PDFs
 * travel as base64 (no data: prefix). Text/markdown docs are NOT parts — they
 * are inlined into `content` client-side, so they work on any model.
 */
export type MsgPart =
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'pdf'; mimeType: string; data: string };

export type Msg = {
  role: 'user' | 'assistant';
  content: string;
  /** Provider-native multimodal parts (images/PDFs). Absent for plain text. */
  parts?: MsgPart[];
};

/* ---------------- provider payload builders (pure; exported for tests) ---------------- */

/**
 * Gemini `contents[].parts` for one message. Byte-identical to the legacy
 * text-only shape (`[{ text }]`) when the message has no attachments.
 */
export function geminiParts(m: Msg): unknown[] {
  const parts: unknown[] = [{ text: m.content }];
  if (m.parts) {
    for (const p of m.parts) {
      parts.push({ inlineData: { mimeType: p.mimeType, data: p.data } });
    }
  }
  return parts;
}

/**
 * One OpenRouter (OpenAI-compat) message. Byte-identical to the legacy shape
 * (`{ role, content: string }`) when there are no attachments; otherwise
 * `content` becomes a parts array with `image_url` / `file` entries.
 */
export function openRouterMessage(m: Msg): { role: string; content: unknown } {
  if (!m.parts || m.parts.length === 0) {
    return { role: m.role, content: m.content };
  }
  const content: unknown[] = [{ type: 'text', text: m.content }];
  for (const p of m.parts) {
    const dataUrl = `data:${p.mimeType};base64,${p.data}`;
    if (p.type === 'image') {
      content.push({ type: 'image_url', image_url: { url: dataUrl } });
    } else {
      content.push({ type: 'file', file: { filename: 'document.pdf', file_data: dataUrl } });
    }
  }
  return { role: m.role, content };
}

export type ProviderErrorKind = 'missing-key' | 'upstream' | 'timeout' | 'unreachable';

export class ProviderError extends Error {
  provider: Provider;
  status: number;
  kind: ProviderErrorKind;
  constructor(provider: Provider, status: number, kind: ProviderErrorKind, message: string) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.kind = kind;
  }
}

const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
};

export function providerLabel(p: Provider): string {
  return PROVIDER_LABEL[p];
}

/** The model id the given provider will use, from env (with documented defaults). */
export function modelForProvider(provider: Provider): string {
  if (provider === 'gemini') return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  return process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
}

/**
 * Provider-reported token counts, captured from the stream tail. Either field is
 * null when the provider didn't report it (caller then falls back to an estimate).
 * The object is mutated as the stream is consumed — read it AFTER the stream drains.
 */
export type UsageTokens = { tokensIn: number | null; tokensOut: number | null };

/** A normalized token stream plus a usage sink filled as the stream is read. */
export type ChatStream = { stream: ReadableStream<string>; usage: UsageTokens };

const UPSTREAM_TIMEOUT_MS = 60_000;

export async function streamChat(
  provider: Provider,
  system: string,
  messages: Msg[],
): Promise<ChatStream> {
  if (provider === 'gemini') return streamGemini(system, messages);
  if (provider === 'openrouter') return streamOpenRouter(system, messages);
  throw new ProviderError(provider, 400, 'upstream', `Unknown provider: ${provider satisfies never}`);
}

/** fetch() wrapper that maps network failures and timeouts to ProviderError. */
async function providerFetch(
  provider: Provider,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ProviderError(
        provider,
        502,
        'timeout',
        `${PROVIDER_LABEL[provider]} timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s`,
      );
    }
    // DNS failure, connection refused, network drop, etc.
    throw new ProviderError(provider, 502, 'unreachable', `${PROVIDER_LABEL[provider]} unreachable`);
  }
}

/* ---------------- SSE line parsing (shared) ---------------- */

/**
 * Pipes an upstream SSE byte stream into a stream of `data:` payload strings.
 * Flushes any final `data:` line that lacks a trailing newline.
 */
function sseDataStream(body: ReadableStream<Uint8Array>): ReadableStream<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  function handleLine(line: string, controller: TransformStreamDefaultController<string>) {
    if (line.startsWith('data:')) {
      controller.enqueue(line.slice(5).trim());
    }
  }

  return body.pipeThrough(
    new TransformStream<Uint8Array, string>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          handleLine(line, controller);
        }
      },
      flush(controller) {
        buffer += decoder.decode(); // drain any partial multi-byte sequence
        const line = buffer.replace(/\r$/, '');
        if (line) handleLine(line, controller);
        buffer = '';
      },
    }),
  );
}

function mapTokens(
  data: ReadableStream<string>,
  extract: (payload: string) => string | undefined,
  usage?: {
    sink: UsageTokens;
    extract: (payload: string) => Partial<UsageTokens> | undefined;
  },
): ReadableStream<string> {
  return data.pipeThrough(
    new TransformStream<string, string>({
      transform(payload, controller) {
        if (!payload || payload === '[DONE]') return;
        // Sniff token usage from the same payload (final chunk carries it). Best
        // effort — a parse miss never affects the text stream.
        if (usage) {
          try {
            const u = usage.extract(payload);
            if (u) {
              if (typeof u.tokensIn === 'number') usage.sink.tokensIn = u.tokensIn;
              if (typeof u.tokensOut === 'number') usage.sink.tokensOut = u.tokensOut;
            }
          } catch {
            /* ignore */
          }
        }
        let token: string | undefined;
        try {
          token = extract(payload);
        } catch {
          return; // skip unparseable keep-alives etc.
        }
        if (token) controller.enqueue(token);
      },
    }),
  );
}

/* ---------------- Gemini ---------------- */

async function streamGemini(system: string, messages: Msg[]): Promise<ChatStream> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError('gemini', 500, 'missing-key', 'GEMINI_API_KEY is not set');
  }
  const model = modelForProvider('gemini');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  const res = await providerFetch('gemini', url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: geminiParts(m),
      })),
    }),
  });

  if (!res.ok || !res.body) {
    // Never propagate the upstream body — status only.
    res.body?.cancel().catch(() => {});
    throw new ProviderError('gemini', res.status, 'upstream', `Gemini upstream error (${res.status})`);
  }

  const usage: UsageTokens = { tokensIn: null, tokensOut: null };
  const stream = mapTokens(
    sseDataStream(res.body),
    (payload) => {
      const json = JSON.parse(payload) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
    },
    {
      sink: usage,
      extract: (payload) => {
        const json = JSON.parse(payload) as {
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const um = json.usageMetadata;
        if (!um) return undefined;
        return { tokensIn: um.promptTokenCount ?? null, tokensOut: um.candidatesTokenCount ?? null };
      },
    },
  );
  return { stream, usage };
}

/* ---------------- OpenRouter ---------------- */

async function streamOpenRouter(system: string, messages: Msg[]): Promise<ChatStream> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new ProviderError('openrouter', 500, 'missing-key', 'OPENROUTER_API_KEY is not set');
  }
  const model = modelForProvider('openrouter');

  const res = await providerFetch('openrouter', 'https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      // Ask for a final usage chunk (prompt/completion token counts).
      stream_options: { include_usage: true },
      messages: [{ role: 'system', content: system }, ...messages.map(openRouterMessage)],
    }),
  });

  if (!res.ok || !res.body) {
    // Never propagate the upstream body — status only.
    res.body?.cancel().catch(() => {});
    throw new ProviderError('openrouter', res.status, 'upstream', `OpenRouter upstream error (${res.status})`);
  }

  const usage: UsageTokens = { tokensIn: null, tokensOut: null };
  const stream = mapTokens(
    sseDataStream(res.body),
    (payload) => {
      const json = JSON.parse(payload) as {
        choices?: { delta?: { content?: string } }[];
      };
      return json.choices?.[0]?.delta?.content ?? undefined;
    },
    {
      sink: usage,
      extract: (payload) => {
        const json = JSON.parse(payload) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const u = json.usage;
        if (!u) return undefined;
        return { tokensIn: u.prompt_tokens ?? null, tokensOut: u.completion_tokens ?? null };
      },
    },
  );
  return { stream, usage };
}
