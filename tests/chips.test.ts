import { describe, it, expect } from 'vitest';
import { parseChips, visibleWhileStreaming } from '@/lib/chips';

describe('parseChips', () => {
  it('extracts a well-formed chips block and strips it from the text', () => {
    const raw = 'Here is my reply.\n<chips>["🔥 Push further","🎲 Switch technique"]</chips>';
    const { text, chips } = parseChips(raw);
    expect(text).toBe('Here is my reply.');
    expect(chips).toEqual(['🔥 Push further', '🎲 Switch technique']);
  });

  it('strips ALL chips blocks and takes chips from the last valid block', () => {
    const raw =
      'Part one.\n<chips>["old A","old B"]</chips>\nPart two.\n<chips>["new A","new B"]</chips>';
    const { text, chips } = parseChips(raw);
    expect(text).not.toContain('<chips');
    expect(text).toContain('Part one.');
    expect(text).toContain('Part two.');
    expect(chips).toEqual(['new A', 'new B']);
  });

  it('chips-only reply yields empty text and never leaks the raw tag', () => {
    const raw = '<chips>["only chips"]</chips>';
    const { text, chips } = parseChips(raw);
    expect(text).toBe('');
    expect(chips).toEqual(['only chips']);
  });

  it('returns the text unchanged with no chips when the block is absent', () => {
    const raw = 'Just a plain reply, no chips here.';
    const { text, chips } = parseChips(raw);
    expect(text).toBe(raw);
    expect(chips).toEqual([]);
  });

  it('strips a malformed chips block without throwing and without chips', () => {
    const raw = 'A reply with broken chips.\n<chips>[not valid json</chips>';
    const { text, chips } = parseChips(raw);
    expect(text).toBe('A reply with broken chips.');
    expect(chips).toEqual([]);
  });

  it('ignores a chips block whose JSON is not an array of strings', () => {
    const raw = 'Reply.\n<chips>{"not":"an array"}</chips>';
    const { text, chips } = parseChips(raw);
    expect(text).toBe('Reply.');
    expect(chips).toEqual([]);
  });

  it('drops a dangling unterminated chips tag mid-stream', () => {
    const raw = 'Streaming so far...\n<chips>["partial';
    const { text, chips } = parseChips(raw);
    expect(text).toBe('Streaming so far...');
    expect(chips).toEqual([]);
  });
});

describe('visibleWhileStreaming', () => {
  it('hides everything from the first <chips onward', () => {
    const raw = 'Visible part.\n<chips>["a"]</chips>';
    expect(visibleWhileStreaming(raw)).toBe('Visible part.');
  });

  it('returns the full text unchanged when no chips marker is present', () => {
    const raw = 'No chips yet.';
    expect(visibleWhileStreaming(raw)).toBe(raw);
  });
});
