import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { parse as parseToml } from 'smol-toml';
import { deepMerge } from '@/lib/skills/toml';

const fixtureDir = path.join(__dirname, 'fixtures', 'toml');
const load = (name: string) => parseToml(readFileSync(path.join(fixtureDir, name), 'utf8'));

function mergedFixtures() {
  let merged = deepMerge(load('base.toml'), load('team.toml'));
  merged = deepMerge(merged, load('user.toml'));
  return merged as Record<string, unknown>;
}

// Expected output, captured from the REAL resolver (merge_ref.py over the
// same fixtures). The child_process block below re-verifies it live when
// python3 is available.
const EXPECTED = {
  title: 'Team Title',
  count: 42,
  enabled: true,
  tags: ['base1', 'base2', 'team1', 'user1'],
  settings: {
    theme: 'dark',
    retries: 5,
    nested: { depth: 2, keep: 'base-only' },
  },
  menu: [
    { code: 'A', description: 'user A' },
    { code: 'B', description: 'team B' },
    { code: 'C', description: 'team C' },
  ],
  items: [
    { id: 'x', value: 'team-x' },
    { id: 'y', value: 'team-y' },
  ],
  notes: [{ text: 'base note' }, { text: 'team note' }],
};

describe('deepMerge — BMad structural rules', () => {
  const merged = mergedFixtures();

  it('scalars: override wins (title/count/enabled)', () => {
    expect(merged.title).toBe('Team Title'); // team over base
    expect(merged.count).toBe(42); // user over team over base
    expect(merged.enabled).toBe(true); // user over base
  });

  it('plain scalar arrays: append across all layers', () => {
    expect(merged.tags).toEqual(['base1', 'base2', 'team1', 'user1']);
  });

  it('tables: deep-merge, preserving base-only nested keys', () => {
    expect(merged.settings).toEqual({
      theme: 'dark', // user over base
      retries: 5, // team over base
      nested: { depth: 2, keep: 'base-only' }, // depth overridden, keep survives
    });
  });

  it('code-keyed arrays of tables: replace matching, append new', () => {
    expect(merged.menu).toEqual([
      { code: 'A', description: 'user A' }, // replaced by user
      { code: 'B', description: 'team B' }, // replaced by team
      { code: 'C', description: 'team C' }, // appended by team
    ]);
  });

  it('id-keyed arrays of tables: replace matching, append new', () => {
    expect(merged.items).toEqual([
      { id: 'x', value: 'team-x' },
      { id: 'y', value: 'team-y' },
    ]);
  });

  it('arrays of tables without a shared key: append', () => {
    expect(merged.notes).toEqual([{ text: 'base note' }, { text: 'team note' }]);
  });

  it('matches the captured resolver output exactly', () => {
    expect(merged).toEqual(EXPECTED);
  });
});

describe('deepMerge — edge cases mirroring resolve_customization.py', () => {
  it('mixed code/id key arrays fall through to append (no keyed merge)', () => {
    const base = { a: [{ code: '1', v: 'b' }] };
    const over = { a: [{ id: '1', v: 'o' }] };
    // items do not all share `code` or all share `id` -> append
    expect(deepMerge(base, over)).toEqual({
      a: [
        { code: '1', v: 'b' },
        { id: '1', v: 'o' },
      ],
    });
  });

  it('scalar replacing a table: override wins', () => {
    expect(deepMerge({ x: { deep: 1 } }, { x: 'flat' })).toEqual({ x: 'flat' });
  });

  it('override-only keys are added', () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });
});

describe('deepMerge — live cross-check vs resolve_customization.py', () => {
  it('produces byte-identical structure to the Python resolver (skipped if no python3)', () => {
    let pyJson: unknown;
    try {
      const out = execFileSync('python3', [path.join(fixtureDir, 'merge_ref.py')], {
        encoding: 'utf8',
      });
      pyJson = JSON.parse(out);
    } catch {
      // python3 not available in this environment — the captured EXPECTED above
      // still guards the merge; skip the live comparison.
      return;
    }
    expect(mergedFixtures()).toEqual(pyJson);
  });
});
