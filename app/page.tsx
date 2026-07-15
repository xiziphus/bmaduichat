'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar, { type ConversationSummary } from '@/components/Sidebar';
import ChatPane, { type InitialMessage } from '@/components/ChatPane';
import DocPane, { type DocState } from '@/components/DocPane';
import Gutter from '@/components/Gutter';
import Toaster from '@/components/Toaster';
import type { Provider } from '@/lib/llm';

export default function Home() {
  const [sideW, setSideW] = useState(270);
  const [docW, setDocW] = useState(460);
  const [provider, setProvider] = useState<Provider>('gemini');

  // Persistence state. `enabled` is discovered from the API on mount: when the
  // server has no DATABASE_URL it returns enabled:false and we keep today's
  // ephemeral, in-tab behavior (sessionKey remount clears the chat).
  const [enabled, setEnabled] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<InitialMessage[]>([]);
  const [sessionKey, setSessionKey] = useState(0);
  // The doc pane reflects the conversation's latest artifact, updated live as a
  // wrap-up streams. Null → placeholder. In the no-DB path this is purely the
  // current session's in-memory document.
  const [doc, setDoc] = useState<DocState | null>(null);

  // Rehydrate a conversation's full thread into the chat pane.
  const openConversation = useCallback((id: string) => {
    setActiveId(id);
    fetch(`/api/conversations/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('thread fetch failed'))))
      .then((data: { messages?: InitialMessage[]; artifact?: DocState | null }) => {
        setInitialMessages(data.messages ?? []);
        setDoc(data.artifact ?? null); // latest saved document, or placeholder
        setSessionKey((k) => k + 1); // remount ChatPane so it seeds the thread
      })
      .catch(() => {
        // Missing/500 → drop the selection and refresh the list.
        setActiveId(null);
        setInitialMessages([]);
        setDoc(null);
        void refreshList();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      if (!res.ok) return;
      const data = (await res.json()) as { enabled?: boolean; conversations?: ConversationSummary[] };
      if (data.enabled) setConversations(data.conversations ?? []);
    } catch {
      /* leave the current list in place */
    }
  }, []);

  // On mount, discover persistence and rehydrate the newest conversation so a
  // refresh resumes where you left off.
  useEffect(() => {
    let alive = true;
    fetch('/api/conversations')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('conversations fetch failed'))))
      .then((data: { enabled?: boolean; conversations?: ConversationSummary[] }) => {
        if (!alive || !data.enabled) return;
        setEnabled(true);
        const list = data.conversations ?? [];
        setConversations(list);
        if (list.length > 0) {
          openConversation(list[0].id);
        } else {
          // Empty DB: create the first conversation so the opening exchange
          // persists (otherwise conversationId would be null).
          fetch('/api/conversations', { method: 'POST' })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('create failed'))))
            .then((d: { conversation?: ConversationSummary | null }) => {
              if (!alive || !d.conversation) return;
              setConversations([d.conversation]);
              setActiveId(d.conversation.id);
            })
            .catch(() => {
              /* creation failed → stay ephemeral for this session */
            });
        }
      })
      .catch(() => {
        /* persistence off or unreachable → stay ephemeral */
      });
    return () => {
      alive = false;
    };
  }, [openConversation]);

  const onNew = useCallback(() => {
    if (!enabled) {
      // Ephemeral fallback: reset the in-tab session (today's behavior).
      setInitialMessages([]);
      setActiveId(null);
      setDoc(null);
      setSessionKey((k) => k + 1);
      return;
    }
    // Create a real row; the previous conversation stays listed (archived=false).
    fetch('/api/conversations', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('create failed'))))
      .then((data: { conversation?: ConversationSummary | null }) => {
        const c = data.conversation;
        if (!c) return;
        setConversations((prev) => [c, ...prev]);
        setActiveId(c.id);
        setInitialMessages([]);
        setDoc(null);
        setSessionKey((k) => k + 1);
      })
      .catch(() => {
        /* creation failed → keep the current session */
      });
  }, [enabled]);

  // After a completed exchange, refresh titles/order in the sidebar.
  const onExchange = useCallback(() => {
    void refreshList();
  }, [refreshList]);

  // Live document updates from the chat pane (streaming + finalized + persisted).
  const onDocument = useCallback((next: DocState) => {
    setDoc(next);
  }, []);

  return (
    <>
    <div id="app" style={{ gridTemplateColumns: `${sideW}px 6px minmax(320px, 1fr) 6px ${docW}px` }}>
      <Sidebar
        onNew={onNew}
        enabled={enabled}
        conversations={conversations}
        activeId={activeId}
        onSelect={openConversation}
      />
      <Gutter start={sideW} min={190} max={420} dir={1} onDrag={setSideW} />
      <ChatPane
        key={sessionKey}
        provider={provider}
        onProviderChange={setProvider}
        conversationId={enabled ? activeId : null}
        initialMessages={initialMessages}
        onExchange={onExchange}
        onDocument={onDocument}
      />
      <Gutter start={docW} min={320} max={760} dir={-1} onDrag={setDocW} />
      <DocPane doc={doc} />
    </div>
    <Toaster />
    </>
  );
}
