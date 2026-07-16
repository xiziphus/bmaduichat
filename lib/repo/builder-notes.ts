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
  owner: string | null = null,
): Promise<BuilderNoteRow[]> {
  // Multi mode: only notes tied to a conversation the user owns (INNER JOIN also
  // drops orphan notes with a null conversation_id). Shared mode: unchanged.
  if (owner !== null) {
    const clauses = ['c.user_id = $1'];
    const params: unknown[] = [owner];
    if (status) {
      clauses.push(`n.status = $${params.length + 1}`);
      params.push(status);
    }
    return exec<BuilderNoteRow>(
      `SELECT n.id, n.conversation_id, n.excerpt, n.status, n.created
         FROM builder_notes n
         JOIN conversations c ON c.id = n.conversation_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY n.created DESC`,
      params,
    );
  }
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

/**
 * Flip the given notes to status 'sent' (the consent action). No-op for [].
 * When `owner` is set (multi mode), only notes tied to a conversation the user
 * owns are flipped — a user can't touch another user's notes.
 */
export async function markBuilderNotesSent(
  ids: string[],
  exec: QueryFn = query,
  owner: string | null = null,
): Promise<void> {
  if (ids.length === 0) return;
  if (owner !== null) {
    await exec(
      `UPDATE builder_notes
          SET status = 'sent'
        WHERE id = ANY($1::uuid[])
          AND conversation_id IN (SELECT id FROM conversations WHERE user_id = $2)`,
      [ids, owner],
    );
    return;
  }
  await exec(
    `UPDATE builder_notes
        SET status = 'sent'
      WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}
