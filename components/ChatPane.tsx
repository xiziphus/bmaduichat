'use client';

import { useEffect, useRef, useState } from 'react';
import { parseChips, visibleWhileStreaming } from '@/lib/chips';
import {
  parseDocument,
  streamingDocumentBody,
  streamingDocumentTitle,
  stripDocumentForBubble,
} from '@/lib/document';
import Markdown from './Markdown';
import { providerLabel, type Msg, type MsgPart, type Provider } from '@/lib/llm';
import {
  ACCEPT,
  MAX_FILES,
  canSend,
  composeOutgoingText,
  modalityIcon,
  readFileAsBase64,
  readFileAsText,
  toMeta,
  toMsgParts,
  validateFile,
  DEFAULT_SUPPORT,
  type Attachment,
  type AttachmentMeta,
  type SupportMap,
} from '@/lib/attachments';
import { pushToast } from '@/lib/toast';
import { drawTwo, type Technique } from '@/lib/techniques';
import {
  extractBuilderNotes,
  BUILDER_NOTES_KEY,
  type BuilderNote,
} from '@/lib/builder-notes';
import ModelToggle from './ModelToggle';
import type { DocState } from './DocPane';
import { activeMentionQuery, stripRange, type Reference } from '@/lib/mentions';

/** One autocomplete row from GET /api/references. */
type MentionItem = { type: 'conversation' | 'artifact'; id: string; title: string };

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips?: string[];
  error?: boolean;
  /** Persistable metadata for the 📎 chips shown on the bubble. */
  attachments?: AttachmentMeta[];
  /** Provider-native binary parts (images/PDFs) — kept in-memory for re-sends. */
  parts?: MsgPart[];
};

/** Rehydrated message shape passed in from the persisted thread. */
export type InitialMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chips?: string[] | null;
  attachments?: AttachmentMeta[] | null;
};

/** Message shape posted to /api/chat: LLM parts + persistable attachment meta. */
type ApiMessage = Msg & { attachments?: AttachmentMeta[] };

let uid = 0;
const nextId = () => `m${++uid}-${Date.now()}`;

/**
 * Serialize the thread for the API. Binary `parts` the CURRENT provider can't
 * read are stripped (e.g. after switching to a text-only model) so a historical
 * image never errors an unsupported upstream — the initial send was already
 * gated + toasted. Attachment metadata rides along for persistence.
 */
function toApiMessages(msgs: UiMessage[], provider: Provider, support: SupportMap): ApiMessage[] {
  return msgs
    .filter((m) => !m.error)
    .map((m) => {
      const parts = m.parts?.filter((p) => support[provider][p.type]);
      const out: ApiMessage = { role: m.role, content: m.content };
      if (parts && parts.length > 0) out.parts = parts;
      if (m.attachments && m.attachments.length > 0) out.attachments = m.attachments;
      return out;
    });
}

function seed(initial: InitialMessage[]): UiMessage[] {
  return initial.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    chips: m.chips ?? undefined,
    attachments: m.attachments ?? undefined,
  }));
}

/** Minimal Web Speech API typing (not in lib.dom across all TS versions). */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

