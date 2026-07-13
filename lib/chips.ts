/**
 * Chips protocol parser.
 * Mary ends replies with: <chips>["…","…"]</chips>
 * - well-formed  → visible text (ALL blocks stripped) + chips array (from the last valid block)
 * - absent       → text unchanged, no chips
 * - malformed    → block stripped (raw tag never visible), no chips, no error
 * Also strips a trailing unterminated "<chips…" fragment (mid-stream safety).
 */

export type ParsedReply = { text: string; chips: string[] };

const CHIPS_BLOCKS = /<chips>([\s\S]*?)<\/chips>/gi;
const DANGLING_OPEN = /<chips(?:>[\s\S]*)?$/i;

function tryParseChips(inner: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(inner);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((c) => typeof c === 'string')
    ) {
      const cleaned = (parsed as string[]).map((c) => c.trim()).filter(Boolean);
      if (cleaned.length > 0) return cleaned;
    }
  } catch {
    // malformed JSON → no chips, no error
  }
  return undefined;
}

export function parseChips(raw: string): ParsedReply {
  let chips: string[] = [];
  for (const match of raw.matchAll(CHIPS_BLOCKS)) {
    const parsed = tryParseChips(match[1]);
    if (parsed) chips = parsed; // last valid block wins
  }
  const text = raw
    .replace(CHIPS_BLOCKS, '')
    .replace(DANGLING_OPEN, '')
    .trimEnd();
  return { text, chips };
}

/**
 * While streaming, hide any partial/complete chips block from the live bubble.
 */
export function visibleWhileStreaming(raw: string): string {
  const idx = raw.toLowerCase().indexOf('<chips');
  return idx === -1 ? raw : raw.slice(0, idx).trimEnd();
}
