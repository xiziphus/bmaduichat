/**
 * Conversations repository. Server-side only.
 *
 * Every function takes an optional `exec` executor (defaulting to the real Neon
 * query helper) so unit tests can assert SQL/param shape against a mock without
 * a live database. Callers must gate on isPersistenceEnabled() before invoking.
 */
import { query, type QueryFn } from '@/lib/db';

export type ConversationSummary = {
  id: string;
  title: string;
  created: string;
  archived: boolean;
};

export type Conversation = {
  id: string;
  title: string | null;
  agent_slug: string;
  created: string;
  archived: boolean;
};

/**
 * Non-archived conversations, newest first. `title` falls back to the first user
 * message snippet, then to a constant, so the sidebar is useful without renames.
 */
export async function listConversations(exec: QueryFn = query): Promise<ConversationSummary[]> {
  return exec<ConversationSummary>(
    `SELECT c.id,
            COALESCE(
              c.title,
              (SELECT LEFT(m.content, 60)
                 FROM messages m
                WHERE m.conversation_id = c.id AND m.role = 'user'
                ORDER BY m.created ASC
                LIMIT 1),
              'New conversation'
            ) AS title,
            c.created,
            c.archived
       FROM conversations c
      WHERE c.archived = false
      ORDER BY c.created DESC`,
  );
}

/** Create a new (non-archived) conversation and return the full row. */
export async function createConversation(
  input: { title?: string | null; agentSlug?: string } = {},
  exec: QueryFn = query,
): Promise<Conversation> {
  const rows = await exec<Conversation>(
    `INSERT INTO conversations (title, agent_slug)
          VALUES ($1, $2)
       RETURNING id, title, agent_slug, created, archived`,
    [input.title ?? null, input.agentSlug ?? 'mary'],
  );
  return rows[0];
}

/** Fetch a single conversation by id, or null if it does not exist. */
export async function getConversation(
  id: string,
  exec: QueryFn = query,
): Promise<Conversation | null> {
  const rows = await exec<Conversation>(
    `SELECT id, title, agent_slug, created, archived
       FROM conversations
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Set the archived flag on a conversation (used by PATCH). Never deletes. */
export async function setArchived(
  id: string,
  archived: boolean,
  exec: QueryFn = query,
): Promise<Conversation | null> {
  const rows = await exec<Conversation>(
    `UPDATE conversations
        SET archived = $2
      WHERE id = $1
      RETURNING id, title, agent_slug, created, archived`,
    [id, archived],
  );
  return rows[0] ?? null;
}