export default function ChatPane({
  provider,
  onProviderChange,
  conversationId = null,
  initialMessages = [],
  onExchange,
  onDocument,
}: {
  provider: Provider;
  onProviderChange: (p: Provider) => void;
  conversationId?: string | null;
  initialMessages?: InitialMessage[];
  onExchange?: () => void;
  onDocument?: (doc: DocState) => void;
}) {
  const [messages, setMessages] = useState<UiMessage[]>(() => seed(initialMessages));
  const [catalog, setCatalog] = useState<Technique[]>([]);
  const [pair, setPair] = useState<[Technique, Technique] | null>(null);
  const [activeTechnique, setActiveTechnique] = useState<Technique | undefined>(undefined);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [notes, setNotes] = useState<BuilderNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [support, setSupport] = useState<SupportMap>(DEFAULT_SUPPORT);
  // @-references picked from the autocomplete — sent as {type,id} on the next
  // send; the server resolves their content. Pills render above the composer.
  const [references, setReferences] = useState<Reference[]>([]);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  // The last document reported to the parent this turn — lets the trailing
  // artifact-id frame re-report the same doc with its persisted id attached.
  const lastDocRef = useRef<DocState | null>(null);

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

  // Probe server-resolved modality support (OpenRouter model/env aware). Until it
  // lands, DEFAULT_SUPPORT (openrouter text-only) keeps the gate safe.
  useEffect(() => {
    let alive = true;
    fetch('/api/capabilities')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('capabilities fetch failed'))))
      .then((data: { support?: SupportMap }) => {
        if (alive && data.support) setSupport(data.support);
      })
      .catch(() => {
        /* keep the safe default */
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

  // Fetch @-mention candidates as the query changes. Auth + DB resolution stay
  // server-side; no DB → empty lists → "no matches" (never errors).
  useEffect(() => {
    if (mention === null) {
      setMentionItems([]);
      return;
    }
    let alive = true;
    fetch(`/api/references?q=${encodeURIComponent(mention.query)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('references fetch failed'))))
      .then((data: { conversations?: MentionItem[]; artifacts?: MentionItem[] }) => {
        if (!alive) return;
        const items = [...(data.conversations ?? []), ...(data.artifacts ?? [])];
        setMentionItems(items);
        setMentionIndex(0);
      })
      .catch(() => {
        if (alive) setMentionItems([]);
      });
    return () => {
      alive = false;
    };
  }, [mention]);

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

  async function runChat(history: UiMessage[], technique?: string, refs: Reference[] = []) {
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
          messages: toApiMessages(history, provider, support),
          provider,
          technique,
          conversationId,
          // Send only {type,id}; the server resolves the content.
          references: refs.length > 0 ? refs.map((r) => ({ type: r.type, id: r.id })) : undefined,
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
            const parsed = JSON.parse(payload) as {
              token?: string;
              artifact?: { id?: string };
            };
            if (parsed.token) {
              raw += parsed.token;
              // Hide any <document>/<chips> tag from the live bubble.
              updatePlaceholder(visibleWhileStreaming(stripDocumentForBubble(raw)));
              // Stream the document into the doc pane as it grows.
              const body = streamingDocumentBody(raw);
              if (body !== null && onDocument) {
                const doc: DocState = { title: streamingDocumentTitle(raw), body };
                lastDocRef.current = doc;
                onDocument(doc);
              }
            }
            // Trailing frame from the server once the artifact row is written:
            // re-report the finished doc with its persisted id.
            if (parsed.artifact?.id && onDocument && lastDocRef.current) {
              onDocument({ ...lastDocRef.current, artifactId: parsed.artifact.id });
            }
          } catch {
            // ignore unparseable frames
          }
        }
      }

      const { text: afterDoc, document } = parseDocument(raw);
      const { text, chips } = parseChips(afterDoc);
      if (!text && chips.length === 0 && !document) {
        // Zero tokens or a chips-only/blocked reply — never show a blank
        // bubble, never leak raw tag text.
        replaceWithError(
          `${providerLabel(provider)} returned an empty response — try again or switch model.`,
        );
        return;
      }
      // Finalize the doc pane with the complete body (no-DB path: this is the
      // only place the document lands, and it persists for the session in
      // parent state).
      if (document && onDocument) {
        const doc: DocState = { title: document.title, body: document.body };
        lastDocRef.current = doc;
        onDocument(doc);
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

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // let the same file be re-picked later
    if (files.length === 0) return;
    const accepted: Attachment[] = [];
    for (const file of files) {
      if (attachments.length + accepted.length >= MAX_FILES) {
        pushToast(`You can attach up to ${MAX_FILES} files.`, { tone: 'warn' });
        break;
      }
      const v = validateFile(file);
      if (!v.ok) {
        pushToast(v.reason, { tone: 'warn' });
        continue;
      }
      try {
        if (v.modality === 'text') {
          const text = await readFileAsText(file);
          accepted.push({
            id: nextId(),
            name: file.name,
            mimeType: file.type || 'text/plain',
            size: file.size,
            modality: 'text',
            text,
          });
        } else {
          const data = await readFileAsBase64(file);
          accepted.push({
            id: nextId(),
            name: file.name,
            mimeType: file.type,
            size: file.size,
            modality: v.modality,
            data,
          });
        }
      } catch {
        pushToast(`Couldn't read ${file.name}.`, { tone: 'warn' });
      }
    }
    if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted]);
  }

  function onMicClick() {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as SpeechWindow;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      pushToast("Voice input isn't supported in this browser.", { tone: 'warn' });
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const transcript = Array.from(ev.results)
        .map((r) => r[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    setRecording(true);
    try {
      rec.start();
    } catch {
      setRecording(false);
      recognitionRef.current = null;
    }
  }

  function sendMessage(text: string, atts: Attachment[] = attachments) {
    if (streaming) return;
    // Capability gate: block an image/PDF the current model can't read — toast
    // and KEEP the attachment (never silently drop). Text docs always pass.
    const gate = canSend(provider, atts, support);
    if (!gate.ok) {
      const noun = gate.blocked === 'pdf' ? 'PDFs' : 'images';
      pushToast(
        `The current ${providerLabel(provider)} model can't read ${noun} — switch to Gemini in the header, or set a vision-capable model.`,
        { tone: 'warn', duration: 6000 },
      );
      return;
    }
    const textDocs = atts
      .filter((a) => a.modality === 'text')
      .map((a) => ({ name: a.name, text: a.text ?? '' }));
    const content = composeOutgoingText(text.trim(), textDocs);
    if (!content && atts.length === 0) return;
    const parts = toMsgParts(atts);
    const meta = atts.map(toMeta);
    const userMsg: UiMessage = {
      id: nextId(),
      role: 'user',
      content,
      attachments: meta.length > 0 ? meta : undefined,
      parts: parts.length > 0 ? parts : undefined,
    };
    const refs = references;
    setInput('');
    setAttachments([]);
    setReferences([]);
    setMention(null);
    void runChat([...messages, userMsg], undefined, refs);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  // Composer change: track text AND detect an active @-mention at the caret.
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setInput(value);
    const caret = e.target.selectionStart ?? value.length;
    setMention(activeMentionQuery(value, caret));
  }

  // Pick an autocomplete row: strip the raw `@token` from the text and bind a
  // reference pill (deduped). Content is never carried — only {type,id,title}.
  function pickMention(item: MentionItem) {
    if (mention) {
      const caret = textInputRef.current?.selectionStart ?? mention.start + mention.query.length + 1;
      setInput((prev) => stripRange(prev, mention.start, caret));
    }
    setReferences((prev) =>
      prev.some((r) => r.type === item.type && r.id === item.id)
        ? prev
        : [...prev, { type: item.type, id: item.id, title: item.title }],
    );
    setMention(null);
    setMentionItems([]);
    textInputRef.current?.focus();
  }

  function removeReference(item: Reference) {
    setReferences((prev) => prev.filter((r) => !(r.type === item.type && r.id === item.id)));
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (mention === null || mentionItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % mentionItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickMention(mentionItems[mentionIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMention(null);
    }
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
              {m.error ? (
                <>
                  <b>⚠️ Honest note: </b>
                  {m.content}
                </>
              ) : m.role === 'user' ? (
                // User bubbles stay PLAIN text — no markdown surprises.
                m.content
              ) : m.content ? (
                // Mary's bubbles render as sanitized markdown.
                <Markdown className="md">{m.content}</Markdown>
              ) : streaming && m.id === lastMessage?.id ? (
                '…'
              ) : (
                ''
              )}
            </div>
            {m.attachments && m.attachments.length > 0 && (
              <div className={`msgattach ${m.role === 'user' ? 'mine' : ''}`}>
                {m.attachments.map((a, i) => (
                  <span className="attach mini" key={i} title={a.name}>
                    📎 {a.name}
                  </span>
                ))}
              </div>
            )}
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
        {mention !== null && (
          <div className="mentionpop" role="listbox" aria-label="Reference a conversation or document">
            {mentionItems.length === 0 ? (
              <div className="mentionempty">No matches</div>
            ) : (
              mentionItems.map((item, i) => (
                <button
                  key={`${item.type}:${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === mentionIndex}
                  className={`mentionitem${i === mentionIndex ? ' on' : ''}`}
                  onMouseDown={(e) => {
                    // mousedown (not click) so the input doesn't blur first.
                    e.preventDefault();
                    pickMention(item);
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                >
                  <span className="mentiontype">{item.type === 'conversation' ? '💬' : '📄'}</span>
                  <span className="mentiontitle">{item.title}</span>
                </button>
              ))
            )}
          </div>
        )}
        {references.length > 0 && (
          <div className="attachrow refrow">
            {references.map((r) => (
              <span key={`${r.type}:${r.id}`} className="attach refpill" title={r.title}>
                <span className="attach-ico">{r.type === 'conversation' ? '💬' : '📄'}</span>
                <span className="attach-name">@{r.title}</span>
                <button
                  type="button"
                  className="attach-x"
                  onClick={() => removeReference(r)}
                  aria-label={`Remove reference ${r.title}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachrow">
            {attachments.map((a) => (
              <span key={a.id} className={`attach ${a.modality}`} title={a.name}>
                <span className="attach-ico">{modalityIcon(a.modality)}</span>
                <span className="attach-name">{a.name}</span>
                <button
                  type="button"
                  className="attach-x"
                  onClick={() => removeAttachment(a.id)}
                  aria-label={`Remove ${a.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="input">
          <input
            type="file"
            ref={fileInputRef}
            className="filehide"
            multiple
            accept={ACCEPT}
            onChange={onPickFiles}
          />
          <button
            type="button"
            className="iconbtn attachbtn"
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming}
            aria-label="Attach files"
            title="Attach images, PDFs, or text/markdown"
          >
            📎
          </button>
          <input
            ref={textInputRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onInputKeyDown}
            onBlur={() => setMention(null)}
            placeholder="Tell Mary what you're chewing on… (@ to reference)"
            disabled={streaming}
          />
          <button
            type="button"
            className={`iconbtn micbtn${recording ? ' rec' : ''}`}
            onClick={onMicClick}
            disabled={streaming}
            aria-label={recording ? 'Stop recording' : 'Voice input'}
            title="Voice input"
          >
            🎙
          </button>
          <button
            type="submit"
            className="send"
            disabled={streaming || (!input.trim() && attachments.length === 0)}
          >
            ↑
          </button>
        </div>
      </form>
    </main>
  );
}
