import { describe, it, expect } from 'vitest';
import type { QueryFn } from '@/lib/db';
import { authMode, issueSession, verifySession } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import {
  listConversations,
  getConversation,
  createConversation,
  searchConversations,
} from '@/lib/repo/conversations';
import { getById, searchArtifacts } from '@/lib/repo/artifacts';

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

const SECRET = 'test-secret-abc';
const UID = '11111111-1111-1111-1111-111111111111';

describe('authMode', () => {
  it('defaults to shared when AUTH_MODE is unset/other', () => {
    const prev = process.env.AUTH_MODE;
    delete process.env.AUTH_MODE;
    expect(authMode()).toBe('shared');
    process.env.AUTH_MODE = 'something';
    expect(authMode()).toBe('shared');
    if (prev === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prev;
  });

  it('is multi only for exactly "multi"', () => {
    const prev = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'multi';
    expect(authMode()).toBe('multi');
    if (prev === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = prev;
  });
});

describe('password hashing (scrypt)', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('wrong horse', stored)).toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('rejects a malformed stored hash', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$deadbeef')).toBe(false);
  });
});

describe('signed session', () => {
  it('round-trips {uid, role}', async () => {
    const cookie = await issueSession({ uid: UID, role: 'admin' }, SECRET);
    expect(await verifySession(cookie, SECRET)).toEqual({ uid: UID, role: 'admin' });
  });

  it('rejects a tampered role (privilege escalation attempt)', async () => {
    const cookie = await issueSession({ uid: UID, role: 'user' }, SECRET);
    const [uid, , sig] = cookie.split('.');
    const forged = `${uid}.admin.${sig}`;
    expect(await verifySession(forged, SECRET)).toBeNull();
  });

  it('rejects a tampered uid and a bad signature', async () => {
    const cookie = await issueSession({ uid: UID, role: 'user' }, SECRET);
    const [, role, sig] = cookie.split('.');
    expect(await verifySession(`22222222.${role}.${sig}`, SECRET)).toBeNull();
    expect(await verifySession(`${UID}.user.deadbeef`, SECRET)).toBeNull();
    expect(await verifySession(cookie, 'other-secret')).toBeNull();
  });
});

describe('per-user isolation (repo owner scoping)', () => {
  it('shared mode (owner null) runs the unscoped SQL — byte-identical', async () => {
    const { exec, calls } = mockExec([]);
    await listConversations(exec, null);
    expect(norm(calls[0].text)).not.toContain('user_id');
  });

  it('multi mode scopes the conversation list to the owner', async () => {
    const { exec, calls } = mockExec([]);
    await listConversations(exec, UID);
    expect(norm(calls[0].text)).toContain('c.user_id = $1');
    expect(calls[0].params).toEqual([UID]);
  });

  it('getConversation returns null for another user (isolation choke point)', async () => {
    // Mock returns [] as if the WHERE id=$1 AND user_id=$2 matched nothing.
    const { exec, calls } = mockExec([]);
    const got = await getConversation('some-id', exec, UID);
    expect(got).toBeNull();
    expect(norm(calls[0].text)).toContain('user_id = $2');
    expect(calls[0].params).toEqual(['some-id', UID]);
  });

  it('createConversation stamps user_id from the owner', async () => {
    const { exec, calls } = mockExec([{ id: 'x' }]);
    await createConversation({ owner: UID }, exec);
    expect(norm(calls[0].text)).toContain('user_id');
    expect(calls[0].params).toEqual([null, 'mary', UID]);
  });

  it('search + artifact reads join on the owning conversation in multi mode', async () => {
    const s = mockExec([]);
    await searchConversations('q', 8, s.exec, UID);
    expect(norm(s.calls[0].text)).toContain('c.user_id = $3');

    const a = mockExec([]);
    await searchArtifacts('q', 8, a.exec, UID);
    expect(norm(a.calls[0].text)).toContain('JOIN conversations');

    const g = mockExec([]);
    await getById('art-id', g.exec, UID);
    expect(norm(g.calls[0].text)).toContain('JOIN conversations');
    expect(g.calls[0].params).toEqual(['art-id', UID]);
  });
});
