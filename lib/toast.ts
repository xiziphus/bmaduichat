/**
 * Lightweight, dependency-free toast store.
 *
 * A module-level pub/sub so `pushToast()` works from anywhere (event handlers,
 * async flows) without threading a React context through the tree. `<Toaster/>`
 * subscribes and renders; `useToast()` is a thin convenience wrapper.
 */

export type ToastTone = 'info' | 'warn' | 'error';
export type Toast = { id: number; message: string; tone: ToastTone };

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function emit() {
  for (const l of listeners) l(toasts);
}

/** Show a toast. Auto-dismisses after `duration` ms (default 4s; 0 = sticky). */
export function pushToast(
  message: string,
  opts: { tone?: ToastTone; duration?: number } = {},
): number {
  const id = ++seq;
  const tone = opts.tone ?? 'info';
  toasts = [...toasts, { id, message, tone }];
  emit();
  const duration = opts.duration ?? 4000;
  if (duration > 0 && typeof window !== 'undefined') {
    window.setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export function dismissToast(id: number) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

/** Subscribe to the toast list; the listener fires immediately with current state. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

/** Convenience hook — `const { toast } = useToast()`. */
export function useToast() {
  return { toast: pushToast, dismiss: dismissToast };
}
