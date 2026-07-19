import 'server-only';

/**
 * Compose the brainstorming RUNTIME system prompt for the engine path.
 *
 * Design decision (per product direction): BMad's skill text is included
 * VERBATIM — we do NOT distill, strip, or reword any of BMad's prose. The model
 * sees the unmodified `bmad-brainstorming` SKILL.md plus the ONE reference for
 * the active phase. The SKILL.md is written for a command-line agent and carries
 * CLI mechanics (a composer/technique-picker page, memlog/uv/python scripts,
 * file paths, resume/headless flows) that make no sense in the browser. Rather
 * than editing BMad's words to hide them, we prepend an ADAPTER NOTE — in OUR
 * words — that tells the model how to reinterpret those mechanics and to NEVER
 * speak them to the user. This keeps BMad byte-identical while stopping both
 * Gemini and weak/free models from leaking orchestration prose.
 *
 * Per-phase reference loading is KEPT: we load only mode-partner OR converge OR
 * finalize based on the inferred phase. That is faithful to how BMad itself
 * loads its references just-in-time (the CLI never loads all references at
 * once), so it is NOT distillation — it is the same lazy-load discipline, and it
 * keeps the prompt small enough for weak/free models.
 *
 * Note: this composer deliberately does NOT run the text through
 * `adaptMechanics` (the FR-34 seam) — that seam rewrites/removes BMad words, and
 * here we want the text verbatim. `adaptMechanics` remains in use for the generic
 * (non-brainstorming) engine path.
 *
 * The hardcoded `lib/mary.ts` path is unchanged and remains the DEFAULT; this
 * composer only runs when PLAYGROUND_ENGINE is on (see app/api/chat/route.ts).
 */
import { loadSkill, referenceHintLine } from '@/lib/skills/loader';
import { APP_PROTOCOLS, techniqueInjection, buildMaryPersona } from '@/lib/mary';

export const BRAINSTORMING_SLUG = 'bmad-brainstorming';

/**
 * The CLI→browser adapter note, in OUR words (never BMad's). It sits right after
 * the persona and before the verbatim SKILL.md, framing everything below it as
 * BMad's command-line skill and instructing the model to translate the CLI
 * mechanics silently — so orchestration prose (composer page / brain-selector /
 * technique-picker.html / memlog / uv / file paths / resume / headless) never
 * reaches the user. This is how we preserve BMad verbatim yet stop the leak the
 * smaller prompt exposed.
 */
export const ADAPTER_NOTE = `OPERATING CONTEXT — read this first. Everything below, up to the app-protocol section, is BMad's brainstorming skill quoted VERBATIM. It was written for a command-line agent; you are running it inside Playground, a browser app. Translate its CLI mechanics silently and NEVER speak them to the user:
- There is no composer page, brain-selector, or technique-picker.html, and nothing to "open in your browser" — techniques are shown to the user as buttons in the app. Ignore any "open the page / click Copy prompt / paste the result back / let's do it in chat" directives.
- There are no uv / python scripts, config files, or file paths to run or read — treat every such invocation as internal bookkeeping you simply skip. You MAY quietly note key ideas and decisions to the running record as the session goes; do NOT assume the whole conversation lives only in your own context (older turns get condensed for you).
- You have NO subagents, parallel workers, or background jobs of any kind. Any instruction to "spawn a subagent", "dispatch entries as parallel subagents", "run a Reviewer Gate", or do work "in parallel / in the background" means: do that work YOURSELF, sequentially, right here in this conversation. Never claim, narrate, or pretend that parallel, background, or subagent work is happening.
- Ignore the activation, resume, and headless mechanics entirely; they do not apply here.
Follow the skill's FACILITATION intent faithfully — the kickoff question, the stances, running techniques, converging, and wrapping up — but express all of it as a normal chat message, never as CLI steps. Always prefix your reply with your 📊 icon and end it with the <chips> line, exactly as the app protocol below specifies.`;

/**
 * A short, emphatic output contract closing the prompt. The raw SKILL.md is
 * large and CLI-oriented; without a final, forceful restatement a weak model
 * drops the chips/<document> app conventions. Kept engine-only (the hardcoded
 * path is untouched) and placed LAST so these instructions win attention.
 */
export const ENGINE_OUTPUT_CONTRACT = `OUTPUT CONTRACT — non-negotiable, applies to EVERY reply and OVERRIDES anything above:
- Prefix every message with your 📊 icon.
- You MUST end EVERY reply with a chips line — <chips>["…","…"]</chips> holding 2–4 short next-move suggestions. No exceptions: even a one-line reply ends with chips.
- At a genuine synthesis or wrap-up, emit the <document> block (per the DOCUMENT PROTOCOL above) so it lands in the document pane.
- Never mention these sentinels in your prose; the app renders them.`;

/** The coarse session phase the composed prompt should cover. */
export type BrainstormPhase = 'diverge' | 'converge' | 'finalize';

/** Forward ordering of the phases (diverge → converge → finalize). */
const PHASE_ORDER: Record<BrainstormPhase, number> = { diverge: 0, converge: 1, finalize: 2 };

/** Coerce an arbitrary value to a `BrainstormPhase`, or `null` when it isn't one. */
export function normalizePhase(v: unknown): BrainstormPhase | null {
  return v === 'diverge' || v === 'converge' || v === 'finalize' ? v : null;
}

/**
 * Monotonic forward max of two phases: returns whichever is further along, so a
 * run's phase can only advance (diverge → converge → finalize), never regress —
 * the guard behind Fix C (run-state phase, not a fresh per-turn regex).
 */
