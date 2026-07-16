import 'server-only';

/**
 * Generic agent-command prompt composition (Epic D) — the SAME shape C-4 built
 * for Mary/brainstorming, generalized to ANY agent with ZERO per-agent code.
 *
 * A command launch composes, in attention order:
 *
 *   PERSONA (from the agent's own skill config — name/icon/role/…)   ← first
 *   ADAPTER_NOTE (our CLI→browser framing, reused verbatim from C-4)
 *   the target skill's SKILL.md, run through the FR-34 adapter
 *   APP_PROTOCOLS (chips / <document> / honest-limits / @refer / attachments)
 *   ENGINE_OUTPUT_CONTRACT (emphatic chips + <document> restatement)  ← last
 *
 * Persona is sliced live from the agent's merged `[agent]` config (via C-1's
 * loader), so picking any agent loads its real identity + icon — no hand-written
 * copy. Brainstorming keeps its dedicated composer (see engine.ts); everything
 * else flows through here.
 *
 * BMad files stay byte-identical: the SKILL.md is adapted in-memory only
 * (adaptMechanics is the sole translation seam).
 */
import { loadSkill, adaptMechanics } from '@/lib/skills/loader';
import { APP_PROTOCOLS } from '@/lib/mary';
import { ADAPTER_NOTE, ENGINE_OUTPUT_CONTRACT } from './brainstorming';

type AgentConfig = {
  name?: unknown;
  title?: unknown;
  icon?: unknown;
  role?: unknown;
  identity?: unknown;
  communication_style?: unknown;
  principles?: unknown;
};

function scalar(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/**
 * Compose an agent's persona header from its merged skill config — the same
 * fields and layout `buildMaryPersona()` uses, but generic over any agent slug.
 * A missing config still yields a sensible minimal persona (never throws).
 */
export function buildAgentPersona(agentSlug: string): string {
  let agent: AgentConfig = {};
  try {
    agent = (loadSkill(agentSlug).config.agent as AgentConfig | undefined) ?? {};
  } catch {
    agent = {};
  }
  const name = scalar(agent.name, agentSlug);
  const title = scalar(agent.title, 'BMad agent');
  const icon = scalar(agent.icon, '🤖');
  const role = scalar(agent.role);
  const identity = scalar(agent.identity);
  const style = scalar(agent.communication_style);
  const principles = list(agent.principles);

  const lines = [`You are ${name}, the ${title}.`, '', `Your icon is ${icon} — prefix every message with it so the user can see at a glance which agent is speaking.`];
  if (role) lines.push('', `Role: ${role}`);
  if (identity) lines.push(`Identity: ${identity}`);
  if (style) lines.push(`Communication style: ${style}`);
  if (principles.length > 0) {
    lines.push('', 'Principles:', ...principles.map((p) => `- ${p}`));
  }
  lines.push('', 'You are running inside Playground, a small browser app.');
  return lines.join('\n');
}

/**
 * The runtime system prompt for a launched command. When `skillSlug` differs
 * from `agentSlug` it's a skill-backed command: persona + adapter note + the
 * adapted SKILL.md + protocols. When they're equal it's a prompt-backed command
 * (no workflow skill): persona + protocols only, and the caller runs the prompt
 * text as the launch turn.
 */
export function composeAgentCommandPrompt(opts: {
  agentSlug: string;
  skillSlug: string;
}): string {
  const persona = buildAgentPersona(opts.agentSlug);
  const parts: string[] = [persona];

  if (opts.skillSlug !== opts.agentSlug) {
    let skillText = `You are running the "${opts.skillSlug}" workflow.`;
    try {
      skillText = adaptMechanics(loadSkill(opts.skillSlug).skillMd);
    } catch {
      /* keep the honest fallback line */
    }
    parts.push(ADAPTER_NOTE, skillText);
  }

  // App conventions LAST so the chips/<document> contract wins attention.
  parts.push(APP_PROTOCOLS, ENGINE_OUTPUT_CONTRACT);
  return parts.join('\n\n');
}
