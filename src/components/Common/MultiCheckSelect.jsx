import React, { useState, useEffect, useRef } from 'react';
import FloatingPanel from './FloatingPanel.jsx';
import { SEARCH_ICON } from './FloatingPanel.icons.jsx';

/* ── Multi-Checkbox Select — value is a string[]; empty = "All".
   Pass `single` to cap it at one pick (checking a new option replaces the
   old one and closes the panel) while keeping the same checkbox visuals. ── */
const MultiCheckSelect = ({ label, value, onChange, options, displayFn, placeholder = 'All', single = false }) => {
  const [open, setOpen] = useState(false);
  const [srch, setSrch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef(null);
  const boxRef = useRef(null);
  const itemRefs = useRef([]);
  useEffect(() => {
    // a click inside the open list (drawn on top of the page) is not "outside"
    const h = e => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('[data-dd-open]')) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const filtered = srch ? options.filter(o => o.toLowerCase().includes(srch.toLowerCase())) : options;
  // "All" is always row 0 in the navigable list, followed by the filtered options
  const navItems = [null, ...filtered];
  itemRefs.current = [];
  const toggle = v => {
    if (single) {
      onChange(value.includes(v) ? [] : [v]);
      setOpen(false);
      return;
    }
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  };
  const selectNav = v => {
    if (v === null) { onChange([]); if (single) setOpen(false); }
    else toggle(v);
  };
  const selLabel = value.length === 0 ? placeholder
    : value.length === 1 ? (displayFn ? displayFn(value[0]) : value[0])
    : `${value.length} selected`;
  const openWithHighlight = () => {
    const idx = value.length === 1 ? navItems.findIndex(v => v === value[0]) : 0;
    setActiveIndex(idx >= 0 ? idx : 0);
    setOpen(true);
  };
  const handleTriggerKeyDown = e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open ? setOpen(false) : openWithHighlight();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };
  const handleSearchKeyDown = e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (navItems.length ? (i + 1) % navItems.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (navItems.length ? (i - 1 + navItems.length) % navItems.length : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < navItems.length) selectNav(navItems[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };
  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);
  useEffect(() => { if (open) setActiveIndex(navItems.length ? 0 : -1); }, [srch]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {label && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ui-label-color, #000)', marginBottom: 5 }}>{label}</div>}
      <div ref={boxRef} onClick={() => { open ? setOpen(false) : openWithHighlight(); }} tabIndex={0}
        onKeyDown={handleTriggerKeyDown}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 10px', border: `1.5px solid ${open ? '#1a56db' : '#d1d5db'}`, borderRadius: 7,
          background: 'white', cursor: 'pointer', fontSize: 13, color: value.length > 0 ? '#1e40af' : '#9ca3af',
          fontWeight: value.length > 0 ? 600 : 400, height: 38, boxSizing: 'border-box', outline: 'none', userSelect: 'none',
          boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{selLabel}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 4 }}>
          {value.length > 0 && <span style={{ background: '#1a56db', color: 'white', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{value.length}</span>}
          {value.length > 0 && (
            <span onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange([]); }}
              style={{ color: '#9ca3af', fontSize: 15, lineHeight: 1, cursor: 'pointer' }}>×</span>
          )}
          <svg viewBox="0 0 20 20" fill="#9ca3af" width="12" height="12"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
          </svg>
        </div>
      </div>
      <FloatingPanel anchorRef={boxRef} open={open} maxHeight={300}>
          <div style={{ padding: 6, borderBottom: '1px solid #eef2f7', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', background: '#fff' }}>
              {SEARCH_ICON}
              <input autoFocus type="text" value={srch} onChange={e => setSrch(e.target.value)}
                placeholder="Search..." onClick={e => e.stopPropagation()} onKeyDown={handleSearchKeyDown}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, flex: 1, minWidth: 0, fontFamily: 'inherit' }} />
            </div>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {navItems.map((v, i) => {
              const isAll = v === null;
              const sel   = isAll ? value.length === 0 : value.includes(v);
              const lbl   = isAll ? placeholder : (displayFn ? displayFn(v) : v);
              const highlighted = i === activeIndex;
              return (
                <div key={v ?? '__all'} ref={el => itemRefs.current[i] = el}
                  onMouseDown={e => { e.preventDefault(); selectNav(v); }}
                  onMouseEnter={() => setActiveIndex(i)}
                  style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    background: sel ? '#eff6ff' : (highlighted ? '#f8fafc' : 'white'), borderBottom: '1px solid #f9fafb' }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: `2px solid ${sel ? '#1a56db' : '#d1d5db'}`,
                    background: sel ? '#1a56db' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {sel && <svg viewBox="0 0 12 12" fill="none" width="9" height="9"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                  </span>
                  <span style={{ fontSize: 13, color: sel ? '#1e40af' : '#374151', fontWeight: sel ? 600 : 400 }}>{lbl}</span>
                </div>
              );
            })}
          </div>
      </FloatingPanel>
    </div>
  );
};

export default MultiCheckSelect;
