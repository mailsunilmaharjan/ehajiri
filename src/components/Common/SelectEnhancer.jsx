import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ═══════════════════════════════════════════════════════════════════════════
   Global drop-down list — one look for every plain <select> in the app.

   Mounted once (main.jsx). Every native single <select> keeps working exactly as before (its value, its
   onChange, its form submit), but instead of the browser's own pop-up list it opens the app's list:
   a blue "Search…" box on top, striped rows, the current option marked, and keyboard support —
     ↓ / ↑   move the highlight          Enter   pick it
     Esc     close (the form stays open) Tab     close and move to the next field
     typing  filters the list
   Opened by a click, or by ↓ / ↑ / Enter / Space / Alt+↓ while the select has focus.

   Picking an option sets the select's value through the native setter and fires a bubbling `change`
   event, which is what React's onChange listens to — so no page needs to change.
   Opt out for a single select with  data-native-select  (also skipped: multiple / size>1 / disabled).
   ═══════════════════════════════════════════════════════════════════════════ */

const setNativeValue = (sel, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  sel.dispatchEvent(new Event('input', { bubbles: true }));
};
// phones / tablets keep their own native picker (better for touch)
const TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const usable = (el) => !TOUCH && el && el.tagName === 'SELECT' && !el.multiple && !(el.size > 1) && !el.disabled
  && !el.hasAttribute('data-native-select');

