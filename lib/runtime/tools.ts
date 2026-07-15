import 'server-only';

/**
 * The fixed BMad-op tool set: JSON schemas declared to the model + small,
 * injectable server implementations. NO code/shell execution — this is the
 * complete, closed list of operations a skill run may perform.
 *
 * DB-graceful: when persistence is off, the persistence-backed tools no-op and
 * return an honest note instead of throwing, so a run still completes single
 * session.
 *
 * `request_checkpoint` is the HALT — its executor returns a `halt` result and
 * the loop stops; the engine persists the checkpoint (see state.ts).
 */
import type { ToolSchema, ToolExecResult, ToolExecutor } from './types';
import { loadSkill } from '@/lib/skills/loader';
import { getTechniques } from '@/lib/techniques-catalog';
import { appendRunEvent as dbAppendRunEvent } from '@/lib/repo/run-events';
import { createVersion } from '@/lib/repo/artifacts';
import { listArtifacts } from '@/lib/repo/artifacts';

/* ---------------- schemas ---------------- */

const OBJ = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({ type: 'object', properties, required });

const STR = (description: string) => ({ type: 'string', description });

/** All tool schemas, in a stable order. */
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'read_reference',
    description:
      "Read one of the current skill's reference documents by file name (e.g. a technique or mode reference). Returns its raw markdown.",
    parameters: OBJ(
      { skill: STR('Skill slug (defaults to the running skill).'), name: STR('Reference file name, e.g. "mode-partner.md".') },
      ['name'],
    ),
  },
  {
    name: 'memlog_init',
    description: 'Start the running record (memlog) for this session with a short title/summary.',
    parameters: OBJ({ text: STR('Title or opening summary for the running record.') }, ['text']),
  },
  {
    name: 'memlog_append',
    description:
      'Append one entry to the running record. `type` is one of idea | decision | question | technique | event.',
    parameters: OBJ(
      { type: STR('idea | decision | question | technique | event'), text: STR('The entry text.') },
      ['type', 'text'],
    ),
  },
  {
    name: 'memlog_set',
    description: 'Record a decision/state entry (a "set") in the running record.',
    parameters: OBJ({ text: STR('The decision or state to record.') }, ['text']),
  },
  {
    name: 'write_artifact',
    description: 'Write (or version) a document artifact for this conversation. Returns its id and version.',
    parameters: OBJ({ title: STR('Artifact title.'), markdown: STR('Full markdown body.') }, ['markdown']),
  },
  {
    name: 'list_outputs',
    description: 'List the document artifacts already produced in this conversation (titles + versions).',
    parameters: OBJ({}),
  },
  {
    name: 'technique_query',
    description:
      'Query the brainstorming technique catalog. kind = "list" (all), "random" (draw N), or "show" (one by name).',
    parameters: OBJ(
      {
        kind: STR('list | random | show'),
        name: STR('Technique name (for kind="show").'),
        count: { type: 'number', description: 'How many to draw (for kind="random"; default 2).' },
      },
      ['kind'],
    ),
  },
  {
    name: 'request_checkpoint',
    description:
      'HALT and hand control back to the human with a question. The run pauses (awaiting_user) and resumes on their next message. Use this whenever a BMad workflow says to wait for the user.',
    parameters: OBJ({ prompt: STR('The question to show the user while paused.') }, ['prompt']),
  },
];

/* ---------------- executor context ---------------- */

/**
 * Everything a tool needs at run time. `persistence` gates the DB-backed tools.
 * The individual ops are injectable so tests can run the real executor against
 * mocks with no database.
 */
export type ToolContext = {
  conversationId: string;
  runId: string | null;
  skillSlug: string;
  persistence: boolean;
  /** Read a skill reference (defaults to the loader). */
  readReference?: (skill: string, name: string) => string | undefined;
  /** Append a memlog entry (defaults to run-events repo). */
  appendEvent?: (e: { type: string; text: string; by: string }) => Promise<void>;
  /** Write an artifact version (defaults to artifacts repo). */
  writeArtifact?: (title: string | null, markdown: string) => Promise<{ id: string; version: number }>;
  /** List artifact summaries (defaults to artifacts repo). */
  listOutputs?: () => Promise<{ title: string | null; version: number }[]>;
  /** Technique catalog rows (defaults to the catalog). */
  techniques?: () => { id: string; name: string; category: string; gist: string }[];
};

const DB_OFF_NOTE = '(not persisted — no database configured)';

function defaultReadReference(skill: string, name: string): string | undefined {
  try {
    return loadSkill(skill).references.read(name);
  } catch {
    return undefined;
  }
}

