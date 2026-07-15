import { describe, it, expect } from 'vitest';
import {
  classify,
  validateFile,
  canSend,
  resolveModalitySupport,
  openrouterSupportsVision,
  composeOutgoingText,
  inlineTextAttachment,
  toMsgParts,
  toMeta,
  DEFAULT_SUPPORT,
  MAX_FILE_BYTES,
  type Attachment,
} from '@/lib/attachments';

describe('classify', () => {
  it('maps image mimes to image', () => {
    expect(classify('image/png', 'a.png')).toBe('image');
    expect(classify('image/jpeg', 'a.jpg')).toBe('image');
    expect(classify('image/webp', 'a.webp')).toBe('image');
    expect(classify('image/gif', 'a.gif')).toBe('image');
  });
  it('maps pdf by mime or extension', () => {
    expect(classify('application/pdf', 'doc.pdf')).toBe('pdf');
    expect(classify('', 'doc.pdf')).toBe('pdf');
  });
  it('maps text/markdown by mime or extension', () => {
    expect(classify('text/plain', 'notes.txt')).toBe('text');
    expect(classify('text/markdown', 'notes.md')).toBe('text');
    expect(classify('', 'notes.md')).toBe('text');
    expect(classify('application/octet-stream', 'notes.markdown')).toBe('text');
  });
  it('rejects unsupported types', () => {
    expect(classify('application/zip', 'a.zip')).toBeNull();
    expect(classify('video/mp4', 'a.mp4')).toBeNull();
  });
});

describe('validateFile', () => {
  it('accepts a valid small image', () => {
    expect(validateFile({ name: 'a.png', type: 'image/png', size: 1000 })).toEqual({
      ok: true,
      modality: 'image',
    });
  });
  it('rejects unsupported type with a reason', () => {
    const r = validateFile({ name: 'a.zip', type: 'application/zip', size: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('unsupported');
  });
  it('rejects oversize file with a max-size reason', () => {
    const r = validateFile({ name: 'big.png', type: 'image/png', size: MAX_FILE_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('too large');
  });
  it('accepts a file exactly at the cap', () => {
    expect(validateFile({ name: 'a.png', type: 'image/png', size: MAX_FILE_BYTES }).ok).toBe(true);
  });
});

describe('openrouterSupportsVision + resolveModalitySupport', () => {
  it('is false for a typical free text-only model', () => {
    expect(openrouterSupportsVision('meta-llama/llama-3.3-70b-instruct:free')).toBe(false);
  });
  it('is true for allowlisted vision models', () => {
    expect(openrouterSupportsVision('openai/gpt-4o')).toBe(true);
    expect(openrouterSupportsVision('anthropic/claude-3.5-sonnet')).toBe(true);
    expect(openrouterSupportsVision('google/gemini-flash-1.5')).toBe(true);
    expect(openrouterSupportsVision('meta-llama/llama-3.2-vision-11b')).toBe(true);
    expect(openrouterSupportsVision('qwen/qwen-2-vl-7b-instruct')).toBe(true);
    expect(openrouterSupportsVision('mistralai/pixtral-12b')).toBe(true);
  });
  it('env override forces vision on regardless of model', () => {
    expect(openrouterSupportsVision('meta-llama/llama-3.3-70b-instruct:free', true)).toBe(true);
  });
  it('resolveModalitySupport: gemini always on; openrouter follows model/env', () => {
    const textOnly = resolveModalitySupport({ openrouterModel: 'llama-3.3-70b:free' });
    expect(textOnly.gemini).toEqual({ image: true, pdf: true });
    expect(textOnly.openrouter).toEqual({ image: false, pdf: false });

    const vision = resolveModalitySupport({ openrouterModel: 'openai/gpt-4o' });
    expect(vision.openrouter).toEqual({ image: true, pdf: true });

    const forced = resolveModalitySupport({
      openrouterModel: 'llama-3.3-70b:free',
      openrouterMultimodal: true,
    });
    expect(forced.openrouter).toEqual({ image: true, pdf: true });
  });
});

describe('canSend gate', () => {
  const img = { modality: 'image' as const };
  const pdf = { modality: 'pdf' as const };
  const txt = { modality: 'text' as const };

  it('gemini accepts images + pdf', () => {
    expect(canSend('gemini', [img, pdf], DEFAULT_SUPPORT)).toEqual({ ok: true });
  });
  it('openrouter default blocks image (names blocked modality)', () => {
    expect(canSend('openrouter', [img], DEFAULT_SUPPORT)).toEqual({ ok: false, blocked: 'image' });
  });
  it('openrouter default blocks pdf', () => {
    expect(canSend('openrouter', [pdf], DEFAULT_SUPPORT)).toEqual({ ok: false, blocked: 'pdf' });
  });
  it('text docs always pass on any provider (never toast)', () => {
    expect(canSend('openrouter', [txt], DEFAULT_SUPPORT)).toEqual({ ok: true });
  });
  it('allowlisted openrouter model accepts images', () => {
    const support = resolveModalitySupport({ openrouterModel: 'openai/gpt-4o' });
    expect(canSend('openrouter', [img], support)).toEqual({ ok: true });
  });
  it('no attachments always passes', () => {
    expect(canSend('openrouter', [], DEFAULT_SUPPORT)).toEqual({ ok: true });
  });
});

describe('text-file inlining', () => {
  it('inlineTextAttachment labels the content', () => {
    expect(inlineTextAttachment('notes.md', '# Hi\nbody')).toBe('[Attached: notes.md]\n# Hi\nbody');
  });
  it('composeOutgoingText appends inlined docs after the typed text', () => {
    const out = composeOutgoingText('here are my notes', [{ name: 'notes.md', text: 'line1' }]);
    expect(out).toBe('here are my notes\n\n[Attached: notes.md]\nline1');
  });
  it('composeOutgoingText returns just the text when no docs', () => {
    expect(composeOutgoingText('hi', [])).toBe('hi');
  });
  it('composeOutgoingText handles empty typed text (doc only)', () => {
    expect(composeOutgoingText('', [{ name: 'a.txt', text: 'x' }])).toBe('[Attached: a.txt]\nx');
  });
  it('composeOutgoingText joins multiple docs', () => {
    const out = composeOutgoingText('', [
      { name: 'a.md', text: 'A' },
      { name: 'b.md', text: 'B' },
    ]);
    expect(out).toBe('[Attached: a.md]\nA\n\n[Attached: b.md]\nB');
  });
});

describe('toMsgParts / toMeta', () => {
  const image: Attachment = {
    id: '1',
    name: 'shot.png',
    mimeType: 'image/png',
    size: 10,
    modality: 'image',
    data: 'AAAA',
  };
  const pdf: Attachment = {
    id: '2',
    name: 'doc.pdf',
    mimeType: 'application/pdf',
    size: 20,
    modality: 'pdf',
    data: 'BBBB',
  };
  const text: Attachment = {
    id: '3',
    name: 'notes.md',
    mimeType: 'text/markdown',
    size: 5,
    modality: 'text',
    text: 'hi',
  };

  it('builds image/pdf parts and skips text docs (they inline as text)', () => {
    expect(toMsgParts([image, pdf, text])).toEqual([
      { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      { type: 'pdf', mimeType: 'application/pdf', data: 'BBBB' },
    ]);
  });
  it('reduces an attachment to persistable metadata (no binary)', () => {
    expect(toMeta(image)).toEqual({ name: 'shot.png', mimeType: 'image/png', size: 10 });
  });
});
