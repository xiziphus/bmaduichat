import { describe, it, expect, afterEach, vi } from 'vitest';
import { isPersistenceEnabled } from '@/lib/db';

describe('isPersistenceEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is false when DATABASE_URL is unset', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(isPersistenceEnabled()).toBe(false);
  });

  it('is false when DATABASE_URL is only whitespace', () => {
    vi.stubEnv('DATABASE_URL', '   ');
    expect(isPersistenceEnabled()).toBe(false);
  });

  it('is true when DATABASE_URL is a non-empty string', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@host/db');
    expect(isPersistenceEnabled()).toBe(true);
  });
});
