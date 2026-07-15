import { describe, it, expect } from 'vitest';
import { parseCsv, parseBrainMethods, getBrainMethods } from '@/lib/bmad-source';

describe('parseCsv', () => {
  it('keeps commas that live inside quoted fields', () => {
    const rows = parseCsv('a,"one, two, three",b');
    expect(rows).toEqual([['a', 'one, two, three', 'b']]);
  });

  it('unescapes doubled quotes ("") to a single literal quote', () => {
    const rows = parseCsv('x,"he said ""hi, there"" loudly",y');
    expect(rows).toEqual([['x', 'he said "hi, there" loudly', 'y']]);
  });

  it('handles CRLF line endings and multiple records', () => {
    const rows = parseCsv('a,b\r\nc,d\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles a quoted field containing a newline', () => {
    const rows = parseCsv('a,"line1\nline2",c');
    expect(rows).toEqual([['a', 'line1\nline2', 'c']]);
  });

  it('handles a final record with no trailing newline', () => {
    const rows = parseCsv('a,b,c');
    expect(rows).toEqual([['a', 'b', 'c']]);
  });
});

describe('parseBrainMethods', () => {
  const csv =
    'category,technique_name,description,detail,provenance,good_for,audience\r\n' +
    'deep,Five Whys,"Ask ""why?"" five times, chaining each answer",,classic,diagnosis,either\r\n';

  it('skips the header and maps columns, preserving verbatim descriptions', () => {
    const methods = parseBrainMethods(csv);
    expect(methods).toHaveLength(1);
    expect(methods[0]).toEqual({
      category: 'deep',
      name: 'Five Whys',
      description: 'Ask "why?" five times, chaining each answer',
      detail: '',
      provenance: 'classic',
      goodFor: 'diagnosis',
      audience: 'either',
    });
  });

  it('drops blank / malformed records', () => {
    expect(parseBrainMethods('category,technique_name,description\r\n')).toEqual([]);
  });
});

describe('getBrainMethods (real file)', () => {
  it('reads the full committed catalog (> 100 techniques)', () => {
    expect(getBrainMethods().length).toBeGreaterThan(100);
  });
});
