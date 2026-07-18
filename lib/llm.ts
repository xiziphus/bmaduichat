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

/**
 * Built-in fallback chain of known free (`:free`) OpenRouter models. Used when
 * neither `OPENROUTER_MODELS` nor `OPENROUTER_MODEL` narrows the choice. It's
 * fine if some ids 404 upstream — the connect-time fallback loop just skips to
 * the next. All are `:free`, so metering (which reads the primary) stays at 0.
 */
const OPENROUTER_FREE_FALLBACKS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'qwen/qwen-2.5-72b-instruct:free',
];

/**
 * The ordered OpenRouter fallback chain — try the first; if it doesn't respond
 * (rate-limit / error / unavailable) fall to the next at connect time.
 *  - `OPENROUTER_MODELS` (comma-separated), if set, defines the exact order.
 *  - Else start with `OPENROUTER_MODEL` (if set), then append the built-in free
 *    defaults as further fallbacks.
 * Deduped preserving order; never empty.
 */
export function openRouterModels(): string[] {
  const chain: string[] = [];
  const csv = process.env.OPENROUTER_MODELS;
  if (csv && csv.trim()) {
    for (const m of csv.split(',')) {
      const t = m.trim();
      if (t) chain.push(t);
    }
  } else {
    const primary = process.env.OPENROUTER_MODEL?.trim();
    if (primary) chain.push(primary);
    chain.push(...OPENROUTER_FREE_FALLBACKS);
  }
  // Dedupe preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of chain) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  // Never empty (e.g. OPENROUTER_MODELS set to only whitespace/commas).
  if (out.length === 0) out.push(OPENROUTER_FREE_FALLBACKS[0]);
  return out;
}

/** The model id the given provider will use, from env (with documented defaults). */
export function modelForProvider(provider: Provider): string {
  if (provider === 'gemini') return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  // The PRIMARY of the fallback chain — used for display/metering. All free
  // models cost 0, so metering stays correct even when a fallback serves.
  return openRouterModels()[0];
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

/**
 * Connect to OpenRouter, trying each model in the fallback chain at CONNECT
 * time. `buildBody` produces the request body for a candidate model. Returns
 * the first Response that is ok (with a body) — the caller then streams/parses
 * it with that model. On a non-ok status (429 rate-limit, 5xx, 400 model-
 * unavailable, …) or a `providerFetch` network error, the next model is tried.
 * If every model fails, the LAST ProviderError is thrown. Fallback is connect-
 * time only: once tokens flow we cannot switch mid-stream.
 */
async function connectOpenRouterWithFallback(
  apiKey: string,
  buildBody: (model: string) => Record<string, unknown>,
  models: string[],
): Promise<{ res: Response; body: ReadableStream<Uint8Array>; model: string }> {
  let lastError: ProviderError = new ProviderError(
    'openrouter',
    502,
    'unreachable',
    'OpenRouter unreachable',
  );
  for (const model of models) {
    console.log(`[openrouter] trying model: ${model}`);
    let res: Response;
    try {
      res = await providerFetch('openrouter', 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(buildBody(model)),
      });
    } catch (err) {
      if (err instanceof ProviderError) {
        console.error(`[openrouter] model ${model} network error (${err.kind}); trying next`);
        lastError = err;
        continue;
      }
      throw err;
    }
    if (res.ok && res.body) {
      console.log(`[openrouter] using model: ${model}`);
      return { res, body: res.body, model };
    }
    // Never propagate the upstream body — status only.
    res.body?.cancel().catch(() => {});
    console.error(`[openrouter] model ${model} upstream error (${res.status}); trying next`);
    lastError = new ProviderError(
      'openrouter',
      res.status,
      'upstream',
      `OpenRouter upstream error (${res.status})`,
    );
  }
  throw lastError;
}

/* ==========================================================================
 * Native function-calling (tool) support — ENGINE-ONLY, dormant.
 *
 * Everything below is additive and reached ONLY through `streamChatWithTools`
 * and `supportsFunctionCalling`. The live chat path calls `streamChat` (above),
 * whose request bodies are untouched: no `tools`/`functionDeclarations` field is
 * ever added when tools aren't passed. Guard = a distinct entrypoint, so the
 * live behavior is byte-identical.
 * ========================================================================== */

/** One tool exposed to the model, JSON-schema `parameters` (OpenAI/Gemini shape). */
export type ToolSchema = {
  name: string;
  description: string;
  /** JSON Schema object for the tool's arguments. */
  parameters: Record<string, unknown>;
};

