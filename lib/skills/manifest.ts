import 'server-only';

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { resolveCustomization, hasCustomization } from './toml';

/**
 * Manifest of installed BMad skills. Scans `.claude/skills/` and classifies each
 * entry as an **agent** (its merged config has an `[agent]` block with a menu —
 * e.g. Mary/John) or a **workflow skill** (everything else). Agents' menu items
 * are surfaced so Epic D can render the command tree without new loader work.
 *
 * Server-only; cached at module scope (skills are read-only on disk).
 */

const SKILLS_DIR = '.claude/skills';

export type MenuItem = {
  code: string;
  description?: string;
  /** A registered skill slug this item invokes, if any. */
  skill?: string;
  /** Inline prompt text this item executes, if any (mutually exclusive with `skill`). */
  prompt?: string;
};

export type ManifestEntry = {
  slug: string;
  kind: 'agent' | 'skill';
  /** Display name — an agent's persona name (e.g. "Mary") or the skill's frontmatter name. */
  name: string;
  icon?: string;
  description?: string;
  /** Agent command menu (agents only). */
  menu?: MenuItem[];
};

/** Extract `name` / `description` from a SKILL.md YAML frontmatter block. */
function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(name|description)\s*:\s*(.*)$/);
    if (kv) {
      const val = kv[2].trim().replace(/^["']|["']$/g, '');
      out[kv[1] as 'name' | 'description'] = val;
    }
  }
  return out;
}

type AgentConfig = {
  name?: unknown;
  icon?: unknown;
  menu?: unknown;
};

function scalar(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function toMenu(raw: unknown): MenuItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const items: MenuItem[] = [];
  for (const it of raw) {
    if (it && typeof it === 'object' && !Array.isArray(it)) {
      const o = it as Record<string, unknown>;
      const code = scalar(o.code);
      if (!code) continue;
      items.push({
        code,
        description: scalar(o.description),
        skill: scalar(o.skill),
        prompt: scalar(o.prompt),
      });
    }
  }
  return items.length ? items : undefined;
}

function classify(slug: string): ManifestEntry {
  const root = path.join(process.cwd(), SKILLS_DIR, slug);
  const skillMdPath = path.join(root, 'SKILL.md');
  const fm = existsSync(skillMdPath)
    ? parseFrontmatter(readFileSync(skillMdPath, 'utf8'))
    : {};

  let config: Record<string, unknown> = {};
  if (hasCustomization(slug)) {
    try {
      config = resolveCustomization(slug);
    } catch {
      // A malformed skill TOML must not sink the whole manifest — treat as no config.
      config = {};
    }
  }

  const agent = config.agent as AgentConfig | undefined;
  const menu = agent ? toMenu(agent.menu) : undefined;

  if (agent && menu) {
    return {
      slug,
      kind: 'agent',
      name: scalar(agent.name) ?? fm.name ?? slug,
      icon: scalar(agent.icon),
      description: fm.description,
      menu,
    };
  }

  return {
    slug,
    kind: 'skill',
    name: fm.name ?? slug,
    icon: scalar(agent?.icon),
    description: fm.description,
  };
}

let cache: ManifestEntry[] | null = null;

/**
 * Enumerate installed skills, classified as agents vs. workflow skills.
 * Sorted by slug. Empty skills dir → []. Cached at module scope.
 */
export function getManifest(): ManifestEntry[] {
  if (cache) return cache;
  const skillsRoot = path.join(process.cwd(), SKILLS_DIR);
  if (!existsSync(skillsRoot)) {
    cache = [];
    return cache;
  }
  const slugs = readdirSync(skillsRoot)
    .filter((entry) => {
      try {
        return statSync(path.join(skillsRoot, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();

  cache = slugs.map(classify);
  return cache;
}

/** Convenience: the agents (skills with a command menu). */
export function getAgents(): ManifestEntry[] {
  return getManifest().filter((e) => e.kind === 'agent');
}
