/**
 * Messages repository. Server-side only.
 *
 * Optional `exec` executor lets tests assert SQL/param shape against a mock.
 * Callers must gate on isPersistenceEnabled() before invoking.
 */
import { query, type QueryFn, type TxQuery } from '@/lib/db';
import type { AttachmentMeta } from '@/lib/attachments';

export type Message = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  chips: string[] | null;
  attachments: AttachmentMeta[] | null;
  created: string;
};

export type MessageInput = {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  chips?: string[] | null;
  /** Lightweight metadata only (filename/mime/size) — never the binary. */
  attachments?: AttachmentMeta[] | null;
};

/**
 * Full message thread for a conversation, oldest first. Ordered by the monotonic
 * `seq` — NOT `created` — so a user+assistant pair inserted in one transaction
 * (identical now() timestamp) still sorts in insertion order.
 */
export async function listMessages(
  conversationId: string,
  exec: QueryFn = query,
): Promise<Message[]> {
  return exec<Message>(
    `SELECT id, conversation_id, role, content, chips_json AS chips, attachments, created
       FROM messages
      WHERE conversation_id = $1
      ORDER BY seq ASC`,
    [conversationId],
  );
}

/** Build a parametrized INSERT for one message (for use inside a transaction). */
export function buildAppendMessageQuery(input: MessageInput): TxQuery {
  const chips =
    input.chips && input.chips.length > 0 ? JSON.stringify(input.chips) : null;
  const attachments =
    input.attachments && input.attachments.length > 0
      ? JSON.stringify(input.attachments)
      : null;
  return {
    text: `INSERT INTO messages (conversation_id, role, content, chips_json, attachments)
                VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    params: [input.conversationId, input.role, input.content, chips, attachments],
  };
}

/** Append one message. chips are stored as jsonb (null when none). */
export async function appendMessage(
  input: MessageInput,
  exec: QueryFn = query,
): Promise<Message> {
  const { text, params } = buildAppendMessageQuery(input);
  const rows = await exec<Message>(
    `${text}
       RETURNING id, conversation_id, role, content, chips_json AS chips, attachments, created`,
    params,
  );
  return rows[0];
}
