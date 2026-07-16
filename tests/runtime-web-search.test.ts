import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  TOOL_SCHEMAS,
  WEB_SEARCH_SCHEMA,
  WEB_SEARCH_UNCONFIGURED,
  toolSchemasFor,
  createToolExecutor,
  type ToolContext,
} from '@/lib/runtime/tools';

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return { conversationId: 'c1', runId: 'r1', skillSlug: 's', persistence: true, ...over };
}

describe('toolSchemasFor — web_search offered ONLY to research skills (FR-41)', () => {
  it('appends web_search for a research-family skill', () => {
    const names = toolSchemasFor('bmad-market-research').map((t) => t.name);
    expect(names).toContain('web_search');
  });

  it('leaves the fixed tool set unchanged for non-research skills', () => {
    expect(toolSchemasFor('bmad-brainstorming')).toEqual(TOOL_SCHEMAS);
    expect(toolSchemasFor('bmad-brainstorming').map((t) => t.name)).not.toContain('web_search');
  });

  it('the web_search schema is a valid object schema', () => {
    expect(WEB_SEARCH_SCHEMA.parameters).toHaveProperty('type', 'object');
  });
});

describe('web_search executor — free-tier only, honest degrade', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('degrades honestly (note-bearing) when no provider is configured', async () => {
    vi.stubEnv('WEB_SEARCH_PROVIDER', '');
    const exec = createToolExecutor(ctx());
    const r = await exec({ name: 'web_search', args: { query: 'anything' } });
    expect(r.kind).toBe('result');
    if (r.kind === 'result') {
      expect(r.content).toBe(WEB_SEARCH_UNCONFIGURED);
      expect(r.content).toMatch(/noted for the builder/i);
    }
  });

  it('uses an injected free-tier search when provided', async () => {
    const exec = createToolExecutor(ctx({ webSearch: async (q) => `results for ${q}` }));
    const r = await exec({ name: 'web_search', args: { query: 'kites' } });
    expect(r.kind).toBe('result');
    if (r.kind === 'result') expect(r.content).toBe('results for kites');
  });

  it('requires a query', async () => {
    const exec = createToolExecutor(ctx());
    const r = await exec({ name: 'web_search', args: {} });
    if (r.kind === 'result') expect(r.content).toMatch(/`query` is required/);
  });
});
