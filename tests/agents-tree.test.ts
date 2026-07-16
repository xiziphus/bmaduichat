import { describe, it, expect } from 'vitest';
import { getAgentTree, DEFAULT_AGENT_SLUG } from '@/lib/agents/tree';
import type { ManifestEntry } from '@/lib/skills/manifest';

/** A fixture manifest — the tree must shape from THIS, with zero per-agent code. */
const FIXTURE: ManifestEntry[] = [
  {
    slug: 'bmad-agent-pm',
    kind: 'agent',
    name: 'John',
    icon: '📋',
    menu: [{ code: 'PRD', description: 'Create a PRD', skill: 'bmad-prd' }],
  },
  {
    slug: 'bmad-agent-analyst',
    kind: 'agent',
    name: 'Mary',
    icon: '📊',
    menu: [
      { code: 'BP', description: 'Brainstorm', skill: 'bmad-brainstorming' },
      { code: 'MR', description: 'Market research', skill: 'bmad-market-research' },
    ],
  },
  {
    slug: 'bmad-agent-dev',
    kind: 'agent',
    name: 'Amelia',
    icon: '💻',
    menu: [{ code: 'QD', description: 'Quick dev', skill: 'bmad-quick-dev' }],
  },
];

describe('getAgentTree — manifest→tree projection (FR-40)', () => {
  const tree = getAgentTree(FIXTURE);

  it('puts Mary first (default selection), then the rest by name', () => {
    expect(tree[0].slug).toBe(DEFAULT_AGENT_SLUG);
    expect(tree.map((a) => a.name)).toEqual(['Mary', 'Amelia', 'John']);
  });

  it('carries agent icon + name from the manifest', () => {
    const mary = tree.find((a) => a.slug === 'bmad-agent-analyst')!;
    expect(mary.icon).toBe('📊');
    expect(mary.name).toBe('Mary');
  });

  it('renders each menu item as a command with its skill', () => {
    const mary = tree.find((a) => a.slug === 'bmad-agent-analyst')!;
    expect(mary.commands.map((c) => c.code)).toEqual(['BP', 'MR']);
    expect(mary.commands[0].skill).toBe('bmad-brainstorming');
  });

  it('joins parity from the registry (conversational verified, dev family unverified)', () => {
    const mary = tree.find((a) => a.slug === 'bmad-agent-analyst')!;
    expect(mary.commands.find((c) => c.code === 'BP')!.parity).toBe('verified');
    expect(mary.commands.find((c) => c.code === 'MR')!.parity).toBe('verified');
    const john = tree.find((a) => a.slug === 'bmad-agent-pm')!;
    expect(john.commands[0].parity).toBe('verified'); // PRD → bmad-prd, conversational
    const amelia = tree.find((a) => a.slug === 'bmad-agent-dev')!;
    expect(amelia.commands[0].parity).toBe('unverified'); // QD → bmad-quick-dev, needs sandbox
  });

  it('flags dev-workflow commands as needs-sandbox', () => {
    const amelia = tree.find((a) => a.slug === 'bmad-agent-dev')!;
    expect(amelia.commands[0].needsSandbox).toBe(true);
    const mary = tree.find((a) => a.slug === 'bmad-agent-analyst')!;
    expect(mary.commands.every((c) => c.needsSandbox === false)).toBe(true);
  });
});

describe('getAgentTree — real manifest (DB-independent)', () => {
  it('renders from files with no database configured', () => {
    const tree = getAgentTree();
    expect(tree.length).toBeGreaterThanOrEqual(2);
    // Mary is always first and her BP command is verified.
    expect(tree[0].slug).toBe(DEFAULT_AGENT_SLUG);
    const bp = tree[0].commands.find((c) => c.code === 'BP');
    expect(bp?.parity).toBe('verified');
  });
});
