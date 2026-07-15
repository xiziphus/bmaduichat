import { createElement } from 'react';
// Next's App Router bans a STATIC `react-dom/server` import anywhere in the
// traced graph. We only need it server-side (the artifact route + tests), so we
// pull `renderToStaticMarkup` in via a lazy require kept out of the static
// import graph. `server-only` guarantees this never lands in a client bundle.
import 'server-only';
import Markdown from '@/components/Markdown';

/**
 * Render trusted-but-user-authored markdown to a sanitized HTML string.
 *
 * Reuses the exact same <Markdown> component the client renders, so the chat
 * bubbles, the live doc pane, and the standalone artifact route all produce
 * byte-identical, XSS-safe markup. Runs anywhere react-dom/server runs (Node
 * route handlers, vitest) — no DOM/jsdom required.
 */
export function renderMarkdownToHtml(markdown: string, className?: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');
  return renderToStaticMarkup(createElement(Markdown, { children: markdown, className }));
}
