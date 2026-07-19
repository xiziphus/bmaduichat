/**
 * Shared runtime-engine types. The canonical model primitives (ToolSchema,
 * ToolCall, ToolMsg, ModelTurn) live in `lib/llm.ts` and are re-exported here so
 * the engine has one import surface.
 *
 * The engine is DORMANT — nothing here is on the live Mary chat path.
 */
import type { ToolSchema, ToolCall, ToolMsg, ModelTurn } from '@/lib/llm';

export type { ToolSchema, ToolCall, ToolMsg, ModelTurn };

export type RunStatus = 'running' | 'awaiting_user' | 'done' | 'failed';

/**
 * The seam the loop drives against. The real client wraps `lib/llm.ts`; tests
 * inject a deterministic mock. Given the transcript (+ optional tool set) it
 * returns one completed model turn.
 */
export type ModelClient = (
  system: string,
  messages: ToolMsg[],
  tools?: ToolSchema[],
  /** Called with each user-facing text chunk as it streams, so the loop can
   *  emit incremental `text` deltas. Optional — mock clients omit it. */
  onDelta?: (chunk: string) => void,
) => Promise<ModelTurn>;

/** The outcome of executing one tool call server-side. */
export type ToolExecResult =
  | { kind: 'result'; content: string }
  /** `request_checkpoint` — the HALT. The loop stops and the engine persists. */
  | { kind: 'halt'; prompt: string };

/** Executes one tool call server-side. Injectable for tests. */
export type ToolExecutor = (call: {
  name: string;
  args: Record<string, unknown>;
}) => Promise<ToolExecResult>;

/** Lightweight events streamed out of a run (progress + text + terminal). */
export type RunEvent =
  | { type: 'progress'; note: string }
  | { type: 'tool'; name: string }
  | { type: 'tool_result'; name: string; content: string }
  | { type: 'text'; delta: string }
  | { type: 'checkpoint'; prompt: string; runId: string | null }
  | { type: 'done'; status: RunStatus; runId: string | null }
  | { type: 'error'; message: string };

/** Where the loop stopped. */
export type LoopResult =
  | { status: 'final'; text: string; transcript: ToolMsg[] }
  | { status: 'halt'; prompt: string; transcript: ToolMsg[] }
  | { status: 'capped'; text: string; transcript: ToolMsg[] };

/**
 * The persistence backend the engine drives against for run state. The default
 * is backed by Neon (`workflow_runs`); tests inject an in-memory store to prove
 * cross-session resume without a database.
 */
export type RunStore = {
  healStale: () => Promise<void>;
  resolveRun: (input: {
    conversationId: string;
    skillSlug: string;
    resumeRunId?: string;
  }) => Promise<{ runId: string | null; resume: RunState | null }>;
  persistCheckpoint: (runId: string | null, state: RunState) => Promise<void>;
  persistTerminal: (runId: string | null, status: 'done' | 'failed', state: RunState) => Promise<void>;
};

/**
 * Persisted resume state (goes into `workflow_runs.state_json`). Bounded: it
 * carries the running transcript (the message/context stack) plus enough to
 * re-enter the loop on the next user message, cross-session/device.
 */
export type RunState = {
  phase: string | null;
  skillSlug: string;
  provider: string;
  model: string | null;
  supportsTools: boolean;
  system: string;
  /** The running message/context stack at the checkpoint. */
  transcript: ToolMsg[];
  /** The pending checkpoint question awaiting the user. */
  pendingPrompt: string | null;
};
