import 'server-only';

/**
 * Shape the C-1 manifest into the two-level agent→command tree the UI renders
 * (FR-40). Level 1 = agents; Level 2 = each agent's menu items joined with their
 * parity status from the capability registry.
 *
 * ZERO per-agent code: the tree is a pure projection of `getAgents()` +
 * `parityFor(...)`. Adding, renaming, or re-menuing an agent in `.claude/skills/**`
 * changes the tree with no edit here. Mary (bmad-agent-analyst) sorts first and
 * is the default selection; every other agent is selectable, ordered by name.
 *
 * DB-independent — reads files only, so the tree renders whether or not a
 * database is configured.
 */
import { getAgents, type ManifestEntry } from '@/lib/skills/manifest';
import { parityFor, isDevWorkflowSkill, type ParityStatus } from './capabilities';

/** Mary is always the first Level-1 agent (the proven front door). */
export const DEFAULT_AGENT_SLUG = 'bmad-agent-analyst';

export type TreeCommand = {
  code: string;
  description?: string;
  /** A registered skill slug this command launches (mutually exclusive with prompt). */
  skill?: string;
  /** Inline prompt text this command runs as its launch turn. */
  prompt?: string;
  /** Parity: 'verified' launches on the engine; 'unverified' greys + degrades. */
  parity: ParityStatus;
  /** True when this command executes code (degrades with a "needs a sandbox" reason). */
  needsSandbox: boolean;
};

export type TreeAgent = {
  slug: string;
  name: string;
  icon?: string;
  commands: TreeCommand[];
};

/** Mary first, then the rest alphabetically by display name (stable, no per-agent code). */
function orderAgents(agents: ManifestEntry[]): ManifestEntry[] {
  return [...agents].sort((a, b) => {
    if (a.slug === DEFAULT_AGENT_SLUG) return -1;
    if (b.slug === DEFAULT_AGENT_SLUG) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Build the agent→command tree. `agents` is injectable for tests (fixture
 * manifest); it defaults to the real `getAgents()`.
 */
export function getAgentTree(agents: ManifestEntry[] = getAgents()): TreeAgent[] {
  return orderAgents(agents).map((agent) => ({
    slug: agent.slug,
    name: agent.name,
    icon: agent.icon,
    commands: (agent.menu ?? []).map((item) => ({
      code: item.code,
      description: item.description,
      skill: item.skill,
      prompt: item.prompt,
      parity: parityFor(agent.slug, item.code, item.skill),
      needsSandbox: isDevWorkflowSkill(item.skill),
    })),
  }));
}
