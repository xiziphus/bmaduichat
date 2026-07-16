/**
 * Conversations repository. Server-side only.
 *
 * Every function takes an optional `exec` executor (defaulting to the real Neon
 * query helper) so unit tests can assert SQL/param shape against a mock without
 * a live database. Callers must gate on isPersistenceEnabled() before invoking.
 *
 * **Per-user isolation (Epic F).** Each read/write takes an `owner` = the logged
 * in user id, or `null` in shared mode. When `null`, the SQL is byte-identical to
 * pre-Epic-F (no user filter) — so shared mode is unchanged. When set, every
 * query is scoped to that owner, and creates stamp `user_id`. Because all child
 * records (messages, artifacts, runs, notes) are reached through a conversation,
 * verifying conversation ownership here is the single isolation choke point.
 */
import { query, type QueryFn } from '@/lib/db';

/** The owning user id to scope to, or null in shared mode (unscoped). */
export type Owner = string | null;

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
 * The effective display title of a conversation: the explicit title, else the
 * first user message snippet, else a constant. Shared by list + search so a
 * conversation is findable/renamable by whatever the sidebar actually shows.
 */
const EFFECTIVE_TITLE = `COALESCE(
              c.title,
              (SELECT LEFT(m.content, 60)
                 FROM messages m
                WHERE m.conversation_id = c.id AND m.role = 'user'
                ORDER BY m.created ASC
                LIMIT 1),
              'New conversation'
            )`;

/**
 * Non-archived conversations, newest first. `title` falls back to the first user
 * message snippet, then to a constant, so the sidebar is useful without renames.
 */
export async function listConversations(
  exec: QueryFn = query,
  owner: Owner = null,
): Promise<ConversationSummary[]> {
  if (owner === null) {
    return exec<ConversationSummary>(
      `SELECT c.id,
              ${EFFECTIVE_TITLE} AS title,
              c.created,
              c.archived
         FROM conversations c
        WHERE c.archived = false
        ORDER BY c.created DESC`,
    );
  }
  return exec<ConversationSummary>(
    `SELECT c.id,
            ${EFFECTIVE_TITLE} AS title,
            c.created,
            c.archived
       FROM conversations c
      WHERE c.archived = false
        AND c.user_id = $1
      ORDER BY c.created DESC`,
    [owner],
  );
}

/**
 * Non-archived conversations whose effective title matches `q` (case-insensitive
 * substring), newest first. Powers the `@`-mention autocomplete. An empty `q`
 * matches everything (returns the most recent, capped by `limit`).
 */
export async function searchConversations(
  q: string,
  limit = 8,
  exec: QueryFn = query,
  owner: Owner = null,
): Promise<ConversationSummary[]> {
  if (owner === null) {
    return exec<ConversationSummary>(
      `SELECT c.id,
              ${EFFECTIVE_TITLE} AS title,
              c.created,
              c.archived
         FROM conversations c
        WHERE c.archived = false
          AND ${EFFECTIVE_TITLE} ILIKE $1
        ORDER BY c.created DESC
        LIMIT $2`,
      [`%${q}%`, limit],
    );
  }
  return exec<ConversationSummary>(
    `SELECT c.id,
            ${EFFECTIVE_TITLE} AS title,
            c.created,
            c.archived
       FROM conversations c
      WHERE c.archived = false
        AND c.user_id = $3
        AND ${EFFECTIVE_TITLE} ILIKE $1
      ORDER BY c.created DESC
      LIMIT $2`,
    [`%${q}%`, limit, owner],
  );
}

/**
 * Create a new (non-archived) conversation and return the full row. In multi
 * mode `owner` stamps `user_id`; in shared mode it stays null (unchanged).
 */
export async function createConversation(
  input: { title?: string | null; agentSlug?: string; owner?: Owner } = {},
  exec: QueryFn = query,
): Promise<Conversation> {
  const rows = await exec<Conversation>(
    `INSERT INTO conversations (title, agent_slug, user_id)
          VALUES ($1, $2, $3)
       RETURNING id, title, agent_slug, created, archived`,
    [input.title ?? null, input.agentSlug ?? 'mary', input.owner ?? null],
  );
  return rows[0];
}

/**
 * Fetch a single conversation by id, or null if it does not exist. When `owner`
 * is set (multi mode), a conversation owned by anyone else returns null — this is
 * the isolation choke point every conversationId-bearing route relies on.
 */
export async function getConversation(
  id: string,
  exec: QueryFn = query,
  owner: Owner = null,
): Promise<Conversation | null> {
  if (owner === null) {
    const rows = await exec<Conversation>(
      `SELECT id, title, agent_slug, created, archived
         FROM conversations
        WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }
  const rows = await exec<Conversation>(
    `SELECT id, title, agent_slug, created, archived
       FROM conversations
      WHERE id = $1 AND user_id = $2`,
    [id, owner],
  );
  return rows[0] ?? null;
}

/**
 * Set (or clear) a conversation's title. Pass null/empty to clear it, which
 * makes the effective title fall back to the first-message snippet (auto-title).
 * Returns the updated row, or null when the conversation is missing.
 */
export async function updateTitle(
  id: string,
  title: string | null,
  exec: QueryFn = query,
  owner: Owner = null,
): Promise<Conversation | null> {
  const normalized = title && title.trim().length > 0 ? title.trim() : null;
  if (owner === null) {
    const rows = await exec<Conversation>(
      `UPDATE conversations
          SET title = $2
        WHERE id = $1
        RETURNING id, title, agent_slug, created, archived`,
      [id, normalized],
    );
    return rows[0] ?? null;
  }
  const rows = await exec<Conversation>(
    `UPDATE conversations
        SET title = $2
      WHERE id = $1 AND user_id = $3
      RETURNING id, title, agent_slug, created, archived`,
    [id, normalized, owner],
  );
  return rows[0] ?? null;
}

/** Set the archived flag on a conversation (used by PATCH). Never deletes. */
export async function setArchived(
  id: string,
  archived: boolean,
  exec: QueryFn = query,
  owner: Owner = null,
): Promise<Conversation | null> {
  if (owner === null) {
    const rows = await exec<Conversation>(
      `UPDATE conversations
          SET archived = $2
        WHERE id = $1
        RETURNING id, title, agent_slug, created, archived`,
      [id, archived],
    );
    return rows[0] ?? null;
  }
  const rows = await exec<Conversation>(
    `UPDATE conversations
        SET archived = $2
      WHERE id = $1 AND user_id = $3
      RETURNING id, title, agent_slug, created, archived`,
    [id, archived, owner],
  );
  return rows[0] ?? null;
}
