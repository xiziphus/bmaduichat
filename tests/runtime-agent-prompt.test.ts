import { describe, it, expect } from 'vitest';
import { buildAgentPersona, composeAgentCommandPrompt } from '@/lib/runtime/agent-prompt';
import { ADAPTER_NOTE } from '@/lib/runtime/brainstorming';
import { HONEST_LIMITS } from '@/lib/mary';

describe('buildAgentPersona — generic, from any agent config (zero per-agent code)', () => {
  it('composes John (PM) from his skill config with his icon', () => {
    const p = buildAgentPersona('bmad-agent-pm');
    expect(p).toMatch(/You are John, the Product Manager\./);
    expect(p).toContain('📋');
  });

  it('composes Amelia (Dev) from her skill config', () => {
    const p = buildAgentPersona('bmad-agent-dev');
    expect(p).toMatch(/You are Amelia/);
    expect(p).toContain('💻');
  });

  it('never throws for an unknown agent (minimal fallback persona)', () => {
    expect(() => buildAgentPersona('no-such-agent')).not.toThrow();
  });
});

describe('composeAgentCommandPrompt — persona + adapted skill + app protocols', () => {
  it('a skill-backed command layers persona, adapter note, skill, and protocols', () => {
    const prompt = composeAgentCommandPrompt({ agentSlug: 'bmad-agent-pm', skillSlug: 'bmad-prd' });
    expect(prompt).toMatch(/You are John/);
    expect(prompt).toContain(ADAPTER_NOTE);
    expect(prompt).toContain(HONEST_LIMITS); // part of APP_PROTOCOLS
  });

  it('a prompt-backed command (skillSlug === agentSlug) is persona-only, no adapter note', () => {
    const prompt = composeAgentCommandPrompt({ agentSlug: 'bmad-agent-pm', skillSlug: 'bmad-agent-pm' });
    expect(prompt).toMatch(/You are John/);
    expect(prompt).not.toContain(ADAPTER_NOTE);
    expect(prompt).toContain(HONEST_LIMITS);
  });
});

/**
 * Smoke test the newly-verified conversational commands (Epic D parity flip):
 * each must compose a sane prompt — the agent persona + the adapted SKILL.md +
 * APP_PROTOCOLS — without throwing, at non-trivial length. No live LLM needed;
 * this proves the engine will accept them.
 */
describe('composeAgentCommandPrompt — newly-verified conversational commands compose sanely', () => {
  const cases = [
    { label: 'John / PRD', agentSlug: 'bmad-agent-pm', skillSlug: 'bmad-prd', persona: /You are John/, marker: 'PRD' },
    { label: 'Mary / PRFAQ', agentSlug: 'bmad-agent-analyst', skillSlug: 'bmad-prfaq', persona: /You are Mary/, marker: 'PRFAQ' },
    { label: 'Sally / UX', agentSlug: 'bmad-agent-ux-designer', skillSlug: 'bmad-ux', persona: /You are Sally/, marker: 'UX' },
  ];

  for (const c of cases) {
    it(`${c.label} layers persona + adapted SKILL.md + app protocols`, () => {
      let prompt = '';
      expect(() => {
        prompt = composeAgentCommandPrompt({ agentSlug: c.agentSlug, skillSlug: c.skillSlug });
      }).not.toThrow();
      // Persona header present.
      expect(prompt).toMatch(c.persona);
      // The adapted SKILL.md was inlined (not the honest fallback line).
      expect(prompt).toContain(ADAPTER_NOTE);
      expect(prompt).not.toContain(`You are running the "${c.skillSlug}" workflow.`);
      expect(prompt).toContain(c.marker);
      // App protocols win the tail.
      expect(prompt).toContain(HONEST_LIMITS);
      // Non-trivial length (persona + full skill + protocols).
      expect(prompt.length).toBeGreaterThan(2000);
    });
  }
});
