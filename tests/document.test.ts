import { describe, it, expect } from 'vitest';
import {
  parseDocument,
  streamingDocumentBody,
  streamingDocumentTitle,
  stripDocumentForBubble,
} from '@/lib/document';

describe('parseDocument — the <document> sentinel', () => {
  it('extracts a well-formed block: title + body, stripped from chat text', () => {
    const raw =
      'Captured it for you →\n<document title="My Doc">\n## Section\n**bold** body\n</document>';
    const { text, document } = parseDocument(raw);
    expect(document).not.toBeNull();
    expect(document?.title).toBe('My Doc');
    expect(document?.body).toContain('## Section');
    expect(document?.body).toContain('**bold** body');
    expect(text).toBe('Captured it for you →');
    expect(text).not.toContain('<document');
  });

  it('handles a block with no title attribute (title null)', () => {
    const { document } = parseDocument('<document>\njust a body\n</document>');
    expect(document?.title).toBeNull();
    expect(document?.body).toBe('just a body');
  });

  it('absent → text unchanged, no document', () => {
    const { text, document } = parseDocument('just a normal chat reply');
    expect(document).toBeNull();
    expect(text).toBe('just a normal chat reply');
  });

  it('malformed (unterminated) → fragment stripped, no document, no raw tag', () => {
    const { text, document } = parseDocument('prose here <document title="x">\n## Started');
    expect(document).toBeNull();
    expect(text).toBe('prose here');
    expect(text).not.toContain('<document');
  });

  it('empty body → not treated as a document', () => {
    const { document } = parseDocument('<document title="x"></document>');
    expect(document).toBeNull();
  });
});

describe('streamingDocumentBody / Title — live doc pane', () => {
  it('returns null before any <document> opens', () => {
    expect(streamingDocumentBody('still just chatting…')).toBeNull();
    expect(streamingDocumentTitle('still just chatting…')).toBeNull();
  });

  it('returns the partial body while the block is still open', () => {
    const raw = 'note\n<document title="Live">\n## Growing';
    expect(streamingDocumentBody(raw)).toContain('## Growing');
    expect(streamingDocumentTitle(raw)).toBe('Live');
  });

  it('returns the full body once closed (trailing content ignored)', () => {
    const raw = '<document title="t">full body</document><chips>["x"]</chips>';
    expect(streamingDocumentBody(raw)).toBe('full body');
  });
});

describe('stripDocumentForBubble', () => {
  it('removes a complete block and a dangling open fragment', () => {
    expect(stripDocumentForBubble('a <document>x</document> b')).toBe('a  b');
    expect(stripDocumentForBubble('a <document title="y">partial')).toBe('a ');
  });
});
