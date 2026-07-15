/**
 * Builder-notes repository — server-side outbox for "noted for the builder"
 * excerpts. Server-side only.
 *
 * Optional `exec` executor lets tests assert SQL/param shape against a mock.
 * Callers must gate on isPersistenceEnabled() before invoking.
 */
import { query, type QueryFn, type TxQuery } from '@/lib/db';

export type BuilderNoteStatus = 'collected' | 'sent';

export type BuilderNoteRow = {
  id: string;
  conversation_id: string | null;
  excerpt: string;
  status: BuilderNoteStatus;
  created: string;
};

export type BuilderNoteInput = {
  conversationId?: string | null;
  excerpt: string;
};

/** Build a parametrized INSERT for one note (status defaults to 'collected'). */
export function buildInsertBuilderNoteQuery(input: BuilderNoteInput): TxQuery {
  return {
    text: `INSERT INTO builder_notes (conversation_id, excerpt)
                VALUES ($1, $2)`,
    params: [input.conversationId ?? null, input.excerpt],
  };
}

/** Insert one builder note (status 'collected'). */
export async function insertBuilderNote(
  input: BuilderNoteInput,
  exec: QueryFn = query,
): Promise<void> {
  const { text, params } = buildInsertBuilderNoteQuery(input);
  await exec(text, params);
}

/**
 * Notes, newest first. When `status` is given, filters to that status; otherwise
 * returns every note (both collected and sent).
 */
export async function listBuilderNotes(
  status: BuilderNoteStatus | undefined,
  exec: QueryFn = query,
): Promise<BuilderNoteRow[]> {
  if (status) {
    return exec<BuilderNoteRow>(
      `SELECT id, conversation_id, excerpt, status, created
         FROM builder_notes
        WHERE status = $1
        ORDER BY created DESC`,
      [status],
    );
  }
  return exec<BuilderNoteRow>(
    `SELECT id, conversation_id, excerpt, status, created
       FROM builder_notes
      ORDER BY created DESC`,
  );
}

/** Flip the given notes to status 'sent' (the consent action). No-op for []. */
export async function markBuilderNotesSent(
  ids: string[],
  exec: QueryFn = query,
): Promise<void> {
  if (ids.length === 0) return;
  await exec(
    `UPDATE builder_notes
        SET status = 'sent'
      WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}
