/**
 * SearchableCheckSelect
 * Styled single-select dropdown with search field + checkbox rows + hover effect.
 * Matches the design shown in the screenshot.
 *
 * Props:
 *   options     – [{ value, label }]
 *   value       – current selected value ('' = All)
 *   onChange    – (value: string) => void
 *   allLabel    – label for the "All" option (default "All")
 *   placeholder – trigger text when nothing is selected
 *   tabIndex    – tabIndex for the trigger (default 0)
 */
import React, { useState, useRef, useEffect } from 'react';

/* ── Checkbox row item ─────────────────────────────────────── */
const OptionRow = ({ label, checked, highlighted, onClick, onMouseEnter, itemRef }) => {
  return (
    <div
      ref={itemRef}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        display:'flex', alignItems:'center', gap:8, padding:'5px 10px',
        cursor:'pointer', userSelect:'none',
        background: checked ? '#eff6ff' : highlighted ? '#f5f8ff' : 'white',
        borderBottom:'1px solid #e9ecef',
        transition:'background .1s',
      }}>
      {/* Custom checkbox */}
      <div style={{
        width:16, height:16, borderRadius:4, flexShrink:0,
        border:`2px solid ${checked ? '#1a56db' : '#d1d5db'}`,
        background: checked ? '#1a56db' : 'white',
        display:'flex', alignItems:'center', justifyContent:'center',
        transition:'border-color .12s, background .12s',
      }}>
        {checked && (
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
            <polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
      <span style={{
        fontSize:13, color: checked ? '#1e40af' : '#374151',
        fontWeight: checked ? 700 : 400,
      }}>
        {label}
      </span>
    </div>
  );
};

/* ── Main component ────────────────────────────────────────── */
const SearchableCheckSelect = ({
  options = [],
  value = '',
  onChange,
  allLabel = 'All',
  placeholder,
  tabIndex = 0,
}) => {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref      = useRef();
  const inpRef   = useRef();
  const trigRef  = useRef();
  const itemRefs = useRef([]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus search input when opened, and highlight the current selection
  useEffect(() => {
    if (open) {
      inpRef.current?.focus();
      const idx = value ? options.findIndex(o => o.value === value) + 1 : 0; // +1 for "All" row
      setActiveIndex(idx);
    }
  }, [open]);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );
  // "All" is always row 0 in the navigable list, followed by the filtered options
  const navItems = [{ value: '', label: allLabel }, ...filtered];
  itemRefs.current = [];

  const selectedLabel = value
    ? (options.find(o => o.value === value)?.label ?? value)
    : (allLabel);

  const select = (v) => {
    onChange(v);
    setOpen(false);
    setSearch('');
    setActiveIndex(-1);
    setTimeout(() => trigRef.current?.focus(), 0);
  };

  const handleTriggerKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); setOpen(p => !p);
    }
    if (e.key === 'Escape') { setOpen(false); setSearch(''); }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (navItems.length ? (i + 1) % navItems.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (navItems.length ? (i - 1 + navItems.length) % navItems.length : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && navItems[activeIndex]) select(navItems[activeIndex].value);
      else if (navItems.length > 0) select(navItems[0].value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false); setSearch('');
      setTimeout(() => trigRef.current?.focus(), 0);
    } else if (e.key === 'Tab') {
      setOpen(false); setSearch('');
    }
  };

  // keep the highlighted row scrolled into view while navigating
  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  // re-anchor the highlight to the first match whenever the search text changes
  useEffect(() => { if (open) setActiveIndex(navItems.length ? 0 : -1); }, [search]);

  return (
    <div ref={ref} style={{ position:'relative' }}>
      {/* ── Trigger ── */}
      <div
        ref={trigRef}
        tabIndex={tabIndex}
        onClick={() => setOpen(p => !p)}
        onKeyDown={handleTriggerKeyDown}
        style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'8px 12px', border:`1.5px solid ${open ? '#1a56db' : '#d1d5db'}`,
          borderRadius:8, background:'white', cursor:'pointer', fontSize:13,
          color: value ? '#1e40af' : '#374151', height:40, userSelect:'none',
          boxShadow: open ? '0 0 0 2px rgba(26,86,219,.1)' : 'none',
          transition:'border-color .12s, box-shadow .12s',
          fontWeight: value ? 600 : 400, outline:'none',
        }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
          {selectedLabel}
        </span>
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"
          style={{ flexShrink:0, marginLeft:6, color:'#9ca3af',
            transform: open ? 'rotate(180deg)' : 'none', transition:'transform .2s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </div>

      {/* ── Dropdown panel ── */}
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:600,
          background:'white', border:'1px solid #d1d5db', borderRadius:8,
          boxShadow:'0 8px 24px rgba(0,0,0,.12)', overflow:'hidden', minWidth:160,
        }}>
          {/* Search field */}
          <div style={{ padding:'8px 10px', background:'#f9fafb', borderBottom:'1px solid #f3f4f6' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, background:'white',
              border:'1px solid #e5e7eb', borderRadius:6, padding:'5px 9px' }}>
              <svg viewBox="0 0 20 20" fill="#9ca3af" width="13" height="13">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              <input
                ref={inpRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search..."
                style={{ border:'none', outline:'none', fontSize:13, flex:1,
                  background:'transparent', color:'#1f2937' }}
              />
              {search && (
                <button onClick={e=>{e.stopPropagation();setSearch('');}}
                  style={{ background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:12,padding:0,lineHeight:1 }}>
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Options list */}
          <div style={{ maxHeight:200, overflowY:'auto' }}>
            <OptionRow
              itemRef={el => itemRefs.current[0] = el}
              label={allLabel}
              checked={!value}
              highlighted={activeIndex === 0}
              onMouseEnter={() => setActiveIndex(0)}
              onClick={() => select('')}
            />
            {filtered.length === 0 && (
              <div style={{ padding:'12px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>
                No results for "{search}"
              </div>
            )}
            {filtered.map((o, i) => (
              <OptionRow
                key={o.value}
                itemRef={el => itemRefs.current[i + 1] = el}
                label={o.label}
                checked={value === o.value}
                highlighted={activeIndex === i + 1}
                onMouseEnter={() => setActiveIndex(i + 1)}
                onClick={() => select(o.value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableCheckSelect;
