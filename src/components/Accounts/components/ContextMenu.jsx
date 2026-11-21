import { useEffect, useRef } from 'react';

/** Right-click menu (same look as eHajiri DataGrid's context menu).
 *  items: [{ label, icon, onClick, danger, disabled, hint }] or 'divider' */
export default function ContextMenu({ x, y, title, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);
  // keep inside the window
  const left = Math.min(x, window.innerWidth - 240);
  const top = Math.min(y, window.innerHeight - (items.length * 34 + 50));
  return (
    <div ref={ref} className="dg-ctx-menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      {title && <div className="dg-ctx-title">{title}</div>}
      {items.filter(Boolean).map((it, i) => (it === 'divider'
        ? <div key={i} className="dg-ctx-divider" />
        : (
          <button key={i} className={`dg-ctx-item ${it.danger ? 'ctx-danger' : ''}`} disabled={it.disabled} title={it.hint || ''}
            onClick={() => { onClose(); it.onClick(); }}>
            <span className="dg-ctx-icon">{it.icon}</span>{it.label}
          </button>
        )))}
    </div>
  );
}
