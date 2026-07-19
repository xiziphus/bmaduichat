/**
 * The agentic tool loop. One code path; the `supportsTools` flag picks native
 * function-calling vs the structured-text `<tool>` fallback.
 *
 *   model → tool calls → execute server-side → feed results back → repeat
 *   until a final user-facing turn or a HALT (request_checkpoint), with a hard
 *   iteration cap and a safe, honest stop.
 *
 * Emits lightweight `RunEvent`s (progress/tool/text) as an async generator and
 * returns a `LoopResult`. Deterministic and unit-testable with a mock model +
 * mock tool executor.
 */
import type {
  ModelClient,
  ModelTurn,
  ToolSchema,
  ToolMsg,
  ToolCall,
  ToolExecutor,
  RunEvent,
  LoopResult,
} from './types';

export const DEFAULT_MAX_ITERATIONS = 12;

export const CAPPED_MESSAGE =
  "I've been working on this for a while and want to check in rather than keep going on my own. " +
  "Here's where I've got to — how would you like to steer from here?";

/* ---------------- structured-text `<tool>` protocol ---------------- */

// Mirror of <chips>/<document>: a named block whose body is the JSON args.
//   <tool name="read_reference">{"name":"mode-partner.md"}</tool>
const TOOL_BLOCK = /<tool\s+name="([^"]+)"\s*>([\s\S]*?)<\/tool>/i;
const TOOL_BLOCK_G = /<tool\s+name="([^"]+)"\s*>([\s\S]*?)<\/tool>/gi;
const DANGLING_TOOL_OPEN = /<tool(?:\s[\s\S]*)?$/i;

export type ParsedToolTag = { name: string; args: Record<string, unknown> } | null;

/** Parse the FIRST well-formed `<tool>` block from model text (fallback mode). */
export function parseToolTag(raw: string): ParsedToolTag {
  const m = raw.match(TOOL_BLOCK);
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  let args: Record<string, unknown> = {};
  const body = m[2].trim();
  if (body) {
    try {
      const v = JSON.parse(body);
      if (v && typeof v === 'object' && !Array.isArray(v)) args = v as Record<string, unknown>;
    } catch {
      // malformed args → treated as empty; loop re-prompts
    }
  }
  return { name, args };
}

/** Strip any `<tool>` block (and a dangling open) from user-facing text. */
export function stripToolTags(raw: string): string {
  return raw.replace(TOOL_BLOCK_G, '').replace(DANGLING_TOOL_OPEN, '').trim();
}

/** System-prompt appendix teaching the fallback protocol to tool-less models. */
export function structuredToolInstructions(tools: ToolSchema[]): string {
  const lines = tools.map((t) => `- ${t.name}: ${t.description}`);
  return [
    '',
    '## Tools (structured-text protocol)',
    'You cannot call functions directly. To use a tool, emit EXACTLY one block and STOP:',
    '<tool name="TOOL_NAME">{ ...json args... }</tool>',
    'The system runs it and replies with the result; then continue. When you are done and',
    'ready to address the user, reply normally with NO <tool> block.',
    '',
    'Available tools:',
    ...lines,
  ].join('\n');
}

/* ---------------- the loop ---------------- */

export type RunLoopOptions = {
  model: ModelClient;
  system: string;
  /** Seed transcript — a fresh run's first user turn, or a resumed stack. */
  transcript: ToolMsg[];
  tools: ToolSchema[];
  supportsTools: boolean;
  executeTool: ToolExecutor;
  maxIterations?: number;
};

async function runToolCall(
  executeTool: ToolExecutor,
  call: ToolCall,
): Promise<{ halt?: string; content: string }> {
  try {
    const r = await executeTool({ name: call.name, args: call.args });
    if (r.kind === 'halt') return { halt: r.prompt, content: '' };
    return { content: r.content };
  } catch {
    // A tool throwing must never kill the loop — feed back an error result.
    return { content: `error: tool "${call.name}" failed.` };
  }
}

/**
 * Run ONE model turn, streaming its user-facing text as incremental `text`
 * RunEvents while it arrives, and returning the completed `ModelTurn` plus the
 * number of visible chars already emitted (so the caller doesn't re-yield them).
 *
 * A callback (`onDelta`) can't `yield`, so we bridge it to this generator via a
 * chunk queue drained here. The guard withholds a forming `<tool>` sentinel in
 * the structured-text path (`stripToolTags` drops a dangling open), so tool tags
 * never leak to the client; native tool-calls carry no user text to stream.
 * A mock client that never calls `onDelta` streams nothing here (emitted=0) — the
 * caller then yields the full final text exactly as before (backward compatible).
 */
