import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The single, shared markdown renderer for the whole app — used for Mary's chat
 * bubbles AND the doc pane. XSS-safe by construction: react-markdown never uses
 * dangerouslySetInnerHTML and does NOT parse raw HTML (no rehype-raw), so any
 * `<script>`/`onerror`/`javascript:` in the untrusted agent output is escaped to
 * inert text or dropped. remark-gfm adds tables + strikethrough. Links are
 * forced to open safely in a new tab.
 *
 * This is a presentational component with no hooks, so it renders in both a
 * Server Component (renderToStaticMarkup for the artifact route) and inside the
 * client ChatPane/DocPane. Styling comes entirely from the wrapper's CSS class
 * (`.md` in chat, `.docbody` under #paper) — no inline styles.
 */

const components: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
  ),
};

export default function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
