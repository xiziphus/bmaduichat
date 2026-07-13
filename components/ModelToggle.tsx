'use client';

import type { Provider } from '@/lib/llm';

export default function ModelToggle({
  provider,
  onChange,
  disabled,
}: {
  provider: Provider;
  onChange: (p: Provider) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mtoggle" role="group" aria-label="Model provider">
      <button
        type="button"
        className={provider === 'gemini' ? 'on' : ''}
        disabled={disabled}
        onClick={() => onChange('gemini')}
      >
        Gemini
      </button>
      <button
        type="button"
        className={provider === 'openrouter' ? 'on' : ''}
        disabled={disabled}
        onClick={() => onChange('openrouter')}
      >
        OpenRouter
      </button>
    </div>
  );
}
