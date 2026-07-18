/**
 * The Epic-D capability registry — parity as **checked-in data, not code**.
 *
 * The manifest (lib/skills/manifest.ts) gives BREADTH: every agent, every
 * command, always visible (FR-43). This registry gives HONESTY (FR-42): a
 * command renders active only if it genuinely runs on the generic engine
 * (lib/runtime/engine.ts + composeAgentCommandPrompt) the way Mary/BP proved —
 * persona + adapted SKILL.md + app protocols, zero per-agent code.
 *
 * POLICY (data-driven, no per-agent branching):
 *   every command is `verified` EXCEPT the dev/sandbox family
 *   (`isDevWorkflowSkill`), which stays `unverified` and degrades with a
 *   "needs a sandbox" reason.
 *
 * Why this is honest: the engine can already compose and run ANY skill- or
 * prompt-backed conversational command (brief, PRD, PRFAQ, brainstorming
 * variants, elicitation, party-mode, document-project, research, UX/design,
 * problem-solving, storytelling, …). Some of those (market/domain/technical
 * research) would benefit from web search that isn't wired — but they don't
 * hard-fail: the honest-limits protocol in the prompt makes the agent say it
 * can't browse here and do what it can from training knowledge. Only commands
 * that must EXECUTE/WRITE CODE genuinely can't run without the sandbox phase,
 * so those alone stay dark.
 *
 * Flipping the whole class is this one file — no TypeScript branching elsewhere.
 *
 * Pure/deterministic and safe to import from anywhere (no fs, no db, no
 * server-only) so the tree layer and the (server) launch layer share it.
 */

export type ParityStatus = 'verified' | 'unverified';

/**
 * VERIFIED SEED — commands with a documented in-browser parity pass. Kept
 * explicit for provenance even though the policy below would verify them anyway.
 * Keyed `agentSlug::code`.
 *
 *   bmad-agent-analyst / BP (brainstorming) — proven on the engine in Epic C-4.
 */
const VERIFIED_SEED: ReadonlySet<string> = new Set<string>(['bmad-agent-analyst::BP']);

/**
 * DEV/SANDBOX FAMILY — commands whose target skill EXECUTES or WRITES CODE (runs
 * a project's test command, produces working code artifacts, drives an unattended
 * dev loop). These need the sandbox service the PRD costs as a separate phase
 * (see spec "Ask First"), so they stay `unverified` and degrade with a specific
 * "needs a sandbox" reason rather than running conversationally on the engine.
 */
const DEV_WORKFLOW_SKILLS: ReadonlySet<string> = new Set<string>([
  'bmad-quick-dev', // Amelia · QD — implement any change as working code
  'bmad-dev-story', // Amelia · DS — write the story's tests + code
  'bmad-dev-auto', // bmad-loop iteration — unattended dev loop
  'bmad-qa-generate-e2e-tests', // Amelia · QA — generate AND run E2E/API tests
  'bmad-wds-build', // Mimir · BU — turn Work Orders into working code
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
 * Parity for one command. Every command is `verified` (engine-runnable) EXCEPT
 * the dev/sandbox family, which stays `unverified` until the sandbox phase.
 * Pass the command's target `skill` so the dev family can be detected; the seed
 * is honored explicitly for provenance.
 */
export function parityFor(agentSlug: string, code: string, skill?: string): ParityStatus {
  if (VERIFIED_SEED.has(key(agentSlug, code))) return 'verified';
  if (isDevWorkflowSkill(skill)) return 'unverified';
  return 'verified';
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
 * Optional builder hint for a preferred free web-search provider (env
 * `WEB_SEARCH_PROVIDER`), or undefined when unset. No longer REQUIRED: the
 * web_search tool is backed by a free multi-provider fallback chain
 * (lib/websearch, ordered via `WEB_SEARCH_ORDER`) whose keyless floor
 * (DuckDuckGo + Wikipedia) is always available. NEVER a paid API.
 */
export function webSearchProvider(): string | undefined {
  const v = process.env.WEB_SEARCH_PROVIDER;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
