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
//
// arrow (default false) — draws a small speech-bubble caret pointing back at
// the trigger, flipping to match whichever side (`opensUp`) the card landed
// on. Off by default so existing plain-card consumers stay pixel-identical.
//
// fill (default false) — makes the wrapper `display:block; width:100%`
// instead of the default `inline-block` (which shrink-wraps to content).
// Needed when `trigger` itself relies on filling its container to do its
// own ellipsis truncation (a `width:100%` child inside a shrink-to-fit
// inline-block never actually gets a definite width to overflow against —
// it just collapses the wrapper to ~0 instead of expanding it).
const HoverCard = ({ trigger, content, minWidth = 200, maxWidth = 340, arrow = false, fill = false }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState(null);
  const [opensUp, setOpensUp] = useState(false);
  const triggerRef = useRef(null);

  const open = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - maxWidth - 8);
    const up = rect.bottom > window.innerHeight * 0.7;
    const gap = arrow ? 14 : 6;
    setOpensUp(up);
    setPos(up
      ? { left, bottom: window.innerHeight - rect.top + gap }
      : { left, top: rect.bottom + gap });
    setShow(true);
  };
  const close = () => setShow(false);

  return (
    <span ref={triggerRef} style={fill ? { display: 'block', width: '100%' } : { display: 'inline-block' }}
      onMouseEnter={open} onMouseLeave={close}>
      {trigger}
      {show && pos && createPortal(
        <div className="hover-card" style={{ position: 'fixed', zIndex: 9999, minWidth, maxWidth, ...pos,
          background: '#ffffff', color: '#1f2937', fontSize: 14, lineHeight: 1.8, padding: '10px 14px',
          borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 10px 28px rgba(0,0,0,.18)', whiteSpace: 'normal' }}>
          {content}
          {arrow && (opensUp ? (
            <>
              <span style={{ position:'absolute', bottom:-9, left:16, width:0, height:0,
                borderLeft:'9px solid transparent', borderRight:'9px solid transparent',
                borderTop:'9px solid #e5e7eb' }} />
              <span style={{ position:'absolute', bottom:-7, left:18, width:0, height:0,
                borderLeft:'7px solid transparent', borderRight:'7px solid transparent',
                borderTop:'7px solid #ffffff' }} />
            </>
          ) : (
            <>
              <span style={{ position:'absolute', top:-9, left:16, width:0, height:0,
                borderLeft:'9px solid transparent', borderRight:'9px solid transparent',
                borderBottom:'9px solid #e5e7eb' }} />
              <span style={{ position:'absolute', top:-7, left:18, width:0, height:0,
                borderLeft:'7px solid transparent', borderRight:'7px solid transparent',
                borderBottom:'7px solid #ffffff' }} />
            </>
          ))}
        </div>,
        document.body
      )}
    </span>
  );
};

export default HoverCard;
