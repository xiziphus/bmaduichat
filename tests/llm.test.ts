import { describe, it, expect } from 'vitest';
import { geminiParts, openRouterMessage, type Msg } from '@/lib/llm';

describe('geminiParts — Gemini contents[].parts', () => {
  it('is byte-identical to the legacy text-only shape when there are no attachments', () => {
    const m: Msg = { role: 'user', content: 'hello' };
    expect(geminiParts(m)).toEqual([{ text: 'hello' }]);
  });

  it('appends inlineData parts for images/PDFs after the text', () => {
    const m: Msg = {
      role: 'user',
      content: 'describe this',
      parts: [
        { type: 'image', mimeType: 'image/png', data: 'IMG64' },
        { type: 'pdf', mimeType: 'application/pdf', data: 'PDF64' },
      ],
    };
    expect(geminiParts(m)).toEqual([
      { text: 'describe this' },
      { inlineData: { mimeType: 'image/png', data: 'IMG64' } },
      { inlineData: { mimeType: 'application/pdf', data: 'PDF64' } },
    ]);
  });
});

describe('openRouterMessage — OpenAI-compat message', () => {
  it('is byte-identical to {role, content} string when there are no attachments', () => {
    const m: Msg = { role: 'assistant', content: 'hi there' };
    expect(openRouterMessage(m)).toEqual({ role: 'assistant', content: 'hi there' });
  });

  it('empty parts array still yields the plain string content path', () => {
    const m: Msg = { role: 'user', content: 'plain', parts: [] };
    expect(openRouterMessage(m)).toEqual({ role: 'user', content: 'plain' });
  });

  it('builds an image_url part with a base64 data URL', () => {
    const m: Msg = {
      role: 'user',
      content: 'look',
      parts: [{ type: 'image', mimeType: 'image/jpeg', data: 'ABC' }],
    };
    expect(openRouterMessage(m)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,ABC' } },
      ],
    });
  });

  it('builds a file part for PDFs with a base64 data URL', () => {
    const m: Msg = {
      role: 'user',
      content: 'read',
      parts: [{ type: 'pdf', mimeType: 'application/pdf', data: 'XYZ' }],
    };
    expect(openRouterMessage(m)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'read' },
        {
          type: 'file',
          file: { filename: 'document.pdf', file_data: 'data:application/pdf;base64,XYZ' },
        },
      ],
    });
  });
});
