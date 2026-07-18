import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  runChain,
  resolveChain,
  formatResults,
  webSearch,
  NO_RESULTS_NOTE,
  type SearchProvider,
  type SearchResult,
} from '@/lib/websearch';
import {
  braveProvider,
  tavilyProvider,
  ddgProvider,
  wikipediaProvider,
} from '@/lib/websearch/providers';

/** Build a mock provider with a scripted behavior. */
function mock(
  name: string,
  behavior: 'empty' | 'throw' | SearchResult[],
  available = true,
): SearchProvider {
  return {
    name,
    available: () => available,
    async search() {
      if (behavior === 'throw') throw new Error(`${name} boom`);
      if (behavior === 'empty') return [];
      return behavior;
    },
  };
}

const HIT: SearchResult = { title: 'Kites', snippet: 'A kite is a tethered craft.', url: 'https://ex/k' };

describe('runChain — fallback pecking order', () => {
  it('returns the FIRST provider with ≥1 result and names it', async () => {
    const chain = [mock('a', [HIT]), mock('b', [{ title: 'B', snippet: 'b' }])];
    const r = await runChain('kites', chain);
    expect(r.provider).toBe('a');
    expect(r.text).toContain('Kites');
  });

  it('falls to the next provider when one THROWS', async () => {
    const chain = [mock('a', 'throw'), mock('b', [HIT])];
    const r = await runChain('kites', chain);
    expect(r.provider).toBe('b');
  });

  it('falls to the next provider when one returns EMPTY', async () => {
    const chain = [mock('a', 'empty'), mock('b', [HIT])];
    const r = await runChain('kites', chain);
    expect(r.provider).toBe('b');
  });

  it('returns the honest note with provider=null when ALL fail/empty', async () => {
    const chain = [mock('a', 'throw'), mock('b', 'empty')];
    const r = await runChain('kites', chain);
    expect(r.provider).toBeNull();
    expect(r.text).toBe(NO_RESULTS_NOTE);
  });

  it('handles an empty chain (nothing available) with the honest note', async () => {
    const r = await runChain('kites', []);
    expect(r.provider).toBeNull();
    expect(r.text).toBe(NO_RESULTS_NOTE);
  });
});

describe('formatResults — compact numbered block', () => {
  it('formats title — snippet — url, numbered', () => {
    const out = formatResults([HIT, { title: 'No URL', snippet: 'just text' }]);
    expect(out).toBe('1. Kites — A kite is a tethered craft. — https://ex/k\n2. No URL — just text');
  });

  it('caps at 6 results', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, snippet: 's' }));
    expect(formatResults(many).split('\n')).toHaveLength(6);
  });
});

describe('resolveChain — order from WEB_SEARCH_ORDER, skips unavailable', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses WEB_SEARCH_ORDER when set and drops unknown names', () => {
    vi.stubEnv('WEB_SEARCH_ORDER', 'b,unknown,a');
    const registry = { a: mock('a', 'empty'), b: mock('b', 'empty') };
    expect(resolveChain(registry).map((p) => p.name)).toEqual(['b', 'a']);
  });

  it('skips providers whose available() is false', () => {
    vi.stubEnv('WEB_SEARCH_ORDER', 'a,b');
    const registry = { a: mock('a', 'empty', false), b: mock('b', 'empty', true) };
    expect(resolveChain(registry).map((p) => p.name)).toEqual(['b']);
  });

  it('falls to the default order when WEB_SEARCH_ORDER is unset', () => {
    vi.stubEnv('WEB_SEARCH_ORDER', '');
    // Default: brave, tavily (keyed → unavailable w/o keys), ddg, wikipedia.
    vi.stubEnv('BRAVE_API_KEY', '');
    vi.stubEnv('TAVILY_API_KEY', '');
    expect(resolveChain().map((p) => p.name)).toEqual(['ddg', 'wikipedia']);
  });
});

describe('provider availability gates on env keys', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('brave/tavily are available only with their key; ddg/wikipedia always', () => {
    vi.stubEnv('BRAVE_API_KEY', '');
    vi.stubEnv('TAVILY_API_KEY', '');
    expect(braveProvider.available()).toBe(false);
    expect(tavilyProvider.available()).toBe(false);
    expect(ddgProvider.available()).toBe(true);
    expect(wikipediaProvider.available()).toBe(true);
    vi.stubEnv('BRAVE_API_KEY', 'k');
    vi.stubEnv('TAVILY_API_KEY', 'k');
    expect(braveProvider.available()).toBe(true);
    expect(tavilyProvider.available()).toBe(true);
  });
});

describe('individual providers — parse mocked fetch responses', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubFetch(json: unknown, ok = true) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => json })),
    );
  }

  it('brave maps web.results[]', async () => {
    vi.stubEnv('BRAVE_API_KEY', 'k');
    stubFetch({ web: { results: [{ title: 'T', description: 'D', url: 'https://u' }] } });
    const out = await braveProvider.search('q', AbortSignal.timeout(1000));
    expect(out).toEqual([{ title: 'T', snippet: 'D', url: 'https://u' }]);
  });

  it('tavily maps results[]', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'k');
    stubFetch({ results: [{ title: 'T', content: 'C', url: 'https://u' }] });
    const out = await tavilyProvider.search('q', AbortSignal.timeout(1000));
    expect(out).toEqual([{ title: 'T', snippet: 'C', url: 'https://u' }]);
  });

  it('ddg maps Abstract + flattens RelatedTopics', async () => {
    stubFetch({
      Heading: 'Kite',
      AbstractText: 'A kite flies.',
      AbstractURL: 'https://ddg/kite',
      RelatedTopics: [
        { Text: 'Box kite - a type', FirstURL: 'https://ddg/box' },
        { Topics: [{ Text: 'Sport kite', FirstURL: 'https://ddg/sport' }] },
      ],
    });
    const out = await ddgProvider.search('kite', AbortSignal.timeout(1000));
    expect(out[0]).toEqual({ title: 'Kite', snippet: 'A kite flies.', url: 'https://ddg/kite' });
    expect(out.map((r) => r.url)).toContain('https://ddg/box');
    expect(out.map((r) => r.url)).toContain('https://ddg/sport');
  });

  it('wikipedia strips HTML from snippets and builds article urls', async () => {
    stubFetch({ query: { search: [{ title: 'Kite', snippet: 'A <span>tethered</span> craft' }] } });
    const out = await wikipediaProvider.search('kite', AbortSignal.timeout(1000));
    expect(out[0].snippet).toBe('A tethered craft');
    expect(out[0].url).toBe('https://en.wikipedia.org/wiki/Kite');
  });

  it('providers throw on non-ok HTTP (chain then falls through)', async () => {
    stubFetch({}, false);
    await expect(wikipediaProvider.search('q', AbortSignal.timeout(1000))).rejects.toThrow(/HTTP 500/);
  });
});

describe('webSearch — public entry (keyless floor, always functional)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('runs the env-resolved chain and formats the winner', async () => {
    vi.stubEnv('WEB_SEARCH_ORDER', 'wikipedia');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ query: { search: [{ title: 'Kite', snippet: 'craft' }] } }),
      })),
    );
    const r = await webSearch('kite');
    expect(r.provider).toBe('wikipedia');
    expect(r.text).toContain('Kite');
  });
});
