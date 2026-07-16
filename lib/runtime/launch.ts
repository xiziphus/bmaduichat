import 'server-only';

/**
 * Command-launch resolver (Epic D). Given a `{agentSlug, code}` descriptor from
 * the tree, resolve it to a launch PLAN the chat route executes:
 *
 *   - verified + skill  → run that skill on the engine (runWorkflow), the SAME
 *                         path C-4 uses, with the agent's persona composed on top.
 *   - verified + prompt → run the prompt text as the launch turn (persona-only).
 *   - unverified        → an honest degrade: a visible "not available here yet"
 *                         bubble + a builder note (FR-43). NO engine call.
 *
 * This module is a PURE resolver (no engine import → no cycle): `planLaunch`
 * decides, the route reuses `engineChatResponse` for the skill/prompt plans and
 * the builder-note outbox for degrades. Zero per-command branching — the plan
 * falls out of the manifest + capability registry.
 */
import { getAgentTree, type TreeAgent, type TreeCommand } from '@/lib/agents/tree';

export type LaunchPlan =
  | { kind: 'skill'; agentSlug: string; agentName: string; skillSlug: string; command: TreeCommand }
  | { kind: 'prompt'; agentSlug: string; agentName: string; prompt: string; command: TreeCommand }
  | {
      kind: 'degrade';
      agentSlug: string;
      agentName: string;
      code: string;
      /** The honest, user-facing bubble (contains "noted for the builder" → B-5 capture). */
      message: string;
      command: TreeCommand | undefined;
    };

function findCommand(
  tree: TreeAgent[],
  agentSlug: string,
  code: string,
): { agent: TreeAgent; command: TreeCommand } | undefined {
  const agent = tree.find((a) => a.slug === agentSlug);
  if (!agent) return undefined;
  const command = agent.commands.find((c) => c.code === code);
  if (!command) return undefined;
  return { agent, command };
}

/**
 * The honest degrade bubble for a greyed command. Every branch contains the
 * exact phrase "noted for the builder" so the B-5 outbox (extractBuilderNotes)
 * captures the sentence as a builder note.
 */
function degradeMessage(agentName: string, command: TreeCommand): string {
  const what = command.description ? `“${command.description}”` : `the “${command.code}” command`;
  if (command.needsSandbox) {
    return `${agentName} here — ${what} runs code, which needs a secure sandbox we haven't built into Playground yet (it's a separate phase); noted for the builder so the demand is captured. In the meantime, tell me what you're trying to do and I'll help however I can from here.`;
  }
  return `${agentName} here — ${what} isn't wired up in Playground yet, so I can't run it live; noted for the builder so the demand is captured. Tell me what you're after and I'll do the nearest thing I can from here.`;
}

/**
 * Resolve a launch descriptor to a plan. `tree` is injectable for tests;
 * defaults to the real `getAgentTree()`. Returns null for an unknown agent/code
 * (the route treats that as a normal, non-launch turn).
 */
export function planLaunch(
  agentSlug: string,
  code: string,
  tree: TreeAgent[] = getAgentTree(),
): LaunchPlan | null {
  const found = findCommand(tree, agentSlug, code);
  if (!found) return null;
  const { agent, command } = found;

  if (command.parity !== 'verified') {
    return {
      kind: 'degrade',
      agentSlug: agent.slug,
      agentName: agent.name,
      code: command.code,
      message: degradeMessage(agent.name, command),
      command,
    };
  }

  if (command.skill) {
    return {
      kind: 'skill',
      agentSlug: agent.slug,
      agentName: agent.name,
      skillSlug: command.skill,
      command,
    };
  }

  // A verified prompt-backed command: run the prompt text as the launch turn.
  return {
    kind: 'prompt',
    agentSlug: agent.slug,
    agentName: agent.name,
    prompt: command.prompt ?? '',
    command,
  };
}
