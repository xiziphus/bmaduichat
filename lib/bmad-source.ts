import { readFileSync } from 'fs';
import path from 'path';

/**
 * Single source of truth for Mary's prompt: read the ACTUAL BMad skill files
 * that are committed to this repo (and bundled into the Vercel serverless
 * function via next.config.ts `outputFileTracingIncludes`). Edit a BMad file
 * → Mary changes. No copy-pasted constants.
 *
 * Each section is sliced out of its source file by heading marker, then
 * post-processed to drop/neutralize mechanics that don't exist in this app:
 * memlog.py / `uv run` script invocations, `{placeholder}` tokens, file-path
 * and composer/brain-selector references, and cross-references to other
 * stances. What survives is BMad's operative facilitation text.
 *
 * Sections are composed once per cold start and cached at module scope.
 */

const SKILLS = '.claude/skills';
const ANALYST_TOML = path.join(SKILLS, 'bmad-agent-analyst', 'customize.toml');
const BRAIN_SKILL = path.join(SKILLS, 'bmad-brainstorming', 'SKILL.md');
const MODE_PARTNER = path.join(SKILLS, 'bmad-brainstorming', 'references', 'mode-partner.md');
const CONVERGE = path.join(SKILLS, 'bmad-brainstorming', 'references', 'converge.md');
const FINALIZE = path.join(SKILLS, 'bmad-brainstorming', 'references', 'finalize.md');
const BRAIN_METHODS_CSV = path.join(SKILLS, 'bmad-brainstorming', 'assets', 'brain-methods.csv');

/** Read a repo-relative BMad file. Missing file → deployment/bundling bug. */
function read(rel: string): string {
  try {
    return readFileSync(path.join(process.cwd(), rel), 'utf8');
  } catch {
    throw new Error(
      `[bmad-source] Required BMad source file missing: ${rel} (cwd=${process.cwd()}). ` +
        `This is a deployment/bundling bug — ensure next.config.ts ` +
        `outputFileTracingIncludes ships the .claude/skills files.`,
    );
  }
}

// ---------------------------------------------------------------------------
// customize.toml — tiny hand parser (no toml dependency)
// ---------------------------------------------------------------------------

function tomlScalar(toml: string, key: string): string {
  const m = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'm'));
  return m ? m[1].replace(/\\"/g, '"') : '';
}

/** Parse a `key = [ "a", "b", ... ]` array (possibly multi-line). */
function tomlArray(toml: string, key: string): string[] {
  const m = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'));
  if (!m) return [];
  return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].replace(/\\"/g, '"'));
}

// ---------------------------------------------------------------------------
// Markdown slicing + scrubbing
// ---------------------------------------------------------------------------

/**
 * Slice a markdown file from the first heading line beginning with `prefix`
 * up to (but not including) the next `#`/`##` heading, or EOF.
 * Fallback per spec: prefix not found → return the whole file.
 */
function sliceSection(md: string, prefix: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith(prefix));
  if (start === -1) return md;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** The single (markdown) line/paragraph whose text starts with `prefix`. */
function paragraphStartingWith(section: string, prefix: string): string | null {
  const line = section
    .split('\n')
    .find((l) => l.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim().startsWith(prefix));
  return line ?? null;
}

// Sentence contains a mechanic that doesn't exist in this app → drop it.
const HARD =
  /(uv run|memlog\.py|\.memlog\.md|resolve_customization|brain\.py|brain-selector|composer page|\{[^}]*\}|--(?:by|type|field|workspace|key|value|skill|category|out|extra|file)\b|references\/[^\s`)]+|`[^`]*\/[^`]*`)/i;

// Sentence talks about a stance this app doesn't run → drop it.
const OTHER_MODE = /\bIn Facilitator mode\b|\bIdeate[- ]for[- ]me\b/i;

// Whole paragraphs that are pure mechanics, keyed by their lead-in phrase.
const DROP_ANCHORS = [
  /^the memlog\b/i, // SKILL framing: memlog-is-the-memory paragraph
  /^attribution is mandatory/i, // mode-partner: --by/--type attribution
  /^record the insights/i, // finalize: log + status:complete mechanics
  /^go to `#/i, // trailing "Go to `## ...`." pointer lines
];

function splitSentences(s: string): string[] {
  const protectedS = s
    .replace(/\be\.g\./g, 'e<D>g<D>')
    .replace(/\bi\.e\./g, 'i<D>e<D>')
    .replace(/\betc\./g, 'etc<D>')
    .replace(/\bvs\./g, 'vs<D>');
  return protectedS.split(/(?<=[.!?])\s+/).map((p) => p.replace(/<D>/g, '.'));
}

/** Drop mechanics/other-mode sentences from a single markdown line. */
function scrubLine(line: string): string {
  const bullet = line.match(/^(\s*[-*]\s+)/);
  const prefix = bullet ? bullet[1] : '';
  const rest = line.slice(prefix.length);
  const kept = splitSentences(rest).filter(
    (sent) => sent.trim() && !HARD.test(sent) && !OTHER_MODE.test(sent),
  );
  return kept.length ? prefix + kept.join(' ') : '';
}

function isResidual(line: string): boolean {
  return !/[A-Za-z0-9]/.test(line);
}

/**
 * Post-process a sliced section: strip markdown headings, drop mechanics
 * asides/parentheticals, drop pure-mechanics paragraphs, scrub mechanics
 * sentences, neutralize leftover jargon/placeholders, tidy whitespace.
 */
