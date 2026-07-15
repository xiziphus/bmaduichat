'use client';

import { useEffect, useState } from 'react';
import { subscribe, dismissToast, type Toast } from '@/lib/toast';

/**
 * Renders the live toast stack. Mount once near the app root. Subscribes to the
 * module-level toast store so any `pushToast()` call surfaces here.
 */
export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribe(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span className="toast-msg">{t.message}</span>
          <button
            type="button"
            className="toast-x"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
