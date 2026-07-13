'use client';

export default function DocPane() {
  return (
    <section id="docpane">
      <div className="dhdr">
        <span className="live" />
        <b>Working doc</b>
        <div className="acts">
          <span className="act">PDF</span>
          <span className="act">Copy</span>
          <span className="act">Send ➤</span>
        </div>
      </div>
      <div id="paper">
        <div className="doctitle">Your document will live here</div>
        <div className="docmeta">SHAPED WITH MARY · LIVE DOCUMENT · GOAL 2</div>
        <div className="rule" />
        <p>
          This pane is where your brainstorm crystallizes into something you can keep. As you and
          Mary work, the good thinking will assemble here into a structured, exportable document —
          hypothesis, evidence, what it changes.
        </p>
        <div className="callout">
          <b>✓ Coming in goal 2</b>
          <p>
            The live document arrives in the next slice. For now, everything happens in the chat —
            go bounce an idea off Mary.
          </p>
        </div>
        <div className="sig">MADE IN PLAYGROUND</div>
      </div>
    </section>
  );
}