function scrub(section: string): string {
  let text = section
    // strip markdown headings — mary.ts supplies its own section labels
    .replace(/^#{1,6}\s.*$/gm, '')
    // cross-reference parentheticals: (`## Converging`)
    .replace(/\s*\(`#{1,6}[^`]*`\)/g, '')
    // attribution-tag parenthetical inside the synthesis mirror move
    .replace(/\s*\(in Creative Partner mode[\s\S]*?theirs\)/i, '')
    // backtick-carrying em-dash asides: "— log each idea … `technique` entry —"
    .replace(/\s*—\s*[^—\n]*`[^`]*`[^—\n]*—/g, '');

  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const bare = raw.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim();
    if (DROP_ANCHORS.some((re) => re.test(bare))) continue;
    const scrubbed = scrubLine(raw);
    if (isResidual(scrubbed)) continue;
    out.push(scrubbed);
  }

  return out
    .join('\n')
    // neutralize app-inapplicable "memlog" jargon (bare word survives HARD)
    .replace(/\bthe memlog\b/gi, 'the conversation')
    .replace(/\bmemlog\b/gi, 'the running record')
    // strip any stray {placeholder} token that slipped through
    .replace(/\{[^}]*\}/g, '')
    // tidy whitespace left by removals
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Composed sections (cached at module scope — read once per cold start)
// ---------------------------------------------------------------------------

export type MaryPersona = {
  name: string;
  title: string;
  icon: string;
  role: string;
  identity: string;
  communicationStyle: string;
  principles: string[];
};

export type BmadSections = {
  persona: MaryPersona;
  framing: string;
  stance: string;
  kickoff: string;
  phasesIntro: string;
  convergeIntro: string;
  converge: string;
  synthesis: string;
};

function compose(): BmadSections {
  const toml = read(ANALYST_TOML);
  const persona: MaryPersona = {
    name: tomlScalar(toml, 'name'),
    title: tomlScalar(toml, 'title'),
    icon: tomlScalar(toml, 'icon'),
    role: tomlScalar(toml, 'role'),
    identity: tomlScalar(toml, 'identity'),
    communicationStyle: tomlScalar(toml, 'communication_style'),
    principles: tomlArray(toml, 'principles'),
  };

  const skill = read(BRAIN_SKILL);
  const framing = scrub(sliceSection(skill, '## Framing'));

  // Kickoff = the opening paragraph of "## Run a Session" only (the compound
  // question), not the composer-page / workspace-binding mechanics that follow.
  const runSession = sliceSection(skill, '## Run a Session');
  const kickoffPara =
    runSession
      .split('\n')
      .slice(1) // drop heading
      .join('\n')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p.length > 0) ?? runSession;
  const kickoff = scrub(kickoffPara);

  // Diverge/run lead-in + "offer three paths" from "## Choosing Techniques".
  const choosing = sliceSection(skill, '## Choosing Techniques');
  const runPara = paragraphStartingWith(choosing, 'Run each technique');
  const phasesIntro = scrub(runPara ?? choosing);

  // Convergence framing (divergent vs. convergent) from "## Converging".
  const convergeIntro = scrub(sliceSection(skill, '## Converging'));

  const stance = scrub(read(MODE_PARTNER));
  const converge = scrub(sliceSection(read(CONVERGE), '## How to run it'));
  const synthesis = scrub(sliceSection(read(FINALIZE), '## Synthesis'));

  return { persona, framing, stance, kickoff, phasesIntro, convergeIntro, converge, synthesis };
}

let cache: BmadSections | null = null;

/** Composed BMad sections, memoized for the process lifetime. */
export function getBmadSections(): BmadSections {
  if (!cache) cache = compose();
  return cache;
}

// ---------------------------------------------------------------------------
// brain-methods.csv — the full BMad brainstorming technique catalog (~108 rows)
// ---------------------------------------------------------------------------

/**
 * RFC-4180-ish CSV parser. Handles quoted fields containing commas, `""`
 * escaped quotes, multi-line quoted fields, a leading BOM, and CRLF/LF/lone-CR
 * line endings. No dependency — the catalog is small and the format is fixed.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // "" → literal quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      // End the current record. Swallow the \n of a \r\n pair.
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c;
    i++;
  }

  // Trailing field/record with no closing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** One brainstorming technique, columns verbatim from brain-methods.csv. */
export type BrainMethod = {
  category: string;
  name: string;
  description: string;
  detail: string;
  provenance: string;
  goodFor: string;
  audience: string;
};

/**
 * Parse the brain-methods CSV into rows, skipping the header and any blank /
 * malformed record. `description` is kept verbatim (the technique's gist).
 */
export function parseBrainMethods(csv: string): BrainMethod[] {
  const rows = parseCsv(csv);
  if (rows.length <= 1) return [];
  return rows
    .slice(1) // header: category,technique_name,description,detail,provenance,good_for,audience
    .filter((r) => r.length >= 3 && r[0].trim() && r[1].trim())
    .map((r) => ({
      category: r[0].trim(),
      name: r[1].trim(),
      description: r[2] ?? '',
      detail: r[3] ?? '',
      provenance: r[4] ?? '',
      goodFor: r[5] ?? '',
      audience: r[6] ?? '',
    }));
}

let brainMethodsCache: BrainMethod[] | null = null;

/** The full brainstorming catalog, read once per cold start. */
export function getBrainMethods(): BrainMethod[] {
  if (!brainMethodsCache) brainMethodsCache = parseBrainMethods(read(BRAIN_METHODS_CSV));
  return brainMethodsCache;
}
