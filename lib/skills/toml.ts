import 'server-only';

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { parse as parseToml } from 'smol-toml';

/**
 * Three-layer BMad customization merge, in TypeScript.
 *
 * Faithful port of `_bmad/scripts/resolve_customization.py`. Reads (lowest →
 * highest priority):
 *   1. `.claude/skills/{slug}/customize.toml`        — skill defaults (required)
 *   2. `_bmad/custom/{slug}.toml`                    — team overrides   (optional)
 *   3. `_bmad/custom/{slug}.user.toml`               — personal overrides (optional)
 * then deep-merges base → team → user with the exact structural rules below.
 *
 * Merge rules (purely structural — no field-name special-casing):
 *   - Scalars (string/number/bool/date): override wins.
 *   - Tables (plain objects): deep-merge recursively.
 *   - Arrays of tables where *every* item shares the same identifier field
 *     (all have `code`, or all have `id`): merge by that key — matching keys
 *     replace in place, new keys append.
 *   - All other arrays (incl. mixed/partial keys): append (base then override).
 *
 * There is no removal mechanism — overrides cannot delete base items.
 */

type TomlValue = unknown;
type TomlTable = Record<string, TomlValue>;

const KEYED_MERGE_FIELDS = ['code', 'id'] as const;

/** A plain TOML table — object, but not an array and not a Date/scalar wrapper. */
function isTable(v: TomlValue): v is TomlTable {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !(v instanceof Date)
  );
}

/**
 * Return 'code' or 'id' if *every* item is a table carrying that same field
 * (non-null). Mixed arrays — some `code`, some `id`, or any non-table item —
 * return null and fall through to append. Matches `_detect_keyed_merge_field`.
 */
function detectKeyedMergeField(items: TomlValue[]): 'code' | 'id' | null {
  if (items.length === 0 || !items.every((it) => isTable(it))) return null;
  for (const candidate of KEYED_MERGE_FIELDS) {
    if (items.every((it) => (it as TomlTable)[candidate] != null)) return candidate;
  }
  return null;
}

/** Merge two arrays-of-tables by a shared key. Mirrors `_merge_by_key`. */
function mergeByKey(base: TomlValue[], override: TomlValue[], keyName: string): TomlValue[] {
  const result: TomlValue[] = [];
  const indexByKey = new Map<unknown, number>();

  for (const item of base) {
    if (!isTable(item)) continue;
    if (item[keyName] != null) indexByKey.set(item[keyName], result.length);
    result.push({ ...item });
  }

  for (const item of override) {
    if (!isTable(item)) {
      result.push(item);
      continue;
    }
    const key = item[keyName];
    if (key != null && indexByKey.has(key)) {
      result[indexByKey.get(key)!] = { ...item };
    } else {
      if (key != null) indexByKey.set(key, result.length);
      result.push({ ...item });
    }
  }

  return result;
}

/** Shape-aware array merge. Keyed-merge if eligible, else append. Mirrors `_merge_arrays`. */
function mergeArrays(base: TomlValue[], override: TomlValue[]): TomlValue[] {
  const keyedField = detectKeyedMergeField([...base, ...override]);
  if (keyedField) return mergeByKey(base, override, keyedField);
  return [...base, ...override];
}

/** Recursively merge `override` into `base` using the BMad structural rules. */
export function deepMerge(base: TomlValue, override: TomlValue): TomlValue {
  if (isTable(base) && isTable(override)) {
    const result: TomlTable = { ...base };
    for (const [key, overVal] of Object.entries(override)) {
      result[key] = key in result ? deepMerge(result[key], overVal) : overVal;
    }
    return result;
  }
  if (Array.isArray(base) && Array.isArray(override)) {
    return mergeArrays(base, override);
  }
  return override;
}

const SKILLS_DIR = '.claude/skills';
const CUSTOM_DIR = path.join('_bmad', 'custom');

/** Read + parse a TOML file. Missing optional → {}. Parse error → throws naming the file. */
function loadToml(absPath: string, required: boolean): TomlTable {
  if (!existsSync(absPath)) {
    if (required) {
      throw new Error(`[skills/toml] required customization file not found: ${absPath}`);
    }
    return {};
  }
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (err) {
    throw new Error(`[skills/toml] failed to read ${absPath}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    throw new Error(`[skills/toml] failed to parse ${absPath}: ${(err as Error).message}`);
  }
  if (!isTable(parsed)) {
    throw new Error(`[skills/toml] ${absPath} did not parse to a table`);
  }
  return parsed;
}

/** Absolute path to a skill's base customize.toml. */
export function customizeTomlPath(slug: string): string {
  return path.join(process.cwd(), SKILLS_DIR, slug, 'customize.toml');
}

/** True if a skill ships a base customize.toml (only these can be resolved/merged). */
export function hasCustomization(slug: string): boolean {
  return existsSync(customizeTomlPath(slug));
}

/**
 * Resolve a skill's merged customization (base → team → user), matching
 * `resolve_customization.py` exactly. Base is required; team/user optional.
 */
export function resolveCustomization(slug: string): TomlTable {
  const root = process.cwd();
  const base = loadToml(customizeTomlPath(slug), true);
  const team = loadToml(path.join(root, CUSTOM_DIR, `${slug}.toml`), false);
  const user = loadToml(path.join(root, CUSTOM_DIR, `${slug}.user.toml`), false);

  let merged = deepMerge(base, team);
  merged = deepMerge(merged, user);
  return merged as TomlTable;
}
