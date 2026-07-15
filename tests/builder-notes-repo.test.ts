import { describe, it, expect } from 'vitest';
import type { QueryFn } from '@/lib/db';
import {
  buildInsertBuilderNoteQuery,
  insertBuilderNote,
  listBuilderNotes,
  markBuilderNotesSent,
} from '@/lib/repo/builder-notes';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function mockExec(rows: unknown[] = []) {
  const calls: { text: string; params: unknown[] }[] = [];
  const exec: QueryFn = async (text, params = []) => {
    calls.push({ text, params });
    return rows as never;
  };
  return { exec, calls };
}

describe('builder-notes repo — SQL/param shape', () => {
  it('buildInsertBuilderNoteQuery inserts conversation_id + excerpt (status defaults collected)', () => {
    const q = buildInsertBuilderNoteQuery({ conversationId: 'c1', excerpt: 'noted for the builder' });
    expect(norm(q.text)).toContain('INSERT INTO builder_notes (conversation_id, excerpt)');
    expect(norm(q.text)).not.toContain('status');
    expect(q.params).toEqual(['c1', 'noted for the builder']);
  });

  it('buildInsertBuilderNoteQuery defaults a missing conversation id to null', () => {
    const q = buildInsertBuilderNoteQuery({ excerpt: 'x' });
    expect(q.params).toEqual([null, 'x']);
  });

  it('insertBuilderNote executes the INSERT', async () => {
    const { exec, calls } = mockExec([]);
    await insertBuilderNote({ conversationId: 'c1', excerpt: 'e' }, exec);
    expect(norm(calls[0].text)).toContain('INSERT INTO builder_notes');
    expect(calls[0].params).toEqual(['c1', 'e']);
  });

  it('listBuilderNotes filters by status when given, newest first', async () => {
    const { exec, calls } = mockExec([]);
    await listBuilderNotes('collected', exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain('FROM builder_notes');
    expect(sql).toContain('WHERE status = $1');
    expect(sql).toContain('ORDER BY created DESC');
    expect(calls[0].params).toEqual(['collected']);
  });

  it('listBuilderNotes lists all statuses when none given (no WHERE)', async () => {
    const { exec, calls } = mockExec([]);
    await listBuilderNotes(undefined, exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain('FROM builder_notes');
    expect(sql).not.toContain('WHERE');
    expect(sql).toContain('ORDER BY created DESC');
    expect(calls[0].params ?? []).toEqual([]);
  });

  it('markBuilderNotesSent flips the given ids to sent', async () => {
    const { exec, calls } = mockExec([]);
    await markBuilderNotesSent(['a', 'b'], exec);
    const sql = norm(calls[0].text);
    expect(sql).toContain("SET status = 'sent'");
    expect(sql).toContain('WHERE id = ANY($1::uuid[])');
    expect(calls[0].params).toEqual([['a', 'b']]);
  });

  it('markBuilderNotesSent is a no-op for an empty id list', async () => {
    const { exec, calls } = mockExec([]);
    await markBuilderNotesSent([], exec);
    expect(calls).toEqual([]);
  });
});
