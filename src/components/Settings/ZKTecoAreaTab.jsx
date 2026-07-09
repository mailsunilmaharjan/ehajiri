/**
 * ZKTeco Area Management Tab
 * Hierarchical access control zones: Company → Branch → Sub-area
 *
 * DataGrid: Area Code | Area Name | Superior | Device Qty | Employee Qty
 * Form:     Name (combobox with search) | Superior (tree-view dropdown)
 */
import React, { useState, useEffect, useRef } from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';

/* ═════════════════════════════════════════════════════════════
   NameComboBox — searchable dropdown + free-text input combined.
   Shows suggestions filtered by what the user types; also allows
   entering any custom name not in the list.
═════════════════════════════════════════════════════════════ */
const NameComboBox = ({ suggestions = [], value, onChange, placeholder, hasError }) => {
  const [open,   setOpen]  = useState(false);
  const [query,  setQuery] = useState(value || '');
  const ref    = useRef();
  const inpRef = useRef();

  // Sync query when parent resets value (e.g. open new form)
  useEffect(() => { setQuery(value || ''); }, [value]);

  // Close on outside click
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Filter suggestions by typed query
  const filtered = query.trim()
    ? suggestions.filter(s => s.value.toLowerCase().includes(query.toLowerCase()))
    : suggestions;

  const handleInput = (e) => {
    const v = e.target.value;
    setQuery(v);
    onChange(v);
    setOpen(true);
  };

  const handleSelect = (s) => {
    setQuery(s.value);
    onChange(s.value);
    setOpen(false);
  };

  const borderColor = open ? '#1a56db' : hasError ? '#ef4444' : '#d1d5db';

  return (
    <div ref={ref} style={{ position:'relative' }}>

      {/* ── Input row with chevron ── */}
      <div style={{
        display:'flex', alignItems:'center',
        border:`1.5px solid ${borderColor}`, borderRadius:8,
        background:'white', overflow:'hidden',
        boxShadow: open ? '0 0 0 2px rgba(26,86,219,.1)' : 'none',
        transition:'border-color .15s, box-shadow .15s',
      }}>
        <input
          ref={inpRef}
          value={query}
          onChange={handleInput}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || 'Type or select…'}
          style={{ flex:1, border:'none', outline:'none', padding:'9px 12px',
            fontSize:13, color:'#1f2937', background:'transparent' }}
        />
        {/* Clear */}
        {query && (
          <button type="button"
            onMouseDown={e => { e.preventDefault(); setQuery(''); onChange(''); inpRef.current?.focus(); }}
            style={{ padding:'0 6px', background:'none', border:'none',
              cursor:'pointer', color:'#9ca3af', fontSize:14, lineHeight:1 }}>
            ✕
          </button>
        )}
        {/* Chevron */}
        <button type="button"
          onMouseDown={e => { e.preventDefault(); setOpen(p=>!p); inpRef.current?.focus(); }}
          style={{ padding:'0 10px', background:'none', border:'none',
            cursor:'pointer', color:'#9ca3af', display:'flex', alignItems:'center' }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"
            style={{ transform:open?'rotate(180deg)':'none', transition:'transform .2s' }}>
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
          </svg>
        </button>
      </div>

      {/* ── Dropdown panel ── */}
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:500,
          background:'white', border:'1px solid #d1d5db', borderRadius:8,
          boxShadow:'0 8px 28px rgba(0,0,0,.13)', overflow:'hidden',
        }}>
          {/* Hint header */}
          <div style={{ padding:'7px 12px', background:'#f9fafb',
            borderBottom:'1px solid #f3f4f6', fontSize:11, color:'#9ca3af', fontWeight:600 }}>
            {query.trim()
              ? <>Showing matches for <strong style={{ color:'#374151' }}>"{query}"</strong></>
              : 'Select from Company / Branch or type a custom name'}
          </div>

          <div style={{ maxHeight:220, overflowY:'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding:'10px 14px', fontSize:12, color:'#9ca3af', fontStyle:'italic' }}>
                No suggestions match — <strong style={{ color:'#374151' }}>"{query}"</strong> will be used as the area name
              </div>
            )}

            {filtered.map((s, i) => {
              const active = s.value === value;
              return (
                <div key={s.value}
                  onMouseDown={e => { e.preventDefault(); handleSelect(s); }}
                  style={{
                    display:'flex', alignItems:'center', gap:10, padding:'9px 14px',
                    cursor:'pointer',
                    background: active ? '#eff6ff' : 'transparent',
                    borderBottom: i < filtered.length-1 ? '1px solid #f9fafb' : 'none',
                    transition:'background .1s',
                  }}
                  onMouseEnter={e => { if(!active) e.currentTarget.style.background='#f5f8ff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = active?'#eff6ff':'transparent'; }}>

                  {/* Checkbox */}
                  <div style={{
                    width:16, height:16, borderRadius:4, flexShrink:0,
                    border:`2px solid ${active?'#1a56db':'#d1d5db'}`,
                    background: active?'#1a56db':'white',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    transition:'all .12s',
                  }}>
                    {active && (
                      <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
                        <polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>

                  <span style={{ fontSize:18, flexShrink:0 }}>{s.icon || '📍'}</span>

                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:active?700:s.bold?600:400,
                      color:active?'#1e40af':'#1f2937', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {s.value}
                    </div>
                    {s.sub && (
                      <div style={{ fontSize:11, color:'#9ca3af' }}>{s.sub}</div>
                    )}
                  </div>

                  {s.badge && (
                    <span style={{ flexShrink:0, fontSize:10, fontWeight:700,
                      padding:'1px 6px', borderRadius:4, background:'#eff6ff', color:'#1a56db' }}>
                      {s.badge}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════
   TreeSelect — tree-view Superior dropdown (same search style)
═════════════════════════════════════════════════════════════ */
const TreeSelect = ({ areas, value, onChange, excludeId, placeholder }) => {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const ref     = useRef();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSearch(''); }};
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const flat     = areas.filter(a => a.id !== excludeId);
  const filtered = search
    ? flat.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    : flat;

  const selected    = flat.find(a => a.id === parseInt(value));
  const displayText = value && selected ? selected.name : (placeholder || 'None — Root Level');

  return (
    <div ref={ref} style={{ position:'relative' }}>

      {/* Trigger */}
      <div onClick={() => setOpen(p=>!p)}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'8px 12px', border:`1.5px solid ${open?'#1a56db':'#d1d5db'}`,
          borderRadius:8, background:'white', cursor:'pointer', fontSize:13,
          color: value?'#1e40af':'#6b7280', fontWeight:value?600:400, height:40,
          boxShadow:open?'0 0 0 2px rgba(26,86,219,.1)':'none' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, flex:1, overflow:'hidden' }}>
          {value && selected ? (
            <>
              <span>{selected.depth===0?'🏢':selected.parent_id?'📍':'🏪'}</span>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selected.name}</span>
            </>
          ) : (
            <span>🏠 {placeholder || 'None — Root Level'}</span>
          )}
        </div>
        <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"
          style={{ flexShrink:0, color:'#9ca3af', transform:open?'rotate(180deg)':'none', transition:'transform .2s', marginLeft:6 }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:400,
          background:'white', border:'1px solid #d1d5db', borderRadius:8,
          boxShadow:'0 8px 24px rgba(0,0,0,.12)', overflow:'hidden' }}>

          {/* Search */}
          <div style={{ padding:'7px 10px', background:'#f9fafb', borderBottom:'1px solid #f3f4f6' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, background:'white',
              border:'1px solid #e5e7eb', borderRadius:6, padding:'4px 8px' }}>
              <svg viewBox="0 0 20 20" fill="#9ca3af" width="13" height="13">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              <input autoFocus value={search} onChange={e=>setSearch(e.target.value)}
                onClick={e=>e.stopPropagation()} placeholder="Search areas..."
                style={{ border:'none', outline:'none', fontSize:12, flex:1, background:'transparent' }} />
            </div>
          </div>

          {/* None (root) */}
          <div onClick={()=>{ onChange(''); setOpen(false); setSearch(''); }}
            style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
              cursor:'pointer', background:!value?'#eff6ff':'white',
              borderBottom:'1px solid #f3f4f6', fontSize:13,
              color:!value?'#1e40af':'#6b7280', fontStyle:'italic' }}>
            <div style={{ width:16,height:16,borderRadius:4,border:`2px solid ${!value?'#1a56db':'#d1d5db'}`,
              background:!value?'#1a56db':'white',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
              {!value && <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
                <polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <span style={{ fontSize:14 }}>🏠</span> None — Root Level
          </div>

          {/* Area options */}
          <div style={{ maxHeight:220, overflowY:'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding:'10px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>
                No areas match "{search}"
              </div>
            )}
            {filtered.map(a => {
              const isSelected = parseInt(value) === a.id;
              return (
                <div key={a.id}
                  onClick={()=>{ onChange(String(a.id)); setOpen(false); setSearch(''); }}
                  style={{ display:'flex', alignItems:'center', padding:'7px 12px', cursor:'pointer',
                    background:isSelected?'#eff6ff':'transparent',
                    borderBottom:'1px solid #f9fafb', transition:'background .1s' }}
                  onMouseEnter={e=>{ if(!isSelected) e.currentTarget.style.background='#f5f8ff'; }}
                  onMouseLeave={e=>{ if(!isSelected) e.currentTarget.style.background='transparent'; }}>
                  <div style={{ width:16,height:16,borderRadius:4,flexShrink:0,marginRight:8,
                    border:`2px solid ${isSelected?'#1a56db':'#d1d5db'}`,
                    background:isSelected?'#1a56db':'white',display:'flex',alignItems:'center',justifyContent:'center' }}>
                    {isSelected && <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
                      <polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  {a.depth > 0 && (
                    <span style={{ color:'#d1d5db', fontFamily:'monospace', fontSize:12, marginRight:2 }}>
                      {'│  '.repeat(a.depth - 1)}{'└─'}
                    </span>
                  )}
                  <span style={{ fontSize:14, marginRight:6 }}>
                    {a.depth===0?'🏢':a.parent_id?'📍':'🏪'}
                  </span>
                  <span style={{ fontSize:13, fontWeight:isSelected?700:400, color:isSelected?'#1e40af':'#374151' }}>
                    {a.name}
                  </span>
                  <span style={{ fontSize:10, color:'#9ca3af', marginLeft:6 }}>[{a.code}]</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════
   Area Tab Main Component
═════════════════════════════════════════════════════════════ */
const ZKTecoAreaTab = ({ areas, loading, onRefresh, L, language, showToast }) => {
  const { settings } = useSettings();

  const [modal,      setModal]      = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [form,       setForm]       = useState({ name:'', parentId:'', description:'' });
  const [errors,     setErrors]     = useState({});
  const [delConfirm, setDelConfirm] = useState(null);
  const [seeding,    setSeeding]    = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  /* Build suggestions: Company name + branches */
  const companyName = settings.companyName || settings.company_name || 'Company';
  const branches    = settings.branches || [];

  const nameSuggestions = [
    { value: companyName,     icon:'🏢', badge:'Company', bold:true, sub:'Root level — top of hierarchy' },
    ...branches.map(b => ({
      value: b.name,
      icon : '🏪',
      badge: 'Branch',
      sub  : b.address || b.shortName || '',
    })),
  ];

  const openAdd = () => {
    setForm({ name:'', parentId:'', description:'' });
    setErrors({}); setEditId(null); setModal(true);
  };
  const openEdit = (area) => {
    setForm({
      name: area.name || '',
      parentId: area.parent_id ? String(area.parent_id) : '',
      description: area.description || '',
    });
    setErrors({}); setEditId(area.id); setModal(true);
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Area name is required';
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    try {
      const body = {
        name       : form.name.trim(),
        parentId   : form.parentId ? parseInt(form.parentId) : null,
        description: form.description || null,
      };
      if (editId) await api.put(`/zkteco/areas/${editId}`, body);
      else        await api.post('/zkteco/areas', body);
      showToast(editId ? 'Area updated' : 'Area created');
      setModal(false);
      onRefresh();
    } catch (err) { showToast(err.message, 'danger'); }
  };

  /* Ctrl+S saves the Area modal — same action as the Save button */
  useSaveShortcut(modal, handleSave);

  const handleDelete = async (id) => {
    if (areas.some(a => a.parent_id === id)) {
      showToast('Cannot delete — this area has sub-areas. Delete children first.', 'danger');
      setDelConfirm(null);
      return;
    }
    try {
      await api.delete(`/zkteco/areas/${id}`);
      showToast('Area deleted');
      setDelConfirm(null);
      onRefresh();
    } catch (err) { showToast(err.message, 'danger'); }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const r = await api.post('/zkteco/areas/seed', {});
      showToast(`Initialized ${r.created} areas from "${r.company}" + ${r.branches.length} branches`);
      onRefresh();
    } catch (err) { showToast(err.message, 'danger'); }
    finally { setSeeding(false); }
  };

  /* DataGrid columns */
  const columns = [
    { field:'code', header:'Area Code', width:120,
      render: v => <span style={{ fontFamily:'monospace', fontSize:12, fontWeight:700, color:'#1a56db' }}>{v}</span>,
    },
    { field:'name', header:'Area Name',
      render: (v, row) => (
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {row.depth > 0 && (
            <span style={{ color:'#d1d5db', fontFamily:'monospace', fontSize:11 }}>
              {'  '.repeat(row.depth-1)}└─
            </span>
          )}
          <span style={{ fontSize: row.depth===0?17:15 }}>
            {row.depth===0?'🏢':row.parent_id?'📍':'🏪'}
          </span>
          <span style={{ fontWeight:row.depth===0?700:600, color:'#1f2937', fontSize:13 }}>{v}</span>
          {row.depth===0 && <span style={{ fontSize:10, color:'#9ca3af', fontStyle:'italic' }}>Root</span>}
        </div>
      ),
    },
    { field:'parent_name', header:'Superior', width:160,
      render: (v, row) => row.parent_id
        ? <span style={{ fontSize:12, color:'#6b7280' }}>↳ {v}</span>
        : <span style={{ color:'#d1d5db', fontSize:11 }}>—</span>,
    },
    { field:'device_qty', header:'Device Qty', width:100, align:'center',
      render: v => v > 0
        ? <span style={{ fontWeight:700, color:'#1a56db', fontSize:13 }}>{v}</span>
        : <span style={{ color:'#d1d5db' }}>0</span>,
    },
    { field:'employee_qty', header:'Employee Qty', width:115, align:'center',
      render: v => v > 0
        ? <span style={{ fontWeight:700, color:'#059669', fontSize:13 }}>{v}</span>
        : <span style={{ color:'#d1d5db' }}>0</span>,
    },
    { field:'actions', header:'Actions', width:75, sortable:false, filterable:false,
      render: (_, row) => (
        <div style={{ display:'flex', gap:4 }}>
          <button className="dg-action-btn edit" title="Edit"
            onClick={e=>{ e.stopPropagation(); openEdit(row); }}>✏</button>
          <button className="dg-action-btn delete" title="Delete"
            onClick={e=>{ e.stopPropagation(); setDelConfirm(row.id); }}>🗑</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Empty state */}
      {!loading && areas.length === 0 && (
        <div style={{ textAlign:'center', padding:'40px 20px', marginBottom:16 }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🗺️</div>
          <div style={{ fontWeight:700, fontSize:15, color:'#374151', marginBottom:6 }}>
            No areas configured yet
          </div>
          <div style={{ fontSize:13, color:'#9ca3af', maxWidth:400, margin:'0 auto 16px' }}>
            Click "Initialize" to auto-create areas from your Company and Branch names, or add manually.
          </div>
          <button onClick={handleSeed} disabled={seeding}
            style={{ background:'#1a56db', color:'white', border:'none', borderRadius:8,
              padding:'10px 22px', fontSize:14, fontWeight:700, cursor:'pointer',
              display:'inline-flex', alignItems:'center', gap:8 }}>
            {seeding?'⏳':'🌱'} Initialize from Company & Branches
          </button>
        </div>
      )}

      <DataGrid
        columns={columns}
        data={areas}
        defaultPageSize={20}
        showSearch
        compact={false}
        loading={loading}
        showCheckbox={false}
        onRowDoubleClick={openEdit}
        toolbar={
          <div style={{ display:'flex', gap:8 }}>
            {areas.length > 0 && (
              <button onClick={handleSeed} disabled={seeding}
                style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 12px',
                  background:'#f0fdf4', border:'1px solid #86efac', color:'#15803d',
                  borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>
                {seeding?'⏳':'🌱'} Sync from Company/Branches
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Area</button>
          </div>
        }
      />

      {/* ══ Add / Edit Modal ══ */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:500 }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
              <h2>{editId ? '✏️ Edit Area' : '+ Add Area'}</h2>
              <button className="modal-close" onClick={()=>setModal(false)}>✕</button>
            </div>
            <div className="modal-body">

              {/* ── Area Name — custom combobox with search ── */}
              <div className="form-group" style={{ marginBottom:16 }}>
                <label className="form-label" style={{ fontWeight:700, fontSize:13 }}>
                  Area Name <span style={{ color:'#ef4444' }}>*</span>
                </label>
                <NameComboBox
                  suggestions={nameSuggestions}
                  value={form.name}
                  onChange={v => set('name', v)}
                  placeholder="Type or select Company / Branch…"
                  hasError={!!errors.name}
                />
                {errors.name && (
                  <div className="form-error" style={{ marginTop:4 }}>{errors.name}</div>
                )}
                <div style={{ fontSize:11, color:'#9ca3af', marginTop:5 }}>
                  💡 Select from suggestions or type any custom area name
                </div>
              </div>

              {/* ── Superior — tree-view dropdown ── */}
              <div className="form-group" style={{ marginBottom:16 }}>
                <label className="form-label" style={{ fontWeight:700, fontSize:13 }}>
                  Superior{' '}
                  <span style={{ fontSize:11, color:'#6b7280', fontWeight:400 }}>
                    (Parent area — defines tree position)
                  </span>
                </label>
                <TreeSelect
                  areas={areas}
                  value={form.parentId}
                  onChange={v => set('parentId', v)}
                  excludeId={editId}
                  placeholder="None — Root Level"
                />
                {/* Preview breadcrumb */}
                {form.name && (
                  <div style={{ marginTop:7, fontSize:12, color:'#6b7280',
                    display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                    <span style={{ color:'#9ca3af' }}>Path:</span>
                    {form.parentId && (
                      <>
                        <span style={{ color:'#1a56db', fontWeight:600 }}>
                          {areas.find(a=>a.id===parseInt(form.parentId))?.breadcrumb ||
                           areas.find(a=>a.id===parseInt(form.parentId))?.name}
                        </span>
                        <span style={{ color:'#9ca3af' }}>›</span>
                      </>
                    )}
                    <span style={{ fontWeight:700, color:'#1f2937' }}>{form.name}</span>
                  </div>
                )}
              </div>

              {/* ── Description ── */}
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="form-label" style={{ fontSize:13 }}>
                  Description{' '}
                  <span style={{ fontSize:11, color:'#9ca3af', fontWeight:400 }}>(optional)</span>
                </label>
                <input className="form-control"
                  placeholder="e.g. Main building entrance with K40 Pro reader"
                  value={form.description}
                  onChange={e=>set('description', e.target.value)} />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setModal(false)}>Cancel</button>
              <SaveButton onClick={handleSave} />
            </div>
          </div>
        </div>
      )}

      {/* ══ Delete Confirm ══ */}
      {delConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚠️ Delete Area</h2>
              <button className="modal-close" onClick={()=>setDelConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this area?</p>
              {areas.some(a=>a.parent_id===delConfirm) && (
                <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,
                  padding:'8px 12px',fontSize:12,color:'#991b1b',marginTop:8 }}>
                  ⚠️ This area has sub-areas. Delete the children first.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setDelConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={()=>handleDelete(delConfirm)}>🗑 Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ZKTecoAreaTab;
