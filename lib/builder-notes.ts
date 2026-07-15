/**
 * Builder notes — interim slice of goal 4.
 *
 * When a finalized Mary reply admits a limit, the persona says the thing is
 * "noted for the builder" (see HONEST_LIMITS in lib/mary.ts). This helper pulls
 * the sentence(s) carrying that phrase so the UI can collect them. Storage +
 * rendering live in the ChatPane; this module is pure and unit-tested.
 */

export type BuilderNote = { excerpt: string; ts: number };

export const BUILDER_NOTES_KEY = 'playground.builderNotes';

const PHRASE = /noted for the builder/i;

// Common abbreviations whose trailing period must not end a sentence.
const ABBR = /\b(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Prof)\.$/i;

/** Split prose into sentences, tolerant of a few abbreviations and ellipses. */
function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let buf = '';
  const tokens = text.split(/(?<=[.!?])\s+/);
  for (const tok of tokens) {
    buf = buf ? `${buf} ${tok}` : tok;
    // Keep accumulating when the break was really an abbreviation/ellipsis.
    if (ABBR.test(buf.trimEnd()) || /\.\.\.$/.test(buf.trimEnd())) continue;
    parts.push(buf);
    buf = '';
  }
  if (buf) parts.push(buf);
  return parts;
}

/**
 * Every sentence in `text` that contains "noted for the builder"
 * (case-insensitive), trimmed. Empty array when the phrase is absent.
 */
export function extractBuilderNotes(text: string): string[] {
  if (!text || !PHRASE.test(text)) return [];
  return splitSentences(text)
    .map((s) => s.trim())
    .filter((s) => PHRASE.test(s));
}
