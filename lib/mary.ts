import { TECHNIQUES, getTechnique } from './techniques';
import { getBmadSections } from './bmad-source';

/**
 * Builds Mary's system prompt by READING BMad's actual skill files at runtime
 * (see lib/bmad-source.ts). Persona, framing, stance, kickoff, and phases are
 * sliced live from the committed .claude/skills sources — edit a BMad file and
 * Mary changes, no constants to keep in sync. HONEST_LIMITS and CHIPS_PROTOCOL
 * are app-native rules (not BMad source) and stay verbatim here.
 *
 * Section order (unchanged): persona, framing, stance, kickoff, technique pool,
 * phases, honest-limits, chips protocol, current-technique injection.
 */

// Kept unchanged — app-specific rule (spec requirement, not BMad source).
export const HONEST_LIMITS = `HONEST LIMITS — this delivers one of the app's core goals (teaching what AI agents are and are not):
This app cannot browse the web, fetch live data, reach external accounts, save or read files, remember past conversations, or execute code. When the user asks for any of those, never fake it and never give a hard bare "I can't": plainly say what's out of reach in this environment, add that it's "noted for the builder", and offer the nearest thing you CAN do (e.g. "paste the numbers and I'll fold them in").`;

// Kept unchanged — app-specific protocol (spec requirement, not BMad source).
export const CHIPS_PROTOCOL = `CHIPS PROTOCOL — mandatory, every single reply:
End EVERY reply with exactly one chips block on its own line, containing a JSON array of 2–4 short next-move suggestions (each a few words, emoji welcome):
<chips>["🔥 Pressure-test it","⛏️ Keep digging","🎲 Switch technique"]</chips>
The chips are the user's likely next moves given where the conversation is — vary them with context. Never mention the chips block in your prose; the app renders it as buttons.`;

// App-native note: this app has no document engine yet (goal 2), so the
// wrap-up lands as structured markdown in the chat rather than a live doc.
const WRAP_UP_ADAPTATION = `This app has no document engine yet (the live document arrives in goal 2), so deliver the wrap-up as a structured markdown summary right here in the chat — the session's keepsake for now.`;

function buildPersona(): string {
  const p = getBmadSections().persona;
  return `You are ${p.name}, the ${p.title}.

Your icon is ${p.icon} — prefix every message with it so the user can see at a glance which agent is speaking.

Role: ${p.role}
Identity: ${p.identity}
Communication style: ${p.communicationStyle}

Principles:
${p.principles.map((x) => `- ${x}`).join('\n')}

You are running a brainstorming session in Playground, a small browser app.`;
}

function buildPhases(): string {
  const b = getBmadSections();
  return `PHASES — diverge, converge, wrap up:

${b.phasesIntro}

CONVERGING — narrow & decide.
${b.convergeIntro}
${b.converge}

WRAP-UP — synthesis.
${b.synthesis}
${WRAP_UP_ADAPTATION}`;
}

export function buildMarySystemPrompt(techniqueId?: string): string {
  const b = getBmadSections();
  const catalog = TECHNIQUES.map((t) => `- ${t.name} (${t.category}): ${t.gist}`).join('\n');

  const sections: string[] = [
    buildPersona(),
    `FRAMING — hold this the whole run.\n${b.framing}`,
    `STANCE — Creative Partner. This app runs the Creative Partner stance.\n${b.stance}`,
    `KICKOFF — starting a session:\n${b.kickoff}`,
    `TECHNIQUE POOL (the only techniques you run in this app):\n${catalog}`,
    buildPhases(),
    HONEST_LIMITS,
    CHIPS_PROTOCOL,
  ];

  const technique = techniqueId ? getTechnique(techniqueId) : undefined;
  if (technique) {
    sections.push(`CURRENT TECHNIQUE — the user just launched "${technique.name}".
${technique.launchPrompt}
Open it now: a one-line framing of the lens at most, then your first question. Facilitate rather than lecture.`);
  }

  return sections.join('\n\n');
}
