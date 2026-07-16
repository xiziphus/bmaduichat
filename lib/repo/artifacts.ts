/**
 * Artifacts repository — conversation-scoped, versioned documents. Server-side
 * only. Callers must gate on isPersistenceEnabled() before invoking.
 *
 * Each brainstorm wrap-up emits a <document> block (see lib/document.ts); the
 * chat route persists it here as a NEW version row (prior versions retained) so
 * "regenerate" keeps history and the doc pane always shows the latest.
 *
 * Optional `exec` executor lets tests assert SQL/param shape against a mock.
 */
import { query, type QueryFn } from '@/lib/db';

/** The owning user id to scope to, or null in shared mode (unscoped). Artifacts
 *  are owned VIA their conversation, so scoping joins conversations.user_id. */
export type Owner = string | null;

export type Artifact = {
  id: string;
  conversation_id: string;
  run_id: string | null;
  title: string | null;
  kind: string | null;
  markdown: string | null;
  html: string | null;
  version: number;
  created: string;
};

export type ArtifactInput = {
  conversationId: string;
  title?: string | null;
  markdown: string;
  html?: string | null;
  kind?: string | null;
  runId?: string | null;
};

const COLUMNS =
  'id, conversation_id, run_id, title, kind, markdown, html, version, created';

/** List artifacts for a conversation, newest first. */
export async function listArtifacts(
  conversationId: string,
  exec: QueryFn = query,
): Promise<Artifact[]> {
  return exec<Artifact>(
    `SELECT ${COLUMNS}
       FROM artifacts
      WHERE conversation_id = $1
      ORDER BY version DESC`,
    [conversationId],
  );
}

/**
 * Write a new version of the conversation's document. The version number is the
 * conversation's current max + 1, computed atomically in the INSERT so prior
 * versions are never overwritten.
 */
export async function createVersion(
  input: ArtifactInput,
  exec: QueryFn = query,
): Promise<Artifact> {
  const rows = await exec<Artifact>(
    `INSERT INTO artifacts (conversation_id, run_id, title, kind, markdown, html, version)
          VALUES ($1, $2, $3, $4, $5, $6,
                  (SELECT COALESCE(MAX(version), 0) + 1
                     FROM artifacts
                    WHERE conversation_id = $1))
       RETURNING ${COLUMNS}`,
    [
      input.conversationId,
      input.runId ?? null,
      input.title ?? null,
      input.kind ?? 'document',
      input.markdown,
      input.html ?? null,
    ],
  );
  return rows[0];
}

/** The latest (highest-version) artifact for a conversation, or null. */
export async function getLatestForConversation(
  conversationId: string,
  exec: QueryFn = query,
): Promise<Artifact | null> {
  const rows = await exec<Artifact>(
    `SELECT ${COLUMNS}
       FROM artifacts
      WHERE conversation_id = $1
      ORDER BY version DESC
      LIMIT 1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

export type ArtifactSummary = {
  id: string;
  conversation_id: string;
  title: string | null;
  version: number;
  created: string;
};

/**
 * Artifacts whose title matches `q` (case-insensitive substring), newest first.
 * Powers the `@`-mention autocomplete. An empty `q` matches everything (returns
 * the most recent, capped by `limit`). Untitled artifacts are excluded.
 */
export async function searchArtifacts(
  q: string,
  limit = 8,
  exec: QueryFn = query,
  owner: Owner = null,
): Promise<ArtifactSummary[]> {
  if (owner === null) {
    return exec<ArtifactSummary>(
      `SELECT id, conversation_id, title, version, created
         FROM artifacts
        WHERE title IS NOT NULL
          AND title ILIKE $1
        ORDER BY created DESC
        LIMIT $2`,
      [`%${q}%`, limit],
    );
  }
  return exec<ArtifactSummary>(
    `SELECT a.id, a.conversation_id, a.title, a.version, a.created
       FROM artifacts a
       JOIN conversations c ON c.id = a.conversation_id
      WHERE a.title IS NOT NULL
        AND a.title ILIKE $1
        AND c.user_id = $3
      ORDER BY a.created DESC
      LIMIT $2`,
    [`%${q}%`, limit, owner],
  );
}

/**
 * A single artifact by id, or null when missing. When `owner` is set (multi
 * mode), an artifact whose conversation is owned by anyone else returns null.
 */
export async function getById(
  id: string,
  exec: QueryFn = query,
  owner: Owner = null,
): Promise<Artifact | null> {
  if (owner === null) {
    const rows = await exec<Artifact>(
      `SELECT ${COLUMNS}
         FROM artifacts
        WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }
  const rows = await exec<Artifact>(
    `SELECT ${COLUMNS.split(', ')
      .map((c) => `a.${c}`)
      .join(', ')}
       FROM artifacts a
       JOIN conversations c ON c.id = a.conversation_id
      WHERE a.id = $1 AND c.user_id = $2`,
    [id, owner],
  );
  return rows[0] ?? null;
}
