/**
 * The FREE web-search providers, in one place. Each is a thin `fetch` call (no
 * SDKs, matching `lib/llm.ts`) exposing the `SearchProvider` contract so the
 * chain (`lib/websearch`) can try them in a pecking order and so each `search`
 * stays individually unit-testable (mock `fetch` or call it directly).
 *
 * Pecking order rationale:
 *   - Brave / Tavily — key-optional FREE tiers; better SERP-style results, so
 *     they go FIRST when their key is set. `available()` gates on the env key.
 *   - DuckDuckGo / Wikipedia — KEYLESS, always available; the always-on floor.
 *
 * NO PAID APIs — Brave/Tavily are free tiers and only used if the builder opted
 * in with a key; the keyless pair needs nothing.
 */
import type { SearchProvider, SearchResult } from './types';

/** Strip any HTML tags a provider embeds in a snippet (e.g. Wikipedia). */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/* ---------------- Brave Search (key-optional FREE tier) ---------------- */

/**
 * Brave Search API — free tier. Header `X-Subscription-Token: BRAVE_API_KEY`.
 * Results live under `web.results[]` as `{ title, description, url }`.
 */
export const braveProvider: SearchProvider = {
  name: 'brave',
  available: () => !!process.env.BRAVE_API_KEY,
  async search(query, signal): Promise<SearchResult[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': process.env.BRAVE_API_KEY ?? '',
      },
    });
    if (!res.ok) throw new Error(`brave: HTTP ${res.status}`);
    const data = (await res.json()) as {
      web?: { results?: { title?: unknown; description?: unknown; url?: unknown }[] };
    };
    const rows = data.web?.results ?? [];
    return rows
      .map((r) => ({
        title: stripHtml(asString(r.title)),
        snippet: stripHtml(asString(r.description)),
        url: asString(r.url) || undefined,
      }))
      .filter((r) => r.title || r.snippet);
  },
};

/* ---------------- Tavily (key-optional FREE tier) ---------------- */

/**
 * Tavily Search API — free tier. POST with `api_key` in the body; results under
 * `results[]` as `{ title, content, url }`.
 */
export const tavilyProvider: SearchProvider = {
  name: 'tavily',
  available: () => !!process.env.TAVILY_API_KEY,
  async search(query, signal): Promise<SearchResult[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY ?? '',
        query,
        max_results: 5,
      }),
    });
    if (!res.ok) throw new Error(`tavily: HTTP ${res.status}`);
    const data = (await res.json()) as {
      results?: { title?: unknown; content?: unknown; url?: unknown }[];
    };
    const rows = data.results ?? [];
    return rows
      .map((r) => ({
        title: stripHtml(asString(r.title)),
        snippet: stripHtml(asString(r.content)),
        url: asString(r.url) || undefined,
      }))
      .filter((r) => r.title || r.snippet);
  },
};

/* ---------------- DuckDuckGo Instant Answer (keyless) ---------------- */

type DdgTopic = { Text?: unknown; FirstURL?: unknown; Topics?: DdgTopic[] };

/** Flatten DDG's nested RelatedTopics (some entries are `{ Topics: [...] }`). */
function flattenDdgTopics(topics: DdgTopic[]): SearchResult[] {
  const out: SearchResult[] = [];
  for (const t of topics) {
    if (Array.isArray(t.Topics)) {
      out.push(...flattenDdgTopics(t.Topics));
      continue;
    }
    const text = stripHtml(asString(t.Text));
    if (!text) continue;
    out.push({
      // DDG puts a "Title — description" style string in Text; the head reads as
      // a title, the whole thing as the snippet.
      title: text.split(' - ')[0].slice(0, 120),
      snippet: text,
      url: asString(t.FirstURL) || undefined,
    });
  }
  return out;
}

/**
 * DuckDuckGo Instant Answer — keyless JSON. Returns limited "instant answers"
 * (an Abstract + RelatedTopics), NOT a full SERP — that's expected and fine as
 * part of the floor.
 */
export const ddgProvider: SearchProvider = {
  name: 'ddg',
  available: () => true,
  async search(query, signal): Promise<SearchResult[]> {
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`ddg: HTTP ${res.status}`);
    const data = (await res.json()) as {
      AbstractText?: unknown;
      AbstractURL?: unknown;
      Heading?: unknown;
      RelatedTopics?: DdgTopic[];
    };
    const out: SearchResult[] = [];
    const abstract = stripHtml(asString(data.AbstractText));
    if (abstract) {
      out.push({
        title: stripHtml(asString(data.Heading)) || query,
        snippet: abstract,
        url: asString(data.AbstractURL) || undefined,
      });
    }
    if (Array.isArray(data.RelatedTopics)) {
      out.push(...flattenDdgTopics(data.RelatedTopics));
    }
    return out;
  },
};

/* ---------------- Wikipedia (keyless) ---------------- */

/**
 * Wikipedia search — keyless MediaWiki API (`list=search`). Reliable floor. The
 * snippet comes back with HTML highlight markup, which we strip.
 */
export const wikipediaProvider: SearchProvider = {
  name: 'wikipedia',
  available: () => true,
  async search(query, signal): Promise<SearchResult[]> {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srlimit', '5');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`wikipedia: HTTP ${res.status}`);
    const data = (await res.json()) as {
      query?: { search?: { title?: unknown; snippet?: unknown }[] };
    };
    const rows = data.query?.search ?? [];
    return rows
      .map((r) => {
        const title = stripHtml(asString(r.title));
        return {
          title,
          snippet: stripHtml(asString(r.snippet)),
          url: title
            ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
            : undefined,
        };
      })
      .filter((r) => r.title || r.snippet);
  },
};

/** All providers keyed by name — the source of truth for order resolution. */
export const PROVIDERS: Record<string, SearchProvider> = {
  brave: braveProvider,
  tavily: tavilyProvider,
  ddg: ddgProvider,
  wikipedia: wikipediaProvider,
};

/** Default pecking order: keyed FREE tiers first, then the keyless floor. */
export const DEFAULT_ORDER: readonly string[] = ['brave', 'tavily', 'ddg', 'wikipedia'];
