'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type AdminUser = { id: string; username: string; role: 'admin' | 'user'; created: string };

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [newName, setNewName] = useState('');
  const [newPass, setNewPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The one-time password to hand over, keyed by a label (username), shown once.
  const [handoff, setHandoff] = useState<{ label: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        if (res.status === 403 || res.status === 401) router.push('/');
        return;
      }
      const data = (await res.json()) as { users?: AdminUser[] };
      setUsers(data.users ?? []);
    } catch {
      /* leave list as-is */
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          newPass.trim() ? { username: newName, password: newPass } : { username: newName },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: AdminUser;
        password?: string;
      };
      if (res.ok && data.user && data.password) {
        setHandoff({ label: data.user.username, password: data.password });
        setNewName('');
        setNewPass('');
        await load();
      } else {
        setErr(data.error ?? 'Could not create user.');
      }
    } catch {
      setErr('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function resetUser(u: AdminUser) {
    setErr(null);
    if (!confirm(`Reset ${u.username}'s password? They'll need the new one to sign in.`)) return;
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { error?: string; password?: string };
      if (res.ok && data.password) {
        setHandoff({ label: u.username, password: data.password });
      } else {
        setErr(data.error ?? 'Could not reset password.');
      }
    } catch {
      setErr('Could not reach the server.');
    }
  }

  return (
    <div id="admin">
      <div className="ahdr">
        <b>👥 Accounts</b>
        <button className="loginlink" onClick={() => router.push('/')}>
          ← back to Playground
        </button>
      </div>

      {handoff && (
        <div className="handoff">
          <b>One-time password for “{handoff.label}”</b>
          <code>{handoff.password}</code>
          <p>Copy it now and hand it over — it won’t be shown again. They can change it at /account.</p>
          <button className="loginlink" onClick={() => setHandoff(null)}>
            done
          </button>
        </div>
      )}

      {err && <div className="err">{err}</div>}

      <form className="acreate" onSubmit={createUser}>
        <input
          type="text"
          placeholder="new username"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <input
          type="text"
          placeholder="password (optional)"
          value={newPass}
          onChange={(e) => setNewPass(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <button type="submit" disabled={busy || newName.trim().length === 0}>
          {busy ? 'creating…' : 'create account'}
        </button>
      </form>
      <div className="ahint">Leave the password blank to auto-generate one. Either way, you’ll get the value to hand over.</div>

      <ul className="alist">
        {users.map((u) => (
          <li key={u.id}>
            <span className="aname">
              {u.username}
              {u.role === 'admin' && <span className="atag">admin</span>}
            </span>
            {u.role !== 'admin' && (
              <button className="loginlink" onClick={() => resetUser(u)}>
                reset password
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
