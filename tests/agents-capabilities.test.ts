import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  parityFor,
  isDevWorkflowSkill,
  isResearchSkill,
  webSearchProvider,
} from '@/lib/agents/capabilities';

describe('capability registry — parity seed (FR-42)', () => {
  it('verifies ONLY bmad-agent-analyst/BP (the C-4-proven command)', () => {
    expect(parityFor('bmad-agent-analyst', 'BP')).toBe('verified');
  });

  it('defaults every other command to unverified', () => {
    expect(parityFor('bmad-agent-analyst', 'MR')).toBe('unverified');
    expect(parityFor('bmad-agent-pm', 'PRD')).toBe('unverified');
    expect(parityFor('bmad-agent-dev', 'QD')).toBe('unverified');
    expect(parityFor('some-new-agent', 'XX')).toBe('unverified');
  });
});

describe('capability registry — command families', () => {
  it('flags the dev-workflow family (needs a sandbox)', () => {
    expect(isDevWorkflowSkill('bmad-quick-dev')).toBe(true);
    expect(isDevWorkflowSkill('bmad-dev-story')).toBe(true);
    expect(isDevWorkflowSkill('bmad-dev-auto')).toBe(true);
    expect(isDevWorkflowSkill('bmad-brainstorming')).toBe(false);
    expect(isDevWorkflowSkill(undefined)).toBe(false);
  });

  it('flags the research family (web-search eligible)', () => {
    expect(isResearchSkill('bmad-market-research')).toBe(true);
    expect(isResearchSkill('bmad-domain-research')).toBe(true);
    expect(isResearchSkill('bmad-technical-research')).toBe(true);
    expect(isResearchSkill('bmad-brainstorming')).toBe(false);
  });
});

describe('capability registry — web-search provider (FR-41)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is undefined when unset (research degrades honestly — never a paid API)', () => {
    vi.stubEnv('WEB_SEARCH_PROVIDER', '');
    expect(webSearchProvider()).toBeUndefined();
  });

  it('reads a configured free provider', () => {
    vi.stubEnv('WEB_SEARCH_PROVIDER', 'duckduckgo');
    expect(webSearchProvider()).toBe('duckduckgo');
  });
});
