/**
 * Artifacts repository — STUB for Epic A.
 *
 * The `artifacts` table exists (created by the migration) but is not wired to
 * any UI until story A-3 (doc pane). This accessor is the only entry point for
 * now: it lists artifacts for a conversation so later phases have a seam to
 * build on. Server-side only.
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

/** List artifacts for a conversation, newest first. Empty until A-3 writes any. */
export async function listArtifacts(
  conversationId: string,
  exec: QueryFn = query,
): Promise<Artifact[]> {
  return exec<Artifact>(
    `SELECT id, conversation_id, run_id, title, kind, markdown, html, version, created
       FROM artifacts
      WHERE conversation_id = $1
      ORDER BY created DESC`,
    [conversationId],
  );
}
