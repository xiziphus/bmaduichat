'use client';

import { useEffect, useState } from 'react';

/**
 * Epic D — the two-level agent→command tree (FR-40), rendered ENTIRELY from
 * /api/agents (manifest + capability registry). Zero per-agent code: Level 1 is
 * the agent buttons (Mary first, default-selected), Level 2 is the selected
 * agent's menu as command chips.
 *
 * Verified commands render active and launch on the engine. Unverified commands
 * render greyed-but-visible (the honest-breadth contract, FR-43) and still fire
 * the launch — the server returns an honest degrade bubble + a builder note.
 *
 * Flag-gated: /api/agents returns `enabled:false` when PLAYGROUND_TREE is off, so
 * this renders NOTHING and the app stays byte-identical to today.
 */

export type TreeCommand = {
  code: string;
  description?: string;
  skill?: string;
  prompt?: string;
  parity: 'verified' | 'unverified';
  needsSandbox: boolean;
};

export type TreeAgent = {
  slug: string;
  name: string;
  icon?: string;
  commands: TreeCommand[];
};

export default function AgentTree({
  disabled,
  activeCode,
  onLaunch,
  onActivateAgent,
  onTreeLoaded,
}: {
  disabled?: boolean;
  /** The currently-active command code, highlighted (if any). */
  activeCode?: string;
  onLaunch: (agentSlug: string, code: string, command: TreeCommand) => void;
  /** Fired when the user actively PICKS an agent — drives the in-chat greeting. */
  onActivateAgent?: (slug: string) => void;
  /** Hand the loaded tree up to the parent (for handoff-chip computation). */
  onTreeLoaded?: (agents: TreeAgent[]) => void;
}) {
  const [agents, setAgents] = useState<TreeAgent[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('agents fetch failed'))))
      .then((data: { enabled?: boolean; agents?: TreeAgent[] }) => {
        if (!alive || !data.enabled) return; // flag off → stay hidden (byte-identical)
        const list = data.agents ?? [];
        setAgents(list);
        if (list.length > 0) setSelected(list[0].slug); // Mary first, default-selected
        onTreeLoaded?.(list);
      })
      .catch(() => {
        /* leave the tree hidden if it can't load */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!agents || agents.length === 0) return null;

  const current = agents.find((a) => a.slug === selected) ?? agents[0];

  return (
    <div className="agenttree">
      <div className="agentrow">
        <span className="lbl">Agents</span>
        {agents.map((a) => (
          <button
            key={a.slug}
            type="button"
            className={`agentbtn${a.slug === current.slug ? ' on' : ''}`}
            disabled={disabled}
            onClick={() => {
              setSelected(a.slug);
              // Greet on every active pick (including re-picking the same agent),
              // but NOT on the initial default selection (see the load effect).
              onActivateAgent?.(a.slug);
            }}
            title={a.name}
          >
            <span className="agentico">{a.icon ?? '🤖'}</span>
            {a.name}
          </button>
        ))}
      </div>
      <div className="cmdrow">
        <span className="lbl">{current.name}&rsquo;s commands</span>
        {current.commands.map((c) => {
          const verified = c.parity === 'verified';
          return (
            <button
              key={c.code}
              type="button"
              className={`cmd${verified ? '' : ' greyed'}${c.code === activeCode ? ' on' : ''}`}
              disabled={disabled}
              onClick={() => onLaunch(current.slug, c.code, c)}
              title={
                verified
                  ? c.description
                  : `${c.description ?? c.code} — ${c.needsSandbox ? 'needs a sandbox (separate phase)' : 'not wired here yet'}`
              }
            >
              <b>{c.code}</b>
              {c.description ? <span className="cmddesc"> {c.description}</span> : null}
              {!verified && <span className="cmdlock">{c.needsSandbox ? '🛠' : '🔒'}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
