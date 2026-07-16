import { describe, it, expect } from 'vitest';
import { getAgentActivation } from '@/lib/agents/activation';
import { getAgentTree } from '@/lib/agents/tree';

describe('getAgentActivation — real-file activation payload (Epic D)', () => {
  it('composes Mary from her real config + the files the loader read', () => {
    const a = getAgentActivation('bmad-agent-analyst');
    expect(a.slug).toBe('bmad-agent-analyst');
    expect(a.name).toBe('Mary');
    expect(a.icon).toBe('📊');
    expect(a.title).toBe('Business Analyst');
    expect(a.blurb.length).toBeGreaterThan(0);
    // filesRead lists the ACTUAL files (customize.toml + SKILL.md at minimum).
    expect(a.filesRead).toContain('customize.toml');
    expect(a.filesRead).toContain('SKILL.md');
    expect(a.filesRead.every((f) => typeof f === 'string' && f.length > 0)).toBe(true);
  });

  it('joins the command menu with honest parity (conversational verified, dev-family coming-soon)', () => {
    const a = getAgentActivation('bmad-agent-analyst');
    // Every one of Mary's commands is conversational → engine-runnable → verified.
    const bp = a.commands.find((c) => c.code === 'BP');
    expect(bp?.parity).toBe('verified');
    const mr = a.commands.find((c) => c.code === 'MR');
    expect(mr?.parity).toBe('verified');
    expect(a.commands.length).toBeGreaterThan(0);

    // The dev/sandbox family stays unverified (Amelia's QD → bmad-quick-dev).
    const dev = getAgentActivation('bmad-agent-dev');
    const qd = dev.commands.find((c) => c.code === 'QD');
    expect(qd?.parity).toBe('unverified');
    expect(qd?.needsSandbox).toBe(true);
  });

  it('mirrors the tree exactly — parity/sandbox come from one source of truth', () => {
    const treeAgent = getAgentTree().find((t) => t.slug === 'bmad-agent-analyst');
    const a = getAgentActivation('bmad-agent-analyst');
    expect(a.commands.map((c) => [c.code, c.parity, c.needsSandbox])).toEqual(
      (treeAgent?.commands ?? []).map((c) => [c.code, c.parity, c.needsSandbox]),
    );
  });

  it('composes Winston (architect) with his real icon + menu', () => {
    const a = getAgentActivation('bmad-agent-architect');
    expect(a.name).toBe('Winston');
    expect(a.icon).toBe('🏗️');
    expect(a.commands.some((c) => c.code === 'CA')).toBe(true);
  });

  it('throws for a slug that is not a real skill on disk', () => {
    expect(() => getAgentActivation('no-such-agent-xyz')).toThrow();
  });
});
