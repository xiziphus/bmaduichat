import { describe, it, expect } from 'vitest';
import { TOOL_SCHEMAS, createToolExecutor, type ToolContext } from '@/lib/runtime/tools';

const TECHNIQUES = [
  { id: 'six-hats', name: 'Six Hats', category: 'structured', gist: 'wear roles' },
  { id: 'scamper', name: 'SCAMPER', category: 'structured', gist: 'transform' },
];

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    conversationId: 'c1',
    runId: 'r1',
    skillSlug: 'brainstorm',
    persistence: true,
    techniques: () => TECHNIQUES,
    readReference: () => '# a reference',
    ...over,
  };
}

describe('TOOL_SCHEMAS', () => {
  it('declares the fixed BMad-op set with JSON-schema parameters', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name);
    expect(names).toEqual([
      'read_reference',
      'memlog_init',
      'memlog_append',
      'memlog_set',
      'write_artifact',
      'list_outputs',
      'technique_query',
      'request_checkpoint',
    ]);
    for (const t of TOOL_SCHEMAS) {
      expect(t.parameters).toHaveProperty('type', 'object');
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});

describe('createToolExecutor', () => {
  it('request_checkpoint returns a HALT with the prompt', async () => {
    const exec = createToolExecutor(ctx());
    const r = await exec({ name: 'request_checkpoint', args: { prompt: 'Choose?' } });
    expect(r).toEqual({ kind: 'halt', prompt: 'Choose?' });
  });

  it('read_reference returns content and reports misses', async () => {
    const exec = createToolExecutor(ctx({ readReference: (_s, n) => (n === 'hit.md' ? 'BODY' : undefined) }));
    expect(await exec({ name: 'read_reference', args: { name: 'hit.md' } })).toEqual({
      kind: 'result',
      content: 'BODY',
    });
    const miss = await exec({ name: 'read_reference', args: { name: 'no.md' } });
    expect(miss.kind).toBe('result');
    if (miss.kind === 'result') expect(miss.content).toContain('not found');
  });

  it('memlog_append persists via injected appendEvent (type passthrough)', async () => {
    const events: unknown[] = [];
    const exec = createToolExecutor(ctx({ appendEvent: async (e) => void events.push(e) }));
    const r = await exec({ name: 'memlog_append', args: { type: 'idea', text: 'spark' } });
    expect(r).toEqual({ kind: 'result', content: 'ok: recorded.' });
    expect(events).toEqual([{ type: 'idea', text: 'spark', by: 'mary' }]);
  });

  it('memlog_set records a decision entry', async () => {
    const events: { type: string }[] = [];
    const exec = createToolExecutor(ctx({ appendEvent: async (e) => void events.push(e) }));
    await exec({ name: 'memlog_set', args: { text: 'chose A' } });
    expect(events[0].type).toBe('decision');
  });

  it('write_artifact writes via injected writer and reports id/version', async () => {
    const exec = createToolExecutor(ctx({ writeArtifact: async () => ({ id: 'a1', version: 2 }) }));
    const r = await exec({ name: 'write_artifact', args: { title: 'Doc', markdown: '# hi' } });
    expect(r.kind).toBe('result');
    if (r.kind === 'result') expect(r.content).toContain('version=2');
  });

  it('technique_query list / show / random', async () => {
    const exec = createToolExecutor(ctx());
    const list = await exec({ name: 'technique_query', args: { kind: 'list' } });
    if (list.kind === 'result') expect(list.content).toContain('Six Hats');
    const show = await exec({ name: 'technique_query', args: { kind: 'show', name: 'SCAMPER' } });
    if (show.kind === 'result') expect(show.content).toContain('transform');
    const rnd = await exec({ name: 'technique_query', args: { kind: 'random', count: 2 } });
    if (rnd.kind === 'result') expect(rnd.content.split('\n').length).toBe(2);
  });

  it('unknown tool → safe error result', async () => {
    const r = await createToolExecutor(ctx())({ name: 'launch_missiles', args: {} });
    expect(r.kind).toBe('result');
    if (r.kind === 'result') expect(r.content).toContain('unknown tool');
  });

  it('DB-off: persistence tools no-op-return an honest note (never throw)', async () => {
    const exec = createToolExecutor(ctx({ persistence: false, runId: null }));
    const mem = await exec({ name: 'memlog_append', args: { type: 'idea', text: 'x' } });
    const art = await exec({ name: 'write_artifact', args: { markdown: '# hi' } });
    const out = await exec({ name: 'list_outputs', args: {} });
    for (const r of [mem, art, out]) {
      expect(r.kind).toBe('result');
      if (r.kind === 'result') expect(r.content).toContain('no database configured');
    }
    // technique_query + read_reference still work with no DB
    const t = await exec({ name: 'technique_query', args: { kind: 'list' } });
    expect(t.kind).toBe('result');
  });
});
