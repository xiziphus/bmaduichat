'use client';

export type ConversationSummary = {
  id: string;
  title: string;
  created: string;
  archived: boolean;
};

const DEMO = [
  { id: 'demo-1', title: '✈️ travel-client pitch' },
  { id: 'demo-2', title: '🧵 newsletter concept' },
  { id: 'demo-3', title: '🪡 Loomcraft rebrand — real job' },
];

export default function Sidebar({
  onNew,
  enabled = false,
  conversations = [],
  activeId = null,
  onSelect,
}: {
  onNew: () => void;
  enabled?: boolean;
  conversations?: ConversationSummary[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <aside id="side">
      <div className="logo">🪁 playground</div>
      <button className="newbtn" onClick={onNew}>
        ＋ New conversation
      </button>
      <h6>Conversations</h6>

      {enabled ? (
        conversations.length === 0 ? (
          <div className="convo on">💬 Current session</div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={`convo${c.id === activeId ? ' on' : ''}`}
              onClick={() => onSelect?.(c.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect?.(c.id);
              }}
            >
              💬 {c.title}
            </div>
          ))
        )
      ) : (
        <>
          <div className="convo on">💬 Current session</div>
          {DEMO.map((d) => (
            <div className="convo" key={d.id}>
              {d.title}
            </div>
          ))}
        </>
      )}

      <div className="foot">
        {enabled ? (
          <>
            <b>Saved.</b> Conversations persist across sessions. Renaming and <b>@</b>-references
            arrive in goal 2.
          </>
        ) : (
          <>
            <b>Goal 1</b> — conversations live in this tab for now. Saved history, renaming, and{' '}
            <b>@</b>-references arrive in goal 2.
          </>
        )}
      </div>
    </aside>
  );
}
