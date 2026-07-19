import 'server-only';

/**
 * Checkpoint / HALT-resume state machine over `workflow_runs`.
 *
 * The novel core: on `request_checkpoint` the run flips to `awaiting_user` and
 * its `state_json` (phase, running transcript, pending prompt, provider/model,
 * skill) is persisted to Neon. The next user message for that run loads
 * `state_json` and re-enters the loop — resumable across sessions and devices
 * because EVERYTHING needed is in the database, never memory-only.
 *
 * DB-graceful: with persistence off there is no run row; the engine runs a
 * single session and a checkpoint simply surfaces the waiting payload without a
 * durable resume (documented degradation).
 */
import { isPersistenceEnabled } from '@/lib/db';
import type { RunState, ToolMsg, RunStore } from './types';
import {
  createRun,
  getRun,
  getActiveRunForConversation,
  getLatestPhaseForConversation,
  updateRun,
  healStaleRuns,
  type WorkflowRun,
} from '@/lib/repo/workflow-runs';

/** A `running` row untouched this long is presumed crashed and auto-healed. */
export const STALE_RUN_MINUTES = 10;

export const STALE_APOLOGY =
  "Sorry — it looks like I got interrupted partway through and left this waiting. " +
  "Let's pick it back up. Where were we?";

/** Auto-heal crashed runs (best-effort; no-op when persistence is off). */
export async function healStale(minutes = STALE_RUN_MINUTES): Promise<WorkflowRun[]> {
  if (!isPersistenceEnabled()) return [];
  try {
    return await healStaleRuns(minutes);
  } catch {
    return [];
  }
}

/** Parse a persisted `state_json` into a `RunState`, or null when unusable. */
export function parseRunState(stateJson: unknown): RunState | null {
  let obj: unknown = stateJson;
  if (typeof stateJson === 'string') {
    try {
      obj = JSON.parse(stateJson);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const s = obj as Partial<RunState>;
  if (!Array.isArray(s.transcript) || typeof s.skillSlug !== 'string' || typeof s.system !== 'string') {
    return null;
  }
  return {
    phase: typeof s.phase === 'string' ? s.phase : null,
    skillSlug: s.skillSlug,
    provider: typeof s.provider === 'string' ? s.provider : 'gemini',
    model: typeof s.model === 'string' ? s.model : null,
    supportsTools: Boolean(s.supportsTools),
    system: s.system,
    transcript: s.transcript as ToolMsg[],
    pendingPrompt: typeof s.pendingPrompt === 'string' ? s.pendingPrompt : null,
  };
}

/**
 * Resolve the run to use for a request. When persistence is off, returns a null
 * runId (single-session). Otherwise:
 *  - explicit `resumeRunId` → that run (if awaiting_user/running)
 *  - else the conversation's most recent resumable run
 *  - else a freshly created `running` run
 */
export async function resolveRun(input: {
  conversationId: string;
  skillSlug: string;
  resumeRunId?: string;
}): Promise<{ runId: string | null; resume: RunState | null }> {
  if (!isPersistenceEnabled()) return { runId: null, resume: null };

  let run: WorkflowRun | null = null;
  if (input.resumeRunId) {
    run = await getRun(input.resumeRunId);
  } else {
    run = await getActiveRunForConversation(input.conversationId);
  }

  if (run && (run.status === 'awaiting_user' || run.status === 'running')) {
    const resume = parseRunState(run.state_json);
    // Mark it running again while we work.
    await updateRun(run.id, { status: 'running' });
    return { runId: run.id, resume };
  }

  const created = await createRun({
    conversationId: input.conversationId,
    skillSlug: input.skillSlug,
    status: 'running',
  });
  return { runId: created.id, resume: null };
}

/**
 * Persist a checkpoint: flip to `awaiting_user` and store the full `RunState`.
 * No-op-safe when persistence is off or there is no run row.
 */
export async function persistCheckpoint(
  runId: string | null,
  state: RunState,
): Promise<void> {
  if (!isPersistenceEnabled() || !runId) return;
  await updateRun(runId, {
    status: 'awaiting_user',
    phase: state.phase ?? null,
    stateJson: state,
  });
}

/** Persist a terminal status (done/failed) with the final state. */
export async function persistTerminal(
  runId: string | null,
  status: 'done' | 'failed',
  state: RunState,
): Promise<void> {
  if (!isPersistenceEnabled() || !runId) return;
  await updateRun(runId, { status, phase: state.phase ?? null, stateJson: state });
}

/**
 * The last persisted phase for a conversation+skill (monotonic-phase guard, Fix
 * C). No-op-safe (null) when persistence is off or the read fails.
 */
export async function latestPhase(
  conversationId: string,
  skillSlug: string,
): Promise<string | null> {
  if (!isPersistenceEnabled()) return null;
  try {
    return await getLatestPhaseForConversation(conversationId, skillSlug);
  } catch {
    return null;
  }
}

/** The default Neon-backed run store the engine uses in production. */
export const dbRunStore: RunStore = {
  healStale: async () => {
    await healStale();
  },
  resolveRun,
  persistCheckpoint,
  persistTerminal,
  latestPhase,
};
