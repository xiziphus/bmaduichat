import { describe, it, expect } from 'vitest';
import { TECHNIQUES, drawTwo } from '@/lib/techniques';

describe('drawTwo', () => {
  it('draws exactly 2 distinct techniques from the pool', () => {
    for (let i = 0; i < 50; i++) {
      const [a, b] = drawTwo();
      expect(a.id).not.toBe(b.id);
      expect(TECHNIQUES.some((t) => t.id === a.id)).toBe(true);
      expect(TECHNIQUES.some((t) => t.id === b.id)).toBe(true);
    }
  });

  it('never redraws the excluded (currently shown) pair', () => {
    const excluded = [TECHNIQUES[0].id, TECHNIQUES[1].id];
    for (let i = 0; i < 100; i++) {
      const [a, b] = drawTwo(excluded);
      const ids = [a.id, b.id];
      // The drawn pair must not be exactly the excluded pair (in either order),
      // and individually neither drawn id should be from the excluded set.
      expect(excluded.includes(a.id)).toBe(false);
      expect(excluded.includes(b.id)).toBe(false);
      expect(ids[0]).not.toBe(ids[1]);
    }
  });

  it('over-exclusion (7 of 8 excluded) still includes the one allowed technique', () => {
    const allowed = TECHNIQUES[0].id;
    const excluded = TECHNIQUES.slice(1).map((t) => t.id);
    for (let i = 0; i < 100; i++) {
      const [a, b] = drawTwo(excluded);
      expect(a.id).not.toBe(b.id);
      // The single non-excluded technique must always be in the drawn pair.
      expect([a.id, b.id]).toContain(allowed);
    }
  });

  it('all techniques excluded still returns 2 distinct techniques (nothing left to respect)', () => {
    const excluded = TECHNIQUES.map((t) => t.id);
    for (let i = 0; i < 50; i++) {
      const [a, b] = drawTwo(excluded);
      expect(a.id).not.toBe(b.id);
    }
  });
});
