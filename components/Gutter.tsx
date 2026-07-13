'use client';

import { useRef } from 'react';

/**
 * Draggable column divider, ported from the mock's pointer-event script.
 * `dir` is +1 when dragging right grows the column to its left (sidebar
 * gutter), -1 when dragging left grows the column to its right (doc gutter).
 */
export default function Gutter({
  onDrag,
  min,
  max,
  start,
  dir,
}: {
  onDrag: (px: number) => void;
  min: number;
  max: number;
  start: number;
  dir: 1 | -1;
}) {
  const dragging = useRef(false);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    target.classList.add('drag');
    target.setPointerCapture(e.pointerId);
    dragging.current = true;
    const startX = e.clientX;

    function move(ev: PointerEvent) {
      if (!dragging.current) return;
      const v = start + (ev.clientX - startX) * dir;
      onDrag(Math.max(min, Math.min(max, v)));
    }
    function end() {
      dragging.current = false;
      target.classList.remove('drag');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  return <div className="gutter" onPointerDown={onPointerDown} />;
}
