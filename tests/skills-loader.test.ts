import { describe, it, expect } from 'vitest';
import { loadSkill, adaptMechanics } from '@/lib/skills/loader';
import { getManifest, getAgents } from '@/lib/skills/manifest';

describe('loadSkill — agent skill (bmad-agent-analyst)', () => {
  const skill = loadSkill('bmad-agent-analyst');

  it('returns RAW SKILL.md, byte-identical to disk', () => {
    expect(skill.skillMd).toContain('# Mary — Business Analyst');
    // Raw: CLI mechanics are still present (adaptation is opt-in, not at load).
    expect(skill.skillMd).toContain('resolve_customization.py');
  });

  it('exposes the merged [agent] config with its menu', () => {
    const agent = skill.config.agent as Record<string, unknown>;
    expect(agent.name).toBe('Mary');
    expect(agent.icon).toBe('📊');
    const menu = agent.menu as Array<Record<string, unknown>>;
    const bp = menu.find((m) => m.code === 'BP');
    expect(bp?.skill).toBe('bmad-brainstorming');
  });
});

describe('loadSkill — workflow skill (bmad-brainstorming)', () => {
  const skill = loadSkill('bmad-brainstorming');

  it('returns SKILL.md and a merged [workflow] config (no [agent])', () => {
    expect(skill.skillMd).toContain('# BMad Brainstorming');
    expect(skill.config.workflow).toBeDefined();
    expect(skill.config.agent).toBeUndefined();
  });

  it('lists references and reads them lazily on demand', () => {
    expect(skill.references.names).toContain('mode-partner.md');
    expect(skill.references.has('mode-partner.md')).toBe(true);
    expect(skill.references.read('mode-partner.md')).toContain('Yes, and');
  });

  it('returns undefined for a missing reference (no crash)', () => {
    expect(skill.references.has('does-not-exist.md')).toBe(false);
    expect(skill.references.read('does-not-exist.md')).toBeUndefined();
  });
});

describe('loadSkill — errors', () => {
  it('throws a clear error for a missing skill dir', () => {
    expect(() => loadSkill('no-such-skill-xyz')).toThrow(/skill not found/i);
  });
});

describe('adaptMechanics — FR-34 adapter seam', () => {
  it('drops uv run / python script invocations', () => {
    expect(adaptMechanics('Run: `uv run brain.py list` then continue.')).not.toMatch(/uv run/i);
    expect(adaptMechanics('Run `python3 x/resolve_customization.py --skill y`.')).not.toMatch(
      /python3|resolve_customization\.py/i,
    );
  });

  it('strips {placeholder} tokens', () => {
    expect(adaptMechanics('Load {project-root}/config and greet {user_name}.')).not.toMatch(
      /\{[^}]*\}/,
    );
  });

  it('neutralizes memlog / composer-page references', () => {
    const out = adaptMechanics('Append to the memlog and open the composer page.');
    expect(out).not.toMatch(/memlog/i);
    expect(out).not.toMatch(/composer page/i);
  });
});

describe('getManifest — classification', () => {
  const manifest = getManifest();
  const bySlug = (slug: string) => manifest.find((e) => e.slug === slug);

  it('classifies bmad-agent-* with a menu as agents (Mary, John)', () => {
    const mary = bySlug('bmad-agent-analyst');
    expect(mary?.kind).toBe('agent');
    expect(mary?.name).toBe('Mary');
    expect(mary?.icon).toBe('📊');
    expect(mary?.menu?.some((m) => m.code === 'BP' && m.skill === 'bmad-brainstorming')).toBe(true);

    const john = bySlug('bmad-agent-pm');
    expect(john?.kind).toBe('agent');
    expect(john?.name).toBe('John');
    expect((john?.menu?.length ?? 0)).toBeGreaterThan(0);
  });

  it('classifies workflow skills (brainstorming, prd) as skills', () => {
    expect(bySlug('bmad-brainstorming')?.kind).toBe('skill');
    expect(bySlug('bmad-prd')?.kind).toBe('skill');
  });

  it('classifies an [agent] block WITHOUT a menu as a skill (bmad-agent-builder)', () => {
    expect(bySlug('bmad-agent-builder')?.kind).toBe('skill');
  });

  it('surfaces frontmatter description on entries', () => {
    expect(bySlug('bmad-brainstorming')?.description).toMatch(/brainstorming session/i);
  });

  it('getAgents returns only agents, all with menus', () => {
    const agents = getAgents();
    expect(agents.length).toBeGreaterThanOrEqual(2);
    expect(agents.every((a) => a.kind === 'agent' && (a.menu?.length ?? 0) > 0)).toBe(true);
    expect(agents.map((a) => a.slug)).toContain('bmad-agent-analyst');
  });
});
