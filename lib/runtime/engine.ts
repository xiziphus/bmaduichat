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
import { supportsFunctionCalling, type Provider, type MsgPart } from '@/lib/llm';
import type { ModelClient, ToolExecutor, RunEvent, RunState, ToolMsg, RunStore } from './types';
import { runLoop, structuredToolInstructions } from './loop';
import { TOOL_SCHEMAS, toolSchemasFor, createToolExecutor } from './tools';
import { makeProviderClient } from './model';
import { dbRunStore, STALE_APOLOGY } from './state';
import {
  BRAINSTORMING_SLUG,
  composeBrainstormingPrompt,
  type BrainstormPhase,
} from './brainstorming';
import { composeAgentCommandPrompt } from './agent-prompt';

export type RunWorkflowInput = {
  conversationId: string;
  skillSlug: string;
  /**
   * The active agent (Epic D). When set, a non-brainstorming skill composes that
   * agent's persona on top of the adapted SKILL.md (generic, zero per-agent
   * code). Absent → the pre-D behavior is byte-identical: brainstorming uses its
   * dedicated composer, any other skill uses the plain adapted SKILL.md.
   */
  agentSlug?: string;
  /** The user's message this turn (a fresh prompt, or the answer resuming a checkpoint). */
  input: string;
  /** Provider-native multimodal parts (images/PDFs) attached to THIS turn. */
  inputParts?: MsgPart[];
  provider: Provider;
  model?: string;
  resumeRunId?: string;
  /**
   * Seed context for a FRESH run (no resumable run in the DB): the prior
   * conversation turns, so multi-turn context survives even when each turn
   * finalizes. Ignored on resume (the persisted transcript is the source of
   * truth). The current turn is always `input`, appended after this.
   */
  history?: ToolMsg[];
  /** A just-launched technique id — folded into a fresh run's system prompt. */
  technique?: string;
  /** The active brainstorming phase (drives reference selection on a fresh run). */
  phase?: BrainstormPhase;
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
export function buildSystemPrompt(
  skillSlug: string,
  supportsTools: boolean,
  opts?: { technique?: string; phase?: BrainstormPhase; agentSlug?: string },
): string {
  let skillText = '';
  try {
    // Brainstorming keeps its dedicated composer (the C-4-proven path) whether or
    // not an agent is named. With an agentSlug, any OTHER skill composes that
    // agent's persona + the adapted SKILL.md (Epic D, generic). Absent → the
    // pre-D plain adapted SKILL.md (byte-identical).
    skillText =
      skillSlug === BRAINSTORMING_SLUG
        ? composeBrainstormingPrompt({ technique: opts?.technique, phase: opts?.phase })
        : opts?.agentSlug
          ? composeAgentCommandPrompt({ agentSlug: opts.agentSlug, skillSlug })
          : adaptMechanics(loadSkill(skillSlug).skillMd);
  } catch {
    skillText = `You are running the "${skillSlug}" skill.`;
  }
  if (supportsTools) return skillText;
  return skillText + '\n' + structuredToolInstructions(toolSchemasFor(skillSlug));
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
  const system =
    resume?.system ??
    buildSystemPrompt(opts.skillSlug, supportsTools, {
      technique: opts.technique,
      phase: opts.phase,
      agentSlug: opts.agentSlug,
    });
  const currentTurn: ToolMsg = {
    role: 'user',
    content: opts.input,
    ...(opts.inputParts && opts.inputParts.length > 0 ? { parts: opts.inputParts } : {}),
  };
  const transcript: ToolMsg[] = resume
    ? [...resume.transcript, currentTurn]
    : [...(opts.history ?? []), currentTurn];

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
      tools: toolSchemasFor(opts.skillSlug),
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
    // Persistence is best-effort: a store write failure must never swallow the
    // user-facing checkpoint (that would blank the reply). Log and continue.
    try {
      await store.persistCheckpoint(runId, baseState(result.prompt));
    } catch (err) {
      void err;
    }
    yield { type: 'checkpoint', prompt: result.prompt, runId };
    yield { type: 'done', status: 'awaiting_user', runId };
    return;
  }

  // final | capped → the run is done. Same best-effort guard on the write.
  try {
    await store.persistTerminal(runId, 'done', baseState(null));
  } catch (err) {
    void err;
  }
  yield { type: 'done', status: 'done', runId };
}
