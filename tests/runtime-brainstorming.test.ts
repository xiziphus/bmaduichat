import { describe, it, expect } from 'vitest';
import {
  composeBrainstormingPrompt,
  referencesForPhase,
  inferPhase,
  normalizePhase,
  maxPhase,
  ADAPTER_NOTE,
  ENGINE_OUTPUT_CONTRACT,
  PROMPT_SIZE_BUDGET,
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

describe('composeBrainstormingPrompt — verbatim SKILL.md + adapter note + APP_PROTOCOLS', () => {
  const prompt = composeBrainstormingPrompt();

  it("prepends Mary's persona so engine-Mary has her voice + 📊 icon", () => {
    // Persona sliced from the analyst agent (same source as the hardcoded Mary).
    expect(prompt).toContain('You are Mary');
    expect(prompt).toContain('📊');
    expect(prompt).toContain(
      "Channels Michael Porter's strategic rigor and Barbara Minto's Pyramid Principle discipline.",
    );
    expect(prompt).toContain(
      "Treasure hunter's excitement for patterns, McKinsey memo's structure for findings.",
    );
  });

  it('puts the app conventions LAST — the emphatic chips/document contract closes the prompt', () => {
    // APP_PROTOCOLS sits at the end (after the skill text), then the emphatic
    // contract is the final block so the chips instruction wins attention.
    expect(prompt.indexOf(APP_PROTOCOLS)).toBeGreaterThan(prompt.indexOf('Aim past 100 ideas'));
    expect(prompt.trimEnd().endsWith(ENGINE_OUTPUT_CONTRACT.trimEnd())).toBe(true);
    expect(prompt).toContain('You MUST end EVERY reply with a chips line');
    // APP_PROTOCOLS immediately precedes the closing contract.
    expect(prompt).toContain(`${APP_PROTOCOLS}\n\n${ENGINE_OUTPUT_CONTRACT}`);
  });

  it('includes the loaded brainstorming SKILL.md text', () => {
    // Framing sentinel from SKILL.md, and the Creative Partner stance from
    // mode-partner.md — both come from the loaded files, not hand-written copy.
    expect(prompt).toContain('Aim past 100 ideas');
    expect(prompt).toContain('Their fire, your kindling.');
  });

  it('quotes the FULL SKILL.md VERBATIM — no distillation, CLI sections kept intact', () => {
    // A distinctive mid-SKILL sentence proves the whole file is present unedited.
    expect(prompt).toContain(
      'The session runs in one of three stances, chosen by the user',
    );
    expect(prompt).toContain('## On Activation'); // section NOT dropped
    expect(prompt).toContain('Choosing Techniques');
    // BMad's CLI mechanics survive verbatim (the adapter note tells the model to
    // reinterpret them rather than us editing BMad's words).
    expect(prompt).toContain('uv run');
    expect(prompt).toContain('memlog.py');
    expect(prompt).toContain('{project-root}');
  });

  it('prepends the ADAPTER NOTE (our words) between the persona and the SKILL.md', () => {
    expect(prompt).toContain(ADAPTER_NOTE);
    expect(prompt).toContain('OPERATING CONTEXT');
    // Order: persona → adapter note → verbatim SKILL.md (framing sentinel).
    expect(prompt.indexOf('You are Mary')).toBeLessThan(prompt.indexOf(ADAPTER_NOTE));
    expect(prompt.indexOf(ADAPTER_NOTE)).toBeLessThan(prompt.indexOf('Aim past 100 ideas'));
    // The note names the leak-prone mechanics so the model never speaks them.
    expect(prompt).toContain('technique-picker.html');
    expect(prompt).toContain('paste the result back');
  });

  it('layers the shared APP_PROTOCOLS block verbatim on top', () => {
    expect(prompt).toContain(APP_PROTOCOLS);
    expect(prompt).toContain('CHIPS PROTOCOL');
    expect(prompt).toContain('DOCUMENT PROTOCOL');
    expect(prompt).toContain('noted for the builder');
  });

  it('appends the CURRENT TECHNIQUE injection when a technique is launched', () => {
    const t = getTechniques()[0];
    const withTech = composeBrainstormingPrompt({ technique: t.id });
    expect(withTech).toContain(`CURRENT TECHNIQUE — the user just launched "${t.name}"`);
    expect(withTech).toContain(t.gist);
    expect(prompt).not.toContain('CURRENT TECHNIQUE');
  });

  it('selects ONLY the active phase reference (one ref per phase, not all three)', () => {
    expect(referencesForPhase('diverge')).toEqual(['mode-partner.md']);
    expect(referencesForPhase('converge')).toEqual(['converge.md']);
    expect(referencesForPhase('finalize')).toEqual(['finalize.md']);
    // No phase → opening/diverge default: mode-partner only.
    expect(referencesForPhase()).toEqual(['mode-partner.md']);
  });

  it('opening prompt has mode-partner but NOT the converge/finalize reference text', () => {
    // mode-partner.md sentinel present…
    expect(prompt).toContain('Their fire, your kindling.');
    // …converge.md + finalize.md sentinels absent (those refs are not loaded).
    expect(prompt).not.toContain('Narrow & Decide'); // converge.md H1
    expect(prompt).not.toContain('Imaginative HTML keepsake'); // finalize.md artifact step
  });

  it('converge phase loads the converge reference (and not mode-partner)', () => {
    const converge = composeBrainstormingPrompt({ phase: 'converge' });
    expect(converge).toContain('Narrow & Decide'); // converge.md H1
    expect(converge).not.toContain('Their fire, your kindling.'); // mode-partner.md
    // Persona + protocols + contract still present.
    expect(converge).toContain('You are Mary');
    expect(converge).toContain(APP_PROTOCOLS);
    expect(converge.trimEnd().endsWith(ENGINE_OUTPUT_CONTRACT.trimEnd())).toBe(true);
  });

  it('is smaller than the prior all-references prompt (per-phase JIT ref loading)', () => {
    // Prior behavior composed the full SKILL.md + ALL THREE references (~21k
    // chars). Loading only the active phase reference keeps the opening prompt
    // below that baseline and under the size budget — the full SKILL.md is still
    // present verbatim, we just don't stack every reference on top.
    expect(prompt.length).toBeLessThan(20000);
    expect(prompt.length).toBeLessThan(PROMPT_SIZE_BUDGET);
  });

  it('inferPhase reads the coarse phase from the latest user message', () => {
    expect(inferPhase('here are some wild ideas for the app')).toBe('diverge');
    expect(inferPhase()).toBe('diverge');
    expect(inferPhase("let's narrow these down and prioritize")).toBe('converge');
    expect(inferPhase('ok wrap it up into a doc')).toBe('finalize');
  });

  it('names the on-demand references + read_reference tool (Fix B)', () => {
    // The brainstorming skill ships references, so the hint line is present and
    // mentions the tool + at least one real reference filename.
    expect(prompt).toContain('read_reference tool');
    expect(prompt).toContain('References you can load on demand');
    expect(prompt).toContain('mode-partner.md');
    // Still one compact line (not a content dump) — the tail contract still closes.
    expect(prompt.trimEnd().endsWith(ENGINE_OUTPUT_CONTRACT.trimEnd())).toBe(true);
  });
});

describe('normalizePhase / maxPhase — monotonic phase helpers (Fix C)', () => {
  it('normalizePhase coerces only the three valid phases', () => {
    expect(normalizePhase('diverge')).toBe('diverge');
    expect(normalizePhase('converge')).toBe('converge');
    expect(normalizePhase('finalize')).toBe('finalize');
    expect(normalizePhase('nope')).toBeNull();
    expect(normalizePhase(null)).toBeNull();
    expect(normalizePhase(undefined)).toBeNull();
  });

  it('maxPhase never regresses (returns the further-along phase)', () => {
    expect(maxPhase('diverge', 'converge')).toBe('converge');
    expect(maxPhase('converge', 'diverge')).toBe('converge'); // no regression
    expect(maxPhase('finalize', 'diverge')).toBe('finalize'); // no regression
    expect(maxPhase('converge', 'finalize')).toBe('finalize'); // forward advance
    expect(maxPhase('diverge', 'diverge')).toBe('diverge');
  });
});

describe('ADAPTER_NOTE — faithfulness clauses (no fake subagents, honest memory)', () => {
  it('states plainly there are NO subagents / parallel workers / background jobs', () => {
    expect(ADAPTER_NOTE).toContain('You have NO subagents, parallel workers, or background jobs');
    // Do the work yourself, sequentially — never narrate parallel/background work.
    expect(ADAPTER_NOTE).toMatch(/do that work YOURSELF, sequentially/);
    expect(ADAPTER_NOTE).toMatch(/Never claim, narrate, or pretend/);
  });

  it('no longer tells the model memory lives ONLY in its own context', () => {
    // Softened for real compaction: the model MAY note to the running record and
    // must NOT be told the whole conversation is only in its own context.
    expect(ADAPTER_NOTE).not.toMatch(/keep the session's memory in your own context/);
    expect(ADAPTER_NOTE).toMatch(/note key ideas and decisions to the running record/);
    expect(ADAPTER_NOTE).toMatch(/do NOT assume the whole conversation lives only in your own context/);
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
