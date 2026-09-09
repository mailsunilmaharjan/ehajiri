import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Avatar from './Avatar.jsx';

/* ─────────────────────────────────────────────────────────
   Multi-select employee dropdown with checkboxes — collapsed by default,
   opens a searchable checkbox list on click instead of showing every staff
   member inline all the time.
   value: string[] of employee IDs
   onChange: (string[]) => void
   employees: [{ id, fullName, position, department, branch, deviceId, profilePhoto, ... }]
   formatLabel(e): optional — custom per-employee label; defaults to
     "Name Post [deviceId]" using postMap (Name -> shortName)
   subLabel(e): optional — a secondary line rendered in small gray text
     under the name in the open list (e.g. "Staff ID - Post"), useful for
     telling apart same-named staff. Never appears in the closed trigger.
   onClearAll(): optional — when given, shows a "Clear all" button in the
     footer next to Done. Separate from the built-in × (which only clears
     THIS picker's own selection) — a caller passes this when the picker
     also drives some broader bulk action that should be resettable too.
───────────────────────────────────────────────────────── */
const EmpMultiSelect = ({ value = [], onChange, employees, postMap = {}, formatLabel, subLabel, placeholder = '— Select —', showNamesWhenMultiple = false, showAvatars = false, onClearAll }) => {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const [rect,   setRect]   = useState(null);
  const trigRef = useRef(null);
  const inpRef  = useRef(null);
  const dropRef = useRef(null);

  const selected = Array.isArray(value) ? value.map(String) : (value ? [String(value)] : []);

  const options = useMemo(() => employees.map(e => {
    let label;
    if (formatLabel) {
      label = formatLabel(e);
    } else {
      const short = postMap[e.position] || '';
      const dev   = e.deviceId ? ` [${e.deviceId}]` : '';
      label = `${e.fullName}${short ? ' '+short : ''}${dev}`;
    }
    return { id: String(e.id), label, name: e.fullName, photo: e.profilePhoto || null,
      sub: subLabel ? subLabel(e) : null };
  }), [employees, postMap, formatLabel, subLabel]);

  const filtered   = search ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())) : options;
  const selOptions = options.filter(o => selected.includes(o.id));
  const selLabels  = selOptions.map(o => o.name);

  const displayText = selLabels.length === 0 ? placeholder
    : selLabels.length === 1 ? selLabels[0]
    : showNamesWhenMultiple ? selLabels.map(n => n.split(' ')[0]).join(', ')
    : `${selLabels.length} selected`;

  const AVATAR_STACK_MAX = 4;

  const openDrop = () => {
    if (!trigRef.current) return;
    const r = trigRef.current.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) });
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (trigRef.current?.contains(e.target) || dropRef.current?.contains(e.target)) return;
      setOpen(false); setSearch('');
    };
    // Only close on scroll if the scroll target is NOT inside the dropdown itself
    const scroll = (e) => {
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false); setSearch('');
    };
    const keydown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false); setSearch('');
      }
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', scroll, true);
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', scroll, true);
      document.removeEventListener('keydown', keydown, true);
    };
  }, [open]);

  useEffect(() => { if (open) setTimeout(() => inpRef.current?.focus(), 20); }, [open]);

  const toggle = (id) => {
    const next = selected.includes(id) ? selected.filter(v => v !== id) : [...selected, id];
    onChange(next);
  };

  return (
    <div style={{ position:'relative' }}>
      <button ref={trigRef} type="button" onClick={openDrop} style={{
        width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'6px 10px', border:`1.5px solid ${open ? '#1a56db' : '#d1d5db'}`,
        borderRadius:6, background: selected.length > 0 ? '#f0f9ff' : '#fff',
        cursor:'pointer', fontSize:12, color: selected.length > 0 ? '#1f2937' : '#9ca3af',
        fontFamily:'inherit', boxShadow: open ? '0 0 0 2px rgba(26,86,219,.1)' : 'none',
        minHeight:32, transition:'border-color .12s, box-shadow .12s',
      }}>
        {showAvatars && selOptions.length > 0 ? (
          <div style={{ display:'flex', alignItems:'center', flex:1, overflow:'hidden' }}>
            {selOptions.slice(0, AVATAR_STACK_MAX).map((o, i) => (
              <span key={o.id} style={{ display:'flex', alignItems:'center', flexShrink:0,
                marginRight: i < Math.min(selOptions.length, AVATAR_STACK_MAX) - 1 ? 10 : 0 }}>
                <Avatar photo={o.photo} name={o.name} size={20} style={{ marginRight:5 }} />
                <span style={{ whiteSpace:'nowrap' }}>
                  {showNamesWhenMultiple && selOptions.length > 1 ? o.name.split(' ')[0] : o.name}
                  {i < Math.min(selOptions.length, AVATAR_STACK_MAX) - 1 ? ',' : ''}
                </span>
              </span>
            ))}
            {selOptions.length > AVATAR_STACK_MAX && (
              <span style={{ marginLeft:8, fontSize:11, color:'#6b7280', flexShrink:0 }}>
                +{selOptions.length - AVATAR_STACK_MAX} more
              </span>
            )}
          </div>
        ) : (
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, textAlign:'left' }}>
            {displayText}
          </span>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0, marginLeft:4 }}>
          {selected.length > 0 && (
            <span style={{ background:'#1a56db', color:'#fff', borderRadius:10,
              fontSize:10, fontWeight:700, padding:'1px 6px', minWidth:18, textAlign:'center' }}>
              {selected.length}
            </span>
          )}
          {selected.length > 0 && (
            <span onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange([]); }}
              style={{ color:'#9ca3af', fontSize:15, lineHeight:1, cursor:'pointer', padding:'0 2px' }}
              onMouseEnter={e => e.currentTarget.style.color='#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color='#9ca3af'}>×</span>
          )}
          <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"
            style={{ color:'#9ca3af', transform: open ? 'rotate(180deg)' : 'none', transition:'transform .15s' }}>
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
          </svg>
        </div>
      </button>

      {open && rect && createPortal(
        <div ref={dropRef} style={{
          position:'fixed', zIndex:999999,
          top:rect.top, left:rect.left, width:rect.width,
          background:'#fff', border:'1.5px solid #1a56db', borderRadius:8,
          boxShadow:'0 8px 24px rgba(0,0,0,.2)', maxHeight:260, display:'flex', flexDirection:'column',
        }}>
          {/* search */}
          <div style={{ padding:'6px 7px', borderBottom:'1px solid #f1f5f9', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, background:'#f8fafc',
              border:'1px solid #e2e8f0', borderRadius:5, padding:'4px 7px' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" style={{ color:'#9ca3af', flexShrink:0 }}>
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              <input ref={inpRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search staff..." style={{ border:'none', outline:'none', background:'transparent',
                  fontSize:12, color:'#374151', width:'100%', fontFamily:'inherit' }} />
              {search && <button type="button" onMouseDown={e => { e.preventDefault(); setSearch(''); }}
                style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:14, padding:0 }}>×</button>}
            </div>
          </div>

          {/* list */}
          <div style={{ overflowY:'auto', flex:1 }} onWheel={e => e.stopPropagation()}>
            {filtered.length === 0
              ? <div style={{ padding:'8px 10px', fontSize:11, color:'#9ca3af', textAlign:'center' }}>No results</div>
              : filtered.map((o, i) => {
                  const checked  = selected.includes(o.id);
                  const stripeBg = i % 2 === 0 ? '#fff' : '#fafafa';
                  return (
                    <div key={o.id} onMouseDown={e => { e.preventDefault(); toggle(o.id); }}
                      style={{ padding:'5px 10px', display:'flex', alignItems:'center', gap:7,
                        cursor:'pointer', fontSize:11.5, transition:'background .12s',
                        background: checked ? '#eff6ff' : stripeBg,
                        borderLeft: checked ? '3px solid #1a56db' : '3px solid transparent',
                        borderBottom:'1px solid #eef0f3' }}
                      onMouseEnter={e => { if (!checked) e.currentTarget.style.background='#f3f4f6'; }}
                      onMouseLeave={e => { if (!checked) e.currentTarget.style.background = checked ? '#eff6ff' : stripeBg; }}>
                      {/* checkbox */}
                      <span style={{
                        width:13, height:13, borderRadius:3, flexShrink:0,
                        border:`2px solid ${checked ? '#1a56db' : '#d1d5db'}`,
                        background: checked ? '#1a56db' : '#fff',
                        display:'flex', alignItems:'center', justifyContent:'center',
                      }}>
                        {checked && (
                          <svg viewBox="0 0 12 12" fill="none" width="8" height="8">
                            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </span>
                      {showAvatars && <Avatar photo={o.photo} name={o.name} size={26} style={{ flexShrink:0 }} />}
                      <span style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
                        <span style={{ color: checked ? '#1a56db' : '#1f2937', fontWeight: checked ? 600 : 400 }}>
                          {o.label}
                        </span>
                        {o.sub && (
                          <span style={{ fontSize:9.5, color:'#9ca3af', fontWeight:400 }}>
                            {o.sub}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })
            }
          </div>

          {/* footer */}
          <div style={{ padding:'6px 10px', borderTop:'1px solid #f1f5f9', display:'flex',
            justifyContent:'space-between', alignItems:'center', flexShrink:0, background:'#fafafa' }}>
            <span style={{ fontSize:11, color:'#6b7280' }}>{selected.length} selected</span>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {onClearAll && (
                <button type="button" onMouseDown={e => { e.preventDefault(); onClearAll(); }}
                  style={{ padding:'3px 10px', background:'#fff', color:'#dc2626', border:'1px solid #fca5a5',
                    borderRadius:5, fontSize:12, fontWeight:600, cursor:'pointer' }}>Clear all</button>
              )}
              <button type="button" onMouseDown={e => { e.preventDefault(); setOpen(false); setSearch(''); }}
                style={{ padding:'3px 12px', background:'#1a56db', color:'#fff', border:'none',
                  borderRadius:5, fontSize:12, fontWeight:600, cursor:'pointer' }}>Done</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default EmpMultiSelect;
