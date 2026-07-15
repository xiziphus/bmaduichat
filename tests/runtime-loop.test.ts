import { describe, it, expect } from 'vitest';
import {
  runLoop,
  parseToolTag,
  stripToolTags,
  structuredToolInstructions,
  CAPPED_MESSAGE,
  DEFAULT_MAX_ITERATIONS,
} from '@/lib/runtime/loop';
import { TOOL_SCHEMAS } from '@/lib/runtime/tools';
import type {
  ModelClient,
  ModelTurn,
  ToolExecutor,
  RunEvent,
  LoopResult,
} from '@/lib/runtime/types';

const noUsage = { tokensIn: null, tokensOut: null };

/** A scripted model: returns queued turns in order; throws if over-drawn. */
function scriptedModel(turns: ModelTurn[]): { client: ModelClient; seen: { tools: boolean }[] } {
  const seen: { tools: boolean }[] = [];
  let i = 0;
  const client: ModelClient = async (_system, _messages, tools) => {
    seen.push({ tools: Array.isArray(tools) });
    if (i >= turns.length) throw new Error('model over-drawn');
    return turns[i++];
  };
  return { client, seen };
}

/** Collect all events + the generator's return value. */
async function drain(
  gen: AsyncGenerator<RunEvent, LoopResult, void>,
): Promise<{ events: RunEvent[]; result: LoopResult }> {
  const events: RunEvent[] = [];
  let res = await gen.next();
  while (!res.done) {
    events.push(res.value);
    res = await gen.next();
  }
  return { events, result: res.value };
}

const echoExecutor: ToolExecutor = async ({ name, args }) => {
  if (name === 'request_checkpoint') {
    return { kind: 'halt', prompt: String((args as { prompt?: string }).prompt ?? '') };
  }
  return { kind: 'result', content: `ran ${name}` };
};

describe('runLoop — native tools', () => {
  it('executes a tool round, feeds the result back, then streams final text', async () => {
    const { client, seen } = scriptedModel([
      { text: '', toolCalls: [{ id: 'c0', name: 'technique_query', args: { kind: 'list' } }], usage: noUsage },
      { text: 'Here are some techniques.', toolCalls: [], usage: noUsage },
    ]);
    const { events, result } = await drain(
      runLoop({
        model: client,
        system: 'sys',
        transcript: [{ role: 'user', content: 'go' }],
        tools: TOOL_SCHEMAS,
        supportsTools: true,
        executeTool: echoExecutor,
      }),
    );
    expect(result.status).toBe('final');
    if (result.status === 'final') expect(result.text).toBe('Here are some techniques.');
    // tool round surfaced, result fed back, final text emitted
    expect(events.some((e) => e.type === 'tool' && e.name === 'technique_query')).toBe(true);
    expect(events.some((e) => e.type === 'tool_result' && e.content === 'ran technique_query')).toBe(true);
    expect(events.some((e) => e.type === 'text' && e.delta === 'Here are some techniques.')).toBe(true);
    // native mode passes the tool set on every turn
    expect(seen.every((s) => s.tools)).toBe(true);
    // transcript recorded assistant tool-call turn + tool result + final
    if (result.status === 'final') {
      const roles = result.transcript.map((m) => m.role);
      expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
    }
  });

  it('HALTs on request_checkpoint without a further model turn', async () => {
    const { client } = scriptedModel([
      {
        text: '',
        toolCalls: [{ id: 'c0', name: 'request_checkpoint', args: { prompt: 'Pick a lane?' } }],
        usage: noUsage,
      },
    ]);
    const { result } = await drain(
      runLoop({
        model: client,
        system: 'sys',
        transcript: [{ role: 'user', content: 'go' }],
        tools: TOOL_SCHEMAS,
        supportsTools: true,
        executeTool: echoExecutor,
      }),
    );
    expect(result.status).toBe('halt');
    if (result.status === 'halt') expect(result.prompt).toBe('Pick a lane?');
  });

  it('stops safely at the iteration cap with an honest message', async () => {
    // Always returns a tool call → would loop forever without the cap.
    const client: ModelClient = async () => ({
      text: '',
      toolCalls: [{ id: 'c', name: 'technique_query', args: { kind: 'list' } }],
      usage: noUsage,
    });
    const { events, result } = await drain(
      runLoop({
        model: client,
        system: 'sys',
        transcript: [{ role: 'user', content: 'go' }],
        tools: TOOL_SCHEMAS,
        supportsTools: true,
        executeTool: echoExecutor,
        maxIterations: 3,
      }),
    );
    expect(result.status).toBe('capped');
    expect(events.some((e) => e.type === 'text' && e.delta === CAPPED_MESSAGE)).toBe(true);
  });

  it('an unknown/throwing tool never kills the loop', async () => {
    const throwing: ToolExecutor = async () => {
      throw new Error('boom');
    };
    const { client } = scriptedModel([
      { text: '', toolCalls: [{ id: 'c0', name: 'read_reference', args: {} }], usage: noUsage },
      { text: 'recovered', toolCalls: [], usage: noUsage },
    ]);
    const { result } = await drain(
      runLoop({
        model: client,
        system: 'sys',
        transcript: [{ role: 'user', content: 'go' }],
        tools: TOOL_SCHEMAS,
        supportsTools: true,
        executeTool: throwing,
      }),
    );
    expect(result.status).toBe('final');
    if (result.status === 'final') {
      const toolResult = result.transcript.find((m) => m.role === 'tool');
      expect(toolResult && 'content' in toolResult ? toolResult.content : '').toContain('failed');
    }
  });
});