export default function SelectEnhancer() {
  const [st, setSt] = useState(null);          // { sel, rect, opts, search, active }
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const itemRefs = useRef([]);
  const stRef = useRef(null);
  stRef.current = st;

  const open = useCallback((sel) => {
    const r = sel.getBoundingClientRect();
    const opts = Array.from(sel.options).map((o, i) => ({ i, value: o.value, label: o.text, disabled: o.disabled, hidden: o.hidden }))
      .filter((o) => !o.hidden);
    const rowsH = Math.min(300, opts.length * 34 + 52);
    const below = window.innerHeight - r.bottom;
    const up = below < rowsH + 8 && r.top > rowsH + 8;
    const cur = opts.findIndex((o) => o.value === sel.value);
    setSt({ sel, opts, search: '', active: cur >= 0 ? cur : 0,
      rect: { left: r.left, width: Math.max(r.width, 180), top: up ? null : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : null } });
  }, []);
  const close = useCallback((refocus = true) => {
    const s = stRef.current;
    setSt(null);
    if (refocus && s?.sel?.isConnected) s.sel.focus({ preventScroll: true });
  }, []);

  // open on click / keyboard; never let the browser's own list appear
  useEffect(() => {
    const onMouseDown = (e) => {
      const sel = e.target.closest?.('select');
      if (!usable(sel) || e.button !== 0) return;
      e.preventDefault();
      sel.focus({ preventScroll: true });
      if (stRef.current?.sel === sel) close(); else open(sel);
    };
    const onKeyDown = (e) => {
      const sel = e.target;
      // a key pressed in the moment before focus moves to the list's search box (list already open)
      if (stRef.current && sel === stRef.current.sel) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key !== 'Tab' && e.key !== 'Shift') { e.preventDefault(); searchRef.current?.focus({ preventScroll: true }); }
        return;
      }
      if (!usable(sel) || stRef.current) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ' || e.key === 'F4') {
        e.preventDefault(); e.stopPropagation();
        open(sel);
      }
    };
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => { document.removeEventListener('mousedown', onMouseDown, true); document.removeEventListener('keydown', onKeyDown, true); };
  }, [open, close]);

  // close on outside click / page scroll / resize
  useEffect(() => {
    if (!st) return undefined;
    const outside = (e) => {
      if (listRef.current?.contains(e.target) || e.target === st.sel) return;
      close(false);
    };
    const scroll = (e) => { if (!listRef.current?.contains(e.target)) close(false); };
    const resize = () => close(false);
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 10);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [st?.sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = st ? st.opts.filter((o) => !st.search || o.label.toLowerCase().includes(st.search.toLowerCase())) : [];
  useEffect(() => { if (st) itemRefs.current[st.active]?.scrollIntoView({ block: 'nearest' }); }, [st?.active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st) return null;
  const pick = (o) => {
    if (!o || o.disabled) return;
    const sel = st.sel;
    close();
    if (sel.value !== o.value) setNativeValue(sel, o.value);
  };
  const move = (d) => {
    if (!shown.length) return;
    let i = st.active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + d + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setSt({ ...st, active: i });
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(shown[st.active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const sel = st.sel;
      close(false);
      // move on to the next / previous field, as Tab would from the select itself
      const f = Array.from(document.querySelectorAll('input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((el) => el.offsetParent !== null);
      const i = f.indexOf(sel);
      (f[i + (e.shiftKey ? -1 : 1)] || sel).focus();
    }
  };

  const r = st.rect;
  itemRefs.current = [];
  return createPortal(
    <div ref={listRef} data-dd-open="" onKeyDown={onKey} style={{
      position:'fixed', zIndex:100000, left:r.left, width:r.width, top:r.top ?? undefined, bottom:r.bottom ?? undefined,
      background:'#fff', border:'1.5px solid var(--ui-dd-border, #1a56db)', borderRadius:'var(--ui-dd-radius, 8px)',
      boxShadow:'var(--ui-dd-shadow, 0 8px 28px rgba(0,0,0,.18))', maxHeight:300, display:'flex', flexDirection:'column',
      fontFamily:'inherit',
    }}>
      <div style={{ padding:6, borderBottom:'1px solid #eef2f7', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', background:'#fff' }}>
          <svg viewBox="0 0 20 20" width="14" height="14">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
          </svg>
          <input ref={searchRef} value={st.search} placeholder="Search..."
            onChange={(e) => {
              const search = e.target.value;
              const list = st.opts.filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()));
              setSt({ ...st, search, active: Math.max(0, list.findIndex((o) => !o.disabled)) });
            }}
            style={{ border:'none', outline:'none', background:'transparent', fontSize:13, color:'#1f2937', flex:1, width:'auto', minWidth:0, fontFamily:'inherit' }} />
        </div>
      </div>
      <div style={{ overflowY:'auto', flex:1 }} onWheel={(e) => e.stopPropagation()}>
        {shown.length === 0
          ? <div style={{ padding:'10px 12px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>No results found</div>
          : shown.map((o, i) => {
              const current = o.value === st.sel.value;
              const hi = i === st.active;
              return (
                <div key={`${o.i}`} ref={(el) => { itemRefs.current[i] = el; }}
                  onMouseEnter={() => !o.disabled && setSt((s) => (s ? { ...s, active: i } : s))}
                  onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                  style={{
                    padding:'var(--ui-dd-row-pad, 6px 10px)', fontSize:'var(--ui-dd-font, 13px)', cursor:o.disabled ? 'not-allowed' : 'pointer',
                    color:o.disabled ? '#c0c4cc' : current ? 'var(--ui-dd-current-text, #1a56db)' : (o.value === '' ? '#9ca3af' : '#1f2937'),
                    fontWeight:current ? 600 : 400, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                    background:hi ? 'var(--ui-dd-hover-bg, #eff6ff)' : current ? 'var(--ui-dd-current-bg, #f8fafc)' : (i % 2 ? 'var(--ui-dd-stripe, #fafafa)' : '#fff'),
                    borderLeft:current ? '3px solid var(--ui-dd-current-bar, #1a56db)' : hi ? '3px solid var(--ui-dd-hover-bar, #93c5fd)' : '3px solid transparent',
                    borderBottom:'1px solid var(--ui-dd-line, #eef0f3)',
                  }}>
                  {o.label || ' '}
                </div>
              );
            })}
      </div>
    </div>,
    document.body,
  );
}
