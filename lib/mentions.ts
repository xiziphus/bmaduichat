/**
 * @-mention parsing — client-safe (no server-only imports), so both the composer
 * (ChatPane) and unit tests can use it. The server-side resolution of references
 * to content lives in lib/references.ts.
 */

export type ReferenceType = 'conversation' | 'artifact';

/** A picked reference bound to its row. Content is NEVER carried client-side —
 *  only {type,id} are sent to the server, which resolves the content itself. */
export type Reference = { type: ReferenceType; id: string; title: string };

/**
 * Given the composer text and the caret offset, return the active `@`-mention
 * query being typed (the text after the nearest `@` that starts a token), or
 * null when the caret isn't inside a mention.
 *
 * A mention starts only when `@` is at the start of the text or right after
 * whitespace, and the run up to the caret contains no whitespace (a mention is a
 * single token while being typed).
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const clamped = Math.max(0, Math.min(caret, text.length));
  const upto = text.slice(0, clamped);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  // The char before `@` must be a boundary (start-of-text or whitespace).
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  // A whitespace in the run means the mention token already ended.
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

/** Remove the character range [start, end) from text (used to strip the raw
 *  `@token` once a reference pill is picked). */
export function stripRange(text: string, start: number, end: number): string {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  return text.slice(0, a) + text.slice(b);
}