/** A tool call the model requested. `args` is the parsed JSON arguments object. */
export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

/**
 * Canonical loop message. The engine's transcript is a `ToolMsg[]`; each provider
 * client serializes it to its own wire format.
 *  - user/assistant text turns
 *  - an assistant turn that requested tools (`toolCalls`)
 *  - a `tool` turn carrying one tool's result (echoed back to the model)
 */
export type ToolMsg =
  | { role: 'user'; content: string; parts?: MsgPart[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

/** The result of one model turn under the tool protocol. */
export type ModelTurn = {
  /** Accumulated user-facing text (may be empty on a pure tool-call turn). */
  text: string;
  /** Tool calls the model requested this turn (empty on a final turn). */
  toolCalls: ToolCall[];
  usage: UsageTokens;
};

/**
 * Per-provider/model function-calling capability. Gemini is always capable.
 * OpenRouter varies by model, so we allowlist known-capable families and honor
 * an explicit `OPENROUTER_TOOLS=true` override. When false, the engine uses the
 * structured-text `<tool>` fallback instead.
 */
const OPENROUTER_TOOL_PATTERNS: RegExp[] = [
  /gpt-4/,
  /gpt-3\.5/,
  /o[13]-/,
  /claude-3/,
  /gemini/,
  /mistral/,
  /mixtral/,
  /llama-3\.[13]/,
  /qwen/,
  /command-r/,
  /deepseek/,
];

export function openrouterSupportsTools(model: string, envOverride?: boolean): boolean {
  if (envOverride) return true;
  const m = (model || '').toLowerCase();
  return OPENROUTER_TOOL_PATTERNS.some((re) => re.test(m));
}

/** True when the given provider/model can drive native function-calling. */
export function supportsFunctionCalling(provider: Provider, model?: string): boolean {
  if (provider === 'gemini') return true;
  const resolved = model ?? modelForProvider('openrouter');
  return openrouterSupportsTools(resolved, process.env.OPENROUTER_TOOLS === 'true');
}

/* ---------------- ToolMsg → provider payloads (pure; exported for tests) -------- */

/** Serialize the canonical transcript into Gemini `contents[]`. */
export function toGeminiContents(messages: ToolMsg[]): unknown[] {
  return messages.map((m) => {
    // Reuse the plain-chat serializer so multimodal parts (images/PDFs) ride the
    // engine transcript identically to the hardcoded path. No parts → byte-
    // identical `[{ text }]`.
    if (m.role === 'user') return { role: 'user', parts: geminiParts(m) };
    if (m.role === 'tool') {
      return {
        role: 'user',
        parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }],
      };
    }
    // assistant
    const parts: unknown[] = [];
    if (m.content) parts.push({ text: m.content });
    for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } });
    if (parts.length === 0) parts.push({ text: '' });
    return { role: 'model', parts };
  });
}

/** Serialize the canonical transcript into OpenRouter (OpenAI-compat) messages. */
export function toOpenRouterMessages(messages: ToolMsg[]): unknown[] {
  return messages.map((m) => {
    // Reuse the plain-chat serializer so multimodal parts ride the engine
    // transcript. No parts → byte-identical `{ role, content: string }`.
    if (m.role === 'user') return openRouterMessage(m);
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    // assistant
    if (m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      };
    }
    return { role: 'assistant', content: m.content };
  });
}

