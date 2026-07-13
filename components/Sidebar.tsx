'use client';

export default function Sidebar({ onNew }: { onNew: () => void }) {
  return (
    <aside id="side">
      <div className="logo">🪁 playground</div>
      <button className="newbtn" onClick={onNew}>
        ＋ New conversation
      </button>
      <h6>Conversations</h6>
      <div className="convo on">💬 Current session</div>
      <div className="convo">✈️ travel-client pitch</div>
      <div className="convo">🧵 newsletter concept</div>
      <div className="convo">🪡 Loomcraft rebrand — real job</div>
      <div className="foot">
        <b>Goal 1</b> — conversations live in this tab for now. Saved history, renaming, and{' '}
        <b>@</b>-references arrive in goal 2.
      </div>
    </aside>
  );
}
