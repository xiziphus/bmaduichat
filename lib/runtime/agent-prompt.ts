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
import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import { loadSkill, adaptMechanics, referenceHintLine } from '@/lib/skills/loader';
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
  /** BMad activation steps (arrays of instruction strings), usually empty today. */
  activation_steps_prepend?: unknown;
  activation_steps_append?: unknown;
  /** Persistent facts: literal strings, or `file:<path>` pointers, usually empty today. */
  persistent_facts?: unknown;
};

function scalar(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

/**
 * Resolve a `file:`-prefixed persistent fact to its RAW contents, server-side.
 * The spec (the part after `file:`) is resolved relative to the repo root
 * (`process.cwd()`); `{project-root}` tokens expand to the same. Returns the file
 * contents, or `undefined` when the path is empty, doesn't resolve, isn't a plain
 * file, or can't be read — SKIP silently, never throw, never inject a broken token.
 */
function readFileFact(spec: string): string | undefined {
  const rel = spec.trim().replace(/\{project-root\}/g, process.cwd());
  if (!rel) return undefined;
  const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  try {
    if (!existsSync(abs) || !statSync(abs).isFile()) return undefined;
    return readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
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

  // Activation steps (BMad `activation_steps_prepend` then `_append`). Usually
  // empty today — inject NOTHING when so (no fabricated content).
  const activation = [...list(agent.activation_steps_prepend), ...list(agent.activation_steps_append)];
  if (activation.length > 0) {
    lines.push('', 'On activation, perform these steps:', ...activation.map((s, i) => `${i + 1}. ${s}`));
  }

  // Persistent facts / context. Literal entries inject verbatim as bullets;
  // `file:<path>` entries resolve server-side and inject their (adapted)
  // contents. Unresolved file pointers are skipped silently. Usually empty today.
  const factEntries: string[] = [];
  for (const f of list(agent.persistent_facts)) {
    const fileMatch = /^file:\s*(.+)$/i.exec(f.trim());
    if (fileMatch) {
      const content = readFileFact(fileMatch[1]);
      if (content && content.trim()) factEntries.push(adaptMechanics(content));
    } else {
      factEntries.push(`- ${f}`);
    }
  }
  if (factEntries.length > 0) {
    lines.push('', 'Persistent facts / context:', ...factEntries);
  }

  lines.push('', 'You are running inside Playground, a small browser app.');
  return lines.join('\n');
}

/**
 * The runtime system prompt for a launched command. When `skillSlug` differs
 * from `agentSlug` it's a skill-backed command: persona + adapter note + the
 * adapted SKILL.md + protocols.
 *
 * When they're equal it's PERSONA CHAT (free chat with the agent, no launched
 * workflow). We STILL load + adapt the agent's OWN SKILL.md and include it, so a
 * free-chatted agent carries its own operating instructions — not just its
 * persona scalars + protocols. Only if the agent ships no loadable SKILL.md do
 * we fall back to persona-only.
 */
export function composeAgentCommandPrompt(opts: {
  agentSlug: string;
  skillSlug: string;
}): string {
  const persona = buildAgentPersona(opts.agentSlug);
  const parts: string[] = [persona];

  // The slug whose SKILL.md + references back this prompt (target workflow for a
  // skill-backed command; the agent's own for persona chat).
  const loadedSlug = opts.skillSlug;
  let loaded = false;

  if (opts.skillSlug !== opts.agentSlug) {
    // Skill-backed command: adapt the target workflow's SKILL.md.
    let skillText = `You are running the "${opts.skillSlug}" workflow.`;
    try {
      skillText = adaptMechanics(loadSkill(opts.skillSlug).skillMd);
      loaded = true;
    } catch {
      /* keep the honest fallback line */
    }
    parts.push(ADAPTER_NOTE, skillText);
  } else {
    // Persona chat: fold in the agent's OWN adapted SKILL.md so free chat isn't
    // stripped of the agent's operating instructions. Persona-only fallback if
    // the agent has no SKILL.md to load.
    try {
      const skillText = adaptMechanics(loadSkill(opts.agentSlug).skillMd);
      parts.push(ADAPTER_NOTE, skillText);
      loaded = true;
    } catch {
      /* no SKILL.md → persona-only */
    }
  }

  // Tell the model which references it can pull on demand (read_reference tool).
  // adaptMechanics strips the SKILL.md's own references/... path directives, so
  // without this line the model has no way to know these files exist. Only when
  // the SKILL.md actually loaded and the skill ships references.
  if (loaded) {
    try {
      const hint = referenceHintLine(loadSkill(loadedSlug).references.names);
      if (hint) parts.push(hint);
    } catch {
      /* no loadable skill → no hint */
    }
  }

  // App conventions LAST so the chips/<document> contract wins attention.
  parts.push(APP_PROTOCOLS, ENGINE_OUTPUT_CONTRACT);
  return parts.join('\n\n');
}
