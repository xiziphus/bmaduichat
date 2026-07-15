import { describe, it, expect } from 'vitest';
import type { QueryFn } from '@/lib/db';
import {
  listConversations,
  createConversation,
  getConversation,
  setArchived,
} from '@/lib/repo/conversations';
import { listMessages, appendMessage, buildAppendMessageQuery } from '@/lib/repo/messages';
import { listArtifacts } from '@/lib/repo/artifacts';

/** Records the last SQL text + params, returns a canned row set. */
function mockExec(rows: unknown[] = []) {
  const calls: { text: string; params: unknown[] }[] = [];
  const exec: QueryFn = async (text, params = []) => {
    calls.push({ text, params });
    return rows as never;
  };
  return { exec, calls };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('conversations repo — SQL/param shape', () => {
  it('listConversations selects non-archived, newest first, with a title fallback', async () => {
    const { exec, calls } = mockExec([]);
    await listConversations(exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain('FROM conversations c');
    expect(sql).toContain('WHERE c.archived = false');
    expect(sql).toContain('ORDER BY c.created DESC');
    expect(sql).toContain("'New conversation'");
    expect(calls[0].params ?? []).toEqual([]);
  });

  it('createConversation inserts title + agent_slug and returns the row', async () => {
    const row = { id: 'c1', title: null, agent_slug: 'mary', created: 't', archived: false };
    const { exec, calls } = mockExec([row]);
    const out = await createConversation({ title: 'Hi', agentSlug: 'mary' }, exec);
    expect(norm(calls[0].text)).toContain('INSERT INTO conversations (title, agent_slug)');
    expect(calls[0].params).toEqual(['Hi', 'mary']);
    expect(out).toEqual(row);
  });

  it('createConversation defaults title=null and agent_slug=mary', async () => {
    const { exec, calls } = mockExec([{ id: 'c1' }]);
    await createConversation({}, exec);
    expect(calls[0].params).toEqual([null, 'mary']);
  });

  it('getConversation filters by id and returns null when absent', async () => {
    const { exec, calls } = mockExec([]);
    const out = await getConversation('c9', exec);
    expect(norm(calls[0].text)).toContain('WHERE id = $1');
    expect(calls[0].params).toEqual(['c9']);
    expect(out).toBeNull();
  });

  it('setArchived updates the flag and returns the row', async () => {
    const row = { id: 'c1', title: null, agent_slug: 'mary', created: 't', archived: true };
    const { exec, calls } = mockExec([row]);
    const out = await setArchived('c1', true, exec);
    expect(norm(calls[0].text)).toContain('SET archived = $2');
    expect(calls[0].params).toEqual(['c1', true]);
    expect(out).toEqual(row);
  });
});

describe('messages repo — SQL/param shape', () => {
  it('listMessages orders by monotonic seq (not created) and aliases chips_json', async () => {
    const { exec, calls } = mockExec([]);
    await listMessages('c1', exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain('chips_json AS chips');
    expect(sql).toContain('WHERE conversation_id = $1');
    expect(sql).toContain('ORDER BY seq ASC');
    expect(sql).not.toContain('ORDER BY created');
    expect(calls[0].params).toEqual(['c1']);
  });

  it('appendMessage serializes chips to JSON when present', async () => {
    const { exec, calls } = mockExec([{ id: 'm1' }]);
    await appendMessage(
      { conversationId: 'c1', role: 'assistant', content: 'hey', chips: ['a', 'b'] },
      exec,
    );
    expect(norm(calls[0].text)).toContain('INSERT INTO messages (conversation_id, role, content, chips_json)');
    expect(calls[0].params).toEqual(['c1', 'assistant', 'hey', JSON.stringify(['a', 'b'])]);
  });

  it('buildAppendMessageQuery produces an INSERT with no RETURNING (transaction-safe)', () => {
    const q = buildAppendMessageQuery({ conversationId: 'c1', role: 'user', content: 'hi' });
    expect(norm(q.text)).toContain('INSERT INTO messages (conversation_id, role, content, chips_json)');
    expect(norm(q.text)).not.toContain('RETURNING');
    expect(q.params).toEqual(['c1', 'user', 'hi', null]);
  });

  it('appendMessage stores null chips for user messages / empty arrays', async () => {
    const { exec, calls } = mockExec([{ id: 'm1' }]);
    await appendMessage({ conversationId: 'c1', role: 'user', content: 'hi' }, exec);
    expect(calls[0].params).toEqual(['c1', 'user', 'hi', null]);

    const { exec: exec2, calls: calls2 } = mockExec([{ id: 'm2' }]);
    await appendMessage({ conversationId: 'c1', role: 'assistant', content: 'x', chips: [] }, exec2);
    expect(calls2[0].params?.[3]).toBeNull();
  });
});

describe('artifacts repo — stub accessor', () => {
  it('listArtifacts filters by conversation and returns rows', async () => {
    const { exec, calls } = mockExec([]);
    const out = await listArtifacts('c1', exec);
    expect(norm(calls[0].text)).toContain('FROM artifacts');
    expect(calls[0].params).toEqual(['c1']);
    expect(out).toEqual([]);
  });
});
