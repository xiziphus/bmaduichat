import { describe, it, expect } from 'vitest';
import {
  composeBrainstormingPrompt,
  referencesForPhase,
} from '@/lib/runtime/brainstorming';
import { APP_PROTOCOLS } from '@/lib/mary';
import { getTechniques } from '@/lib/techniques-catalog';
import { runWorkflow } from '@/lib/runtime/engine';
import type { ModelClient, RunEvent } from '@/lib/runtime/types';

const noUsage = { tokensIn: null, tokensOut: null };

async function collect(gen: AsyncGenerator<RunEvent, void, void>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('composeBrainstormingPrompt — adapted skill text + APP_PROTOCOLS', () => {
  const prompt = composeBrainstormingPrompt();

  it('includes the loaded, adapted brainstorming SKILL.md text', () => {
    // Framing sentinel from SKILL.md, and the Creative Partner stance from
    // mode-partner.md — both come from the loaded files, not hand-written copy.
    expect(prompt).toContain('Aim past 100 ideas');
    expect(prompt).toContain('Their fire, your kindling.');
  });

  it('layers the shared APP_PROTOCOLS block verbatim on top', () => {
    expect(prompt).toContain(APP_PROTOCOLS);
    expect(prompt).toContain('CHIPS PROTOCOL');
    expect(prompt).toContain('DOCUMENT PROTOCOL');
    expect(prompt).toContain('noted for the builder');
  });

  it('adapts (strips) CLI-only BMad mechanics that do not exist in this app', () => {
    expect(prompt).not.toContain('uv run');
    expect(prompt).not.toContain('memlog.py');
    expect(prompt).not.toContain('{project-root}');
  });

  it('appends the CURRENT TECHNIQUE injection when a technique is launched', () => {
    const t = getTechniques()[0];
    const withTech = composeBrainstormingPrompt({ technique: t.id });
    expect(withTech).toContain(`CURRENT TECHNIQUE — the user just launched "${t.name}"`);
    expect(withTech).toContain(t.gist);
    expect(prompt).not.toContain('CURRENT TECHNIQUE');
  });

  it('selects references by phase (converge/finalize add narrowing + synthesis refs)', () => {
    expect(referencesForPhase('diverge')).toEqual(['mode-partner.md']);
    expect(referencesForPhase('converge')).toEqual(['mode-partner.md', 'converge.md']);
    expect(referencesForPhase('finalize')).toEqual([
      'mode-partner.md',
      'converge.md',
      'finalize.md',
    ]);
    // No phase → all relevant refs so a full single-run session is covered.
    expect(referencesForPhase()).toContain('finalize.md');
  });
});

describe('engine path — chips + <document> survive to the client stream', () => {
  it('emits the assistant text verbatim, including <document> and <chips> blocks', async () => {
    const reply =
      "Here's your synthesis →\n" +
      '<document title="Session Notes">\n## Ideas\n- one\n- two\n</document>\n' +
      '<chips>["🔥 Pressure-test it","⛏️ Keep digging"]</chips>';

    const model: ModelClient = async () => ({ text: reply, toolCalls: [], usage: noUsage });

    const events = await collect(
      runWorkflow({
        conversationId: 'c1',
        skillSlug: 'bmad-brainstorming',
        input: 'wrap it up',
        provider: 'gemini',
        deps: { model, persistence: false },
      }),
    );

    const textEvent = events.find((e) => e.type === 'text');
    expect(textEvent && textEvent.type === 'text' ? textEvent.delta : '').toBe(reply);
    // The loop must not strip or reshape the chips/document sentinels.
    const delta = textEvent && textEvent.type === 'text' ? textEvent.delta : '';
    expect(delta).toContain('<document title="Session Notes">');
    expect(delta).toContain('<chips>["🔥 Pressure-test it","⛏️ Keep digging"]</chips>');
  });
});
