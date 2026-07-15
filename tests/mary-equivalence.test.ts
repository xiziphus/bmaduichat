import { describe, it, expect } from 'vitest';
import { buildMarySystemPrompt } from '@/lib/mary';
import { getTechniques } from '@/lib/techniques-catalog';

/**
 * Byte-equivalence guard for Mary's runtime prompt. Epic C-1 introduced the
 * generic skill loader (lib/skills/*); this snapshot pins the EXACT text of
 * Mary's system prompt so any later re-expression of lib/mary.ts / lib/bmad-source.ts
 * onto the loader cannot silently drift her output. If BMad source files change
 * intentionally, update the snapshot with `vitest -u` and review the diff.
 */
describe('Mary prompt — byte-equivalence snapshot', () => {
  it('base prompt is unchanged', () => {
    expect(buildMarySystemPrompt()).toMatchSnapshot();
  });

  it('prompt with an injected current technique is unchanged', () => {
    const t = getTechniques()[0];
    expect(buildMarySystemPrompt(t.id)).toMatchSnapshot();
  });
});
