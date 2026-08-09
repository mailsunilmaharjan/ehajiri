import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

// Shared hover-tooltip card — light background (never black/dark), border +
// soft shadow, for anything too long to show inline (a full staff list, a
// long note/description). Wrap the visible/truncated content as `trigger`;
// `content` is whatever should show on hover (a string or JSX).
//
// Rendered into document.body via a portal, positioned from the trigger's
// own screen coordinates (position: fixed) rather than as an absolutely-
// positioned child of the trigger — a DataGrid cell sits inside a
// scrollable wrapper (overflow: auto), which clips an absolutely-positioned
// tooltip at the wrapper's edge no matter how high its z-index is. Escaping
// via a portal sidesteps that entirely.
const HoverCard = ({ trigger, content, minWidth = 200, maxWidth = 340 }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);

  const open = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - maxWidth - 8);
    const opensUp = rect.bottom > window.innerHeight * 0.7;
    setPos(opensUp
      ? { left, bottom: window.innerHeight - rect.top + 6 }
      : { left, top: rect.bottom + 6 });
    setShow(true);
  };
  const close = () => setShow(false);

  return (
    <span ref={triggerRef} style={{ display: 'inline-block' }}
      onMouseEnter={open} onMouseLeave={close}>
      {trigger}
      {show && pos && createPortal(
        <div className="hover-card" style={{ position: 'fixed', zIndex: 9999, minWidth, maxWidth, ...pos,
          background: '#ffffff', color: '#1f2937', fontSize: 14, lineHeight: 1.8, padding: '10px 14px',
          borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 10px 28px rgba(0,0,0,.18)', whiteSpace: 'normal' }}>
          {content}
        </div>,
        document.body
      )}
    </span>
  );
};

export default HoverCard;
