/**
 * Client-safe technique primitives: the shared `Technique` shape plus the pure
 * helpers the browser needs (slug, per-category emoji, random draw).
 *
 * NOTE: this file must never import `fs` or `lib/bmad-source` — it is bundled
 * into the client. The actual catalog is loaded server-side from BMad's
 * brain-methods.csv (see lib/techniques-catalog.ts) and reaches the browser
 * over the authed GET /api/techniques route.
 */

export type Technique = {
  id: string;
  name: string;
  category: string;
  gist: string;
  emoji: string;
};

/** Stable url/id slug for a technique name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The CSV has no per-technique icon, so techniques inherit a stable emoji from
// their category (brain-icons.json only carries category SVG glyphs).
const CATEGORY_EMOJI: Record<string, string> = {
  collaborative: '🤝',
  deep: '🔍',
  structured: '🧩',
  quantum: '⚛️',
  speculative_future: '🔮',
  biomimetic: '🌿',
  constraint: '⛓️',
  wild: '⚡',
  cultural: '🌍',
  theatrical: '🎭',
  absurdist: '🤪',
  introspective_delight: '🧘',
  creative: '🎨',
};

export function categoryEmoji(category: string): string {
  return CATEGORY_EMOJI[category] ?? '💡';
}

/**
 * Draw two distinct techniques at random from `pool`. When `excluding` (the
 * currently shown pair's ids) is given, neither drawn technique may be in it —
 * so the cycle button never re-shows the current pair.
 */
export function drawTwo(pool: Technique[], excluding?: string[]): [Technique, Technique] {
  const exclude = new Set(excluding ?? []);
  const avail = pool.filter((t) => !exclude.has(t.id));

  if (avail.length >= 2) {
    const i = Math.floor(Math.random() * avail.length);
    let j = Math.floor(Math.random() * (avail.length - 1));
    if (j >= i) j += 1;
    return [avail[i], avail[j]];
  }

  // Over-excluded. Respect the exclusion as far as possible: keep the one
  // non-excluded technique, then top up from the excluded remainder.
  if (avail.length === 1) {
    const first = avail[0];
    const rest = pool.filter((t) => t.id !== first.id);
    const second = rest[Math.floor(Math.random() * rest.length)];
    return [first, second];
  }

  // Everything excluded (or a degenerate pool) — nothing to respect.
  const i = Math.floor(Math.random() * pool.length);
  let j = Math.floor(Math.random() * (pool.length - 1));
  if (j >= i) j += 1;
  return [pool[i], pool[j]];
}
