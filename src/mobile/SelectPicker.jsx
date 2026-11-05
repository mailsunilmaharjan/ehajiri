import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, useMT } from './kit.jsx';

/* Turns every drop-down (<select>) in the phone app into a bottom-sheet pick list - big tap targets, the current choice ticked,
   a search box when the list is long - instead of the small browser pop-up. It works on the website's own forms (leave, visit,
   late/early, reports...) without changing them: it intercepts the tap, then writes the choice back and fires a normal
   "change" event, so every form behaves exactly as before. */

const labelOf = (el) => {
  const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
  const near = el.closest('.form-group, .m-field, label')?.querySelector('label');
  return (byFor || near)?.textContent?.replace(/\*/g, '').trim() || '';
};

export default function SelectPicker() {
  const mt = useMT();
  const [st, setSt] = useState(null);     // { el, title, options:[{value,label,disabled}], value }
  const [q, setQ] = useState('');
  const elRef = useRef(null);
  const openedAt = useRef(0);   // the tap that opens the list also produces a click that lands on it - ignore clicks for a moment

  useEffect(() => {
    const onDown = (e) => {
      const el = e.target?.closest?.('select');
      if (!el || el.multiple || el.disabled || el.dataset.nativePicker === '1') return;
      e.preventDefault(); e.stopPropagation();
      try { el.blur(); } catch { /* ignore */ }
      elRef.current = el; openedAt.current = Date.now();
      setQ('');
      setSt({
        el, title: labelOf(el) || el.getAttribute('aria-label') || '',
        options: [...el.options].map(o => ({ value: o.value, label: o.textContent.trim() || '—', disabled: o.disabled, hidden: o.hidden })).filter(o => !o.hidden),
        value: el.value,
      });
    };
    // mousedown covers touch taps too (the browser synthesises it); keydown covers hardware keyboards
    const onKey = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target?.tagName === 'SELECT') onDown(e); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, []);

  const shown = useMemo(() => {
    if (!st) return [];
    const s = q.trim().toLowerCase();
    return s ? st.options.filter(o => o.label.toLowerCase().includes(s)) : st.options;
  }, [st, q]);

  if (!st) return null;
  const fresh = () => Date.now() - openedAt.current < 450;
  const choose = (o) => {
    if (o.disabled || fresh()) return;
    const el = st.el;
    if (el.value !== o.value) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, o.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setSt(null);
  };
  const close = () => { if (!fresh()) setSt(null); };

  // rendered on <body> so it sits above the website's own popup forms (they are outside the app frame)
  return createPortal(
    <div className="m-pick-back" onClick={close}>
      <div className="m-pick" onClick={e => e.stopPropagation()} role="listbox" aria-label={st.title || 'Choose'}>
        <div className="m-sheet-grab" />
        <div className="m-pick-head m-row"><span className="m-grow">{st.title || mt('Choose')}</span>
          <button type="button" className="m-icon-btn" style={{ background: '#f3f4f6', color: '#374151' }} onClick={close} aria-label="Close"><Icon name="x" size={20} /></button></div>
        {st.options.length > 10 && <input className="m-input m-pick-search" placeholder={mt('Search')} value={q} onChange={e => setQ(e.target.value)} />}
        <div className="m-pick-list">
          {shown.map((o, i) => (
            <button type="button" key={`${o.value}-${i}`} role="option" aria-selected={o.value === st.value} disabled={o.disabled}
              className={`m-pick-item${o.value === st.value ? ' on' : ''}`} onClick={() => choose(o)}>
              <span className="m-grow">{o.label}</span>{o.value === st.value && <Icon name="check" size={20} />}
            </button>
          ))}
          {shown.length === 0 && <div className="m-muted" style={{ padding: 16, textAlign: 'center' }}>{mt('Nothing here yet')}</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}
