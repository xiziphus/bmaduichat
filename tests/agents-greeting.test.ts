import { describe, it, expect } from 'vitest';
import {
  composeStatusLine,
  composeWelcome,
  type AgentActivation,
} from '@/lib/agents/greeting';

const fixture: AgentActivation = {
  slug: 'bmad-agent-architect',
  name: 'Winston',
  icon: '🏗️',
  title: 'System Architect',
  blurb: 'Convert the PRD and UX into technical architecture decisions',
  filesRead: ['customize.toml', 'SKILL.md', 'references/architecture-styles.md'],
  commands: [
    { code: 'BP', description: 'Guided brainstorming', parity: 'verified', needsSandbox: false },
    { code: 'CA', description: 'Produce the architecture', parity: 'unverified', needsSandbox: false },
    { code: 'QD', description: 'Quick dev', parity: 'unverified', needsSandbox: true },
  ],
};

describe('composeStatusLine — the activation file-read note', () => {
  it('names the agent, lists the real files, and counts them', () => {
    const line = composeStatusLine(fixture);
    expect(line).toContain('📂 Activating Winston');
    expect(line).toContain('customize.toml, SKILL.md, references/architecture-styles.md');
    expect(line).toContain('(3 files)');
  });

  it('uses the singular for a single file', () => {
    expect(composeStatusLine({ ...fixture, filesRead: ['SKILL.md'] })).toContain('(1 file)');
  });
});

describe('composeWelcome — in-voice greeting, deterministic + honest', () => {
  const welcome = composeWelcome(fixture);

  it('opens in the agent voice with icon, name, title, and a blurb sentence', () => {
    expect(welcome.startsWith("🏗️ Hi, I'm Winston, the System Architect.")).toBe(true);
    // Blurb is terminated with a period even though the source has none.
    expect(welcome).toContain('technical architecture decisions.');
  });

  it('lists the menu, marking verified vs coming-soon honestly', () => {
    expect(welcome).toContain('Here\'s what I can help with:');
    expect(welcome).toMatch(/`BP` — Guided brainstorming _\(available now\)_/);
    expect(welcome).toMatch(/`CA` — Produce the architecture _\(coming soon\)_/);
    // Sandbox-family command spells out why it's not live.
    expect(welcome).toMatch(/`QD` — Quick dev _\(coming soon — needs a sandbox\)_/);
  });

  it('ends by inviting the user to act', () => {
    expect(welcome.trimEnd().endsWith('What would you like to do?')).toBe(true);
  });

  it('never invents availability — an all-unverified agent shows no "available now"', () => {
    const w = composeWelcome({
      ...fixture,
      commands: [{ code: 'CA', description: 'x', parity: 'unverified', needsSandbox: false }],
    });
    expect(w).not.toContain('available now');
  });
});
