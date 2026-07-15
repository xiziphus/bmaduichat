'use client';

import { useEffect, useRef, useState } from 'react';
import { parseChips, visibleWhileStreaming } from '@/lib/chips';
import { providerLabel, type Msg, type Provider } from '@/lib/llm';
import { drawTwo, type Technique } from '@/lib/techniques';
import {
  extractBuilderNotes,
  BUILDER_NOTES_KEY,
  type BuilderNote,
} from '@/lib/builder-notes';
import ModelToggle from './ModelToggle';

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips?: string[];
  error?: boolean;
};

/** Rehydrated message shape passed in from the persisted thread. */
export type InitialMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips?: string[] | null;
};

let uid = 0;
const nextId = () => `m${++uid}-${Date.now()}`;

function toApiMessages(msgs: UiMessage[]): Msg[] {
  return msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
}

function seed(initial: InitialMessage[]): UiMessage[] {
  return initial.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    chips: m.chips ?? undefined,
  }));
}

export default function ChatPane({
  provider,
  onProviderChange,
  conversationId = null,
  initialMessages = [],
  onExchange,
}: {
  provider: Provider;
  onProviderChange: (p: Provider) => void;
  conversationId?: string | null;
  initialMessages?: InitialMessage[];
  onExchange?: () => void;
}) {
  const [messages, setMessages] = useState<UiMessage[]>(() => seed(initialMessages));
  const [catalog, setCatalog] = useState<Technique[]>([]);
  const [pair, setPair] = useState<[Technique, Technique] | null>(null);
  const [activeTechnique, setActiveTechnique] = useState<Technique | undefined>(undefined);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [notes, setNotes] = useState<BuilderNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);

  // Load the full catalog from the authed API (fs reads stay server-side), then
  // draw the initial random pair client-side so SSR/CSR markup match.
  useEffect(() => {
    let alive = true;
    fetch('/api/techniques')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('techniques fetch failed'))))
      .then((data: { techniques?: Technique[] }) => {
        if (!alive) return;
        const list = data.techniques ?? [];
        setCatalog(list);
        if (list.length >= 2) setPair(drawTwo(list));
      })
      .catch(() => {
        /* leave the technique row hidden if the catalog can't load */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Builder notes persist in this browser only (interim; goal 4 ships the real
  // outbox). Survives the session-reset remount because it re-reads storage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BUILDER_NOTES_KEY);
      if (raw) setNotes(JSON.parse(raw) as BuilderNote[]);
    } catch {
      /* corrupt/absent storage → start empty */
    }
  }, []);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function shuffleTechniques() {
    if (!pair || streaming || catalog.length < 2) return;
    setPair(drawTwo(catalog, pair.map((t) => t.id)));
  }

  function captureBuilderNotes(text: string) {
    const excerpts = extractBuilderNotes(text);
    if (excerpts.length === 0) return;
    const ts = Date.now();
    setNotes((prev) => {
      const next = [...prev, ...excerpts.map((excerpt) => ({ excerpt, ts }))];
      try {
        localStorage.setItem(BUILDER_NOTES_KEY, JSON.stringify(next));
      } catch {
        /* storage full/blocked → keep in-memory only */
      }
      return next;
    });
  }

  async function copyNotes() {
    // Newest-first, joined as markdown bullets.
    const md = [...notes]
      .reverse()
      .map((n) => `- ${n.excerpt}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      /* clipboard blocked → no-op */
    }
  }

  function clearNotes() {
    setNotes([]);
    try {
      localStorage.removeItem(BUILDER_NOTES_KEY);
    } catch {
      /* ignore */
    }
  }

  async function runChat(history: UiMessage[], technique?: string) {
    setStreaming(true);
    const placeholderId = nextId();
    setMessages([...history, { id: placeholderId, role: 'assistant', content: '' }]);

    function updatePlaceholder(content: string) {
      setMessages((prev) =>
        prev.map((m) => (m.id === placeholderId ? { ...m, content } : m)),
      );
    }
    function finalizePlaceholder(content: string, chips: string[]) {
      setMessages((prev) =>
        prev.map((m) => (m.id === placeholderId ? { ...m, content, chips } : m)),
      );
    }
    function replaceWithError(text: string) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId ? { ...m, content: text, error: true, chips: undefined } : m,
        ),
      );
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: toApiMessages(history),
          provider,
          technique,
          conversationId,
        }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        replaceWithError(
          data.error ?? `${providerLabel(provider)} hit a snag — try again or switch model.`,
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let raw = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!chunk.startsWith('data:')) continue;
          const payload = chunk.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload) as { token?: string };
            if (parsed.token) {
              raw += parsed.token;
              updatePlaceholder(visibleWhileStreaming(raw));
            }
          } catch {
            // ignore unparseable frames
          }
        }
      }

      const { text, chips } = parseChips(raw);
      if (!text && chips.length === 0) {
        // Zero tokens or a chips-only/blocked reply — never show a blank
        // bubble, never leak raw tag text.
        replaceWithError(
          `${providerLabel(provider)} returned an empty response — try again or switch model.`,
        );
        return;
      }
      finalizePlaceholder(text, chips);
      captureBuilderNotes(text);
      // A full exchange just persisted server-side — let the parent refresh the
      // sidebar (title/order). No-op when persistence is disabled.
      if (conversationId) onExchange?.();
    } catch {
      replaceWithError(`${providerLabel(provider)} hit a snag — try again or switch model.`);
    } finally {
      setStreaming(false);
    }
  }

  function launchTechnique(t: Technique) {
    if (streaming) return;
    setActiveTechnique(t);
    // History must always end on a user turn (Gemini rejects assistant-final
    // histories; OpenAI-shape treats them as prefill) — so launching a
    // technique posts a visible user message first.
    const next: UiMessage[] = [
      ...messages,
      { id: nextId(), role: 'user', content: `Let's run ${t.name}.` },
    ];
    void runChat(next, t.id);
  }

  function sendMessage(text: string) {
    if (streaming || !text.trim()) return;
    const next: UiMessage[] = [...messages, { id: nextId(), role: 'user', content: text.trim() }];
    void runChat(next);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input;
    setInput('');
    sendMessage(text);
  }

  const lastMessage = messages[messages.length - 1];

  return (
    <main id="chat">
      <div className="hdr">
        <div className="ava">M</div>
        <div>
          <b>Mary</b>
          <small>Business Analyst · brainstorming with you</small>
        </div>
        {activeTechnique && (
          <span className="mode">
            {activeTechnique.emoji} {activeTechnique.name}
          </span>
        )}
        <div className="right">
          <ModelToggle provider={provider} onChange={onProviderChange} disabled={streaming} />
          <div className="noteswrap">
            <button
              type="button"
              className="notesbtn"
              onClick={() => setNotesOpen((o) => !o)}
              aria-label="Builder notes"
              aria-expanded={notesOpen}
              title="Builder notes"
            >
              📮
              {notes.length > 0 && <span className="notesbadge">{notes.length}</span>}
            </button>
            {notesOpen && (
              <div className="notesdrawer" role="dialog" aria-label="Builder notes">
                <div className="notesdrawer-hd">
                  <b>📮 Builder notes</b>
                  <div className="notesdrawer-acts">
                    <button type="button" onClick={copyNotes} disabled={notes.length === 0}>
                      Copy all
                    </button>
                    <button type="button" onClick={clearNotes} disabled={notes.length === 0}>
                      Clear
                    </button>
                  </div>
                </div>
                <div className="notesdrawer-body">
                  {notes.length === 0 ? (
                    <p className="notesempty">
                      No notes yet — when Mary says &ldquo;noted for the builder&rdquo;, it lands
                      here.
                    </p>
                  ) : (
                    [...notes].reverse().map((n, i) => (
                      <div className="noteitem" key={`${n.ts}-${i}`}>
                        <p>{n.excerpt}</p>
                        <time>{new Date(n.ts).toLocaleString()}</time>
                      </div>
                    ))
                  )}
                </div>
                <div className="notesfoot">
                  Interim: stored in this browser only — the real builder outbox ships in goal 4.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="msgs" ref={msgsRef}>
        {messages.length === 0 && (
          <div className="b mary">
            Hi, I&rsquo;m Mary. Pick a technique below, or just tell me what you&rsquo;re chewing on.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id}>
            <div className={`b ${m.error ? 'honest' : m.role === 'user' ? 'user' : 'mary'}`}>
              {m.error && <b>⚠️ Honest note: </b>}
              {m.content || (streaming && m.id === lastMessage?.id ? '…' : '')}
            </div>
            {m.chips && m.chips.length > 0 && m.id === lastMessage?.id && (
              <div className="chips">
                <span className="lbl">Mary suggests</span>
                {m.chips.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className="chip"
                    disabled={streaming}
                    onClick={() => sendMessage(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {pair && (
        <div className="techrow">
          <span className="lbl">Try a technique</span>
          {pair.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tech"
              disabled={streaming}
              onClick={() => launchTechnique(t)}
              title={t.gist}
            >
              {t.emoji} {t.name}
            </button>
          ))}
          <button
            type="button"
            className="tech dice"
            disabled={streaming}
            onClick={shuffleTechniques}
          >
            🎲 show me others
          </button>
        </div>
      )}

      <form className="inputw" onSubmit={onSubmit}>
        <div className="input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell Mary what you're chewing on…"
            disabled={streaming}
          />
          <button type="submit" className="send" disabled={streaming || !input.trim()}>
            ↑
          </button>
        </div>
      </form>
    </main>
  );
}
