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
