'use client';

import { useEffect, useRef, useState } from 'react';
import { parseChips, visibleWhileStreaming } from '@/lib/chips';
import { providerLabel, type Msg, type Provider } from '@/lib/llm';
import { drawTwo, type Technique } from '@/lib/techniques';
import ModelToggle from './ModelToggle';

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips?: string[];
  error?: boolean;
};

let uid = 0;
const nextId = () => `m${++uid}-${Date.now()}`;

function toApiMessages(msgs: UiMessage[]): Msg[] {
  return msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
}

export default function ChatPane({
  provider,
  onProviderChange,
}: {
  provider: Provider;
  onProviderChange: (p: Provider) => void;
}) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pair, setPair] = useState<[Technique, Technique] | null>(null);
  const [activeTechnique, setActiveTechnique] = useState<Technique | undefined>(undefined);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);

  // Draw the initial random pair client-side only, so SSR/CSR markup match.
  useEffect(() => {
    setPair(drawTwo());
  }, []);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function shuffleTechniques() {
    if (!pair || streaming) return;
    setPair(drawTwo(pair.map((t) => t.id)));
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
