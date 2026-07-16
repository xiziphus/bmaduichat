import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_COOKIE, authToken } from '@/lib/auth';
import type { RunEvent } from '@/lib/runtime/types';

// Mock the engine seam so we can assert the ROUTE resolves + routes a launch
// descriptor without a provider or database.
vi.mock('@/lib/runtime/engine', () => ({ runWorkflow: vi.fn() }));

import { runWorkflow } from '@/lib/runtime/engine';
import { POST } from '@/app/api/chat/route';

async function* fromEvents(events: RunEvent[]): AsyncGenerator<RunEvent, void, void> {
  for (const e of events) yield e;
}

async function makeReq(body: Record<string, unknown>): Promise<NextRequest> {
  const token = await authToken('test-secret');
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `${AUTH_COOKIE}=${token}` },
    body: JSON.stringify({ provider: 'openrouter', messages: [{ role: 'user', content: 'go' }], ...body }),
  });
}

describe('POST /api/chat — PLAYGROUND_TREE OFF is byte-identical (descriptor ignored)', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    vi.stubEnv('PLAYGROUND_TREE', ''); // off
    vi.stubEnv('PLAYGROUND_ENGINE', ''); // off
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('OPENROUTER_API_KEY', ''); // missing key → hardcoded path config error
    vi.mocked(runWorkflow).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('ignores {agentSlug, code} entirely and takes today’s hardcoded path', async () => {
    const res = await POST(await makeReq({ agentSlug: 'bmad-agent-analyst', code: 'BP' }));
    // Same as a request with NO descriptor: engine untouched, hardcoded path
    // returns the honest missing-key config error (500).
    expect(runWorkflow).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/chat — PLAYGROUND_TREE ON routes the launch descriptor', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    vi.stubEnv('PLAYGROUND_TREE', 'on');
    vi.stubEnv('DATABASE_URL', ''); // DB off — degrade note falls back to client localStorage
    vi.stubEnv('OPENROUTER_API_KEY', 'x'); // unused (engine mocked)
    vi.mocked(runWorkflow).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('an UNVERIFIED command degrades honestly (+ note) without touching the engine', async () => {
    // Amelia/QD (bmad-quick-dev) is dev-family → unverified → honest degrade
    // bubble, no engine call.
    const res = await POST(await makeReq({ agentSlug: 'bmad-agent-dev', code: 'QD' }));
    const body = await res.text();
    expect(runWorkflow).not.toHaveBeenCalled();
    expect(body).toMatch(/noted for the builder/i);
    expect(body).toContain('data: [DONE]');
  });

  it('a VERIFIED command launches on the engine with the right skill + agent persona', async () => {
    vi.mocked(runWorkflow).mockImplementation(() =>
      fromEvents([
        { type: 'text', delta: '📊 hello' },
        { type: 'done', status: 'done', runId: null },
      ]),
    );
    const res = await POST(await makeReq({ agentSlug: 'bmad-agent-analyst', code: 'BP' }));
    const body = await res.text();
    expect(runWorkflow).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(runWorkflow).mock.calls[0][0];
    expect(arg.skillSlug).toBe('bmad-brainstorming');
    expect(arg.agentSlug).toBe('bmad-agent-analyst');
    expect(body).toContain('📊 hello');
    expect(body).toContain('data: [DONE]');
  });

  it('an unknown descriptor falls through to the normal path (no crash)', async () => {
    // Unknown code → planLaunch null → not a launch; engine untouched. Drop the
    // key so the hardcoded fallthrough returns the honest 500 with no network.
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const res = await POST(await makeReq({ agentSlug: 'bmad-agent-analyst', code: 'NOPE' }));
    expect(runWorkflow).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });
});
