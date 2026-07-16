import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  parityFor,
  isDevWorkflowSkill,
  isResearchSkill,
  webSearchProvider,
} from '@/lib/agents/capabilities';

describe('capability registry — parity policy (FR-42)', () => {
  it('keeps the C-4-proven seed (bmad-agent-analyst/BP) verified', () => {
    expect(parityFor('bmad-agent-analyst', 'BP', 'bmad-brainstorming')).toBe('verified');
  });

  it('verifies conversational skill-backed commands (engine-runnable)', () => {
    expect(parityFor('bmad-agent-analyst', 'MR', 'bmad-market-research')).toBe('verified');
    expect(parityFor('bmad-agent-pm', 'PRD', 'bmad-prd')).toBe('verified');
    expect(parityFor('bmad-agent-analyst', 'WB', 'bmad-prfaq')).toBe('verified');
    expect(parityFor('bmad-agent-ux-designer', 'CU', 'bmad-ux')).toBe('verified');
  });

  it('verifies prompt-backed commands (no target skill — run the prompt)', () => {
    expect(parityFor('bmad-agent-tech-writer', 'WD')).toBe('verified');
    expect(parityFor('bmad-cis-agent-presentation-master', 'SD')).toBe('verified');
  });

  it('keeps the dev/sandbox family unverified', () => {
    expect(parityFor('bmad-agent-dev', 'QD', 'bmad-quick-dev')).toBe('unverified');
    expect(parityFor('bmad-agent-dev', 'DS', 'bmad-dev-story')).toBe('unverified');
    expect(parityFor('bmad-agent-dev', 'QA', 'bmad-qa-generate-e2e-tests')).toBe('unverified');
    expect(parityFor('wds-agent-mimir-builder', 'BU', 'bmad-wds-build')).toBe('unverified');
  });
});

describe('capability registry — command families', () => {
  it('flags the dev-workflow family (needs a sandbox)', () => {
    expect(isDevWorkflowSkill('bmad-quick-dev')).toBe(true);
    expect(isDevWorkflowSkill('bmad-dev-story')).toBe(true);
    expect(isDevWorkflowSkill('bmad-dev-auto')).toBe(true);
    expect(isDevWorkflowSkill('bmad-qa-generate-e2e-tests')).toBe(true);
    expect(isDevWorkflowSkill('bmad-wds-build')).toBe(true);
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
