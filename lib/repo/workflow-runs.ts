/**
 * Workflow-runs repository — the checkpoint/HALT state machine's backing store.
 * Server-side only. Callers must gate on isPersistenceEnabled() before invoking.
 *
 * status: running | awaiting_user | done | failed
 *
 * Optional `exec` executor lets tests assert SQL/param shape against a mock
 * (same convention as the other repos).
 */
import { query, type QueryFn } from '@/lib/db';

export type WorkflowRunStatus = 'running' | 'awaiting_user' | 'done' | 'failed';

export type WorkflowRun = {
  id: string;
  conversation_id: string;
  skill_slug: string | null;
  status: WorkflowRunStatus;
  phase: string | null;
  state_json: unknown | null;
  created: string;
  updated: string;
};

export type CreateRunInput = {
  conversationId: string;
  skillSlug: string;
  status?: WorkflowRunStatus;
  phase?: string | null;
  stateJson?: unknown;
};

const COLUMNS =
  'id, conversation_id, skill_slug, status, phase, state_json, created, updated';

/** Create a new run (defaults status='running'). */
export async function createRun(
  input: CreateRunInput,
  exec: QueryFn = query,
): Promise<WorkflowRun> {
  const rows = await exec<WorkflowRun>(
    `INSERT INTO workflow_runs (conversation_id, skill_slug, status, phase, state_json)
          VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING ${COLUMNS}`,
    [
      input.conversationId,
      input.skillSlug,
      input.status ?? 'running',
      input.phase ?? null,
      input.stateJson === undefined ? null : JSON.stringify(input.stateJson),
    ],
  );
  return rows[0];
}

/** A single run by id, or null. */
export async function getRun(
  id: string,
  exec: QueryFn = query,
): Promise<WorkflowRun | null> {
  const rows = await exec<WorkflowRun>(
    `SELECT ${COLUMNS} FROM workflow_runs WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * The most recent resumable run for a conversation — one that is still
 * `awaiting_user` (paused at a checkpoint) or `running`. Null when none.
 */
export async function getActiveRunForConversation(
  conversationId: string,
  exec: QueryFn = query,
): Promise<WorkflowRun | null> {
  const rows = await exec<WorkflowRun>(
    `SELECT ${COLUMNS}
       FROM workflow_runs
      WHERE conversation_id = $1
        AND status IN ('awaiting_user', 'running')
      ORDER BY updated DESC
      LIMIT 1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

export type UpdateRunInput = {
  status?: WorkflowRunStatus;
  phase?: string | null;
  stateJson?: unknown;
};

/**
 * Update a run's status/phase/state_json and bump `updated`. Only supplied
 * fields change (COALESCE keeps the rest). Returns the updated row or null.
 */
export async function updateRun(
  id: string,
  input: UpdateRunInput,
  exec: QueryFn = query,
): Promise<WorkflowRun | null> {
  const stateProvided = Object.prototype.hasOwnProperty.call(input, 'stateJson');
  const phaseProvided = Object.prototype.hasOwnProperty.call(input, 'phase');
  const rows = await exec<WorkflowRun>(
    `UPDATE workflow_runs
        SET status     = COALESCE($2, status),
            phase      = CASE WHEN $4 THEN $3 ELSE phase END,
            state_json = CASE WHEN $6 THEN $5::jsonb ELSE state_json END,
            updated    = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [
      id,
      input.status ?? null,
      phaseProvided ? (input.phase ?? null) : null,
      phaseProvided,
      stateProvided ? (input.stateJson === undefined ? null : JSON.stringify(input.stateJson)) : null,
      stateProvided,
    ],
  );
  return rows[0] ?? null;
}

/**
 * Auto-heal crashed runs: flip `running` rows untouched for more than
 * `olderThanMinutes` to `awaiting_user` so the user can resume them. Returns the
 * healed rows.
 */
export async function healStaleRuns(
  olderThanMinutes: number,
  exec: QueryFn = query,
): Promise<WorkflowRun[]> {
  return exec<WorkflowRun>(
    `UPDATE workflow_runs
        SET status = 'awaiting_user',
            updated = now()
      WHERE status = 'running'
        AND updated < now() - ($1 || ' minutes')::interval
      RETURNING ${COLUMNS}`,
    [String(olderThanMinutes)],
  );
}
