import { describe, it, expect } from 'vitest';
import {
  isHtmlArtifact,
  slugifyTitle,
  artifactFileMeta,
} from '@/lib/artifact-file';

describe('isHtmlArtifact — HTML vs markdown detection', () => {
  it('is HTML when kind === "html" regardless of body', () => {
    expect(isHtmlArtifact('# just markdown', 'html')).toBe(true);
  });

  it('is HTML when the body opens with <!doctype html (case-insensitive, leading ws)', () => {
    expect(isHtmlArtifact('<!DOCTYPE html><html><body>hi</body></html>')).toBe(true);
    expect(isHtmlArtifact('   \n<!doctype HTML>\n<html></html>')).toBe(true);
  });

  it('is HTML when the body opens with <html', () => {
    expect(isHtmlArtifact('<html lang="en"><head></head></html>')).toBe(true);
    expect(isHtmlArtifact('<HTML>\n...')).toBe(true);
  });

  it('is markdown for plain markdown bodies (default kind)', () => {
    expect(isHtmlArtifact('# Heading\n\nsome **bold** text')).toBe(false);
    expect(isHtmlArtifact('- a\n- b')).toBe(false);
  });

  it('does not treat an inline <div> or fragment as a full HTML document', () => {
    expect(isHtmlArtifact('<div>a snippet inside markdown</div>')).toBe(false);
  });
});

describe('slugifyTitle', () => {
  it('lowercases, collapses non-alphanumerics to single hyphens, trims', () => {
    expect(slugifyTitle('My Great Doc!')).toBe('my-great-doc');
    expect(slugifyTitle('  Weird__Title -- v2  ')).toBe('weird-title-v2');
  });

  it('falls back to "document" for null/empty/symbol-only titles', () => {
    expect(slugifyTitle(null)).toBe('document');
    expect(slugifyTitle('')).toBe('document');
    expect(slugifyTitle('!!!')).toBe('document');
  });
});

describe('artifactFileMeta — mime, ext, filename', () => {
  it('HTML artifact → text/html, .html, slugified filename', () => {
    const meta = artifactFileMeta({
      title: 'Pitch Deck',
      body: '<!doctype html><html></html>',
    });
    expect(meta.kind).toBe('html');
    expect(meta.ext).toBe('html');
    expect(meta.mime).toBe('text/html; charset=utf-8');
    expect(meta.filename).toBe('pitch-deck.html');
  });

  it('markdown artifact → text/markdown, .md, slugified filename', () => {
    const meta = artifactFileMeta({ title: 'Session Notes', body: '# Notes' });
    expect(meta.kind).toBe('markdown');
    expect(meta.ext).toBe('md');
    expect(meta.mime).toBe('text/markdown; charset=utf-8');
    expect(meta.filename).toBe('session-notes.md');
  });

  it('kind override forces HTML even for a markdown-looking body', () => {
    const meta = artifactFileMeta({ title: null, body: '# md', kind: 'html' });
    expect(meta.ext).toBe('html');
    expect(meta.filename).toBe('document.html');
  });
});
