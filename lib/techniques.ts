/**
 * The 8-technique pool for Playground v1.
 * Names + gists lifted verbatim from BMad's brain-methods.csv.
 * Each launch prompt tells Mary how to open the technique.
 */

export type Technique = {
  id: string;
  name: string;
  emoji: string;
  category: string;
  gist: string;
  launchPrompt: string;
};

export const TECHNIQUES: Technique[] = [
  {
    id: 'job-to-be-done',
    name: 'Job to Be Done',
    emoji: '🃏',
    category: 'structured',
    gist: 'Ask what the user is really hiring this to do, then ideate around that underlying job, not the feature you assumed',
    launchPrompt:
      'Open Job to Be Done: ask the user what the thing they are working on is really being *hired* to do — the underlying job, not the surface feature. Start with one sharp hiring question about their topic, then keep peeling toward the real job before ideating around it.',
  },
  {
    id: 'five-whys',
    name: 'Five Whys',
    emoji: '🔗',
    category: 'deep',
    gist: 'Ask "why?" five times in a chain, each answer feeding the next, until you hit the root cause beneath the symptom',
    launchPrompt:
      'Open Five Whys: take their stated problem and ask the first "why?" — one why per message, each new why built on their last answer. Chain roughly five deep until the root cause under the symptom is exposed, then name it back to them.',
  },
  {
    id: 'how-might-we',
    name: 'How Might We',
    emoji: '❓',
    category: 'structured',
    gist: "Reframe the problem as a batch of 'How might we...' opportunity questions first, then ideate against the sharpest one",
    launchPrompt:
      'Open How Might We: help the user reframe their problem into a small batch of "How might we…" opportunity questions. Draft the reframes together, then ask them to pick the sharpest one and ideate against it.',
  },
  {
    id: 'empathy-map',
    name: 'Empathy Map',
    emoji: '🗺️',
    category: 'structured',
    gist: 'Map what the user says, thinks, does, and feels around the problem, then mine each quadrant for the unmet need',
    launchPrompt:
      'Open Empathy Map: walk the four quadrants — says, thinks, does, feels — for the person at the center of their problem, one quadrant at a time. Once the map has substance, mine each quadrant for the unmet need hiding in it.',
  },
  {
    id: 'chaos-engineering',
    name: 'Chaos Engineering',
    emoji: '💥',
    category: 'wild',
    gist: 'Deliberately break your idea every way it could fail, then rebuild only the parts that survive the wreckage',
    launchPrompt:
      'Open Chaos Engineering: invite the user to deliberately break their idea — pick one failure vector at a time and push on it hard. After the wreckage, rebuild together keeping only the parts that survived.',
  },
  {
    id: 'zero-mandate',
    name: 'The $0 Mandate',
    emoji: '🪙',
    category: 'constraint',
    gist: 'Achieve the goal spending literally nothing — no tools, hires, or ads; only people, favors, and what you own',
    launchPrompt:
      'Open The $0 Mandate: impose the constraint that they must achieve their goal spending literally nothing — no tools, hires, or ads; only people, favors, and what they already own. Ask for their first $0 move and keep the constraint ruthless.',
  },
  {
    id: 'cross-pollination',
    name: 'Cross-Pollination',
    emoji: '🐝',
    category: 'creative',
    gist: 'Ask how a wildly different industry — casinos, ERs, beekeeping — would crack this, then adapt their move',
    launchPrompt:
      'Open Cross-Pollination: pick (or let them pick) a wildly different industry — casinos, ERs, beekeeping — and ask how that world would crack their problem. Adapt the borrowed move back to their context, one industry at a time.',
  },
  {
    id: 'worst-possible-idea',
    name: 'Worst Possible Idea',
    emoji: '🙃',
    category: 'structured',
    gist: 'Deliberately generate the most terrible solutions you can, then flip each into what it teaches you to do right',
    launchPrompt:
      'Open Worst Possible Idea: ask the user for the most terrible, guaranteed-to-fail solution they can imagine for their problem — celebrate the awfulness. Then flip each bad idea into what it teaches about doing it right.',
  },
];

export function getTechnique(id: string): Technique | undefined {
  return TECHNIQUES.find((t) => t.id === id);
}

/**
 * Draw two distinct techniques at random. When `excluding` (the currently
 * shown pair's ids) is given, neither drawn technique may be in it — so the
 * cycle button never re-shows the current pair.
 */
export function drawTwo(excluding?: string[]): [Technique, Technique] {
  const exclude = new Set(excluding ?? []);
  const pool = TECHNIQUES.filter((t) => !exclude.has(t.id));

  if (pool.length >= 2) {
    const i = Math.floor(Math.random() * pool.length);
    let j = Math.floor(Math.random() * (pool.length - 1));
    if (j >= i) j += 1;
    return [pool[i], pool[j]];
  }

  // Over-excluded. Respect the exclusion as far as possible: keep any
  // non-excluded technique, then top up from the excluded remainder.
  if (pool.length === 1) {
    const first = pool[0];
    const rest = TECHNIQUES.filter((t) => t.id !== first.id);
    const second = rest[Math.floor(Math.random() * rest.length)];
    return [first, second];
  }

  // Everything excluded — nothing to respect; draw from the full pool.
  const i = Math.floor(Math.random() * TECHNIQUES.length);
  let j = Math.floor(Math.random() * (TECHNIQUES.length - 1));
  if (j >= i) j += 1;
  return [TECHNIQUES[i], TECHNIQUES[j]];
}
