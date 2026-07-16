/**
 * Skill-to-skill handoff (FR-38) — the UJ-1 Mary→John moment. When a workflow
 * finishes and produces a `<document>` artifact, the wrap-up may offer handoff
 * chips that launch ANOTHER agent's command in the SAME conversation with the
 * just-made artifact pre-referenced (threaded via the existing @refer mechanism).
 *
 * VERIFIED-ONLY: a handoff is only offered when the TARGET command is verified,
 * so a chip never hands off into a dead (greyed) command. Pure and client-safe
 * (no server-only imports) — the browser already holds the tree from
 * /api/agents, so it computes chips locally and posts the descriptor + reference.
 *
 * With the current seed (only bmad-agent-analyst/BP verified) there is no OTHER
 * verified target, so live sessions offer no handoff yet — honest by construction.
 * The mechanism opens up automatically as commands are flipped to `verified`.
 */
import type { TreeAgent } from '@/lib/agents/tree';

/** The artifact a finished run produced, as the client knows it. */
export type HandoffArtifact = { id: string; title?: string };

/** One @refer reference threaded into a handoff launch. */
export type HandoffReference = { type: 'artifact'; id: string; title?: string };

export type HandoffChip = {
  /** Button label, e.g. "Take this to John → PRD". */
  label: string;
  /** Target launch descriptor. */
  agentSlug: string;
  code: string;
  /** The source artifact, pre-referenced so the target opens with context. */
  reference: HandoffReference;
};

/**
 * Handoff chips for a finished run's artifact. Offers every VERIFIED command
 * across the tree EXCEPT the one that just ran (`self`), each pre-referencing the
 * artifact. Returns [] when there is no artifact or no verified target.
 */
export function buildHandoffChips(opts: {
  tree: TreeAgent[];
  artifact: HandoffArtifact | null | undefined;
  /** The command that just ran (excluded from targets). */
  self?: { agentSlug: string; code: string };
}): HandoffChip[] {
  const { tree, artifact, self } = opts;
  if (!artifact || !artifact.id) return [];

  const chips: HandoffChip[] = [];
  for (const agent of tree) {
    for (const command of agent.commands) {
      if (command.parity !== 'verified') continue;
      if (self && agent.slug === self.agentSlug && command.code === self.code) continue;
      chips.push({
        label: `Take this to ${agent.name} → ${command.description ?? command.code}`,
        agentSlug: agent.slug,
        code: command.code,
        reference: { type: 'artifact', id: artifact.id, title: artifact.title },
      });
    }
  }
  return chips;
}
