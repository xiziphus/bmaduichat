'use client';

import { useCallback, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import ChatPane from '@/components/ChatPane';
import DocPane from '@/components/DocPane';
import Gutter from '@/components/Gutter';
import type { Provider } from '@/lib/llm';

export default function Home() {
  const [sideW, setSideW] = useState(270);
  const [docW, setDocW] = useState(460);
  const [provider, setProvider] = useState<Provider>('gemini');
  // Bumping the key remounts ChatPane → clears messages/technique/input,
  // while provider (lifted here) and pane sizes survive the reset.
  const [sessionKey, setSessionKey] = useState(0);

  const onNew = useCallback(() => {
    // Goal 1: single in-tab session — "new conversation" resets the chat.
    // Persisted/multiple conversations arrive in goal 2.
    setSessionKey((k) => k + 1);
  }, []);

  return (
    <div id="app" style={{ gridTemplateColumns: `${sideW}px 6px minmax(320px, 1fr) 6px ${docW}px` }}>
      <Sidebar onNew={onNew} />
      <Gutter start={sideW} min={190} max={420} dir={1} onDrag={setSideW} />
      <ChatPane key={sessionKey} provider={provider} onProviderChange={setProvider} />
      <Gutter start={docW} min={320} max={760} dir={-1} onDrag={setDocW} />
      <DocPane />
    </div>
  );
}
