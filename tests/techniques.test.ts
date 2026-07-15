import { describe, it, expect } from 'vitest';
import { drawTwo, slugify, categoryEmoji } from '@/lib/techniques';
import { getTechniques, getTechnique } from '@/lib/techniques-catalog';

describe('technique catalog (from brain-methods.csv)', () => {
  const catalog = getTechniques();

  it('loads the FULL BMad catalog, not a curated handful (> 100)', () => {
    expect(catalog.length).toBeGreaterThan(100);
  });

  it('shapes each row as {id, name, category, gist, emoji} with a slug id', () => {
    for (const t of catalog) {
      expect(t.id).toBe(slugify(t.name));
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.category.length).toBeGreaterThan(0);
      expect(t.gist.length).toBeGreaterThan(0);
      expect(t.emoji.length).toBeGreaterThan(0);
    }
  });

  it('carries CSV-only techniques absent from the old curated 8 (Lotus Blossom)', () => {
    const lotus = getTechnique('lotus-blossom');
    expect(lotus?.name).toBe('Lotus Blossom');
    expect(lotus?.gist).toContain('Put the theme at the center of a 3x3 grid');
  });

  it('keeps gists verbatim, including quotes that were escaped in the CSV', () => {
    const yesAnd = catalog.find((t) => t.name === 'Yes And Building');
    expect(yesAnd?.gist).toContain('"Yes, and..."');
  });

  it('gives every category a stable emoji', () => {
    expect(categoryEmoji('deep')).toBe('🔍');
    expect(categoryEmoji('structured')).toBe('🧩');
    expect(categoryEmoji('unknown-category')).toBe('💡');
  });
});

describe('drawTwo (no-repeat contract unchanged)', () => {
  const pool = getTechniques();

  it('draws exactly 2 distinct techniques from the pool', () => {
    for (let i = 0; i < 50; i++) {
      const [a, b] = drawTwo(pool);
      expect(a.id).not.toBe(b.id);
      expect(pool.some((t) => t.id === a.id)).toBe(true);
      expect(pool.some((t) => t.id === b.id)).toBe(true);
    }
  });

  it('never redraws the excluded (currently shown) pair', () => {
    const excluded = [pool[0].id, pool[1].id];
    for (let i = 0; i < 100; i++) {
      const [a, b] = drawTwo(pool, excluded);
      expect(excluded.includes(a.id)).toBe(false);
      expect(excluded.includes(b.id)).toBe(false);
      expect(a.id).not.toBe(b.id);
    }
  });

  it('over-exclusion (all but one excluded) still includes the one allowed technique', () => {
    const allowed = pool[0].id;
    const excluded = pool.slice(1).map((t) => t.id);
    for (let i = 0; i < 100; i++) {
      const [a, b] = drawTwo(pool, excluded);
      expect(a.id).not.toBe(b.id);
      expect([a.id, b.id]).toContain(allowed);
    }
  });

  it('all techniques excluded still returns 2 distinct techniques', () => {
    const excluded = pool.map((t) => t.id);
    for (let i = 0; i < 50; i++) {
      const [a, b] = drawTwo(pool, excluded);
      expect(a.id).not.toBe(b.id);
    }
  });
});
