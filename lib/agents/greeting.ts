/**
 * Deterministic agent-activation greeting — the browser-native BMad "activation"
 * moment, composed with ZERO model/LLM call (free, instant, and accurate).
 *
 * Given the activation payload the server derives from an agent's REAL files
 * (see /api/agents/[slug]), these pure functions produce:
 *   - a status line showing which files the loader actually read, and
 *   - a welcome message IN THE AGENT'S VOICE with its command menu, each command
 *     honestly marked "available now" (verified) or "coming soon" (unverified,
 *     with a "needs a sandbox" note where that applies).
 *
 * Pure and dependency-free (no server-only, no fs) so it runs client-side AND is
 * trivially unit-testable. The template is honest by construction: a command is
 * only "available now" when its parity is `verified`.
 */

export type ActivationCommand = {
  code: string;
  description?: string;
  parity: 'verified' | 'unverified';
  needsSandbox: boolean;
};

export type AgentActivation = {
  slug: string;
  name: string;
  icon: string;
  title: string;
  /** One sentence on what the agent does, from its real role/identity/description. */
  blurb: string;
  /** The real relative filenames the loader read for this agent. */
  filesRead: string[];
  commands: ActivationCommand[];
};

/** Fixed status glyph — NOT the agent icon, so the status line reads distinctly. */
const STATUS_ICON = '📂';

/**
 * The status line: shows the agent reading its real files. Rendered in a distinct
 * dim/monospace "status" style (not a normal chat bubble).
 */
export function composeStatusLine(a: AgentActivation): string {
  const n = a.filesRead.length;
  const files = a.filesRead.join(', ');
  const count = `${n} file${n === 1 ? '' : 's'}`;
  return `${STATUS_ICON} Activating ${a.name} — read ${files} (${count})`;
}

/** Honest availability marker for one command, from its parity + sandbox need. */
function availability(c: ActivationCommand): string {
  if (c.parity === 'verified') return 'available now';
  return c.needsSandbox ? 'coming soon — needs a sandbox' : 'coming soon';
}

/** Ensure a blurb ends on sentence punctuation (source strings usually do). */
function terminate(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * The welcome message, in the agent's voice, composed deterministically from its
 * real config. Rendered as markdown in an assistant bubble; prefixed with the
 * agent's icon.
 */
export function composeWelcome(a: AgentActivation): string {
  const opener = `${a.icon} Hi, I'm ${a.name}, the ${a.title}.`;
  const blurb = terminate(a.blurb);
  const lines: string[] = [blurb ? `${opener} ${blurb}` : opener];

  if (a.commands.length > 0) {
    lines.push('', "Here's what I can help with:");
    for (const c of a.commands) {
      const desc = c.description ? ` — ${c.description}` : '';
      lines.push(`- \`${c.code}\`${desc} _(${availability(c)})_`);
    }
  }

  lines.push('', 'What would you like to do?');
  return lines.join('\n');
}
