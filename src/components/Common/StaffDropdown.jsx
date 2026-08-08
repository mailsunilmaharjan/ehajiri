import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';

/* ── Searchable Staff Dropdown ───────────────────────────────── */
const StaffDropdown = ({ employees, value, onChange, autoOpen = false }) => {
  const [open,   setOpen]   = useState(autoOpen);
  const [search, setSearch] = useState('');
  const [rect,   setRect]   = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref     = useRef();  // trigger
  const dropRef = useRef();  // portalled panel
  const inpRef  = useRef();
  const itemRefs = useRef([]);

  // Portalled to document.body so it isn't clipped by an ancestor's
  // overflow:hidden (e.g. a modal card). Recomputes whenever open flips
  // true — including autoOpen's initial mount, not just an explicit click.
  useEffect(() => {
    if (!open) { setRect(null); return; }
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    const close = (e) => {
      if (ref.current?.contains(e.target) || dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const scroll = (e) => {
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', scroll, true); };
  }, [open]);

  useEffect(() => { if (open && inpRef.current) setTimeout(() => inpRef.current?.focus(), 20); }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return employees.filter(e =>
      !q || e.fullName?.toLowerCase().includes(q) ||
      e.department?.toLowerCase().includes(q) ||
      e.deviceId?.toLowerCase().includes(q) ||
      e.employeeId?.toLowerCase().includes(q)
    );
  }, [employees, search]);
  itemRefs.current = [];

  const selected = employees.find(e => e.id === value);

  const select = (emp) => { onChange(emp.id); setOpen(false); setSearch(''); setActiveIndex(-1); };
  const openWithHighlight = () => {
    const idx = filtered.findIndex(e => e.id === value);
    setActiveIndex(idx >= 0 ? idx : (filtered.length ? 0 : -1));
    setOpen(true);
  };
  const toggleOpen = () => { open ? setOpen(false) : openWithHighlight(); };
  const handleTriggerKeyDown = e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      toggleOpen();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };
  const handleSearchKeyDown = e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (filtered.length ? (i + 1) % filtered.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (filtered.length ? (i - 1 + filtered.length) % filtered.length : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) select(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };
  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);
  useEffect(() => { if (open) setActiveIndex(filtered.length ? 0 : -1); }, [search]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        tabIndex={0}
        onClick={toggleOpen}
        onKeyDown={handleTriggerKeyDown}
        style={{ height: 36, border: `1.5px solid ${open ? '#1a56db' : '#d1d5db'}`, borderRadius: 7,
          padding: '0 10px', display: 'flex', alignItems: 'center', cursor: 'pointer',
          background: 'white', fontSize: 13, color: selected ? '#1f2937' : '#9ca3af',
          userSelect: 'none', outline: 'none',
          boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none' }}>
        <span style={{ flex: 1 }}>
          {selected
            ? `${selected.fullName} — ${selected.department || '—'} — ${selected.deviceId || selected.employeeId || '—'}`
            : 'Search and select staff…'}
        </span>
        <svg viewBox="0 0 20 20" fill="#9ca3af" width="14" height="14"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </div>
      {open && rect && createPortal(
        <div ref={dropRef} style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width, zIndex: 999999,
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden' }}>
          <div style={{ padding: '8px' }}>
            <input ref={inpRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, department, attendance ID…"
              onKeyDown={handleSearchKeyDown}
              style={{ width: '100%', height: 32, border: '1px solid #d1d5db', borderRadius: 6,
                padding: '0 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0
              ? <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>No staff found</div>
              : filtered.map((emp, i) => (
                <div key={emp.id} ref={el => itemRefs.current[i] = el}
                  onClick={() => select(emp)}
                  onMouseEnter={() => setActiveIndex(i)}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                    background: emp.id === value ? '#eff6ff' : (i === activeIndex ? '#f9fafb' : 'white'),
                    color: emp.id === value ? '#1e40af' : '#374151',
                    borderTop: '1px solid #f3f4f6' }}>
                  <span style={{ fontWeight: 600 }}>{emp.fullName}</span>
                  <span style={{ color: '#6b7280', marginLeft: 6 }}>
                    {emp.department || '—'} · {emp.deviceId || emp.employeeId || '—'}
                  </span>
                </div>
              ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default StaffDropdown;