async function defaultAppendEvent(
  runId: string,
  e: { type: string; text: string; by: string },
): Promise<void> {
  await dbAppendRunEvent({ runId, type: e.type, text: e.text, by: e.by });
}

async function defaultWriteArtifact(
  conversationId: string,
  runId: string | null,
  title: string | null,
  markdown: string,
): Promise<{ id: string; version: number }> {
  const a = await createVersion({ conversationId, runId, title, markdown });
  return { id: a.id, version: a.version };
}

async function defaultListOutputs(
  conversationId: string,
): Promise<{ title: string | null; version: number }[]> {
  const rows = await listArtifacts(conversationId);
  return rows.map((r) => ({ title: r.title, version: r.version }));
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/**
 * Build the server-side tool executor for a run. Returns a `ToolExecutor` the
 * loop calls per tool invocation. Unknown tools resolve to an error result (the
 * loop keeps going safely, never throws).
 */
export function createToolExecutor(ctx: ToolContext): ToolExecutor {
  const result = (content: string): ToolExecResult => ({ kind: 'result', content });

  return async ({ name, args }) => {
    switch (name) {
      case 'request_checkpoint':
        return { kind: 'halt', prompt: str(args.prompt) || 'What would you like to do next?' };

      case 'read_reference': {
        const skill = str(args.skill) || ctx.skillSlug;
        const refName = str(args.name);
        if (!refName) return result('error: `name` is required.');
        const read = ctx.readReference ?? defaultReadReference;
        const content = read(skill, refName);
        return result(content ?? `error: reference "${refName}" not found in skill "${skill}".`);
      }

      case 'memlog_init':
      case 'memlog_append':
      case 'memlog_set': {
        if (!ctx.persistence || !ctx.runId) {
          return result(`${DB_OFF_NOTE} — running-record entry noted in-session only.`);
        }
        const type =
          name === 'memlog_append' ? str(args.type, 'event') : name === 'memlog_set' ? 'decision' : 'event';
        const text = str(args.text);
        if (!text) return result('error: `text` is required.');
        const append = ctx.appendEvent ?? ((e) => defaultAppendEvent(ctx.runId as string, e));
        try {
          await append({ type, text, by: 'mary' });
          return result('ok: recorded.');
        } catch {
          return result('error: could not record entry (kept in-session).');
        }
      }

      case 'write_artifact': {
        const markdown = str(args.markdown);
        if (!markdown) return result('error: `markdown` is required.');
        const title = args.title === undefined ? null : str(args.title) || null;
        if (!ctx.persistence) {
          return result(`${DB_OFF_NOTE} — artifact drafted in-session only.`);
        }
        const write =
          ctx.writeArtifact ??
          ((t: string | null, md: string) => defaultWriteArtifact(ctx.conversationId, ctx.runId, t, md));
        try {
          const a = await write(title, markdown);
          return result(`ok: wrote artifact "${title ?? 'untitled'}" (id=${a.id}, version=${a.version}).`);
        } catch {
          return result('error: could not write artifact (kept in-session).');
        }
      }

      case 'list_outputs': {
        if (!ctx.persistence) return result(`${DB_OFF_NOTE} — no stored artifacts.`);
        const list = ctx.listOutputs ?? (() => defaultListOutputs(ctx.conversationId));
        try {
          const rows = await list();
          if (rows.length === 0) return result('No artifacts yet.');
          return result(rows.map((r) => `- ${r.title ?? 'untitled'} (v${r.version})`).join('\n'));
        } catch {
          return result('error: could not list artifacts.');
        }
      }

      case 'technique_query': {
        const kind = str(args.kind, 'list');
        const all = (ctx.techniques ?? getTechniques)();
        if (kind === 'show') {
          const q = str(args.name).toLowerCase();
          const t = all.find((x) => x.name.toLowerCase() === q || x.id === q);
          return result(t ? `${t.name} [${t.category}] — ${t.gist}` : `error: technique "${str(args.name)}" not found.`);
        }
        if (kind === 'random') {
          const count = typeof args.count === 'number' && args.count > 0 ? Math.floor(args.count) : 2;
          const pool = [...all];
          const drawn: typeof all = [];
          for (let i = 0; i < count && pool.length > 0; i++) {
            drawn.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
          }
          return result(drawn.map((t) => `${t.name} [${t.category}] — ${t.gist}`).join('\n'));
        }
        // list
        return result(all.map((t) => `${t.name} [${t.category}]`).join('\n'));
      }

      default:
        return result(`error: unknown tool "${name}".`);
    }
  };
}
