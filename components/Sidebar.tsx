'use client';

import { useEffect, useRef, useState } from 'react';

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
  onRename,
}: {
  onNew: () => void;
  enabled?: boolean;
  conversations?: ConversationSummary[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  function startEdit(c: ConversationSummary) {
    setEditingId(c.id);
    setDraft(c.title);
  }

  function commitEdit() {
    if (editingId) onRename?.(editingId, draft);
    setEditingId(null);
    setDraft('');
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft('');
  }

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
          conversations.map((c) =>
            editingId === c.id ? (
              <div key={c.id} className={`convo${c.id === activeId ? ' on' : ''} editing`}>
                <span className="convo-ico">💬</span>
                <input
                  ref={inputRef}
                  className="convo-edit"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitEdit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  aria-label="Conversation title"
                />
              </div>
            ) : (
              <div
                key={c.id}
                className={`convo${c.id === activeId ? ' on' : ''}`}
                onClick={() => onSelect?.(c.id)}
                onDoubleClick={() => startEdit(c)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect?.(c.id);
                }}
              >
                <span className="convo-ico">💬</span>
                <span className="convo-title">{c.title}</span>
                <button
                  type="button"
                  className="convo-rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(c);
                  }}
                  aria-label={`Rename ${c.title}`}
                  title="Rename"
                >
                  ✎
                </button>
              </div>
            ),
          )
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
            <b>Saved.</b> Conversations persist across sessions. Double-click or ✎ to rename;
            type <b>@</b> in the composer to reference another conversation or document.
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
