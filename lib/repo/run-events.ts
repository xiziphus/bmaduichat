/**
 * Run-events repository — the browser equivalent of the CLI memlog. Append-only
 * rows keyed to a workflow run, using the SAME entry types as the CLI memlog
 * (idea | decision | question | technique | event). Server-side only; callers
 * must gate on isPersistenceEnabled().
 *
 * Optional `exec` executor lets tests assert SQL/param shape against a mock.
 */
import { query, type QueryFn } from '@/lib/db';

/** The memlog entry types (mirrors the CLI's `memlog.py` categories). */
export type RunEventType = 'idea' | 'decision' | 'question' | 'technique' | 'event';

export type RunEventRow = {
  id: string;
  run_id: string;
  type: string;
  text: string | null;
  by: string | null;
  created: string;
};

export type RunEventInput = {
  runId: string;
  type: RunEventType | string;
  text: string;
  /** Who logged it — 'mary' | 'user' | 'system'. Defaults to 'mary'. */
  by?: string | null;
};

const COLUMNS = 'id, run_id, type, text, by, created';

/** Append one memlog entry. */
export async function appendRunEvent(
  input: RunEventInput,
  exec: QueryFn = query,
): Promise<RunEventRow> {
  const rows = await exec<RunEventRow>(
    `INSERT INTO run_events (run_id, type, text, by)
          VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
    [input.runId, input.type, input.text, input.by ?? 'mary'],
  );
  return rows[0];
}

/** Every event for a run, oldest first. */
export async function listRunEvents(
  runId: string,
  exec: QueryFn = query,
): Promise<RunEventRow[]> {
  return exec<RunEventRow>(
    `SELECT ${COLUMNS}
       FROM run_events
      WHERE run_id = $1
      ORDER BY created ASC`,
    [runId],
  );
}
