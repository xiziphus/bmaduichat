'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Me = { mode: string; username?: string | null; role?: 'admin' | 'user' };

/**
 * Profile menu (multi mode only). Renders nothing in shared mode, so the
 * default single-password experience is unchanged. Lives in the chat header.
 */
export default function ProfileMenu() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Me | null) => setMe(d))
      .catch(() => setMe(null));
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!me || me.mode !== 'multi') return null;

  const name = me.username ?? 'you';
  const initial = name.charAt(0).toUpperCase();

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* clear anyway */
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="profwrap" ref={wrapRef}>
      <button
        type="button"
        className="profbtn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        title={name}
      >
        {initial}
      </button>
      {open && (
        <div className="profmenu" role="menu">
          <div className="profhd">
            <div className="profname">{name}</div>
            <div className="profrole">{me.role === 'admin' ? 'admin' : 'signed in'}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setHelpOpen(true);
              setOpen(false);
            }}
          >
            ❓ What is BMad?
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setPwOpen(true);
              setOpen(false);
            }}
          >
            🔑 Change password
          </button>
          {me.role === 'admin' && (
            <button type="button" role="menuitem" onClick={() => router.push('/admin')}>
              👥 Accounts
            </button>
          )}
          <button type="button" role="menuitem" className="profout" onClick={logout}>
            ↩ Log out
          </button>
        </div>
      )}
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
      {helpOpen && <BmadHelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function BmadHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modalbg" onMouseDown={onClose}>
      <div className="modalcard help" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalhd">
          <b>❓ What is BMad?</b>
          <button type="button" className="modalx" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p>
          <b>BMad</b> is a structured way to think with AI. Instead of one open-ended chat, you work
          with <b>specialist agents</b> — each a focused persona (Mary the analyst, John the PM,
          Winston the architect…) with a menu of <b>guided workflows</b>.
        </p>
        <p>
          A workflow runs in real <b>phases</b> — it asks, diverges, converges, and ends with a
          proper <b>document</b> you can keep (downloadable as a PDF). That structure is the point:
          it beats a blank ChatGPT box because it drives you to a decision and an artifact.
        </p>
        <p>
          <b>Where we are:</b> <b>Mary</b> (guided brainstorming) is fully live here. The other
          agents show in the picker so you can see the full breadth, but they’re not wired up yet —
          they’ll say so honestly rather than fake it. Agents also can’t browse the web or run code
          in this app; when something’s out of reach, they say so.
        </p>
        <button type="button" className="helpdone" onClick={onClose}>
          got it
        </button>
      </div>
    </div>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) {
      setMsg({ kind: 'err', text: 'New passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setMsg({ kind: 'ok', text: 'Password changed.' });
        setCurrent('');
        setNext('');
        setConfirm('');
      } else {
        setMsg({ kind: 'err', text: data.error ?? 'Could not change password.' });
      }
    } catch {
      setMsg({ kind: 'err', text: 'Could not reach the server — try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalbg" onMouseDown={onClose}>
      <form className="modalcard" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modalhd">
          <b>🔑 Change password</b>
          <button type="button" className="modalx" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {msg && <div className={msg.kind === 'ok' ? 'ok' : 'err'}>{msg.text}</div>}
        <input
          type="password"
          placeholder="current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoFocus
        />
        <input
          type="password"
          placeholder="new password (min 8)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <input
          type="password"
          placeholder="confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button type="submit" disabled={busy || !current || next.length < 8}>
          {busy ? 'saving…' : 'change password'}
        </button>
      </form>
    </div>
  );
}
