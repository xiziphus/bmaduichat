import { describe, it, expect } from 'vitest';
import { activeMentionQuery, stripRange } from '@/lib/mentions';

describe('activeMentionQuery — @-token parsing', () => {
  it('detects a mention at the start of the text', () => {
    expect(activeMentionQuery('@trav', 5)).toEqual({ query: 'trav', start: 0 });
  });

  it('detects a mention after whitespace', () => {
    const text = 'compare to @travel';
    expect(activeMentionQuery(text, text.length)).toEqual({ query: 'travel', start: 11 });
  });

  it('returns just-opened empty query when only "@" typed', () => {
    expect(activeMentionQuery('hey @', 5)).toEqual({ query: '', start: 4 });
  });

  it('is null when the token already ended with a space', () => {
    expect(activeMentionQuery('@travel plan', 12)).toBeNull();
  });

  it('is null when @ is glued to a preceding word (e.g. an email)', () => {
    expect(activeMentionQuery('me@example', 10)).toBeNull();
  });

  it('is null when there is no @ before the caret', () => {
    expect(activeMentionQuery('just talking', 12)).toBeNull();
  });

  it('uses the caret, ignoring text after it', () => {
    const text = '@trav and more';
    // caret right after "@trav"
    expect(activeMentionQuery(text, 5)).toEqual({ query: 'trav', start: 0 });
  });

  it('tracks the nearest @ to the caret', () => {
    const text = '@one @two';
    expect(activeMentionQuery(text, text.length)).toEqual({ query: 'two', start: 5 });
  });
});

describe('stripRange', () => {
  it('removes the given range', () => {
    expect(stripRange('hello @trav world', 6, 11)).toBe('hello  world');
  });

  it('clamps out-of-range indices', () => {
    expect(stripRange('abc', 1, 99)).toBe('a');
    expect(stripRange('abc', -5, 2)).toBe('c');
  });
});
