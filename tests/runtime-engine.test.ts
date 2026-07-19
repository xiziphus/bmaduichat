import { describe, it, expect } from 'vitest';
import {
  runWorkflow,
  composeSeedHistory,
  HISTORY_CHAR_BUDGET,
  HISTORY_MAX_TURNS,
  type RunWorkflowInput,
} from '@/lib/runtime/engine';
import { parseRunState } from '@/lib/runtime/state';
import type { RunEventRow } from '@/lib/repo/run-events';
import type {
  ModelClient,
  ModelTurn,
  RunEvent,
  RunStore,
  RunState,
  ToolMsg,
  ToolExecutor,
} from '@/lib/runtime/types';

const noUsage = { tokensIn: null, tokensOut: null };

async function collect(gen: AsyncGenerator<RunEvent, void, void>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/**
 * A minimal in-memory stand-in for Neon `workflow_runs`. This is the ONLY shared
 * state between two engine invocations — proving resume rides the store (DB), not
 * in-memory loop state. Serializes state_json to a string exactly like Postgres
 * jsonb round-trips, so the resume path exercises real (de)serialization.
 */
function memoryStore() {
  const rows = new Map<string, { status: string; state_json: string | null; conversationId: string }>();
  let seq = 0;
  let healed = 0;
  const store: RunStore = {
    healStale: async () => {
      healed++;
    },
    resolveRun: async ({ conversationId, resumeRunId }) => {
      // Find an existing resumable run for this conversation.
      let id = resumeRunId;
      if (!id) {
        for (const [rid, r] of rows) {
          if (r.conversationId === conversationId && (r.status === 'awaiting_user' || r.status === 'running')) {
            id = rid;
          }
        }
      }
      const existing = id ? rows.get(id) : undefined;
      if (existing) {
        const resume = parseRunState(existing.state_json);
        existing.status = 'running';
        return { runId: id as string, resume };
      }
      const rid = `run_${seq++}`;
      rows.set(rid, { status: 'running', state_json: null, conversationId });
      return { runId: rid, resume: null };
    },
    persistCheckpoint: async (runId, state) => {
      if (!runId) return;
      const r = rows.get(runId);
      if (r) {
        r.status = 'awaiting_user';
        r.state_json = JSON.stringify(state); // jsonb round-trip
      }
    },
    persistTerminal: async (runId, status) => {
      if (!runId) return;
      const r = rows.get(runId);
      if (r) r.status = status;
    },
  };
  return { store, rows, stats: () => ({ healed }) };
}

const base = (over: Partial<RunWorkflowInput>): RunWorkflowInput => ({
  conversationId: 'c1',
  skillSlug: 'bmad-brainstorming',
  input: 'help me brainstorm',
  provider: 'gemini',
  ...over,
});

describe('composeSeedHistory — deterministic compaction + memlog recall', () => {
  const userMsg = (content: string): ToolMsg => ({ role: 'user', content });
  const asstMsg = (content: string): ToolMsg => ({ role: 'assistant', content });

  it('passes short history WHOLE — no memory block (byte-identical to before)', () => {
    const history: ToolMsg[] = [userMsg('hi'), asstMsg('hello'), userMsg('idea?')];
    const seed = composeSeedHistory(history);
    expect(seed).toBe(history); // same reference: untouched
    expect(seed.some((m) => 'content' in m && m.content.includes('condensed'))).toBe(false);
  });

  it('windows over-budget history and prepends a condensed memory block', () => {
    // Build a history that clearly exceeds the char budget.
    const big = 'x'.repeat(1000);
    const history: ToolMsg[] = [];
    for (let i = 0; i < 20; i++) history.push(i % 2 === 0 ? userMsg(`${big} u${i}`) : asstMsg(`${big} a${i}`));
    const total = history.reduce((n, m) => n + ('content' in m ? m.content.length : 0), 0);
    expect(total).toBeGreaterThan(HISTORY_CHAR_BUDGET);

    const seed = composeSeedHistory(history);
    // First entry is the memory block.
    const first = seed[0];
    expect('content' in first ? first.content : '').toContain('[Earlier in this conversation, condensed:]');
    // Windowed: fewer turns than the original + the memory block, and within caps.
    expect(seed.length).toBeLessThan(history.length + 1);
    expect(seed.length - 1).toBeLessThanOrEqual(HISTORY_MAX_TURNS);
    const seedChars = seed.slice(1).reduce((n, m) => n + ('content' in m ? m.content.length : 0), 0);
    expect(seedChars).toBeLessThanOrEqual(HISTORY_CHAR_BUDGET);
    // The most-recent turn survives verbatim.
    expect('content' in seed[seed.length - 1] ? (seed[seed.length - 1] as { content: string }).content : '').toContain('a19');
  });

  it('folds recalled memlog entries into the memory block (even under budget)', () => {
    const history: ToolMsg[] = [userMsg('hi'), asstMsg('hello')];
    const events: RunEventRow[] = [
      { id: '1', run_id: 'r', type: 'decision', text: 'chose the marketplace angle', by: 'mary', created: 't1' },
      { id: '2', run_id: 'r', type: 'idea', text: 'referral loop', by: 'user', created: 't2' },
    ];
    const seed = composeSeedHistory(history, events);
    const block = 'content' in seed[0] ? (seed[0] as { content: string }).content : '';
    expect(block).toContain("Key points recalled from this session's running record:");
    expect(block).toContain('[decision] chose the marketplace angle');
    expect(block).toContain('[idea] referral loop');
    // Verbatim turns still follow the block.
    expect(seed.length).toBe(history.length + 1);
  });
});

describe('runWorkflow — memlog recall surfaces in the seeded transcript', () => {
  it('reads run_events via injected listRunEvents and folds them into the seed', async () => {
    const { store } = memoryStore();
    const events: RunEventRow[] = [
      { id: '1', run_id: 'r', type: 'decision', text: 'chose the marketplace angle', by: 'mary', created: 't1' },
    ];
    let sawRecall = false;
    const model: ModelClient = async (_sys, messages) => {
      const joined = messages.map((m) => ('content' in m ? m.content : '')).join(' | ');
      if (joined.includes('chose the marketplace angle')) sawRecall = true;
      return { text: 'ok', toolCalls: [], usage: noUsage } as ModelTurn;
    };
    await collect(
      runWorkflow(
        base({
          input: 'continue',
          deps: {
            model,
            persistence: true,
            store,
            listRunEvents: async () => events,
          },
        }),
      ),
    );
    expect(sawRecall).toBe(true);
  });
});

describe('runWorkflow — checkpoint persist then cross-session resume', () => {
  it('persists state_json on HALT and a FRESH engine invocation resumes from it', async () => {
    const { store, rows } = memoryStore();

    // --- Session 1: model calls request_checkpoint → HALT ---
    const model1: ModelClient = async () => ({
      text: '',
      toolCalls: [{ id: 'c0', name: 'request_checkpoint', args: { prompt: 'Which angle?' } }],
      usage: noUsage,
    });
    const noopTool: ToolExecutor = async ({ name, args }) =>
      name === 'request_checkpoint'
        ? { kind: 'halt', prompt: String((args as { prompt?: string }).prompt) }
        : { kind: 'result', content: 'ok' };

    const ev1 = await collect(
      runWorkflow(base({ deps: { model: model1, executeTool: noopTool, persistence: true, store } })),
    );
    expect(ev1.find((e) => e.type === 'checkpoint')).toMatchObject({ prompt: 'Which angle?' });
    expect(ev1.find((e) => e.type === 'done')).toMatchObject({ status: 'awaiting_user' });

    // The run row is awaiting_user with a persisted transcript.
    const runId = [...rows.keys()][0];
    expect(rows.get(runId)!.status).toBe('awaiting_user');
    const persisted = parseRunState(rows.get(runId)!.state_json) as RunState;
    expect(persisted.pendingPrompt).toBe('Which angle?');
    expect(persisted.transcript.length).toBeGreaterThan(0);

    // --- Session 2: a BRAND-NEW engine call (no in-memory carryover) resumes ---
    // The resumed model sees the persisted transcript + the user's answer and finalizes.
    let sawResumedTranscript = false;
    const model2: ModelClient = async (_sys, messages) => {
      // The seed transcript must include the prior turns AND the new user answer.
      const contents = messages.map((m) => ('content' in m ? m.content : '')).join(' | ');
      if (messages.length >= 2 && contents.includes('the second angle')) sawResumedTranscript = true;
      return { text: 'Great, proceeding with that angle.', toolCalls: [], usage: noUsage } as ModelTurn;
    };

    const ev2 = await collect(
      runWorkflow(
        base({
          input: 'the second angle',
          deps: { model: model2, executeTool: noopTool, persistence: true, store },
        }),
      ),
    );
    expect(sawResumedTranscript).toBe(true);
    expect(ev2.find((e) => e.type === 'text')).toMatchObject({ delta: 'Great, proceeding with that angle.' });
    expect(ev2.find((e) => e.type === 'done')).toMatchObject({ status: 'done' });
    expect(rows.get(runId)!.status).toBe('done');
  });
});

describe('runWorkflow — DB-off graceful', () => {
  it('runs a single session with no store, persistence tools no-op, no crash', async () => {
    // No store, persistence off → real tool executor runs with persistence:false.
    const model: ModelClient = async () => ({
      text: 'Done without a database.',
      toolCalls: [],
      usage: noUsage,
    });
    const ev = await collect(
      runWorkflow(base({ deps: { model, persistence: false } })),
    );
    expect(ev.find((e) => e.type === 'text')).toMatchObject({ delta: 'Done without a database.' });
    expect(ev.find((e) => e.type === 'done')).toMatchObject({ status: 'done', runId: null });
  });

  it('DB-off: a memlog tool call returns an honest no-op note and the run still finishes', async () => {
    let round = 0;
    const model: ModelClient = async () => {
      round++;
      if (round === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'c0', name: 'memlog_append', args: { type: 'idea', text: 'x' } }],
          usage: noUsage,
        };
      }
      return { text: 'Finished.', toolCalls: [], usage: noUsage };
    };
    const ev = await collect(runWorkflow(base({ deps: { model, persistence: false } })));
    const tr = ev.find((e) => e.type === 'tool_result');
    expect(tr && tr.type === 'tool_result' ? tr.content : '').toContain('no database configured');
    expect(ev.find((e) => e.type === 'done')).toMatchObject({ status: 'done' });
  });
});

