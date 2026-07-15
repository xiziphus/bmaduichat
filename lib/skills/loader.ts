import 'server-only';

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { resolveCustomization, hasCustomization } from './toml';

/**
 * Generic BMad skill loader. Given a skill slug, reads its `SKILL.md`, exposes
 * its `references/*` for just-in-time reading, and returns its merged
 * `customize.toml` config (base → team → user, via ./toml). Generalizes the
 * hand-rolled reads in `lib/bmad-source.ts` so ANY skill can be loaded with no
 * per-skill TypeScript.
 *
 * Files on disk stay byte-identical: `loadSkill` returns RAW content. CLI→browser
 * neutralization is an explicit, opt-in step via `adaptMechanics(text)` (the
 * FR-34 adapter seam) — callers adapt at the point of use.
 *
 * Server-only; never bundle client-side. Reads are relative to `process.cwd()`,
 * the proven `bmad-source` pattern (files shipped to Vercel via next.config
 * `outputFileTracingIncludes`).
 */

const SKILLS_DIR = '.claude/skills';

function skillRoot(slug: string): string {
  return path.join(process.cwd(), SKILLS_DIR, slug);
}

/** A skill's references/*, readable one file at a time (lazy, cached). */
export type SkillReferences = {
  /** Reference file names present on disk (e.g. `mode-partner.md`), sorted. */
  names: string[];
  /** True if a named reference exists. */
  has(name: string): boolean;
  /** Read one reference's RAW content; undefined if absent (never throws for a miss). */
  read(name: string): string | undefined;
};

export type LoadedSkill = {
  slug: string;
  /** RAW SKILL.md content, byte-identical to disk. */
  skillMd: string;
  /** references/* accessor (lazy). */
  references: SkillReferences;
  /** Merged customize.toml (base→team→user); {} when the skill ships none. */
  config: Record<string, unknown>;
};

/** List reference files under a skill's references/ dir (flat + one nested level). */
function listReferences(refDir: string): string[] {
  if (!existsSync(refDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(refDir)) {
    const abs = path.join(refDir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isFile()) {
      out.push(entry);
    } else if (st.isDirectory()) {
      // one level of nesting, keyed as `subdir/file.md`
      for (const sub of readdirSync(abs)) {
        if (statSync(path.join(abs, sub)).isFile()) out.push(`${entry}/${sub}`);
      }
    }
  }
  return out.sort();
}

function makeReferences(slug: string): SkillReferences {
  const refDir = path.join(skillRoot(slug), 'references');
  const names = listReferences(refDir);
  const nameSet = new Set(names);
  const cache = new Map<string, string>();
  return {
    names,
    has: (name: string) => nameSet.has(name),
    read(name: string): string | undefined {
      if (cache.has(name)) return cache.get(name);
      if (!nameSet.has(name)) return undefined;
      const content = readFileSync(path.join(refDir, name), 'utf8');
      cache.set(name, content);
      return content;
    },
  };
}

const skillCache = new Map<string, LoadedSkill>();

/**
 * Load a skill by slug: RAW SKILL.md, its references (lazy), and merged config.
 * Missing skill dir / SKILL.md → clear error. Cached at module scope per slug.
 */
export function loadSkill(slug: string): LoadedSkill {
  const cached = skillCache.get(slug);
  if (cached) return cached;

  const root = skillRoot(slug);
  if (!existsSync(root)) {
    throw new Error(
      `[skills/loader] skill not found: ${slug} (looked in ${root}). ` +
        `Ensure the slug is correct and next.config.ts outputFileTracingIncludes ` +
        `ships .claude/skills into this function.`,
    );
  }
  const skillMdPath = path.join(root, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    throw new Error(`[skills/loader] SKILL.md missing for skill: ${slug} (${skillMdPath})`);
  }

  const loaded: LoadedSkill = {
    slug,
    skillMd: readFileSync(skillMdPath, 'utf8'),
    references: makeReferences(slug),
    config: hasCustomization(slug) ? resolveCustomization(slug) : {},
  };
  skillCache.set(slug, loaded);
  return loaded;
}

// ---------------------------------------------------------------------------
// adaptMechanics — the FR-34 CLI→browser adapter seam
// ---------------------------------------------------------------------------

/**
 * Neutralize CLI-only BMad mechanics in loaded skill text so it reads sensibly
 * in the browser runtime, without editing any file on disk. This is the shared,
 * general seam for FR-34; `lib/bmad-source.ts` layers Mary-specific scrubbing on
 * top for her prompt. Transforms centralized here (extend as more skills onboard):
 *
 *   - `uv run …` / `python3 …script.py …` script invocations → dropped.
 *   - memlog / resolver / brain script references (`memlog.py`, `.memlog.md`,
 *     `resolve_customization.py`, `brain.py`, `brain-selector`) → dropped/neutralized.
 *   - `{placeholder}` tokens (e.g. `{project-root}`, `{user_name}`) → removed.
 *   - composer-page and bare file-path references → softened.
 *
 * Idempotent and whitespace-tidying. Input text is never mutated on disk.
 */
export function adaptMechanics(text: string): string {
  return (
    text
      // `uv run …` or inline `python3 …/foo.py …` invocations (whole run to EOL / end of inline code)
      .replace(/`?\buv run [^\n`]*`?/gi, '')
      .replace(/`?\bpython3?\s+[^\n`]*\.py[^\n`]*`?/gi, '')
      // memlog / resolver / brain mechanic tokens
      .replace(/\bmemlog\.py\b/gi, '')
      .replace(/\bresolve_customization\.py\b/gi, '')
      .replace(/\bbrain\.py\b/gi, '')
      .replace(/\bbrain-selector\b/gi, '')
      .replace(/\.memlog\.md\b/gi, '')
      .replace(/\bthe memlog\b/gi, 'the running record')
      .replace(/\bmemlog\b/gi, 'the running record')
      // composer-page reference
      .replace(/\bcomposer page\b/gi, 'the technique picker')
      // {placeholder} tokens (project-root, skill-root, user_name, …)
      .replace(/\{[^}\n]*\}/g, '')
      // tidy whitespace left by removals
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([.,;:])/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
