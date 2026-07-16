'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AccountPage() {
  const router = useRouter();
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
    <div id="login">
      <form className="card" onSubmit={submit}>
        <div className="logo">🔑 change password</div>
        <div className="sub">Update your own password.</div>
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
      <button className="loginlink" onClick={() => router.push('/')}>
        ← back to Playground
      </button>
    </div>
  );
}
