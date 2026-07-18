/**
 * Shared types for the free multi-provider web-search fallback chain.
 *
 * A `SearchProvider` is one link in the pecking order (see `lib/websearch`):
 * keyless providers (DuckDuckGo, Wikipedia) are always `available()`, key-optional
 * FREE tiers (Brave, Tavily) light up only when their env key is set. The chain
 * tries them in order; the first to return ≥1 result wins.
 *
 * No SDKs — every provider is a thin `fetch` call (matches `lib/llm.ts`), and no
 * provider ever reaches a PAID API.
 */

/** One normalized hit. `url` is optional (some keyless answers have no link). */
export type SearchResult = { title: string; snippet: string; url?: string };

/** One link in the fallback chain. `search` receives a per-provider AbortSignal. */
export type SearchProvider = {
  /** Stable id used in `WEB_SEARCH_ORDER` and logs. */
  name: string;
  /** True when this provider can be tried (keyless → always; keyed → key present). */
  available(): boolean;
  /** Run the query; resolve to hits (may be empty) or throw on failure/timeout. */
  search(query: string, signal: AbortSignal): Promise<SearchResult[]>;
};
