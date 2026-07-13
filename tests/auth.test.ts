import { describe, it, expect } from 'vitest';
import { authToken, safeEqual, verifyAuthCookie } from '@/lib/auth';

describe('authToken / safeEqual', () => {
  it('produces a deterministic hex HMAC for a given secret', async () => {
    const a = await authToken('my-secret');
    const b = await authToken('my-secret');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different tokens for different secrets', async () => {
    const a = await authToken('secret-one');
    const b = await authToken('secret-two');
    expect(a).not.toBe(b);
  });

  it('safeEqual is true for identical strings and false otherwise', async () => {
    expect(await safeEqual('abc', 'abc')).toBe(true);
    expect(await safeEqual('abc', 'abd')).toBe(false);
    expect(await safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('verifyAuthCookie', () => {
  it('accepts the correct token for the configured secret', async () => {
    const secret = 'AUTH_SECRET_VALUE';
    const token = await authToken(secret);
    expect(await verifyAuthCookie(token, secret)).toBe(true);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await authToken('wrong-secret');
    expect(await verifyAuthCookie(token, 'AUTH_SECRET_VALUE')).toBe(false);
  });

  it('rejects when the cookie value is missing', async () => {
    expect(await verifyAuthCookie(undefined, 'AUTH_SECRET_VALUE')).toBe(false);
  });

  it('rejects when the secret is not configured', async () => {
    const token = await authToken('anything');
    expect(await verifyAuthCookie(token, undefined)).toBe(false);
  });
});