describe('runWorkflow — monotonic brainstorming phase (Fix C)', () => {
  it('never regresses phase across turns even when the per-turn signal flip-flops', async () => {
    // A store that persists the run phase and serves it back via latestPhase —
    // the ONLY cross-turn carrier (brainstorming turns finalize as `done`).
    let lastPhase: string | null = null;
    const persisted: (string | null)[] = [];
    const store: RunStore = {
      healStale: async () => {},
      resolveRun: async () => ({ runId: 'r', resume: null }),
      persistCheckpoint: async () => {},
      persistTerminal: async (_id, _status, state) => {
        lastPhase = state.phase;
        persisted.push(state.phase);
      },
      latestPhase: async () => lastPhase,
    };
    const model: ModelClient = async () => ({ text: 'ok', toolCalls: [], usage: noUsage });
    const run = (phase: 'diverge' | 'converge' | 'finalize') =>
      collect(runWorkflow(base({ phase, deps: { model, persistence: true, store } })));

    await run('diverge'); //  fresh → diverge
    await run('converge'); // forward → converge
    await run('diverge'); //  signal regresses; must stay converge
    await run('finalize'); // forward → finalize
    await run('converge'); // signal regresses; must stay finalize

    expect(persisted).toEqual(['diverge', 'converge', 'converge', 'finalize', 'finalize']);
  });

  it('a store without latestPhase falls back to the per-turn signal (no crash)', async () => {
    // memoryStore() omits latestPhase — the guard degrades to the signal.
    const { store } = memoryStore();
    const model: ModelClient = async () => ({ text: 'ok', toolCalls: [], usage: noUsage });
    const ev = await collect(
      runWorkflow(base({ phase: 'converge', deps: { model, persistence: true, store } })),
    );
    expect(ev.find((e) => e.type === 'done')).toMatchObject({ status: 'done' });
  });
});

describe('runWorkflow — stale heal + cap', () => {
  it('calls store.healStale before touching the conversation', async () => {
    const { store, stats } = memoryStore();
    const model: ModelClient = async () => ({ text: 'ok', toolCalls: [], usage: noUsage });
    await collect(runWorkflow(base({ deps: { model, persistence: true, store } })));
    expect(stats().healed).toBe(1);
  });

  it('honors the iteration cap through the engine', async () => {
    const model: ModelClient = async () => ({
      text: '',
      toolCalls: [{ id: 'c', name: 'technique_query', args: { kind: 'list' } }],
      usage: noUsage,
    });
    const ev = await collect(
      runWorkflow(base({ deps: { model, persistence: false, maxIterations: 2 } })),
    );
    // Ends done (capped is a safe stop, not a failure) with the honest message text.
    expect(ev.find((e) => e.type === 'done')).toMatchObject({ status: 'done' });
    expect(ev.some((e) => e.type === 'text')).toBe(true);
  });
});
