import { describe, it, expect } from 'vitest';
import { extractBuilderNotes } from '@/lib/builder-notes';

describe('extractBuilderNotes', () => {
  it('returns [] when the phrase is absent', () => {
    expect(extractBuilderNotes('Here is a perfectly ordinary reply.')).toEqual([]);
    expect(extractBuilderNotes('')).toEqual([]);
  });

  it('pulls the single sentence containing the phrase, trimmed', () => {
    const text =
      "I can't browse the web here. That's noted for the builder — but paste the numbers and I'll fold them in.";
    expect(extractBuilderNotes(text)).toEqual([
      "That's noted for the builder — but paste the numbers and I'll fold them in.",
    ]);
  });

  it('matches case-insensitively', () => {
    const text = 'Reaching your calendar is out of reach. NOTED FOR THE BUILDER.';
    expect(extractBuilderNotes(text)).toEqual(['NOTED FOR THE BUILDER.']);
  });

  it('captures every sentence carrying the phrase when there are multiple', () => {
    const text =
      'Saving files is noted for the builder. Here is an idea. Live data access is also noted for the builder.';
    expect(extractBuilderNotes(text)).toEqual([
      'Saving files is noted for the builder.',
      'Live data access is also noted for the builder.',
    ]);
  });

  it('does not split on the "e.g." abbreviation inside the captured sentence', () => {
    const text =
      "External accounts (e.g. Slack) are out of reach — noted for the builder, so I'll work with what you paste.";
    expect(extractBuilderNotes(text)).toEqual([
      "External accounts (e.g. Slack) are out of reach — noted for the builder, so I'll work with what you paste.",
    ]);
  });
});
