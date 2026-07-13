import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/route';
import { AUTH_COOKIE, authToken } from '@/lib/auth';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth', () => {
  beforeEach(() => {
    vi.stubEnv('PLAYGROUND_PASSWORD', 'open-sesame');
    vi.stubEnv('AUTH_SECRET', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 and sets no cookie for a wrong password', async () => {
    const res = await POST(makeRequest({ password: 'wrong' }));
    expect(res.status).toBe(401);
    expect(res.cookies.get(AUTH_COOKIE)).toBeUndefined();
  });

  it('returns 401 for a malformed body', async () => {
    const req = new NextRequest('http://localhost/api/auth', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 500 when PLAYGROUND_PASSWORD is missing', async () => {
    vi.stubEnv('PLAYGROUND_PASSWORD', '');
    const res = await POST(makeRequest({ password: 'open-sesame' }));
    expect(res.status).toBe(500);
  });

  it('returns 500 when AUTH_SECRET is missing', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    const res = await POST(makeRequest({ password: 'open-sesame' }));
    expect(res.status).toBe(500);
  });

  it('success sets an httpOnly cookie with the expected HMAC value and flags', async () => {
    const res = await POST(makeRequest({ password: 'open-sesame' }));
    expect(res.status).toBe(200);

    const cookie = res.cookies.get(AUTH_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.value).toBe(await authToken('test-secret'));
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBeGreaterThan(0);
  });
});