async function* streamModelTurn(
  model: ModelClient,
  system: string,
  transcript: ToolMsg[],
  tools: ToolSchema[] | undefined,
  supportsTools: boolean,
): AsyncGenerator<RunEvent, { turn: ModelTurn; emitted: number }, void> {
  const chunks: string[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  const signal = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const onDelta = (c: string) => {
    if (c) {
      chunks.push(c);
      signal();
    }
  };
  const pending = model(system, transcript, tools, onDelta).then(
    (t) => {
      done = true;
      signal();
      return t;
    },
    (e) => {
      done = true;
      signal();
      throw e;
    },
  );

  let raw = '';
  let emitted = 0;
  for (;;) {
    while (chunks.length) raw += chunks.shift()!;
    // Guarded visible text: native tools carry no inline sentinel; the fallback
    // path strips completed AND dangling <tool> blocks so a forming tag is held.
    const safe = supportsTools ? raw : stripToolTags(raw);
    if (safe.length > emitted) {
      yield { type: 'text', delta: safe.slice(emitted) };
      emitted = safe.length;
    }
    if (done && chunks.length === 0) break;
    if (!done) await new Promise<void>((r) => (wake = r));
  }
  const turn = await pending; // throws if the model call errored
  return { turn, emitted };
}

export async function* runLoop(
  opts: RunLoopOptions,
): AsyncGenerator<RunEvent, LoopResult, void> {
  const max = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const transcript: ToolMsg[] = [...opts.transcript];
  // The most recent user-facing prose seen on a tool-taking turn. If we hit the
  // iteration cap we surface this (real model text) rather than only the canned
  // message — so the cap "emits whatever text was produced", never nothing.
  let lastText = '';

  for (let i = 0; i < max; i++) {
    // Stream this turn's user-facing text as it arrives; `emitted` is how many
    // visible chars were already sent, so we don't re-yield them below.
    const { turn, emitted } = yield* streamModelTurn(
      opts.model,
      opts.system,
      transcript,
      opts.supportsTools ? opts.tools : undefined,
      opts.supportsTools,
    );

    if (opts.supportsTools) {
      if (turn.toolCalls.length > 0) {
        if (turn.text && turn.text.trim()) lastText = turn.text;
        // Record the assistant's tool-call turn verbatim so the model sees it.
        transcript.push({ role: 'assistant', content: turn.text, toolCalls: turn.toolCalls });
        yield { type: 'progress', note: 'Working…' };
        for (const call of turn.toolCalls) {
          yield { type: 'tool', name: call.name };
          const { halt, content } = await runToolCall(opts.executeTool, call);
          if (halt !== undefined) {
            return { status: 'halt', prompt: halt, transcript };
          }
          transcript.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
          yield { type: 'tool_result', name: call.name, content };
        }
        continue;
      }
      // Final user-facing turn — yield only the tail not already streamed.
      transcript.push({ role: 'assistant', content: turn.text });
      const rest = turn.text.slice(emitted);
      if (rest) yield { type: 'text', delta: rest };
      return { status: 'final', text: turn.text, transcript };
    }

    // -------- structured-text fallback --------
    const tag = parseToolTag(turn.text);
    if (tag) {
      // Any prose alongside the tag is real user-facing text — remember it for
      // the cap fallback so a tool-happy weak model still yields something.
      const visible = stripToolTags(turn.text);
      if (visible) lastText = visible;
      // Echo the raw model turn (with the tag) so the transcript stays coherent.
      transcript.push({ role: 'assistant', content: turn.text });
      yield { type: 'progress', note: 'Working…' };
      yield { type: 'tool', name: tag.name };
      const { halt, content } = await runToolCall(opts.executeTool, {
        id: `call_${i}`,
        name: tag.name,
        args: tag.args,
      });
      if (halt !== undefined) {
        return { status: 'halt', prompt: halt, transcript };
      }
      // Feed the result back as a user turn the model can read.
      transcript.push({
        role: 'user',
        content: `<tool_result name="${tag.name}">\n${content}\n</tool_result>`,
      });
      yield { type: 'tool_result', name: tag.name, content };
      continue;
    }
    // No tool tag → final. Strip any dangling fragment defensively.
    const text = stripToolTags(turn.text);
    transcript.push({ role: 'assistant', content: text });
    const rest = text.slice(emitted);
    if (rest) yield { type: 'text', delta: rest };
    return { status: 'final', text, transcript };
  }

  // Iteration cap — safe, honest stop. Prefer any real prose the model produced
  // along the way; fall back to the canned message so this is NEVER empty.
  const capText = lastText.trim() ? lastText : CAPPED_MESSAGE;
  yield { type: 'text', delta: capText };
  return { status: 'capped', text: capText, transcript };
}
