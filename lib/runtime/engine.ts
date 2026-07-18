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
import { listRunEvents, type RunEventRow } from '@/lib/repo/run-events';
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
    /** Override the memlog reader (tests). Defaults to the run-events repo. */
    listRunEvents?: typeof listRunEvents;
    maxIterations?: number;
  };
};

/**
 * Deterministic context compaction (NO extra LLM call). Bounds the replayed
 * verbatim history to a recent window that fits a char budget / turn cap; when
 * older turns are dropped, their gist — plus any recalled memlog entries — is
 * preserved in a single compact memory block prepended to the window.
 *
 * The memlog fold (row 9) turns the run_events sink into genuine recalled
 * memory: the same entry types the CLI memlog uses (idea | decision | question |
 * technique | event) are surfaced back to the model. With no dropped turns and
 * no recalled events the history is returned UNTOUCHED — a short session with no
 * DB behaves exactly as before (no memory block, full verbatim history).
 */
export const HISTORY_CHAR_BUDGET = 12000;
export const HISTORY_MAX_TURNS = 14;

function msgText(m: ToolMsg): string {
  return 'content' in m && typeof m.content === 'string' ? m.content : '';
}

function condenseTurn(m: ToolMsg): string {
  const who = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'You' : `Tool(${m.name})`;
  const text = msgText(m).replace(/\s+/g, ' ').trim();
  const clipped = text.length > 200 ? `${text.slice(0, 200)}…` : text;
  return `- ${who}: ${clipped}`;
}

function memlogRecall(events: RunEventRow[]): string[] {
  return events
    .filter((e) => typeof e.text === 'string' && e.text.trim().length > 0)
    .map((e) => `- [${e.type}] ${(e.text as string).replace(/\s+/g, ' ').trim()}`);
}

/**
 * Build the seed history the model replays: recent verbatim turns, optionally
 * preceded by a condensed memory block. Pure and unit-testable.
 */
export function composeSeedHistory(history: ToolMsg[], events: RunEventRow[] = []): ToolMsg[] {
  const total = history.reduce((n, m) => n + msgText(m).length, 0);

  // Keep the most recent turns that fit the budget + turn cap. Under both limits
  // we keep everything (recent = history, nothing older).
  let recent = history;
  let older: ToolMsg[] = [];
  if (total > HISTORY_CHAR_BUDGET || history.length > HISTORY_MAX_TURNS) {
    recent = [];
    let used = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const len = msgText(history[i]).length;
      const full =
        recent.length >= HISTORY_MAX_TURNS ||
        (recent.length > 0 && used + len > HISTORY_CHAR_BUDGET);
      if (full) {
        older = history.slice(0, i + 1);
        break;
      }
      recent.unshift(history[i]);
      used += len;
    }
  }

  const recalled = memlogRecall(events);
  if (older.length === 0 && recalled.length === 0) return history;

  const lines: string[] = ['[Earlier in this conversation, condensed:]'];
  if (older.length > 0) lines.push(...older.map(condenseTurn));
  if (recalled.length > 0) {
    lines.push('', "Key points recalled from this session's running record:", ...recalled);
  }
  const memoryBlock: ToolMsg = { role: 'user', content: lines.join('\n') };
  return [memoryBlock, ...recent];
}

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

  // Fresh run: compact the replayed history to a bounded window and fold any
  // persisted memlog (run_events) into a recalled-memory block, so long sessions
  // don't overflow and the memlog stops being a write-only sink. Resume re-enters
  // with the persisted transcript unchanged (its own bounded-state mechanism).
  let seedHistory = opts.history ?? [];
  if (!resume) {
    let events: RunEventRow[] = [];
    if (persistence && runId) {
      try {
        events = await (opts.deps?.listRunEvents ?? listRunEvents)(runId);
      } catch {
        events = [];
      }
    }
    seedHistory = composeSeedHistory(opts.history ?? [], events);
  }
  const transcript: ToolMsg[] = resume
    ? [...resume.transcript, currentTurn]
    : [...seedHistory, currentTurn];

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
