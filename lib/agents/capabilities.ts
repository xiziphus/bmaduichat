/**
 * The Epic-D capability registry — parity as **checked-in data, not code**.
 *
 * The manifest (lib/skills/manifest.ts) gives BREADTH: every agent, every
 * command, always visible (FR-43). This registry gives HONESTY (FR-42): only a
 * command whose engine parity has been documented renders active; everything
 * else renders greyed-but-visible and degrades honestly when tapped.
 *
 * Flipping a command live is one edit here + a documented in-browser pass — no
 * TypeScript branching anywhere else. Default is `unverified`; only the seed
 * below is `verified`.
 *
 * Pure/deterministic and safe to import from anywhere (no fs, no db, no
 * server-only) so the tree layer and the (server) launch layer share it.
 */

export type ParityStatus = 'verified' | 'unverified';

/**
 * VERIFIED SEED — the ONLY commands that have passed a documented in-browser
 * parity pass. Keyed `agentSlug::code`.
 *
 *   bmad-agent-analyst / BP (brainstorming) — proven on the engine in Epic C-4.
 *
 * Add an entry here (with a per-command parity note in the PR) to flip a command
 * live. Nothing else is verified until its own pass is documented.
 */
const VERIFIED_SEED: ReadonlySet<string> = new Set<string>(['bmad-agent-analyst::BP']);

/**
 * DEV-WORKFLOW FAMILY — commands whose target skill EXECUTES CODE. These need
 * the sandbox service the PRD costs as a separate phase (see spec "Ask First"),
 * so they stay `unverified` and degrade with a specific "needs a sandbox"
 * reason rather than the generic "not wired yet".
 */
const DEV_WORKFLOW_SKILLS: ReadonlySet<string> = new Set<string>([
  'bmad-quick-dev',
  'bmad-dev-story',
  'bmad-dev-auto',
]);

/**
 * RESEARCH FAMILY — commands whose target skill may need the web. They get the
 * free-tier `web_search` tool (lib/runtime/tools.ts) offered to their run; with
 * no provider configured the tool degrades honestly (never a paid API).
 */
const RESEARCH_SKILLS: ReadonlySet<string> = new Set<string>([
  'bmad-market-research',
  'bmad-domain-research',
  'bmad-technical-research',
]);

function key(agentSlug: string, code: string): string {
  return `${agentSlug}::${code}`;
}

/**
 * Parity for one command. `verified` only for the seed above; everything else
 * defaults to `unverified`.
 */
export function parityFor(agentSlug: string, code: string): ParityStatus {
  return VERIFIED_SEED.has(key(agentSlug, code)) ? 'verified' : 'unverified';
}

/** True when a command's target skill executes code (needs the sandbox phase). */
export function isDevWorkflowSkill(skill?: string): boolean {
  return skill !== undefined && DEV_WORKFLOW_SKILLS.has(skill);
}

/** True when a command's target skill is research-family (web-search eligible). */
export function isResearchSkill(skill?: string): boolean {
  return skill !== undefined && RESEARCH_SKILLS.has(skill);
}

/**
 * The configured free/keyless web-search provider (env `WEB_SEARCH_PROVIDER`),
 * or undefined when unset. NEVER a paid API — an unconfigured provider makes the
 * research command degrade honestly (see lib/runtime/tools.ts).
 */
export function webSearchProvider(): string | undefined {
  const v = process.env.WEB_SEARCH_PROVIDER;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
