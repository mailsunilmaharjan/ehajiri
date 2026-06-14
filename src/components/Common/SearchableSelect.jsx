import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Searchable select with optional multi-select + checkboxes.
 * Portal-based dropdown — always above overflow:hidden / modals.
 *
 * Props:
 *   value        — string (single) | string[] (multiple)
 *   onChange     — (value) => void
 *   options      — [{ value, label }]
 *   multiple     — bool (default false) — enables checkbox multi-select
 *   placeholder  — string
 *   className, style, disabled
 */
const SearchableSelect = ({
  value       = '',
  onChange,
  options     = [],
  multiple    = false,
  placeholder = '— Select —',
  className   = 'form-control',
  style       = {},
  disabled    = false,
}) => {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const [rect,   setRect]   = useState(null);
  const triggerRef = useRef(null);
  const searchRef  = useRef(null);
  const dropRef    = useRef(null);

  /* normalise value to array for multi mode */
  const selectedArr = multiple
    ? (Array.isArray(value) ? value : value ? [value] : [])
    : [];
  const isSelected = (v) => multiple
    ? selectedArr.includes(String(v))
    : String(value) === String(v);

  const selectedOptions = options.filter(o => isSelected(o.value));
  const displayLabel = multiple
    ? (selectedOptions.length === 0
        ? placeholder
        : selectedOptions.length === 1
          ? selectedOptions[0].label
          : `${selectedOptions.length} selected`)
    : (options.find(o => String(o.value) === String(value))?.label || placeholder);

  const filtered = options.filter(o =>
    !search || o.label.toLowerCase().includes(search.toLowerCase())
  );

  /* open: measure trigger position */
  const openDrop = () => {
    if (disabled || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const dropH = Math.min(280, filtered.length * 38 + 68);
    const above = spaceBelow < dropH + 8 && r.top > dropH + 8;
    setRect({ left: r.left, top: above ? r.top - dropH - 4 : r.bottom + 4, width: r.width, above });
    setOpen(o => !o);
  };

  /* close on outside click / scroll (but NOT when scrolling inside the dropdown) */
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (triggerRef.current?.contains(e.target) || dropRef.current?.contains(e.target)) return;
      setOpen(false); setSearch('');
    };
    const scroll = (e) => {
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false); setSearch('');
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', scroll, true); };
  }, [open]);

  useEffect(() => { if (open) setTimeout(() => searchRef.current?.focus(), 20); }, [open]);

  /* selection logic */
  const handleSelect = (optValue) => {
    if (multiple) {
      const arr = selectedArr.includes(String(optValue))
        ? selectedArr.filter(v => v !== String(optValue))
        : [...selectedArr, String(optValue)];
      onChange(arr);
      /* stay open for multi */
    } else {
      onChange(optValue);
      setOpen(false);
      setSearch('');
    }
  };

  const clearAll = (e) => { e.stopPropagation(); onChange(multiple ? [] : ''); };

  return (
    <div style={{ position: 'relative', ...style }}
      onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setSearch(''); } }}>

      {/* Trigger */}
      <button ref={triggerRef} type="button" disabled={disabled} className={className}
        onClick={openDrop}
        style={{
          width: '100%', textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: disabled ? '#f3f4f6' : '#fff',
          color: (multiple ? selectedArr.length > 0 : value) ? '#1f2937' : '#9ca3af',
          fontSize: 13, fontFamily: 'inherit', padding: '6px 10px',
          border: '1px solid #d1d5db', borderRadius: 6, outline: 'none', boxSizing: 'border-box',
          ...(open ? { borderColor: '#1a56db', boxShadow: '0 0 0 2px rgba(26,86,219,.1)' } : {}),
        }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
          {displayLabel}
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0, marginLeft:6 }}>
          {/* clear button */}
          {(multiple ? selectedArr.length > 0 : value) && (
            <span onMouseDown={clearAll} style={{ color:'#9ca3af', fontSize:14, lineHeight:1, cursor:'pointer',
              padding:'0 2px', borderRadius:3 }}
              onMouseEnter={e => e.currentTarget.style.color='#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color='#9ca3af'}>×</span>
          )}
          {multiple && selectedArr.length > 0 && (
            <span style={{ background:'#1a56db', color:'#fff', borderRadius:10, fontSize:10, fontWeight:700,
              padding:'1px 6px', minWidth:18, textAlign:'center' }}>
              {selectedArr.length}
            </span>
          )}
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"
            style={{ color:'#9ca3af', transform: open ? 'rotate(180deg)' : 'none', transition:'transform .15s' }}>
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
          </svg>
        </div>
      </button>

      {/* Portal dropdown */}
      {open && rect && createPortal(
        <div ref={dropRef} style={{
          position: 'fixed', zIndex: 99999,
          top: rect.top, left: rect.left, width: rect.width,
          background: '#fff', border: '1.5px solid #1a56db', borderRadius: 8,
          boxShadow: '0 8px 28px rgba(0,0,0,.18)',
          maxHeight: 280, display: 'flex', flexDirection: 'column',
        }}>
          {/* search */}
          <div style={{ padding:'7px 7px 5px', borderBottom:'1px solid #f1f5f9', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, background:'#f8fafc',
              border:'1px solid #e2e8f0', borderRadius:5, padding:'4px 7px' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" style={{ color:'#9ca3af', flexShrink:0 }}>
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              <input ref={searchRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search..." style={{ border:'none', outline:'none', background:'transparent',
                  fontSize:12, color:'#374151', width:'100%', fontFamily:'inherit' }} />
              {search && <button type="button" onMouseDown={e => { e.preventDefault(); setSearch(''); }}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:14, padding:0 }}>×</button>}
            </div>
          </div>

          {/* options */}
          <div style={{ overflowY:'auto', flex:1 }} onWheel={e => e.stopPropagation()}>
            {filtered.length === 0
              ? <div style={{ padding:'10px 12px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>No results found</div>
              : filtered.map(opt => {
                  const active = isSelected(opt.value);
                  return (
                    <div key={opt.value}
                      onMouseDown={e => { e.preventDefault(); handleSelect(opt.value); }}
                      style={{
                        padding: '8px 10px', fontSize:13, cursor:'pointer',
                        display:'flex', alignItems:'center', gap:8,
                        background: active ? '#eff6ff' : 'transparent',
                        color:      active ? '#1a56db' : '#374151',
                        borderLeft: active ? '3px solid #1a56db' : '3px solid transparent',
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background='#f8fafc'; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background='transparent'; }}>
                      {/* checkbox for multiple mode */}
                      {multiple && (
                        <span style={{
                          width:15, height:15, borderRadius:3, flexShrink:0,
                          border: `2px solid ${active ? '#1a56db' : '#d1d5db'}`,
                          background: active ? '#1a56db' : '#fff',
                          display:'flex', alignItems:'center', justifyContent:'center',
                        }}>
                          {active && (
                            <svg viewBox="0 0 12 12" fill="none" width="9" height="9">
                              <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </span>
                      )}
                      <span style={{ fontWeight: active ? 600 : 400 }}>{opt.label}</span>
                    </div>
                  );
                })
            }
          </div>

          {/* multi footer */}
          {multiple && (
            <div style={{ padding:'6px 10px', borderTop:'1px solid #f1f5f9', display:'flex',
              justifyContent:'space-between', alignItems:'center', flexShrink:0, background:'#fafafa' }}>
              <span style={{ fontSize:11, color:'#6b7280' }}>{selectedArr.length} selected</span>
              <button type="button" onMouseDown={e => { e.preventDefault(); setOpen(false); setSearch(''); }}
                style={{ padding:'3px 12px', background:'#1a56db', color:'#fff', border:'none',
                  borderRadius:5, fontSize:12, fontWeight:600, cursor:'pointer' }}>Done</button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default SearchableSelect;