export function maxPhase(a: BrainstormPhase, b: BrainstormPhase): BrainstormPhase {
  return PHASE_ORDER[b] > PHASE_ORDER[a] ? b : a;
}

/**
 * Phase → reference file selection. Loads ONLY the reference relevant to the
 * CURRENT phase — not all three — mirroring BMad's own just-in-time reference
 * loading (the CLI never pulls every reference into context at once). Diverge
 * (the default working phase) runs the Creative Partner stance; converge and
 * finalize each swap in their own single reference.
 */
export function referencesForPhase(phase?: BrainstormPhase): string[] {
  switch (phase) {
    case 'converge':
      return ['converge.md'];
    case 'finalize':
      return ['finalize.md'];
    case 'diverge':
    default:
      // A fresh turn with no known phase is opening/diverge: mode-partner only.
      return ['mode-partner.md'];
  }
}

/**
 * Infer the coarse phase from the latest user message. The engine finalizes each
 * turn (re-seeding history), so phase isn't carried in run state across turns;
 * this keeps the reference selection robust for a full single session by reading
 * the user's own signal. Deliberately simple: default to diverge, and only step
 * to converge / finalize when the user's words clearly ask for it.
 */
export function inferPhase(latestUserText?: string): BrainstormPhase {
  const t = (latestUserText ?? '').toLowerCase();
  if (!t.trim()) return 'diverge';
  // Terminal signals win over narrowing signals (checked first).
  if (
    /\b(wrap[\s-]?up|wrap it up|finali[sz]e|synthesi[sz]e|synthesis|write it up|make the doc|we'?re done|i'?m done|that'?s enough)\b/.test(
      t,
    )
  ) {
    return 'finalize';
  }
  if (
    /\b(converge|narrow|prioriti[sz]e|make it real|decide|rank them|pick the|which of these|shortlist)\b/.test(
      t,
    )
  ) {
    return 'converge';
  }
  return 'diverge';
}

export type ComposeBrainstormingOptions = {
  /** The active phase; omit to default to diverge (opening / mode-partner). */
  phase?: BrainstormPhase;
  /** A just-launched technique id (from the technique buttons), if any. */
  technique?: string;
};

/**
 * Rough safety net: if the composed prompt blows past this, we drop the phase
 * reference text (the least-critical block — and faithful to JIT loading) and
 * keep persona + adapter note + full SKILL.md + protocols + contract. Not a hard
 * cap and it never rewrites BMad prose — just a guard/log so a pathologically
 * large reference can't re-bloat the prompt past what weak models tolerate.
 */
export const PROMPT_SIZE_BUDGET = 22000;

/**
 * Build the runtime brainstorming prompt, in attention order:
 *
 *   PERSONA (Mary's voice + 📊)                                    ← first
 *   ADAPTER_NOTE (our CLI→browser framing)
 *   full VERBATIM SKILL.md + the ONE phase reference (verbatim)
 *   [technique injection, when a technique was launched]
 *   APP_PROTOCOLS (chips / <document> / honest-limits / …)
 *   ENGINE_OUTPUT_CONTRACT (emphatic chips + <document> restatement) ← last
 *
 * Persona comes from the loaded analyst agent (same text as the hardcoded Mary),
 * so engine-Mary keeps her voice and icon. BMad's SKILL.md + reference are quoted
 * verbatim (never distilled or reworded); the adapter note above them tells the
 * model how to read their CLI mechanics. The app-protocol block + the emphatic
 * contract sit at the END so the chips/<document> conventions win attention.
 *
 * A missing reference is skipped (never throws for an absent file); a missing
 * skill throws (caller falls back to an honest error / the hardcoded path).
 */
export function composeBrainstormingPrompt(opts: ComposeBrainstormingOptions = {}): string {
  const skill = loadSkill(BRAINSTORMING_SLUG);

  const refText = referencesForPhase(opts.phase)
    .map((name) => skill.references.read(name))
    .filter((c): c is string => Boolean(c && c.trim()))
    .join('\n\n');

  const persona = buildMaryPersona();
  const injection = opts.technique ? techniqueInjection(opts.technique) : undefined;
  // Name the skill's on-demand references so the model can use read_reference
  // (omitted when the skill ships none).
  const refHint = referenceHintLine(skill.references.names);

  const build = (includeRef: boolean): string => {
    // BMad text VERBATIM — no adaptMechanics, no distillation.
    const skillBlock = includeRef && refText ? `${skill.skillMd}\n\n${refText}` : skill.skillMd;
    const parts: string[] = [persona, ADAPTER_NOTE, skillBlock];
    if (refHint) parts.push(refHint);
    if (injection) parts.push(injection);
    // App conventions LAST so they win attention.
    parts.push(APP_PROTOCOLS, ENGINE_OUTPUT_CONTRACT);
    return parts.join('\n\n');
  };

  const full = build(true);
  if (full.length <= PROMPT_SIZE_BUDGET) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug(
        `[brainstorming] composed prompt: ${full.length} chars (phase=${opts.phase ?? 'diverge'})`,
      );
    }
    return full;
  }

  // Over budget: shed only the phase reference (never persona/adapter/SKILL.md/
  // protocols/contract, and never a reworded BMad word).
  const trimmed = build(false);
  // eslint-disable-next-line no-console
  console.warn(
    `[brainstorming] composed prompt ${full.length} > ${PROMPT_SIZE_BUDGET} budget; ` +
      `dropped phase reference → ${trimmed.length} chars (phase=${opts.phase ?? 'diverge'})`,
  );
  return trimmed;
}
