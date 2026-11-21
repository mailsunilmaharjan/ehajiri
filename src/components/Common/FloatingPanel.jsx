import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/* A drop-down list panel drawn on top of the page (portal to <body>, position:fixed) instead of inside its box.
 * Inside a pop-up form a normal absolutely-positioned list is clipped by the form's scroll area — the bottom rows
 * (and the bottom of the blue border) disappear. This panel is never clipped: it sits just below the box, flips
 * above it when there isn't room below, and follows the box while the page scrolls.
 *
 *   <FloatingPanel anchorRef={boxRef} open={open} maxHeight={260}> …list… </FloatingPanel>
 *
 * It carries data-dd-open, so the "click outside closes it" checks of the owning control (and of pop-up forms)
 * can tell that a click inside the list is not outside:  e.target.closest('[data-dd-open]').
 */
export default function FloatingPanel({ anchorRef, open, maxHeight = 260, minWidth = 160, style, children, panelRef }) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const up = below < Math.min(maxHeight, 180) && above > below;
      const h = Math.max(120, Math.min(maxHeight, up ? above : below));
      const width = Math.max(r.width, minWidth);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      setPos(up
        ? { left, width, bottom: window.innerHeight - r.top + 4, maxHeight: h }
        : { left, width, top: r.bottom + 4, maxHeight: h });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, anchorRef, maxHeight, minWidth]);

  if (!open || !pos) return null;
  return createPortal(
    <div ref={panelRef} data-dd-open="" onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', zIndex: 100000, left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight,
        background: '#fff', border: '1.5px solid var(--ui-dd-border, #1a56db)', borderRadius: 'var(--ui-dd-radius, 8px)',
        boxShadow: 'var(--ui-dd-shadow, 0 8px 28px rgba(0,0,0,.18))', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxSizing: 'border-box', ...style,
      }}>
      {children}
    </div>,
    document.body,
  );
}
