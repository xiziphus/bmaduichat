import 'server-only';

/**
 * Compose the brainstorming RUNTIME system prompt for the engine path.
 *
 * This is the FR-34 adapter in the flesh: engine-Mary is the ACTUAL
 * `bmad-brainstorming` SKILL.md (plus the reference(s) for the active phase),
 * run through `adaptMechanics` to neutralize CLI-only mechanics, with ONE thing
 * layered on top — the shared `APP_PROTOCOLS` block (chips, <document>,
 * honest-limits, attachments, @refer). Persona / framing / stance / kickoff /
 * phases all come from the loaded skill + agent files via the loader, NOT
 * hand-written copy: nothing here re-states Mary's voice.
 *
 * The hardcoded `lib/mary.ts` path is unchanged and remains the DEFAULT; this
 * composer only runs when PLAYGROUND_ENGINE is on (see app/api/chat/route.ts).
 */
import { loadSkill, adaptMechanics } from '@/lib/skills/loader';
import { APP_PROTOCOLS, techniqueInjection } from '@/lib/mary';

export const BRAINSTORMING_SLUG = 'bmad-brainstorming';

/** The coarse session phase the composed prompt should cover. */
export type BrainstormPhase = 'diverge' | 'converge' | 'finalize';

/**
 * Phase → reference file selection. Diverge is the default working phase and
 * runs the Creative Partner stance; converge/finalize additively pull in the
 * narrowing and synthesis references. When no phase is known we include ALL
 * relevant references so a full single-run session (open → converge → wrap-up)
 * has the guidance it needs (the engine does not re-derive phase mid-turn).
 */
export function referencesForPhase(phase?: BrainstormPhase): string[] {
  switch (phase) {
    case 'diverge':
      return ['mode-partner.md'];
    case 'converge':
      return ['mode-partner.md', 'converge.md'];
    case 'finalize':
      return ['mode-partner.md', 'converge.md', 'finalize.md'];
    default:
      return ['mode-partner.md', 'converge.md', 'finalize.md'];
  }
}

export type ComposeBrainstormingOptions = {
  /** The active phase; omit to include all relevant references. */
  phase?: BrainstormPhase;
  /** A just-launched technique id (from the technique buttons), if any. */
  technique?: string;
};

/**
 * Build the runtime brainstorming prompt:
 *   adaptMechanics( SKILL.md + phase reference(s) )  +  APP_PROTOCOLS  [+ technique]
 *
 * Missing references are skipped (never throws for an absent file); a missing
 * skill throws (caller falls back to an honest error / the hardcoded path).
 */
export function composeBrainstormingPrompt(opts: ComposeBrainstormingOptions = {}): string {
  const skill = loadSkill(BRAINSTORMING_SLUG);

  const refs = referencesForPhase(opts.phase)
    .map((name) => skill.references.read(name))
    .filter((c): c is string => Boolean(c && c.trim()));

  // Adapt the loaded skill text + references together, then layer the shared
  // app-protocol block on top (verbatim — same text the hardcoded Mary uses).
  const adapted = adaptMechanics([skill.skillMd, ...refs].join('\n\n'));

  const parts: string[] = [adapted, APP_PROTOCOLS];

  const injection = opts.technique ? techniqueInjection(opts.technique) : undefined;
  if (injection) parts.push(injection);

  return parts.join('\n\n');
}
