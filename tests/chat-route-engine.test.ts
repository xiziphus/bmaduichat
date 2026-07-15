import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_COOKIE, authToken } from '@/lib/auth';
import type { RunEvent } from '@/lib/runtime/types';

// The engine seam is mocked so we exercise the ROUTE's streaming/guarantee logic
// with deterministic events — no provider, no database.
vi.mock('@/lib/runtime/engine', () => ({ runWorkflow: vi.fn() }));

import { runWorkflow } from '@/lib/runtime/engine';
import { POST } from '@/app/api/chat/route';

async function* fromEvents(events: RunEvent[]): AsyncGenerator<RunEvent, void, void> {
  for (const e of events) yield e;
}

async function makeReq(): Promise<NextRequest> {
  const token = await authToken('test-secret');
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `${AUTH_COOKIE}=${token}` },
    body: JSON.stringify({ provider: 'openrouter', messages: [{ role: 'user', content: 'hi' }] }),
  });
}

describe('POST /api/chat — engine path never yields a silent empty stream (PLAYGROUND_ENGINE=on)', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    vi.stubEnv('PLAYGROUND_ENGINE', 'on');
    vi.stubEnv('DATABASE_URL', ''); // persistence off — deterministic
    vi.stubEnv('OPENROUTER_API_KEY', 'x'); // unused (engine mocked)
    vi.mocked(runWorkflow).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('an EMPTY model completion still streams a visible honest bubble + [DONE]', async () => {
    // Tiny free model returns nothing: the engine emits only a terminal `done`.
    vi.mocked(runWorkflow).mockImplementation(() =>
      fromEvents([{ type: 'done', status: 'done', runId: null }]),
    );
    const res = await POST(await makeReq());
    const body = await res.text();
    expect(body).toContain('empty response');
    expect(body).toContain('data: [DONE]');
  });

  it('an engine THROW (e.g. a TypeError) still streams an honest snag bubble + [DONE]', async () => {
    vi.mocked(runWorkflow).mockImplementation(
      () =>
        (async function* () {
          throw new TypeError('boom');
        })() as AsyncGenerator<RunEvent, void, void>,
    );
    const res = await POST(await makeReq());
    const body = await res.text();
    expect(body).toContain('hit a snag');
    expect(body).toContain('data: [DONE]');
  });

  it('an engine `error` event with no text yields a visible bubble, not a blank', async () => {
    vi.mocked(runWorkflow).mockImplementation(() =>
      fromEvents([
        { type: 'error', message: 'Could not start the run.' },
        { type: 'done', status: 'failed', runId: null },
      ]),
    );
    const res = await POST(await makeReq());
    const body = await res.text();
    expect(body).toContain('Could not start the run.');
    expect(body).toContain('data: [DONE]');
  });

  it('chips + <document> in the engine text survive to the client as token frames', async () => {
    const reply = 'note →\n<document title="D">\n## X\n- a\n</document>\n<chips>["a","b"]</chips>';
    vi.mocked(runWorkflow).mockImplementation(() =>
      fromEvents([
        { type: 'text', delta: reply },
        { type: 'done', status: 'done', runId: null },
      ]),
    );
    const res = await POST(await makeReq());
    const body = await res.text();
    // Tokens are JSON-encoded in the SSE frame; the sentinels survive intact.
    expect(body).toContain('<document title=\\"D\\">');
    expect(body).toContain('<chips>');
    expect(body).toContain('data: [DONE]');
  });
});

describe('POST /api/chat — flag OFF never touches the engine (default path)', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    vi.stubEnv('PLAYGROUND_ENGINE', ''); // off / unset
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('OPENROUTER_API_KEY', ''); // missing key → hardcoded path config error
    vi.mocked(runWorkflow).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not invoke runWorkflow; the hardcoded path handles the request', async () => {
    const res = await POST(await makeReq());
    expect(runWorkflow).not.toHaveBeenCalled();
    // Missing OPENROUTER_API_KEY → the hardcoded path returns an honest config error.
    expect(res.status).toBe(500);
  });
});
