import { describe, it, expect } from 'vitest';
import type { QueryFn } from '@/lib/db';
import {
  parseReferences,
  truncate,
  formatBlock,
  resolveReferences,
  PER_REFERENCE_BUDGET,
  RECENT_MESSAGE_LIMIT,
  type Reference,
} from '@/lib/references';

/**
 * Routes queries to canned rows by the table named in the SQL, so a single mock
 * can serve getConversation / listMessages / getById in one resolution pass.
 */
function routerExec(opts: {
  convo?: Record<string, unknown> | null;
  messages?: Record<string, unknown>[];
  artifact?: Record<string, unknown> | null;
}) {
  const calls: { text: string; params: unknown[] }[] = [];
  const exec: QueryFn = async (text, params = []) => {
    calls.push({ text, params });
    if (/FROM conversations/i.test(text)) return (opts.convo ? [opts.convo] : []) as never;
    if (/FROM messages/i.test(text)) return (opts.messages ?? []) as never;
    if (/FROM artifacts/i.test(text)) return (opts.artifact ? [opts.artifact] : []) as never;
    return [] as never;
  };
  return { exec, calls };
}

const convoRef = (id: string): Reference => ({ type: 'conversation', id, title: '' });
const artifactRef = (id: string): Reference => ({ type: 'artifact', id, title: '' });

describe('parseReferences', () => {
  it('keeps valid {type,id} pairs and blanks the title (server owns titles)', () => {
    expect(parseReferences([{ type: 'conversation', id: 'c1', title: 'evil' }])).toEqual([
      { type: 'conversation', id: 'c1', title: '' },
    ]);
  });

  it('drops junk: bad type, missing id, non-objects, non-arrays', () => {
    expect(parseReferences('nope')).toEqual([]);
    expect(parseReferences([{ type: 'x', id: 'c1' }, { type: 'artifact' }, 5, null])).toEqual([]);
  });

  it('dedupes by type:id', () => {
    const out = parseReferences([
      { type: 'artifact', id: 'a1' },
      { type: 'artifact', id: 'a1' },
      { type: 'conversation', id: 'a1' },
    ]);
    expect(out).toEqual([
      { type: 'artifact', id: 'a1', title: '' },
      { type: 'conversation', id: 'a1', title: '' },
    ]);
  });
});

describe('truncate', () => {
  it('leaves short text untouched', () => {
    expect(truncate('short', 100)).toBe('short');
  });
  it('cuts and appends the (truncated) marker', () => {
    const out = truncate('x'.repeat(50), 10);
    expect(out.length).toBeLessThan(50);
    expect(out).toContain('(truncated)');
  });
});

describe('formatBlock', () => {
  it('wraps content in a clearly-delimited, labeled block', () => {
    const block = formatBlock('Travel', 'conversation', 'body');
    expect(block).toBe('--- Referenced: "@Travel" (conversation) ---\nbody\n--- end ---');
  });
});

describe('resolveReferences', () => {
  it('resolves a conversation to its recent messages, cited by title', async () => {
    const { exec } = routerExec({
      convo: { id: 'c1', title: 'Travel pitch' },
      messages: [
        { role: 'user', content: 'hi there' },
        { role: 'assistant', content: 'hey back' },
      ],
    });
    const { context, resolved } = await resolveReferences([convoRef('c1')], exec);
    expect(context).toContain('--- Referenced: "@Travel pitch" (conversation) ---');
    expect(context).toContain('User: hi there');
    expect(context).toContain('Mary: hey back');
    expect(context).toContain('--- end ---');
    expect(resolved).toEqual([
      { type: 'conversation', id: 'c1', title: 'Travel pitch', available: true },
    ]);
  });

  it('only includes the most recent messages (RECENT_MESSAGE_LIMIT)', async () => {
    const messages = Array.from({ length: RECENT_MESSAGE_LIMIT + 5 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    }));
    const { exec } = routerExec({ convo: { id: 'c1', title: 'T' }, messages });
    const { context } = await resolveReferences([convoRef('c1')], exec);
    // Last RECENT_MESSAGE_LIMIT kept; the oldest beyond that dropped.
    expect(context).toContain(`m${RECENT_MESSAGE_LIMIT + 4}`);
    expect(context).toContain(`m${5}`); // first kept (20 msgs → slice(-12) → m5..m19)
    expect(context).not.toContain('m4');
  });

  it('resolves an artifact to its markdown', async () => {
    const { exec } = routerExec({ artifact: { id: 'a1', title: 'Pitch doc', markdown: '## Body here' } });
    const { context, resolved } = await resolveReferences([artifactRef('a1')], exec);
    expect(context).toContain('--- Referenced: "@Pitch doc" (artifact) ---');
    expect(context).toContain('## Body here');
    expect(resolved[0]).toEqual({ type: 'artifact', id: 'a1', title: 'Pitch doc', available: true });
  });

  it('truncates a long reference within the per-reference budget', async () => {
    const big = 'y'.repeat(PER_REFERENCE_BUDGET + 2000);
    const { exec } = routerExec({ artifact: { id: 'a1', title: 'Big', markdown: big } });
    const { context } = await resolveReferences([artifactRef('a1')], exec);
    expect(context).toContain('(truncated)');
    // The block body must not exceed the per-reference budget (+ marker + frame).
    expect(context.length).toBeLessThan(PER_REFERENCE_BUDGET + 200);
  });

  it('marks a deleted/missing reference as unavailable and skips it', async () => {
    const { exec } = routerExec({ convo: null });
    const { context, resolved } = await resolveReferences([convoRef('gone')], exec);
    expect(context).toContain('unavailable');
    expect(resolved[0].available).toBe(false);
  });

  it('returns empty context for no references', async () => {
    const { exec } = routerExec({});
    expect(await resolveReferences([], exec)).toEqual({ context: '', resolved: [] });
  });
});
