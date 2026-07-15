import 'server-only';

/**
 * The runtime engine seam: `runWorkflow(...)`. Orchestrates loadSkill →
 * system-prompt build → tool loop → checkpoint/resume persistence, and streams
 * `RunEvent`s. Deterministic and unit-testable: inject a mock `model` and/or
 * `executeTool` and toggle `persistence` to exercise every path with no network
 * and no database.
 *
 * DORMANT: nothing here is wired to the live Mary chat. C-4 migrates
 * brainstorming onto this engine behind a parity checklist.
 */
import { isPersistenceEnabled } from '@/lib/db';
import { loadSkill, adaptMechanics } from '@/lib/skills/loader';
import { supportsFunctionCalling, type Provider } from '@/lib/llm';
import type { ModelClient, ToolExecutor, RunEvent, RunState, ToolMsg, RunStore } from './types';
import { runLoop, structuredToolInstructions } from './loop';
import { TOOL_SCHEMAS, createToolExecutor } from './tools';
import { makeProviderClient } from './model';
import { dbRunStore, STALE_APOLOGY } from './state';

export type RunWorkflowInput = {
  conversationId: string;
  skillSlug: string;
  /** The user's message this turn (a fresh prompt, or the answer resuming a checkpoint). */
  input: string;
  provider: Provider;
  model?: string;
  resumeRunId?: string;
  /** Injectables for tests / alternate transports. */
  deps?: {
    model?: ModelClient;
    executeTool?: ToolExecutor;
    /** Override persistence detection (tests). Defaults to isPersistenceEnabled(). */
    persistence?: boolean;
    /** Override the run-state backend (tests). Defaults to the Neon store. */
    store?: RunStore;
    maxIterations?: number;
  };
};

/**
 * Build the run's system prompt from the skill (RAW SKILL.md adapted for the
 * browser) plus, in fallback mode, the structured-text tool protocol.
 */
export function buildSystemPrompt(skillSlug: string, supportsTools: boolean): string {
  let skillText = '';
  try {
    skillText = adaptMechanics(loadSkill(skillSlug).skillMd);
  } catch {
    skillText = `You are running the "${skillSlug}" skill.`;
  }
  if (supportsTools) return skillText;
  return skillText + '\n' + structuredToolInstructions(TOOL_SCHEMAS);
}

/**
 * Run (or resume) a workflow. Async generator of `RunEvent`s; the final event is
 * always a `done` (or `error`) carrying the terminal status + runId.
 */
export async function* runWorkflow(
  opts: RunWorkflowInput,
): AsyncGenerator<RunEvent, void, void> {
  const persistence = opts.deps?.persistence ?? isPersistenceEnabled();
  const supportsTools = supportsFunctionCalling(opts.provider, opts.model);
  const store = opts.deps?.store ?? dbRunStore;

  // Best-effort auto-heal of crashed runs before we touch this conversation.
  if (persistence) await store.healStale();

  // Resolve the run (new vs resume). When persistence is off, runId is null.
  let runId: string | null = null;
  let resume: RunState | null = null;
  if (persistence) {
    try {
      const r = await store.resolveRun({
        conversationId: opts.conversationId,
        skillSlug: opts.skillSlug,
        resumeRunId: opts.resumeRunId,
      });
      runId = r.runId;
      resume = r.resume;
    } catch (err) {
      yield { type: 'error', message: 'Could not start the run.' };
      void err;
      return;
    }
  }

  // Build system + seed transcript. Resume re-enters with the persisted stack +
  // the user's answer appended; a fresh run starts from the user's input.
  const system = resume?.system ?? buildSystemPrompt(opts.skillSlug, supportsTools);
  const transcript: ToolMsg[] = resume
    ? [...resume.transcript, { role: 'user', content: opts.input }]
    : [{ role: 'user', content: opts.input }];

  // If we resumed a stale-healed run that never actually checkpointed, apologize.
  if (resume && resume.pendingPrompt === null && resume.transcript.length > 0) {
    yield { type: 'progress', note: STALE_APOLOGY };
  }

  const model: ModelClient = opts.deps?.model ?? makeProviderClient(opts.provider, opts.model);
  const executeTool: ToolExecutor =
    opts.deps?.executeTool ??
    createToolExecutor({
      conversationId: opts.conversationId,
      runId,
      skillSlug: opts.skillSlug,
      persistence,
    });

  let result;
  try {
    result = yield* runLoop({
      model,
      system,
      transcript,
      tools: TOOL_SCHEMAS,
      supportsTools,
      executeTool,
      maxIterations: opts.deps?.maxIterations,
    });
  } catch (err) {
    yield { type: 'error', message: 'The run hit an unexpected error.' };
    void err;
    if (persistence && runId) {
      await store.persistTerminal(runId, 'failed', {
        phase: resume?.phase ?? null,
        skillSlug: opts.skillSlug,
        provider: opts.provider,
        model: opts.model ?? null,
        supportsTools,
        system,
        transcript,
        pendingPrompt: null,
      });
    }
    return;
  }

  const baseState = (pendingPrompt: string | null): RunState => ({
    phase: resume?.phase ?? null,
    skillSlug: opts.skillSlug,
    provider: opts.provider,
    model: opts.model ?? null,
    supportsTools,
    system,
    transcript: result.transcript,
    pendingPrompt,
  });

  if (result.status === 'halt') {
    await store.persistCheckpoint(runId, baseState(result.prompt));
    yield { type: 'checkpoint', prompt: result.prompt, runId };
    yield { type: 'done', status: 'awaiting_user', runId };
    return;
  }

  // final | capped → the run is done.
  await store.persistTerminal(runId, 'done', baseState(null));
  yield { type: 'done', status: 'done', runId };
}
