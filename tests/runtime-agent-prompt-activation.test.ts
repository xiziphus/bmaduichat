import { describe, it, expect, vi } from 'vitest';

/**
 * Fix A — buildAgentPersona executes activation steps and loads persistent facts
 * from the merged [agent] config. Shipped agents ship EMPTY arrays today, so this
 * is mostly dormant plumbing; these tests prove it's no longer silently ignored
 * when an agent IS customized, and injects nothing when the arrays are empty.
 *
 * We mock the skills loader to return synthetic agent configs for two fixture
 * slugs (real slugs still delegate to the actual loader), and write a temp file
 * on disk for the resolvable `file:` fact.
 */
const { RESOLVES, MISSES, RESOLVED_TEXT } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fact-'));
  const resolves = path.join(dir, 'fact.md');
  const resolvedText = 'RESOLVED FACT CONTENT loaded from disk.';
  fs.writeFileSync(resolves, resolvedText, 'utf8');
  return { RESOLVES: resolves, MISSES: path.join(dir, 'nope.md'), RESOLVED_TEXT: resolvedText };
});

vi.mock('@/lib/skills/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/skills/loader')>();
  const noRefs = { names: [], has: () => false, read: () => undefined };
  return {
    ...actual,
    loadSkill: (slug: string) => {
      if (slug === 'fixture-agent') {
        return {
          slug,
          skillMd: '',
          references: noRefs,
          config: {
            agent: {
              name: 'Fixie',
              title: 'Fixture Agent',
              icon: '🧪',
              activation_steps_prepend: ['Load the project brief', 'Greet the user'],
              activation_steps_append: ['Confirm the scope before proceeding'],
              persistent_facts: ['The team ships weekly.', `file:${RESOLVES}`, `file:${MISSES}`],
            },
          },
        };
      }
      if (slug === 'fixture-empty') {
        return {
          slug,
          skillMd: '',
          references: noRefs,
          config: {
            agent: {
              name: 'Emmy',
              title: 'Empty Agent',
              icon: '🫥',
              activation_steps_prepend: [],
              activation_steps_append: [],
              persistent_facts: [],
            },
          },
        };
      }
      return actual.loadSkill(slug);
    },
  };
});

// Import AFTER the mock is registered.
const { buildAgentPersona } = await import('@/lib/runtime/agent-prompt');

describe('buildAgentPersona — activation steps + persistent facts (Fix A)', () => {
  it('injects prepend-then-append activation steps and literal + resolved-file facts', () => {
    const p = buildAgentPersona('fixture-agent');

    // Activation block, prepend steps first, then append steps, numbered in order.
    expect(p).toContain('On activation, perform these steps:');
    expect(p).toContain('1. Load the project brief');
    expect(p).toContain('2. Greet the user');
    expect(p).toContain('3. Confirm the scope before proceeding');

    // Persistent facts: literal fact as a bullet, resolved file contents inlined.
    expect(p).toContain('Persistent facts / context:');
    expect(p).toContain('- The team ships weekly.');
    expect(p).toContain(RESOLVED_TEXT);

    // The unresolved file: fact is skipped silently — no broken path/token leaks.
    expect(p).not.toContain(MISSES);
    expect(p).not.toContain('file:');
  });

  it('injects NOTHING for empty arrays (persona unchanged from today)', () => {
    const p = buildAgentPersona('fixture-empty');
    expect(p).toContain('You are Emmy, the Empty Agent.');
    expect(p).not.toContain('On activation, perform these steps:');
    expect(p).not.toContain('Persistent facts / context:');
  });
});
