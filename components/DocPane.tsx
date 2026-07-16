'use client';

import { useState } from 'react';
import Markdown from './Markdown';

/** The document currently shown in the pane. `artifactId` is set once the row
 *  is persisted (DB on); null/undefined in the graceful no-DB path. */
export type DocState = {
  title: string | null;
  body: string;
  artifactId?: string | null;
};

export default function DocPane({ doc }: { doc: DocState | null }) {
  const [copied, setCopied] = useState(false);

  async function copyMarkdown() {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(doc.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked → no-op */
    }
  }

  function printDoc() {
    // Best path: a persisted artifact renders as a clean, fully-styled, isolated
    // standalone page that auto-opens the print dialog (→ Save as PDF). Works for
    // any document type. No Puppeteer, no server-side PDF.
    if (doc?.artifactId) {
      window.open(`/api/artifacts/${doc.artifactId}?print=1`, '_blank', 'noopener,noreferrer');
      return;
    }
    // Not yet persisted (e.g. no DB) → print the live doc pane via @media print.
    window.print();
  }

  const hasDoc = doc !== null && doc.body.trim().length > 0;

  return (
    <section id="docpane">
      <div className="dhdr">
        <span className="live" />
        <b>{hasDoc ? doc?.title || 'Working doc' : 'Working doc'}</b>
        <div className="acts">
          <button
            type="button"
            className="act"
            onClick={printDoc}
            disabled={!hasDoc}
            aria-disabled={!hasDoc}
          >
            PDF
          </button>
          <button
            type="button"
            className="act"
            onClick={copyMarkdown}
            disabled={!hasDoc}
            aria-disabled={!hasDoc}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          {doc?.artifactId && (
            <a
              className="act"
              href={`/api/artifacts/${doc.artifactId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open ↗
            </a>
          )}
        </div>
      </div>
      <div id="paper">
        {hasDoc ? (
          <>
            {doc?.title && <div className="doctitle">{doc.title}</div>}
            <div className="docmeta">SHAPED WITH MARY · LIVE DOCUMENT</div>
            <div className="rule" />
            <Markdown className="docbody">{doc!.body}</Markdown>
            <div className="sig">MADE IN PLAYGROUND</div>
          </>
        ) : (
          <>
            <div className="doctitle">Your document will live here</div>
            <div className="docmeta">SHAPED WITH MARY · LIVE DOCUMENT</div>
            <div className="rule" />
            <p>
              This pane is where your brainstorm crystallizes into something you can keep. As you and
              Mary work toward a wrap-up, the good thinking assembles here into a structured,
              exportable document — hypothesis, evidence, what it changes.
            </p>
            <div className="callout">
              <b>✓ How it works</b>
              <p>
                When Mary converges on a synthesis, the document appears here — formatted and ready
                to Copy or save as PDF. For now, go bounce an idea off her.
              </p>
            </div>
            <div className="sig">MADE IN PLAYGROUND</div>
          </>
        )}
      </div>
    </section>
  );
}
