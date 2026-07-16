/**
 * Server-side reference resolution. The client sends only `{type,id}` pairs; this
 * module resolves them to their actual content (conversation → recent messages;
 * artifact → its markdown) and formats clearly-delimited context blocks that the
 * chat route injects into the model request. Content is NEVER trusted from the
 * client — it is always fetched here.
 *
 * Callers must gate on isPersistenceEnabled() before invoking (resolution needs
 * the DB). The optional `exec` executor lets tests assert behavior against a mock.
 */
import { query, type QueryFn } from '@/lib/db';
import type { Reference, ReferenceType } from '@/lib/mentions';
import { getConversation } from '@/lib/repo/conversations';
import { listMessages } from '@/lib/repo/messages';
import { getById } from '@/lib/repo/artifacts';

export type { Reference, ReferenceType } from '@/lib/mentions';

/** Per-reference character cap before truncation. */
export const PER_REFERENCE_BUDGET = 4000;
/** Overall cap across all injected references for one request. */
export const TOTAL_REFERENCE_BUDGET = 12000;
/** How many trailing messages of a referenced conversation to include. */
export const RECENT_MESSAGE_LIMIT = 12;

export type ResolvedReference = {
  type: ReferenceType;
  id: string;
  title: string;
  available: boolean;
};

/** Validate an unknown value into a clean list of references (drops junk). */
export function parseReferences(input: unknown): Reference[] {
  if (!Array.isArray(input)) return [];
  const out: Reference[] = [];
  const seen = new Set<string>();
  for (const r of input) {
    if (typeof r !== 'object' || r === null) continue;
    const type = (r as { type?: unknown }).type;
    const id = (r as { id?: unknown }).id;
    if ((type !== 'conversation' && type !== 'artifact') || typeof id !== 'string' || !id) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id, title: '' });
  }
  return out;
}

/** Truncate to `max` chars, appending a "(truncated)" marker when cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n…(truncated)`;
}

/** Wrap a resolved reference's content in a bounded, clearly-labeled block. */
export function formatBlock(title: string, type: ReferenceType, body: string): string {
  return `--- Referenced: "@${title}" (${type}) ---\n${body}\n--- end ---`;
}

function unavailableBlock(type: ReferenceType): string {
  return `--- Referenced ${type} unavailable (deleted or not found) — skipped ---`;
}

/**
 * Resolve references to a single injectable context string plus a manifest of
 * what was resolved. Respects a per-reference cap and an overall budget:
 * once the budget is exhausted, remaining references are noted as omitted.
 */
export async function resolveReferences(
  refs: Reference[],
  exec: QueryFn = query,
  owner: string | null = null,
): Promise<{ context: string; resolved: ResolvedReference[] }> {
  const blocks: string[] = [];
  const resolved: ResolvedReference[] = [];
  let remaining = TOTAL_REFERENCE_BUDGET;

  for (const ref of refs) {
    if (remaining <= 0) {
      resolved.push({ type: ref.type, id: ref.id, title: ref.title, available: false });
      blocks.push(`--- Referenced ${ref.type} omitted — reference budget reached ---`);
      continue;
    }
    const allowance = Math.min(PER_REFERENCE_BUDGET, remaining);

    if (ref.type === 'conversation') {
      // Owner-scoped: a user can only @refer their OWN conversations (multi mode).
      const convo = await getConversation(ref.id, exec, owner);
      if (!convo) {
        resolved.push({ type: ref.type, id: ref.id, title: ref.title, available: false });
        blocks.push(unavailableBlock('conversation'));
        continue;
      }
      const title = convo.title ?? 'Untitled conversation';
      const messages = await listMessages(ref.id, exec);
      const recent = messages.slice(-RECENT_MESSAGE_LIMIT);
      const body = recent
        .map((m) => `${m.role === 'user' ? 'User' : 'Mary'}: ${m.content}`)
        .join('\n');
      const block = formatBlock(title, 'conversation', truncate(body, allowance));
      blocks.push(block);
      remaining -= block.length;
      resolved.push({ type: ref.type, id: ref.id, title, available: true });
    } else {
      // Owner-scoped: a user can only @refer artifacts from their own conversations.
      const artifact = await getById(ref.id, exec, owner);
      if (!artifact || !artifact.markdown) {
        resolved.push({ type: ref.type, id: ref.id, title: ref.title, available: false });
        blocks.push(unavailableBlock('artifact'));
        continue;
      }
      const title = artifact.title ?? 'Untitled document';
      const block = formatBlock(title, 'artifact', truncate(artifact.markdown, allowance));
      blocks.push(block);
      remaining -= block.length;
      resolved.push({ type: ref.type, id: ref.id, title, available: true });
    }
  }

  const context = blocks.length > 0 ? blocks.join('\n\n') : '';
  return { context, resolved };
}