describe('runLoop — structured-text fallback', () => {
  it('parses a <tool> tag, executes it, feeds a <tool_result> back, then finalizes', async () => {
    const { client, seen } = scriptedModel([
      { text: '<tool name="technique_query">{"kind":"list"}</tool>', toolCalls: [], usage: noUsage },
      { text: 'All done.', toolCalls: [], usage: noUsage },
    ]);
    const { events, result } = await drain(
      runLoop({
        model: client,
        system: 'sys',
        transcript: [{ role: 'user', content: 'go' }],
        tools: TOOL_SCHEMAS,
        supportsTools: false,
        executeTool: echoExecutor,
      }),
    );
    expect(result.status).toBe('final');
    if (result.status === 'final') expect(result.text).toBe('All done.');
    // fallback never sends a tool set to the model
    expect(seen.every((s) => !s.tools)).toBe(true);
    // the result was fed back as a user <tool_result> turn
    if (result.status === 'final') {
      const fed = result.transcript.find(
        (m) => m.role === 'user' && 'content' in m && m.content.includes('<tool_result'),
      );
      expect(fed).toBeTruthy();
    }
    expect(events.some((e) => e.type === 'tool' && e.name === 'technique_query')).toBe(true);
  });

  it('HALTs via a <tool> request_checkpoint tag', async () => {
    const { client } = scriptedModel([
      { text: '<tool name="request_checkpoint">{"prompt":"Which theme?"}</tool>', toolCalls: [], usage: noUsage },
    ]);
    const { result } = await drain(
      runLoop({
        model: client,
        system: 'sys',
        transcript: [{ role: 'user', content: 'go' }],
        tools: TOOL_SCHEMAS,
        supportsTools: false,
        executeTool: echoExecutor,
      }),
    );
    expect(result.status).toBe('halt');
    if (result.status === 'halt') expect(result.prompt).toBe('Which theme?');
  });

  it('plain text (no tag) is a final turn', async () => {
    const { client } = scriptedModel([{ text: 'Just chatting.', toolCalls: [], usage: noUsage }]);
    const { result } = await drain(
      runLoop({
        model: client,
        system: 'sys',
        transcript: [{ role: 'user', content: 'go' }],
        tools: TOOL_SCHEMAS,
        supportsTools: false,
        executeTool: echoExecutor,
      }),
    );
    expect(result.status).toBe('final');
    if (result.status === 'final') expect(result.text).toBe('Just chatting.');
  });

  it('a NON-tool-capable model reply with a <chips> block (no <tool>) is final, chips preserved', async () => {
    // The exact shape tencent/hy3:free returns on a simple "hi": prose + chips,
    // no tool call. It must be treated as the final answer and streamed verbatim.
    const reply =
      "Hi! What are you chewing on?\n" +
      '<chips>["🔥 Pressure-test it","⛏️ Keep digging"]</chips>';
    const { client } = scriptedModel([{ text: reply, toolCalls: [], usage: noUsage }]);
    const { events, result } = await drain(
      runLoop({
        model: client,
        system: 'sys',
        transcript: [{ role: 'user', content: 'hi' }],
        tools: TOOL_SCHEMAS,
        supportsTools: false,
        executeTool: echoExecutor,
      }),
    );
    expect(result.status).toBe('final');
    if (result.status === 'final') expect(result.text).toBe(reply);
    // The chips block survives to the streamed text event (nothing stripped).
    const textEv = events.find((e) => e.type === 'text');
    expect(textEv && textEv.type === 'text' ? textEv.delta : '').toBe(reply);
    expect(textEv && textEv.type === 'text' ? textEv.delta : '').toContain('<chips>[');
  });

  it('the iteration cap surfaces real prose the model produced, not just the canned message', async () => {
    // A tool-happy weak model that always emits prose + a tool tag, never a clean
    // final. At the cap we should see its last prose, never an empty turn.
    const client: ModelClient = async () => ({
      text: 'Here is a thought <tool name="technique_query">{"kind":"list"}</tool>',
      toolCalls: [],
      usage: noUsage,
    });
    const { events, result } = await drain(
      runLoop({
        model: client,
        system: 'sys',
        transcript: [{ role: 'user', content: 'go' }],
        tools: TOOL_SCHEMAS,
        supportsTools: false,
        executeTool: echoExecutor,
        maxIterations: 2,
      }),
    );
    expect(result.status).toBe('capped');
    const capEv = events.find((e) => e.type === 'text');
    const delta = capEv && capEv.type === 'text' ? capEv.delta : '';
    expect(delta).toBe('Here is a thought');
    expect(delta.length).toBeGreaterThan(0);
  });
});

describe('parseToolTag / stripToolTags', () => {
  it('parses name + JSON body args', () => {
    expect(parseToolTag('<tool name="read_reference">{"name":"m.md"}</tool>')).toEqual({
      name: 'read_reference',
      args: { name: 'm.md' },
    });
  });
  it('malformed args → empty args (loop re-prompts, no throw)', () => {
    expect(parseToolTag('<tool name="foo">not json</tool>')).toEqual({ name: 'foo', args: {} });
  });
  it('no tag → null', () => {
    expect(parseToolTag('hello world')).toBeNull();
  });
  it('strips complete blocks and dangling opens', () => {
    expect(stripToolTags('a <tool name="x">{}</tool> b')).toBe('a  b');
    expect(stripToolTags('text <tool name="x">{"a":1')).toBe('text');
  });
  it('instructions list every tool name', () => {
    const txt = structuredToolInstructions(TOOL_SCHEMAS);
    for (const t of TOOL_SCHEMAS) expect(txt).toContain(t.name);
  });
});

describe('constants', () => {
  it('default cap is 12', () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(12);
  });
});
