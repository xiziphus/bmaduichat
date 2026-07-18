import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openRouterModels, modelForProvider, streamChat, ProviderError } from '@/lib/llm';

/* ---------------- openRouterModels() — the ordered fallback chain ---------------- */

describe('openRouterModels — pecking order of free models', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_MODELS', '');
    vi.stubEnv('OPENROUTER_MODEL', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses OPENROUTER_MODELS csv order verbatim when set', () => {
    vi.stubEnv('OPENROUTER_MODELS', 'a/one:free, b/two:free ,c/three:free');
    expect(openRouterModels()).toEqual(['a/one:free', 'b/two:free', 'c/three:free']);
  });

  it('falls back to the built-in free default list when nothing is set', () => {
    const models = openRouterModels();
    expect(models.length).toBeGreaterThan(1);
    expect(models[0]).toBe('meta-llama/llama-3.3-70b-instruct:free');
    // Every default is a free model.
    expect(models.every((m) => m.endsWith(':free'))).toBe(true);
  });

  it('prepends OPENROUTER_MODEL to the default list, deduped', () => {
    // Choosing a default as the primary must not duplicate it further down.
    vi.stubEnv('OPENROUTER_MODEL', 'meta-llama/llama-3.3-70b-instruct:free');
    const models = openRouterModels();
    expect(models[0]).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(models.filter((m) => m === 'meta-llama/llama-3.3-70b-instruct:free')).toHaveLength(1);
  });

  it('puts a custom OPENROUTER_MODEL first, then the defaults as fallbacks', () => {
    vi.stubEnv('OPENROUTER_MODEL', 'custom/primary:free');
    const models = openRouterModels();
    expect(models[0]).toBe('custom/primary:free');
    expect(models).toContain('meta-llama/llama-3.3-70b-instruct:free');
  });

  it('dedupes OPENROUTER_MODELS preserving first-seen order', () => {
    vi.stubEnv('OPENROUTER_MODELS', 'x/a:free,y/b:free,x/a:free');
    expect(openRouterModels()).toEqual(['x/a:free', 'y/b:free']);
  });

  it('is never empty even for a whitespace/comma-only OPENROUTER_MODELS', () => {
    vi.stubEnv('OPENROUTER_MODELS', '  , ,');
    expect(openRouterModels().length).toBeGreaterThan(0);
  });

  it('modelForProvider(openrouter) returns the primary (first of the chain)', () => {
    vi.stubEnv('OPENROUTER_MODELS', 'first/model:free,second/model:free');
    expect(modelForProvider('openrouter')).toBe('first/model:free');
  });
});

/* ---------------- connect-time fallback loop ---------------- */

async function readAll(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out += value;
  }
  return out;
}

function sseBody(content: string): string {
  return `data: {"choices":[{"delta":{"content":${JSON.stringify(content)}}}]}\n\ndata: [DONE]\n\n`;
}

describe('OpenRouter connect-time fallback loop', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubEnv('OPENROUTER_MODELS', 'modelA,modelB,modelC');
    vi.stubEnv('OPENROUTER_MODEL', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('falls to the next model when the first returns a non-ok status (429 → 200)', async () => {
    const bodies: Array<{ model: string }> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push({ model: body.model });
      if (bodies.length === 1) return new Response(null, { status: 429 });
      return new Response(sseBody('hello world'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { stream } = await streamChat('openrouter', 'sys', [{ role: 'user', content: 'hi' }]);
    const text = await readAll(stream);

    expect(bodies.map((b) => b.model)).toEqual(['modelA', 'modelB']);
    expect(text).toBe('hello world');
  });

  it('falls past a network error (thrown fetch) to the next model', async () => {
    const bodies: Array<{ model: string }> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push({ model: body.model });
      if (bodies.length === 1) throw new Error('ECONNREFUSED');
      return new Response(sseBody('ok'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { stream } = await streamChat('openrouter', 'sys', [{ role: 'user', content: 'hi' }]);
    const text = await readAll(stream);

    expect(bodies.map((b) => b.model)).toEqual(['modelA', 'modelB']);
    expect(text).toBe('ok');
  });

  it('throws the LAST ProviderError when every model fails', async () => {
    const statuses = [429, 500, 503];
    let i = 0;
    const fetchMock = vi.fn(async () => new Response(null, { status: statuses[i++] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      streamChat('openrouter', 'sys', [{ role: 'user', content: 'hi' }]),
    ).rejects.toMatchObject({ provider: 'openrouter', status: 503, kind: 'upstream' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses the first model directly when it responds ok', async () => {
    const bodies: Array<{ model: string }> = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push({ model: body.model });
      return new Response(sseBody('first'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { stream } = await streamChat('openrouter', 'sys', [{ role: 'user', content: 'hi' }]);
    const text = await readAll(stream);

    expect(bodies.map((b) => b.model)).toEqual(['modelA']);
    expect(text).toBe('first');
    expect(ProviderError).toBeDefined();
  });
});
