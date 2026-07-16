import { describe, it, expect } from 'vitest';
import { planLaunch } from '@/lib/runtime/launch';
import { getAgentTree } from '@/lib/agents/tree';
import type { ManifestEntry } from '@/lib/skills/manifest';
import type { TreeAgent } from '@/lib/agents/tree';

const FIXTURE: ManifestEntry[] = [
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

const tree = getAgentTree(FIXTURE);

describe('planLaunch — descriptor routing', () => {
  it('routes a VERIFIED skill command to the engine', () => {
    const plan = planLaunch('bmad-agent-analyst', 'BP', tree);
    expect(plan?.kind).toBe('skill');
    if (plan?.kind === 'skill') {
      expect(plan.skillSlug).toBe('bmad-brainstorming');
      expect(plan.agentSlug).toBe('bmad-agent-analyst');
    }
  });

  it('routes a VERIFIED conversational (research) command to the engine', () => {
    const plan = planLaunch('bmad-agent-analyst', 'MR', tree);
    expect(plan?.kind).toBe('skill');
    if (plan?.kind === 'skill') {
      expect(plan.skillSlug).toBe('bmad-market-research');
    }
  });

  it('degrades an UNVERIFIED dev-workflow command with a needs-sandbox, note-bearing bubble', () => {
    const plan = planLaunch('bmad-agent-dev', 'QD', tree);
    expect(plan?.kind).toBe('degrade');
    if (plan?.kind === 'degrade') {
      expect(plan.message).toMatch(/sandbox/i);
      expect(plan.message).toMatch(/noted for the builder/i);
    }
  });

  it('routes a VERIFIED prompt-backed command to run its prompt text', () => {
    // A hand-built tree with a verified prompt command (the seed only verifies
    // BP, so we inject a verified prompt to exercise the prompt route).
    const promptTree: TreeAgent[] = [
      {
        slug: 'x-agent',
        name: 'X',
        commands: [
          { code: 'P', description: 'do it', prompt: 'Do the thing now.', parity: 'verified', needsSandbox: false },
        ],
      },
    ];
    const plan = planLaunch('x-agent', 'P', promptTree);
    expect(plan?.kind).toBe('prompt');
    if (plan?.kind === 'prompt') expect(plan.prompt).toBe('Do the thing now.');
  });

  it('returns null for an unknown agent/code', () => {
    expect(planLaunch('nope', 'ZZ', tree)).toBeNull();
    expect(planLaunch('bmad-agent-analyst', 'ZZ', tree)).toBeNull();
  });
});
