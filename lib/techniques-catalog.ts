/**
 * Server-only technique catalog. Loads the FULL BMad brainstorming catalog from
 * brain-methods.csv (via lib/bmad-source.ts, which reads the committed file at
 * runtime) and shapes each row into a `Technique`.
 *
 * This module imports `fs` transitively — never import it from a client
 * component. The browser gets the catalog over GET /api/techniques.
 */

import { getBrainMethods } from './bmad-source';
import { categoryEmoji, slugify, type Technique } from './techniques';

let cache: Technique[] | null = null;

/** The full technique catalog (~108 entries), read once per cold start. */
export function getTechniques(): Technique[] {
  if (!cache) {
    cache = getBrainMethods().map((m) => ({
      id: slugify(m.name),
      name: m.name,
      category: m.category,
      gist: m.description, // verbatim from the CSV
      emoji: categoryEmoji(m.category),
    }));
  }
  return cache;
}

export function getTechnique(id: string): Technique | undefined {
  return getTechniques().find((t) => t.id === id);
}
