import { describe, it, expect } from 'vitest';
import { buildHandoffChips } from '@/lib/runtime/handoff';
import type { TreeAgent } from '@/lib/agents/tree';

const TREE: TreeAgent[] = [
  {
    slug: 'bmad-agent-analyst',
    name: 'Mary',
    icon: '📊',
    commands: [{ code: 'BP', description: 'Brainstorm', skill: 'bmad-brainstorming', parity: 'verified', needsSandbox: false }],
  },
  {
    slug: 'bmad-agent-pm',
    name: 'John',
    icon: '📋',
    commands: [
      { code: 'PRD', description: 'Create a PRD', skill: 'bmad-prd', parity: 'verified', needsSandbox: false },
      { code: 'XX', description: 'Greyed', skill: 'bmad-x', parity: 'unverified', needsSandbox: false },
    ],
  },
];

const artifact = { id: 'art-1', title: 'Brainstorm output' };

describe('buildHandoffChips — verified-only + artifact pre-reference (FR-38)', () => {
  it('offers a chip ONLY for verified targets, pre-referencing the artifact', () => {
    const chips = buildHandoffChips({
      tree: TREE,
      artifact,
      self: { agentSlug: 'bmad-agent-analyst', code: 'BP' },
    });
    // John/PRD (verified) is offered; John/XX (unverified) is not; BP (self) excluded.
    expect(chips.map((c) => c.code)).toEqual(['PRD']);
    expect(chips[0].agentSlug).toBe('bmad-agent-pm');
    expect(chips[0].reference).toEqual({ type: 'artifact', id: 'art-1', title: 'Brainstorm output' });
    expect(chips[0].label).toMatch(/John/);
  });

  it('never offers an unverified target', () => {
    const onlyUnverified: TreeAgent[] = [
      { slug: 'a', name: 'A', commands: [{ code: 'U', parity: 'unverified', needsSandbox: false }] },
    ];
    expect(buildHandoffChips({ tree: onlyUnverified, artifact })).toEqual([]);
  });

  it('offers nothing when there is no artifact', () => {
    expect(buildHandoffChips({ tree: TREE, artifact: null })).toEqual([]);
    expect(buildHandoffChips({ tree: TREE, artifact: undefined })).toEqual([]);
  });
});
