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

/** A single artifact by id, or null when missing. */
export async function getById(
  id: string,
  exec: QueryFn = query,
): Promise<Artifact | null> {
  const rows = await exec<Artifact>(
    `SELECT ${COLUMNS}
       FROM artifacts
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
