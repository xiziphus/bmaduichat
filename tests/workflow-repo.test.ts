import { describe, it, expect } from 'vitest';
import type { QueryFn } from '@/lib/db';
import {
  createRun,
  getRun,
  getActiveRunForConversation,
  updateRun,
  healStaleRuns,
} from '@/lib/repo/workflow-runs';
import { appendRunEvent, listRunEvents } from '@/lib/repo/run-events';

function mockExec(rows: unknown[] = []) {
  const calls: { text: string; params: unknown[] }[] = [];
  const exec: QueryFn = async (text, params = []) => {
    calls.push({ text, params });
    return rows as never;
  };
  return { exec, calls };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('workflow-runs repo — SQL/param shape', () => {
  it('createRun inserts with defaults and serializes state_json', async () => {
    const { exec, calls } = mockExec([{ id: 'r1' }]);
    await createRun({ conversationId: 'c1', skillSlug: 'brainstorm', stateJson: { a: 1 } }, exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain('INSERT INTO workflow_runs (conversation_id, skill_slug, status, phase, state_json)');
    expect(sql).toContain('$5::jsonb');
    expect(sql).toContain('RETURNING');
    expect(calls[0].params).toEqual(['c1', 'brainstorm', 'running', null, JSON.stringify({ a: 1 })]);
  });

  it('createRun defaults state_json to null when absent', async () => {
    const { exec, calls } = mockExec([{ id: 'r1' }]);
    await createRun({ conversationId: 'c1', skillSlug: 'brainstorm' }, exec);
    expect(calls[0].params[4]).toBeNull();
  });

  it('getRun filters by id, null when missing', async () => {
    const { exec, calls } = mockExec([]);
    const out = await getRun('r9', exec);
    expect(norm(calls[0].text)).toContain('WHERE id = $1');
    expect(calls[0].params).toEqual(['r9']);
    expect(out).toBeNull();
  });

  it('getActiveRunForConversation selects resumable statuses, most recent', async () => {
    const { exec, calls } = mockExec([]);
    await getActiveRunForConversation('c1', exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain("status IN ('awaiting_user', 'running')");
    expect(sql).toContain('ORDER BY updated DESC');
    expect(sql).toContain('LIMIT 1');
    expect(calls[0].params).toEqual(['c1']);
  });

  it('updateRun only changes provided fields (guarded phase/state), bumps updated', async () => {
    const { exec, calls } = mockExec([{ id: 'r1' }]);
    await updateRun('r1', { status: 'awaiting_user', stateJson: { s: 1 } }, exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain('updated = now()');
    // status provided; phase NOT provided (guard false); state provided (guard true).
    expect(calls[0].params).toEqual(['r1', 'awaiting_user', null, false, JSON.stringify({ s: 1 }), true]);
  });

  it('updateRun with only phase sets the phase guard true and leaves state guard false', async () => {
    const { exec, calls } = mockExec([{ id: 'r1' }]);
    await updateRun('r1', { phase: 'diverge' }, exec);
    expect(calls[0].params).toEqual(['r1', null, 'diverge', true, null, false]);
  });

  it('healStaleRuns flips stale running rows to awaiting_user', async () => {
    const { exec, calls } = mockExec([]);
    await healStaleRuns(10, exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain("SET status = 'awaiting_user'");
    expect(sql).toContain("status = 'running'");
    expect(sql).toContain("($1 || ' minutes')::interval");
    expect(calls[0].params).toEqual(['10']);
  });
});

describe('run-events repo — SQL/param shape', () => {
  it('appendRunEvent inserts type/text/by (by defaults to mary)', async () => {
    const { exec, calls } = mockExec([{ id: 'e1' }]);
    await appendRunEvent({ runId: 'r1', type: 'idea', text: 'a spark' }, exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain('INSERT INTO run_events (run_id, type, text, by)');
    expect(calls[0].params).toEqual(['r1', 'idea', 'a spark', 'mary']);
  });

  it('appendRunEvent honors an explicit `by`', async () => {
    const { exec, calls } = mockExec([{ id: 'e1' }]);
    await appendRunEvent({ runId: 'r1', type: 'decision', text: 'go', by: 'user' }, exec);
    expect(calls[0].params).toEqual(['r1', 'decision', 'go', 'user']);
  });

  it('listRunEvents orders oldest first', async () => {
    const { exec, calls } = mockExec([]);
    await listRunEvents('r1', exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain('WHERE run_id = $1');
    expect(sql).toContain('ORDER BY created ASC');
    expect(calls[0].params).toEqual(['r1']);
  });
});
