/**
 * Free multi-provider web-search fallback chain.
 *
 * Tries providers in a pecking order (env `WEB_SEARCH_ORDER`, else the default:
 * keyed FREE tiers first, then the keyless floor). Each provider gets a short
 * per-provider timeout so a slow one fails fast to the next. The FIRST provider
 * returning ≥1 result WINS; its hits are formatted into a compact numbered text
 * block. If every provider fails / times out / returns empty, we return an
 * honest "no live results" note with `provider: null`.
 *
 * NO PAID APIs — the keyless DuckDuckGo + Wikipedia pair is the always-on floor;
 * Brave/Tavily are key-optional FREE tiers.
 */
import 'server-only';
import type { SearchProvider, SearchResult } from './types';
import { PROVIDERS, DEFAULT_ORDER } from './providers';

export type { SearchProvider, SearchResult } from './types';
export { PROVIDERS, DEFAULT_ORDER } from './providers';

/** Per-provider timeout — a slow provider fails fast so the chain moves on. */
const PER_PROVIDER_TIMEOUT_MS = 6_000;

/** Honest degrade when the whole chain comes up empty. */
export const NO_RESULTS_NOTE =
  "I couldn't get live web results right now — every free search provider was empty or unreachable. Paste any facts or sources you have and I'll fold them in.";

/**
 * Resolve the ordered list of providers to try. Order comes from
 * `WEB_SEARCH_ORDER` (comma-separated names) if set, else `DEFAULT_ORDER`.
 * Unknown names are dropped; providers whose `available()` is false are skipped.
 */
export function resolveChain(
  registry: Record<string, SearchProvider> = PROVIDERS,
): SearchProvider[] {
  const csv = process.env.WEB_SEARCH_ORDER;
  const names =
    csv && csv.trim()
      ? csv.split(',').map((s) => s.trim()).filter(Boolean)
      : [...DEFAULT_ORDER];
  const seen = new Set<string>();
  const chain: SearchProvider[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const p = registry[name];
    if (p && p.available()) chain.push(p);
  }
  return chain;
}

/** Format winning hits into a compact numbered block: `n. title — snippet — url`. */
export function formatResults(results: SearchResult[]): string {
  return results
    .slice(0, 6)
    .map((r, i) => {
      const parts = [r.title || '(untitled)', r.snippet].filter(Boolean);
      const line = parts.join(' — ');
      return r.url ? `${i + 1}. ${line} — ${r.url}` : `${i + 1}. ${line}`;
    })
    .join('\n');
}

/**
 * Run the given provider chain in order, returning the first non-empty result
 * set (formatted) with its provider name. Exposed so tests can inject mock
 * providers. Each provider runs under its own AbortSignal timeout.
 */
export async function runChain(
  query: string,
  chain: SearchProvider[],
): Promise<{ text: string; provider: string | null }> {
  for (const provider of chain) {
    try {
      const results = await provider.search(query, AbortSignal.timeout(PER_PROVIDER_TIMEOUT_MS));
      if (results.length > 0) {
        console.log(`[websearch] answered by "${provider.name}" (${results.length} results)`);
        return { text: formatResults(results), provider: provider.name };
      }
    } catch (err) {
      console.log(`[websearch] provider "${provider.name}" failed: ${(err as Error).message}`);
      // fall through to the next provider
    }
  }
  console.log('[websearch] no provider returned results');
  return { text: NO_RESULTS_NOTE, provider: null };
}

/**
 * The public entry point. Resolves the env-configured chain and runs it. Always
 * functional (keyless floor); returns `{ text, provider }` where `provider` is
 * null only when the whole chain came up empty.
 */
export async function webSearch(
  query: string,
): Promise<{ text: string; provider: string | null }> {
  return runChain(query, resolveChain());
}
