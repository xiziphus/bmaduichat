import { describe, it, expect } from 'vitest';
import {
  geminiParts,
  openRouterMessage,
  supportsFunctionCalling,
  openrouterSupportsTools,
  toGeminiContents,
  toOpenRouterMessages,
  toGeminiTools,
  toOpenRouterTools,
  type Msg,
  type ToolMsg,
  type ToolSchema,
} from '@/lib/llm';

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

/* ---------------- native function-calling (engine-only) ---------------- */

describe('supportsFunctionCalling — capability flag', () => {
  it('Gemini is always capable', () => {
    expect(supportsFunctionCalling('gemini')).toBe(true);
    expect(supportsFunctionCalling('gemini', 'gemini-2.5-flash')).toBe(true);
  });
  it('OpenRouter allowlists tool-capable families, else false', () => {
    expect(openrouterSupportsTools('openai/gpt-4o')).toBe(true);
    expect(openrouterSupportsTools('mistralai/mistral-large')).toBe(true);
    expect(openrouterSupportsTools('some/unknown-model')).toBe(false);
  });
  it('OpenRouter env override forces capability on', () => {
    expect(openrouterSupportsTools('some/unknown-model', true)).toBe(true);
  });
});

describe('ToolMsg → provider payloads', () => {
  const asst: ToolMsg = {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'c0', name: 'read_reference', args: { name: 'm.md' } }],
  };
  const toolResult: ToolMsg = { role: 'tool', toolCallId: 'c0', name: 'read_reference', content: 'BODY' };

  it('Gemini: assistant tool-call → functionCall part; tool result → functionResponse', () => {
    expect(toGeminiContents([{ role: 'user', content: 'go' }, asst, toolResult])).toEqual([
      { role: 'user', parts: [{ text: 'go' }] },
      { role: 'model', parts: [{ functionCall: { name: 'read_reference', args: { name: 'm.md' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'read_reference', response: { result: 'BODY' } } }] },
    ]);
  });

  it('OpenRouter: assistant tool_calls + role:tool message', () => {
    expect(toOpenRouterMessages([{ role: 'user', content: 'go' }, asst, toolResult])).toEqual([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c0', type: 'function', function: { name: 'read_reference', arguments: '{"name":"m.md"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c0', content: 'BODY' },
    ]);
  });

  it('plain assistant/user turns stay simple (no tool fields)', () => {
    expect(toGeminiContents([{ role: 'assistant', content: 'hi' }])).toEqual([
      { role: 'model', parts: [{ text: 'hi' }] },
    ]);
    expect(toOpenRouterMessages([{ role: 'assistant', content: 'hi' }])).toEqual([
      { role: 'assistant', content: 'hi' },
    ]);
  });

  it('tool schemas map to each provider tool block', () => {
    const tools: ToolSchema[] = [{ name: 't', description: 'd', parameters: { type: 'object', properties: {} } }];
    expect(toGeminiTools(tools)).toEqual([
      { functionDeclarations: [{ name: 't', description: 'd', parameters: { type: 'object', properties: {} } }] },
    ]);
    expect(toOpenRouterTools(tools)).toEqual([
      { type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object', properties: {} } } },
    ]);
  });
});
