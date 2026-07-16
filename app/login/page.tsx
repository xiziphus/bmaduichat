'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [multi, setMulti] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Which door to render: shared (password only) or multi (username + password).
  useEffect(() => {
    fetch('/api/auth')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { mode?: string } | null) => setMulti(d?.mode === 'multi'))
      .catch(() => setMulti(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(multi ? { username, password } : { password }),
      });
      if (res.ok) {
        router.push('/');
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "That's not it — try again?");
    } catch {
      setError('Could not reach the server — try again.');
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || password.length === 0 || (multi && username.length === 0);

  return (
    <div id="login">
      <form className="card" onSubmit={submit}>
        <div className="logo">🪁 playground</div>
        <div className="sub">
          {multi
            ? 'Brainstorm with Mary. Sign in to your space.'
            : 'Brainstorm with Mary. One password, one door.'}
        </div>
        {error && <div className="err">{error}</div>}
        {multi && (
          <input
            type="text"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
          />
        )}
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={!multi}
        />
        <button type="submit" disabled={disabled}>
          {busy ? 'checking…' : 'come on in'}
        </button>
      </form>
    </div>
  );
}
