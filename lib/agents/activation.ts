import 'server-only';

/**
 * Server-side composer for an agent's activation payload — the real data behind
 * the browser-native BMad "activation" moment. It reads the agent's ACTUAL files
 * via the generic skill loader and reports exactly which ones were read, then
 * joins the command menu with its checked-in parity (verified vs coming-soon).
 *
 * DB-independent and server-only (fs reads of .claude/skills/**). The greeting
 * TEXT is composed elsewhere (lib/agents/greeting.ts, a pure client-safe module)
 * from this payload — so it stays free, instant, and honest.
 */
import { existsSync } from 'fs';
import path from 'path';
import { loadSkill } from '@/lib/skills/loader';
import { hasCustomization } from '@/lib/skills/toml';
import { getAgentTree } from './tree';
import type { AgentActivation } from './greeting';

type AgentConfig = {
  name?: unknown;
  title?: unknown;
  icon?: unknown;
  role?: unknown;
  identity?: unknown;
  whenToUse?: unknown;
  description?: unknown;
};

function scalar(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The real relative filenames the loader read for this agent, in load order:
 * the merged customize.toml (+ any team/user overrides that exist), SKILL.md,
 * then each references/* file. Only files actually present are listed.
 */
function filesReadFor(slug: string, refNames: string[]): string[] {
  const files: string[] = [];
  if (hasCustomization(slug)) files.push('customize.toml');
  const customDir = path.join(process.cwd(), '_bmad', 'custom');
  if (existsSync(path.join(customDir, `${slug}.toml`))) files.push(`_bmad/custom/${slug}.toml`);
  if (existsSync(path.join(customDir, `${slug}.user.toml`)))
    files.push(`_bmad/custom/${slug}.user.toml`);
  files.push('SKILL.md');
  for (const name of refNames) files.push(`references/${name}`);
  return files;
}

/**
 * Compose the activation payload for one agent slug. Throws (via loadSkill) when
 * the slug isn't a real skill on disk — the route maps that to a 404.
 */
export function getAgentActivation(slug: string): AgentActivation {
  const skill = loadSkill(slug); // throws for a missing/invalid skill dir
  const agent = (skill.config.agent as AgentConfig | undefined) ?? {};

  const treeAgent = getAgentTree().find((a) => a.slug === slug);
  const name = scalar(agent.name) ?? treeAgent?.name ?? slug;
  const icon = scalar(agent.icon) ?? treeAgent?.icon ?? '🤖';
  const title = scalar(agent.title) ?? 'BMad agent';
  const blurb =
    scalar(agent.role) ??
    scalar(agent.identity) ??
    scalar(agent.whenToUse) ??
    scalar(agent.description) ??
    '';

  const commands = (treeAgent?.commands ?? []).map((c) => ({
    code: c.code,
    description: c.description,
    parity: c.parity,
    needsSandbox: c.needsSandbox,
  }));

  return {
    slug,
    name,
    icon,
    title,
    blurb,
    filesRead: filesReadFor(slug, skill.references.names),
    commands,
  };
}