/** Gemini `tools` block from our tool schemas. */
export function toGeminiTools(tools: ToolSchema[]): unknown {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

/** OpenRouter `tools` array from our tool schemas. */
export function toOpenRouterTools(tools: ToolSchema[]): unknown {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/* ---------------- non-streaming (accumulating) tool turn ---------------- */

/** Drain an SSE `data:` payload stream, calling `onPayload` for each line. */
async function drainSse(
  body: ReadableStream<Uint8Array>,
  onPayload: (payload: string) => void,
): Promise<void> {
  const reader = sseDataStream(body).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) onPayload(value);
  }
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * One model turn with the (optional) tool set. Accumulates the full turn —
 * user-facing text plus any function calls — and returns a `ModelTurn`. When
 * `tools` is omitted no tool field is sent (used by the structured-text
 * fallback, which drives tools purely through prompt text).
 *
 * Engine-only. Never on the live chat path.
 */
export async function streamChatWithTools(
  provider: Provider,
  system: string,
  messages: ToolMsg[],
  tools?: ToolSchema[],
  modelOverride?: string,
): Promise<ModelTurn> {
  if (provider === 'gemini') return geminiToolTurn(system, messages, tools, modelOverride);
  if (provider === 'openrouter') return openRouterToolTurn(system, messages, tools, modelOverride);
  throw new ProviderError(provider, 400, 'upstream', `Unknown provider: ${provider satisfies never}`);
}

async function geminiToolTurn(
  system: string,
  messages: ToolMsg[],
  tools: ToolSchema[] | undefined,
  modelOverride?: string,
): Promise<ModelTurn> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('gemini', 500, 'missing-key', 'GEMINI_API_KEY is not set');
  const model = modelOverride || modelForProvider('gemini');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: system }] },
    contents: toGeminiContents(messages),
  };
  if (tools && tools.length > 0) body.tools = toGeminiTools(tools);

  const res = await providerFetch('gemini', url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    res.body?.cancel().catch(() => {});
    throw new ProviderError('gemini', res.status, 'upstream', `Gemini upstream error (${res.status})`);
  }

  const usage: UsageTokens = { tokensIn: null, tokensOut: null };
  let text = '';
  const toolCalls: ToolCall[] = [];
  await drainSse(res.body, (payload) => {
    if (!payload || payload === '[DONE]') return;
    let json: {
      candidates?: { content?: { parts?: { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (typeof p.text === 'string') text += p.text;
      if (p.functionCall && p.functionCall.name) {
        toolCalls.push({
          id: `call_${toolCalls.length}`,
          name: p.functionCall.name,
          args: p.functionCall.args ?? {},
        });
      }
    }
    const um = json.usageMetadata;
    if (um) {
      if (typeof um.promptTokenCount === 'number') usage.tokensIn = um.promptTokenCount;
      if (typeof um.candidatesTokenCount === 'number') usage.tokensOut = um.candidatesTokenCount;
    }
  });
  return { text, toolCalls, usage };
}

async function openRouterToolTurn(
  system: string,
  messages: ToolMsg[],
  tools: ToolSchema[] | undefined,
  modelOverride?: string,
): Promise<ModelTurn> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new ProviderError('openrouter', 500, 'missing-key', 'OPENROUTER_API_KEY is not set');
  // An explicit override pins one model; otherwise walk the free fallback chain.
  const models = modelOverride ? [modelOverride] : openRouterModels();

  const { body: resBody } = await connectOpenRouterWithFallback(
    apiKey,
    (model) => {
      const reqBody: Record<string, unknown> = {
        model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'system', content: system }, ...toOpenRouterMessages(messages)],
      };
      if (tools && tools.length > 0) reqBody.tools = toOpenRouterTools(tools);
      return reqBody;
    },
    models,
  );

  const usage: UsageTokens = { tokensIn: null, tokensOut: null };
  let text = '';
  // Accumulate streamed tool_call fragments keyed by their delta index.
  const acc = new Map<number, { id: string; name: string; args: string }>();
  await drainSse(resBody, (payload) => {
    if (!payload || payload === '[DONE]') return;
    let json: {
      choices?: {
        delta?: {
          content?: string;
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta;
    if (delta?.content) text += delta.content;
    for (const tc of delta?.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      const cur = acc.get(idx) ?? { id: '', name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name = tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      acc.set(idx, cur);
    }
    const u = json.usage;
    if (u) {
      if (typeof u.prompt_tokens === 'number') usage.tokensIn = u.prompt_tokens;
      if (typeof u.completion_tokens === 'number') usage.tokensOut = u.completion_tokens;
    }
  });

  const toolCalls: ToolCall[] = [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, c]) => ({
      id: c.id || `call_${idx}`,
      name: c.name,
      args: safeJsonParse(c.args),
    }))
    .filter((c) => c.name);
  return { text, toolCalls, usage };
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

  // Try each free model in order; the first that responds streams the reply.
  const { body } = await connectOpenRouterWithFallback(
    apiKey,
    (model) => ({
      model,
      stream: true,
      // Ask for a final usage chunk (prompt/completion token counts).
      stream_options: { include_usage: true },
      messages: [{ role: 'system', content: system }, ...messages.map(openRouterMessage)],
    }),
    openRouterModels(),
  );

  const usage: UsageTokens = { tokensIn: null, tokensOut: null };
  const stream = mapTokens(
    sseDataStream(body),
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
