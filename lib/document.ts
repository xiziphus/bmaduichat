/**
 * Document protocol parser — the browser equivalent of finalize.md writing an
 * artifact. At wrap-up Mary wraps the durable synthesis in a sentinel:
 *
 *   <document title="…">…markdown…</document>
 *
 * Mirrors how <chips> works (see lib/chips.ts):
 * - well-formed  → visible chat text (block stripped) + a {title, body} document
 * - absent       → text unchanged, no document
 * - malformed    → block/fragment stripped (raw tag never visible), no document
 *
 * The body is markdown; it is rendered live in the doc pane and, when a database
 * is configured, persisted as a versioned `artifacts` row.
 */

export type PlaygroundDocument = { title: string | null; body: string };
export type ParsedDocumentReply = { text: string; document: PlaygroundDocument | null };

// A complete, closed block. `title` attribute is optional.
const DOCUMENT_BLOCK = /<document(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/document>/i;
const DOCUMENT_BLOCK_G = /<document(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/document>/gi;
// A just-opened tag whose close hasn't streamed yet (mid-stream safety).
const DOCUMENT_OPEN = /<document(?:\s+title="([^"]*)")?\s*>/i;
const DANGLING_DOC_OPEN = /<document(?:\s[\s\S]*)?$/i;

/**
 * Split a completed reply into its visible chat text and (if present) the
 * document. Only a fully-closed block with a non-empty body counts as a
 * document; anything else is stripped so the raw tag never reaches the bubble.
 */
export function parseDocument(raw: string): ParsedDocumentReply {
  const match = raw.match(DOCUMENT_BLOCK);
  let document: PlaygroundDocument | null = null;
  if (match) {
    const body = match[2].trim();
    if (body) {
      const title = match[1] ? match[1].trim() : null;
      document = { title: title || null, body };
    }
  }
  const text = raw
    .replace(DOCUMENT_BLOCK_G, '')
    .replace(DANGLING_DOC_OPEN, '')
    .trim();
  return { text, document };
}

/**
 * While streaming, the partial document body to show live in the doc pane, or
 * null when no <document …> has opened yet. Returns everything after the open
 * tag up to </document> (or end-of-stream so the doc grows as tokens arrive).
 */
export function streamingDocumentBody(raw: string): string | null {
  const open = raw.match(DOCUMENT_OPEN);
  if (!open || open.index === undefined) return null;
  const afterOpen = raw.slice(open.index + open[0].length);
  const closeIdx = afterOpen.search(/<\/document>/i);
  const body = closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx);
  return body;
}

/** The document title mid-stream (from the open tag), if any. */
export function streamingDocumentTitle(raw: string): string | null {
  const open = raw.match(DOCUMENT_OPEN);
  const title = open?.[1]?.trim();
  return title ? title : null;
}

/**
 * Remove any complete document block AND a dangling open fragment from text
 * destined for the chat bubble. Complement to chips' visibleWhileStreaming.
 */
export function stripDocumentForBubble(raw: string): string {
  return raw.replace(DOCUMENT_BLOCK_G, '').replace(DANGLING_DOC_OPEN, '');
}
