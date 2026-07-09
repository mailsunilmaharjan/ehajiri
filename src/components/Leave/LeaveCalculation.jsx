import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useAuth }     from '../../context/AuthContext.jsx';
import useDateFormat   from '../../hooks/useDateFormat.js';
import DataGrid        from '../DataGrid/DataGrid.jsx';
import SaveButton      from '../Common/SaveButton.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import { branchAbbr }  from '../../utils/branchUtils.js';

/* ─────────────────────────────────────────── */
/* localStorage helpers                         */
/* ─────────────────────────────────────────── */
const lsGet = (key, fallback) => {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
};
const lsSet = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

/* ─────────────────────────────────────────── */
/* MultiSelectDropdown                          */
/* ─────────────────────────────────────────── */
const MultiSelectDropdown = ({ options, value, onChange, placeholder = 'All', maxHeight = 220, tabIndex = 0 }) => {
  const [open,        setOpen]        = useState(false);
  const [openUp,      setOpenUp]      = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const ref  = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleToggle = () => {
    if (!open) {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setOpenUp(window.innerHeight - rect.bottom < 280);
      setLocalSearch('');
    }
    setOpen(p => !p);
  };

  const handleTriggerKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(); }
    else if (e.key === 'Escape')            { setOpen(false); }
    else if (e.key === 'Tab')               { setOpen(false); }
  };

  const isAll    = value.length === 0;
  const toggle   = (v) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  const filtered = localSearch ? options.filter(o => o.label.toLowerCase().includes(localSearch.toLowerCase())) : options;
  const display  = isAll ? null
    : value.length === 1 ? (options.find(o => o.value === value[0])?.label || value[0])
    : `${value.length} selected`;

  return (
    <div ref={ref} style={{ position:'relative', flex:1, minWidth:0 }}>
      <div
        tabIndex={tabIndex}
        role="combobox"
        aria-expanded={open}
        onClick={handleToggle}
        onKeyDown={handleTriggerKey}
        style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'6px 10px', border:`1.5px solid ${open ? '#1a56db' : '#d1d5db'}`,
          borderRadius:6, background:'white', cursor:'pointer', fontSize:13, color:'#1f2937',
          minHeight:34, boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none', transition:'border-color .15s',
          outline:'none',
        }}
      >
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
          {isAll
            ? <span style={{ color:'#9ca3af' }}>{placeholder}</span>
            : <span style={{ color:'#1e40af', fontWeight:600 }}>{display}</span>}
        </span>
        <span style={{ fontSize:9, color:'#9ca3af', marginLeft:4, flexShrink:0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          position:'absolute',
          ...(openUp
            ? { bottom:'calc(100% + 2px)', top:'auto' }
            : { top:'calc(100% + 2px)',    bottom:'auto' }),
          left:0, right:0, zIndex:9999,
          background:'white', border:'1.5px solid #d1d5db', borderRadius:6,
          boxShadow:'0 10px 28px rgba(0,0,0,.18)',
          display:'flex', flexDirection:'column',
        }}>
          {/* search box */}
          <div style={{ padding:'6px 8px', borderBottom:'2px solid #e5e7eb', flexShrink:0 }}>
            <input
              type="text" autoFocus
              placeholder="🔍 Search..."
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
              style={{
                width:'100%', padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:4,
                fontSize:12, outline:'none', background:'#f9fafb',
              }}
            />
          </div>
          {/* options list */}
          <div style={{ maxHeight, overflowY:'auto' }}>
            <label
              onClick={() => { onChange([]); setLocalSearch(''); }}
              style={{
                display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer',
                background: isAll ? '#eff6ff' : 'transparent',
                borderBottom:'2px solid #e5e7eb', userSelect:'none',
              }}
            >
              <input type="checkbox" checked={isAll} readOnly style={{ accentColor:'#1a56db' }} onClick={e => e.stopPropagation()} />
              <span style={{ fontSize:13, fontWeight:600, color: isAll ? '#1e40af' : '#374151' }}>All</span>
            </label>
            {filtered.map((opt, i) => {
              const checked = value.includes(opt.value);
              return (
                <label key={opt.value}
                  onClick={() => toggle(opt.value)}
                  style={{
                    display:'flex', alignItems:'center', gap:8, padding:'7px 12px', cursor:'pointer',
                    background: checked ? '#eff6ff' : 'transparent',
                    borderBottom: i < filtered.length - 1 ? '1.5px solid #e5e7eb' : 'none',
                    userSelect:'none',
                  }}
                >
                  <input type="checkbox" checked={checked} readOnly style={{ accentColor:'#1a56db' }} onClick={e => e.stopPropagation()} />
                  <span style={{ fontSize:13, color: checked ? '#1e40af' : '#374151', fontWeight: checked ? 600 : 400, whiteSpace:'nowrap' }}>
                    {opt.label}
                  </span>
                </label>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding:'10px 12px', textAlign:'center', color:'#9ca3af', fontSize:12 }}>No results found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* module-level shortName helper */
const shortOf = (name, list) => {
  if (!name || name === '—') return '—';
  return (list||[]).find(x => x.name === name)?.shortName || name?.slice(0, 8) || '—';
};

/* ─────────────────────────────────────────── */
/* Shared Advanced Filter Modal                 */
/* ─────────────────────────────────────────── */
const LeaveAdvancedFilter = ({
  isOpen, onClose, onApply, onReset,
  fyId, setFyId, fiscalYears,
  tempF, setTF,
  branchOpts, deptOpts, postOpts, gradeOpts, modeOpts, statusOpts, staffOpts, leaveTypeOpts,
  showFY = true, L,
}) => {
  if (!isOpen) return null;
  const funnelIcon = (
    <svg viewBox="0 0 20 20" fill="currentColor" width={16} height={16} style={{ color:'#1a56db' }}>
      <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
    </svg>
  );
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth:760, width:'96vw' }} onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="modal-header" style={{ background:'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {funnelIcon}
            <h2>{L('उन्नत फिल्टर','Advanced Filter')}</h2>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:14 }}
          onKeyDown={e => {
            if (e.key !== 'Enter') return;
            if (e.target.tagName === 'INPUT' && e.target.type === 'radio') return;
            const focusable = Array.from(e.currentTarget.querySelectorAll(
              '[tabindex="0"],[tabindex="1"],[tabindex="2"],[tabindex="3"],[tabindex="4"],[tabindex="5"],[tabindex="6"],[tabindex="7"],[tabindex="8"],[tabindex="9"],select,button'
            )).filter(el => !el.disabled && el.offsetParent !== null);
            const idx = focusable.indexOf(document.activeElement);
            if (idx >= 0 && idx < focusable.length - 1) { e.preventDefault(); focusable[idx + 1].focus(); }
          }}
        >

          {/* ── Row 1: FY (optional) | Branch | Department ── */}
          <div style={{ display:'grid', gridTemplateColumns: showFY ? '1fr 1fr 1fr' : '1fr 1fr', gap:12 }}>
            {showFY && (
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="form-label required">{L('आर्थिक वर्ष','Fiscal Year')}</label>
                <select className="form-control" style={{ fontSize:13 }} tabIndex={1} value={fyId} onChange={e => setFyId(e.target.value)}>
                  {(fiscalYears||[]).map(fy => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
                </select>
              </div>
            )}
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">{L('शाखा','Branch')}</label>
              <MultiSelectDropdown tabIndex={2} options={branchOpts} value={tempF.branches} onChange={v => setTF('branches', v)} placeholder={L('सबै','All')} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">{L('विभाग','Department')}</label>
              <MultiSelectDropdown tabIndex={3} options={deptOpts} value={tempF.departments} onChange={v => setTF('departments', v)} placeholder={L('सबै','All')} />
            </div>
          </div>

          {/* ── Row 2: Post | Grade | Mode | Status ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 }}>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">{L('पद','Post')}</label>
              <MultiSelectDropdown tabIndex={4} options={postOpts} value={tempF.posts} onChange={v => setTF('posts', v)} placeholder={L('सबै','All')} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">{L('ग्रेड','Grade')}</label>
              <MultiSelectDropdown tabIndex={5} options={gradeOpts} value={tempF.grades} onChange={v => setTF('grades', v)} placeholder={L('सबै','All')} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">{L('सेवा प्रकार','Mode')}</label>
              <MultiSelectDropdown tabIndex={6} options={modeOpts} value={tempF.modes} onChange={v => setTF('modes', v)} placeholder={L('सबै','All')} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">{L('स्थिति','Status')}</label>
              <MultiSelectDropdown tabIndex={7} options={statusOpts} value={tempF.statuses} onChange={v => setTF('statuses', v)} placeholder={L('सबै','All')} />
            </div>
          </div>

          {/* ── Row 3: Staff | Leave ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:12 }}>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">{L('कर्मचारी','Staff')}</label>
              <MultiSelectDropdown tabIndex={8} options={staffOpts} value={tempF.staffIds} onChange={v => setTF('staffIds', v)} placeholder={L('सबै कर्मचारी','All Staff')} maxHeight={210} />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">{L('बिदा','Leave')}</label>
              <MultiSelectDropdown tabIndex={9} options={leaveTypeOpts} value={tempF.leaveTypes} onChange={v => setTF('leaveTypes', v)} placeholder={L('सबै बिदा','All Leaves')} maxHeight={210} />
            </div>
          </div>

          {/* ── Leave Category (only Leave Opening) ── */}
          {showFY && (
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">{L('बिदा वर्ग','Leave Category')}</label>
              <div style={{ display:'flex', gap:20, marginTop:6, flexWrap:'wrap' }}>
                {[
                  { val:'all',           np:'सबै',           en:'All'                  },
                  { val:'accumulate',    np:'संचित बिदा',     en:'Accumulate Leave'     },
                  { val:'nonAccumulate', np:'गैर-संचित बिदा', en:'Non-Accumulate Leave' },
                ].map(opt => (
                  <label key={opt.val} style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', userSelect:'none' }}>
                    <input type="radio" name="leaveAccumFilter" checked={tempF.leaveAccum === opt.val}
                      onChange={() => setTF('leaveAccum', opt.val)}
                      style={{ accentColor:'#1a56db', width:15, height:15, cursor:'pointer' }} />
                    <span style={{ fontSize:13, fontWeight: tempF.leaveAccum===opt.val ? 700 : 400, color: tempF.leaveAccum===opt.val ? '#1e40af' : '#374151' }}>
                      {L(opt.np, opt.en)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onReset}>🔄 {L('रिसेट','Reset')}</button>
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            <button className="btn btn-outline" onClick={onClose}>{L('रद्द','Cancel')}</button>
            <button className="btn btn-primary" onClick={onApply}>✅ {L('फिल्टर लगाउनुस','Apply Filter')}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════ */
/* TAB 1 — Leave Opening                       */
/* ═══════════════════════════════════════════ */
const DEFAULT_ADV_FILTERS = {
  branches: [], departments: [], posts: [], grades: [],
  statuses: [], modes: [], staffIds: [], leaveTypes: [], leaveAccum: 'all',
};

const LeaveOpeningTab = ({ employees, settings, L, opening, setOpening }) => {
  const defaultFY = (settings.fiscalYears||[]).find(f=>f.isDefault) || (settings.fiscalYears||[])[0];
  const ltConfigs = useMemo(() => settings.leaveTypeConfigs || [], [settings.leaveTypeConfigs]);

  const [fyId,       setFyId]       = useState(defaultFY?.id || '');
  const [editVals,   setEditVals]   = useState({});
  const [headerVals, setHeaderVals] = useState({});
  const [search,     setSearch]     = useState('');
  const [toast,      setToast]      = useState(null);
  const [alertMsg,   setAlertMsg]   = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [advFilters, setAdvFilters] = useState({ ...DEFAULT_ADV_FILTERS });
  const [tempF,      setTempF]      = useState({ ...DEFAULT_ADV_FILTERS });


  /* init editVals when FY selector changes */
  useEffect(() => {
    const init = {};
    (employees||[]).filter(e=>e.active).forEach(emp => {
      ltConfigs.forEach(lt => {
        init[`${emp.id}_${lt.shortName}`] =
          opening[fyId]?.[emp.id]?.[lt.shortName] ?? lt.daysPerYear ?? 0;
      });
    });
    setEditVals(init);
    setHeaderVals({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyId]);

  const showToast = (msg, type='success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 2500);
  };

  const getVal = (empId, code) => editVals[`${empId}_${code}`] ?? 0;

  /* validate value against daysPerYear ceiling */
  const validate = (val, ltName, daysPerYear) => {
    if (val !== '' && Number(val) > daysPerYear) {
      setAlertMsg({
        title: '⚠️ Leave Limit Exceeded',
        msg:   `"${ltName}" per year is ${daysPerYear} days.\nCannot save more than this.`,
      });
      return false;
    }
    return true;
  };

  /* header input → bulk fill all employees */
  const applyHeaderVal = (lt) => {
    const val = headerVals[lt.shortName];
    if (val === '' || val === undefined) return;
    if (!validate(val, lt.name, lt.daysPerYear)) {
      setHeaderVals(p => ({ ...p, [lt.shortName]: '' }));
      return;
    }
    const n = Number(val);
    setEditVals(p => {
      const next = { ...p };
      (employees||[]).filter(e=>e.active).forEach(emp => {
        next[`${emp.id}_${lt.shortName}`] = n;
      });
      return next;
    });
    showToast(`${lt.name} → ${n} days applied to all staff`);
  };

  /* single cell change with validation */
  const handleCellChange = (empId, code, val, lt) => {
    if (val !== '' && !validate(val, lt.name, lt.daysPerYear)) {
      setEditVals(p => ({ ...p, [`${empId}_${code}`]: lt.daysPerYear }));
      return;
    }
    setEditVals(p => ({ ...p, [`${empId}_${code}`]: val === '' ? 0 : Number(val) }));
  };

  /* save all current editVals to opening state + localStorage */
  const handleSave = () => {
    const fyData = {};
    (employees||[]).filter(e=>e.active).forEach(emp => {
      fyData[emp.id] = {};
      ltConfigs.forEach(lt => { fyData[emp.id][lt.shortName] = getVal(emp.id, lt.shortName); });
    });
    const next = { ...opening, [fyId]: fyData };
    setOpening(next);
    showToast(L('बिदा प्रारम्भिक सुरक्षित भयो', 'Current Year Leave Opening saved successfully'));
  };

  /* Ctrl+S saves — this tab only exists while it's the active tab */
  useSaveShortcut(true, handleSave);

  /* reset all cells to daysPerYear default */
  const handleSetDefault = () => {
    const init = {};
    (employees||[]).filter(e=>e.active).forEach(emp => {
      ltConfigs.forEach(lt => { init[`${emp.id}_${lt.shortName}`] = lt.daysPerYear ?? 0; });
    });
    setEditVals(init);
    setHeaderVals({});
    showToast(L('डिफल्ट दिन सेट भयो', 'Default days applied'));
  };

  /* ── option lists for filter dropdowns ── */
  const branchOpts = useMemo(() => (settings.branches||[]).map(b => ({ value:b.name, label:b.name })), [settings.branches]);
  const deptOpts   = useMemo(() => (settings.departments||[]).map(d => ({ value:d.name, label:d.name })), [settings.departments]);
  const postOpts   = useMemo(() => (settings.posts||[]).map(p => ({ value:p.name, label:p.name })), [settings.posts]);
  const gradeOpts  = useMemo(() => (settings.grades||[]).map(g => ({ value:g.name, label:g.name })), [settings.grades]);
  const statusOpts = useMemo(() => (settings.employeeStatuses||[]).map(s => ({ value:s.name, label:s.name })), [settings.employeeStatuses]);
  const modeOpts   = useMemo(() => (settings.modes||[]).map(m => ({ value:m.name, label:m.name })), [settings.modes]);
  const staffOpts  = useMemo(() => (employees||[]).filter(e=>e.active).map(e => ({
    value: String(e.id),
    label: `${e.fullName} [${e.position || '—'} | ${e.deviceId || '—'}]`,
  })), [employees]);
  const leaveTypeOpts  = useMemo(() => ltConfigs.map(lt => ({ value:lt.shortName, label:`${lt.name} (${lt.shortName})` })), [ltConfigs]);

  /* ── leave type column filter ── */
  const filteredLtConfigs = useMemo(() => {
    let configs = ltConfigs;
    if (advFilters.leaveAccum === 'accumulate')    configs = configs.filter(lt => lt.carryForward);
    if (advFilters.leaveAccum === 'nonAccumulate') configs = configs.filter(lt => !lt.carryForward);
    if (advFilters.leaveTypes.length > 0)          configs = configs.filter(lt => advFilters.leaveTypes.includes(lt.shortName));
    return configs;
  }, [ltConfigs, advFilters.leaveAccum, advFilters.leaveTypes]);

  /* rows for the table */
  const rows = useMemo(() =>
    [...(employees||[])].filter(e => e.active)
      .sort((a, b) => (a.rankingOrder ?? 9999) - (b.rankingOrder ?? 9999))
      .map(emp => ({
      id:          emp.id,
      fullName:    emp.fullName,
      branch:      emp.branch      || '',
      department:  emp.department  || '',
      position:    emp.position    || '',
      grade:       emp.grade       || '',
      mode:        emp.mode        || '',
      empStatus:   emp.empStatus   || 'Active',
      postShort:   shortOf(emp.position,   settings.posts),
      deptShort:   shortOf(emp.department, settings.departments),
      branchShort: branchAbbr(emp.branch, settings),
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [employees, settings.posts, settings.departments, settings.branches]);

  const filteredRows = useMemo(() => {
    let r = rows;
    if (search) {
      const s = search.toLowerCase();
      r = r.filter(row =>
        row.fullName.toLowerCase().includes(s) ||
        row.postShort.toLowerCase().includes(s) ||
        row.deptShort.toLowerCase().includes(s) ||
        row.branchShort.toLowerCase().includes(s)
      );
    }
    if (advFilters.branches.length)    r = r.filter(row => advFilters.branches.includes(row.branch));
    if (advFilters.departments.length) r = r.filter(row => advFilters.departments.includes(row.department));
    if (advFilters.posts.length)       r = r.filter(row => advFilters.posts.includes(row.position));
    if (advFilters.grades.length)      r = r.filter(row => advFilters.grades.includes(row.grade));
    if (advFilters.modes.length)       r = r.filter(row => advFilters.modes.includes(row.mode));
    if (advFilters.statuses.length)    r = r.filter(row => advFilters.statuses.includes(row.empStatus));
    if (advFilters.staffIds.length)    r = r.filter(row => advFilters.staffIds.includes(String(row.id)));
    return r;
  }, [rows, search, advFilters]);

  /* active filter badge count */
  const activeFilterCount = useMemo(() =>
    [advFilters.branches, advFilters.departments, advFilters.posts,
     advFilters.grades,   advFilters.modes,       advFilters.statuses, advFilters.staffIds, advFilters.leaveTypes]
    .filter(a => a.length > 0).length + (advFilters.leaveAccum !== 'all' ? 1 : 0),
  [advFilters]);

  const openFilter  = useCallback(() => { setTempF({ ...advFilters }); setFilterOpen(true);  }, [advFilters]);
  const applyFilter = useCallback(() => { setAdvFilters({ ...tempF }); setFilterOpen(false); }, [tempF]);
  const resetFilter = useCallback(() => setTempF({ ...DEFAULT_ADV_FILTERS }), []);
  const setTF = useCallback((key, val) => setTempF(p => ({ ...p, [key]: val })), []);

  /* Enter key → move to next cell input (like Tab) */
  const handleEnterNav = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = Array.from(document.querySelectorAll('[data-leave-cell]'));
    const idx = inputs.indexOf(e.target);
    if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
  };

  const numInput = {
    width:56, textAlign:'center', borderRadius:4, padding:'3px 0',
    fontSize:13, outline:'none', background:'white', fontWeight:600,
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <label style={{ fontSize:13, fontWeight:600, color:'#374151', whiteSpace:'nowrap' }}>
            {L('आर्थिक वर्ष','Fiscal Year')}:
          </label>
          <select className="form-control" style={{ width:200, fontSize:13 }}
            value={fyId} onChange={e => setFyId(e.target.value)}>
            {(settings.fiscalYears||[]).map(fy => (
              <option key={fy.id} value={fy.id}>{fy.name}</option>
            ))}
          </select>
        </div>

        {/* Advanced filter button */}
        <button
          className="btn btn-outline"
          onClick={openFilter}
          style={{ position:'relative', display:'flex', alignItems:'center', gap:6, paddingRight: activeFilterCount > 0 ? 20 : undefined }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14}>
            <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
          </svg>
          {L('फिल्टर','Filter')}
          {activeFilterCount > 0 && (
            <span style={{
              position:'absolute', top:-7, right:-7,
              background:'#1a56db', color:'white', fontSize:10, fontWeight:800,
              width:17, height:17, borderRadius:'50%',
              display:'flex', alignItems:'center', justifyContent:'center',
              lineHeight:1, boxShadow:'0 1px 3px rgba(0,0,0,.25)',
            }}>
              {activeFilterCount}
            </span>
          )}
        </button>

        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          {/* Search moved here, next to Set All to Default */}
          <div className="dg-searchbox" style={{ minWidth:220 }}>
            <svg className="dg-search-icon" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
            </svg>
            <input className="dg-search-input"
              placeholder={L('नाम / विभाग खोज्नुस...','Search name / dept...')}
              value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="dg-search-clear" onClick={() => setSearch('')}>✕</button>}
          </div>
          <button className="btn btn-outline" onClick={handleSetDefault}>
            ✨ {L('सबैलाई डिफल्ट','Set All to Default')}
          </button>
          <SaveButton onClick={handleSave} label={L('सबै सुरक्षित','Save All')} />
        </div>
      </div>

      {/* DataGrid-themed editable table */}
      <div className="dg-container">

        {/* Scrollable table */}
        <div className="dg-scroll-wrapper">
          <table className="dg-table compact">
            <thead>
              <tr className="dg-header-row">
                {/* SN */}
                <th className="dg-th dg-sn-col" style={{ width:42 }}>SN</th>
                <th className="dg-th" style={{ minWidth:160 }}>{L('कर्मचारी नाम','Staff Name')}</th>
                <th className="dg-th" style={{ width:80 }}>{L('पद','Post')}</th>
                <th className="dg-th" style={{ width:80 }}>{L('विभाग','Dept')}</th>
                <th className="dg-th" style={{ width:80 }}>{L('शाखा','Branch')}</th>
                {filteredLtConfigs.map(lt => (
                  <th key={lt.shortName} className="dg-th" style={{ textAlign:'center', minWidth:96, whiteSpace:'normal' }}>
                    <div style={{ fontSize:13, color:'#374151', fontWeight:600, marginBottom:5 }}>{lt.name}</div>
                    <input
                      type="text" inputMode="numeric" pattern="[0-9.]*"
                      placeholder={String(lt.daysPerYear)}
                      value={headerVals[lt.shortName] ?? ''}
                      onChange={e => {
                        const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                        setHeaderVals(p => ({ ...p, [lt.shortName]: v }));
                      }}
                      onBlur={() => applyHeaderVal(lt)}
                      onKeyDown={e => { if (e.key === 'Enter') { applyHeaderVal(lt); e.target.blur(); } }}
                      onClick={e => { e.stopPropagation(); e.target.select(); }}
                      title={`Fill ALL staff (max ${lt.daysPerYear} days)`}
                      style={{ ...numInput, width:60, border:'1px solid #bfdbfe', background:'#eff6ff', color:'#1e40af' }}
                    />
                    <div style={{ fontSize:9, color:'#9ca3af', marginTop:2 }}>max {lt.daysPerYear}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, ri) => {
                const total = filteredLtConfigs.reduce((s, lt) => s + Number(getVal(row.id, lt.shortName)||0), 0);
                return (
                  <tr key={row.id} className="dg-row">
                    <td className="dg-sn-col">{ri + 1}</td>
                    <td className="dg-td dg-first-col" style={{ fontWeight:600 }}>{row.fullName}</td>
                    <td className="dg-td" style={{ padding:'4px 8px' }}>
                      <span style={{ background:'#eff6ff', color:'#1e40af', padding:'2px 8px', borderRadius:4, fontSize:13, fontWeight:600 }}>{row.postShort}</span>
                    </td>
                    <td className="dg-td" style={{ padding:'4px 8px' }}>
                      <span style={{ background:'#f0fdf4', color:'#166534', padding:'2px 8px', borderRadius:4, fontSize:13, fontWeight:600 }}>{row.deptShort}</span>
                    </td>
                    <td className="dg-td" style={{ padding:'4px 8px' }}>
                      <span style={{ background:'#fdf4ff', color:'#7e3af2', padding:'2px 8px', borderRadius:4, fontSize:13, fontWeight:600 }}>{row.branchShort}</span>
                    </td>
                    {filteredLtConfigs.map(lt => (
                      <td key={lt.shortName} className="dg-td" style={{ textAlign:'center', padding:'4px 6px' }}>
                        <input
                          data-leave-cell
                          type="text" inputMode="numeric" pattern="[0-9.]*"
                          value={getVal(row.id, lt.shortName)}
                          onChange={e => {
                            const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                            handleCellChange(row.id, lt.shortName, v, lt);
                          }}
                          onKeyDown={handleEnterNav}
                          onClick={e => { e.stopPropagation(); e.target.select(); }}
                          onFocus={e => e.target.select()}
                          style={{
                            ...numInput,
                            border: `1px solid ${getVal(row.id, lt.shortName) > 0 ? '#a7f3d0' : '#d1d5db'}`,
                            color:  getVal(row.id, lt.shortName) > 0 ? '#065f46' : '#6b7280',
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={filteredLtConfigs.length + 5} className="dg-empty">
                    <div className="dg-empty-content">
                      <div className="dg-empty-icon">📭</div>
                      <div className="dg-empty-text">{L('कुनै कर्मचारी फेला परेन','No active staff found')}</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="dg-footer">
          <div className="dg-info">
            {filteredRows.length === rows.length
              ? `${rows.length} ${L('कर्मचारी','staff')}`
              : `${filteredRows.length} / Total ${rows.length} ${L('कर्मचारी','staff')}`}
          </div>
        </div>
      </div>

      {/* Validation alert popup */}
      {alertMsg && (
        <div className="modal-overlay">
          <div className="modal modal-sm" style={{ maxWidth:380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#fff7ed,#fef3c7)' }}>
              <h2 style={{ color:'#92400e' }}>{alertMsg.title}</h2>
              <button className="modal-close" onClick={() => setAlertMsg(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, padding:'12px 16px', fontSize:14, color:'#9a3412', lineHeight:1.7, whiteSpace:'pre-line' }}>
                {alertMsg.msg}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setAlertMsg(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            <span>{toast.type==='success'?'✅':'ℹ️'}</span>{toast.msg}
          </div>
        </div>
      )}

      <LeaveAdvancedFilter
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        onApply={applyFilter}
        onReset={resetFilter}
        fyId={fyId} setFyId={setFyId} fiscalYears={settings.fiscalYears}
        tempF={tempF} setTF={setTF}
        branchOpts={branchOpts} deptOpts={deptOpts} postOpts={postOpts}
        gradeOpts={gradeOpts}   modeOpts={modeOpts}  statusOpts={statusOpts}
        staffOpts={staffOpts}   leaveTypeOpts={leaveTypeOpts}
        showFY={true} L={L}
      />
    </div>
  );
};

/* ═══════════════════════════════════════════ */
/* TAB 2 — Leave Transfer                      */
/* ═══════════════════════════════════════════ */
const defaultTransferForm = {
  empId:'', leaveTypeCode:'', days:'', transferType:'add', date:'', reason:'',
};

const DEFAULT_TRANSFER_FILTERS = {
  branches: [], departments: [], posts: [], grades: [],
  statuses: [], modes: [], staffIds: [], leaveTypes: [], leaveAccum: 'all',
};

const LeaveTransferTab = ({ employees, settings, leaves, L, fd, opening, setOpening }) => {
  const { canEdit } = useAuth();
  const canEditTransfer = canEdit('leaveCalculation');
  const ltConfigs  = useMemo(() => settings.leaveTypeConfigs || [], [settings.leaveTypeConfigs]);
  const defaultFY  = (settings.fiscalYears||[]).find(f => f.isDefault) || (settings.fiscalYears||[])[0];
  const [fyId,        setFyId]       = useState(defaultFY?.id || '');
  const [search,      setSearch]     = useState('');
  const [editMode,    setEditMode]   = useState(false);
  const [editVals,    setEditVals]   = useState({});
  const [toast,       setToast]      = useState(null);
  const [prevAlert,   setPrevAlert]  = useState(null); // { ltName, maxDays }
  const printTRef = useRef(null);
  const [tFilterOpen, setTFilterOpen] = useState(false);
  const [tAdvFilters, setTAdvFilters] = useState({ ...DEFAULT_TRANSFER_FILTERS });
  const [tTempF,      setTTempF]     = useState({ ...DEFAULT_TRANSFER_FILTERS });

  const showToast = (msg, type='success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  /* current & previous fiscal year */
  const sortedFYs = useMemo(() =>
    [...(settings.fiscalYears||[])].sort((a, b) => new Date(a.startDate) - new Date(b.startDate)),
  [settings.fiscalYears]);

  const currentFY = useMemo(() => (settings.fiscalYears||[]).find(f => String(f.id) === String(fyId)), [settings.fiscalYears, fyId]);
  const prevFY    = useMemo(() => {
    const idx = sortedFYs.findIndex(f => String(f.id) === String(fyId));
    return idx > 0 ? sortedFYs[idx - 1] : null;
  }, [sortedFYs, fyId]);

  /* dedicated carry-forward key for this FY — never overlaps with annual allocation */
  const prevOpeningKey = 'prev_' + fyId;

  /* filter options */
  const tBranchOpts    = useMemo(() => (settings.branches||[]).map(b => ({ value:b.name, label:b.name })), [settings.branches]);
  const tDeptOpts      = useMemo(() => (settings.departments||[]).map(d => ({ value:d.name, label:d.name })), [settings.departments]);
  const tPostOpts      = useMemo(() => (settings.posts||[]).map(p => ({ value:p.name, label:p.name })), [settings.posts]);
  const tGradeOpts     = useMemo(() => (settings.grades||[]).map(g => ({ value:g.name, label:g.name })), [settings.grades]);
  const tModeOpts      = useMemo(() => (settings.modes||[]).map(m => ({ value:m.name, label:m.name })), [settings.modes]);
  const tStatusOpts    = useMemo(() => (settings.employeeStatuses||[]).map(s => ({ value:s.name, label:s.name })), [settings.employeeStatuses]);
  const tStaffOpts     = useMemo(() => (employees||[]).filter(e=>e.active).map(e => ({
    value: String(e.id),
    label: `${e.fullName} [${e.position || '—'} | ${e.deviceId || '—'}]`,
  })), [employees]);
  const tLeaveTypeOpts = useMemo(() => ltConfigs.map(lt => ({ value:lt.shortName, label:`${lt.name} (${lt.shortName})` })), [ltConfigs]);

  const tActiveCount = useMemo(() =>
    [tAdvFilters.branches, tAdvFilters.departments, tAdvFilters.posts,
     tAdvFilters.grades, tAdvFilters.modes, tAdvFilters.statuses,
     tAdvFilters.staffIds, tAdvFilters.leaveTypes].filter(a => a.length > 0).length
    + (tAdvFilters.leaveAccum !== 'all' ? 1 : 0),
  [tAdvFilters]);

  const openTFilter  = useCallback(() => { setTTempF({ ...tAdvFilters }); setTFilterOpen(true);  }, [tAdvFilters]);
  const applyTFilter = useCallback(() => { setTAdvFilters({ ...tTempF }); setTFilterOpen(false); }, [tTempF]);
  const resetTFilter = useCallback(() => setTTempF({ ...DEFAULT_TRANSFER_FILTERS }), []);
  const setTTF = useCallback((key, val) => setTTempF(p => ({ ...p, [key]: val })), []);

  /* compute rows — Prev Year = prevFY opening, Curr Year = currentFY opening */
  const allRows = useMemo(() => {
    return [...(employees||[])].filter(e => e.active)
      .sort((a, b) => (a.rankingOrder ?? 9999) - (b.rankingOrder ?? 9999))
      .map(emp => {
      const row = {
        id:          emp.id,
        fullName:    emp.fullName,
        branch:      emp.branch      || '',
        department:  emp.department  || '',
        position:    emp.position    || '',
        grade:       emp.grade       || '',
        mode:        emp.mode        || '',
        empStatus:   emp.empStatus   || 'Active',
        postShort:   shortOf(emp.position,   settings.posts),
        deptShort:   shortOf(emp.department, settings.departments),
        branchShort: branchAbbr(emp.branch, settings),
      };
      ltConfigs.forEach(lt => {
        row[`${lt.shortName}_prev`] = Number(opening[prevOpeningKey]?.[emp.id]?.[lt.shortName] ?? 0);
        row[`${lt.shortName}_curr`] = Number(opening[fyId]?.[emp.id]?.[lt.shortName]          ?? 0);
      });
      return row;
    });
  }, [employees, ltConfigs, opening, fyId, prevOpeningKey, settings]);

  /* edit helpers */
  const startEdit = useCallback(() => {
    const vals = {};
    allRows.forEach(row => {
      ltConfigs.forEach(lt => {
        const rawPrev = row[`${lt.shortName}_prev`];
        const maxAccum = lt.carryForward && lt.maxAccumulateDays != null ? Number(lt.maxAccumulateDays) : Infinity;
        vals[`${row.id}_${lt.shortName}_prev`] = isFinite(maxAccum) ? Math.min(rawPrev, maxAccum) : rawPrev;
        vals[`${row.id}_${lt.shortName}_curr`] = row[`${lt.shortName}_curr`];
      });
    });
    setEditVals(vals);
    setEditMode(true);
  }, [allRows, ltConfigs]);

  const cancelEdit = useCallback(() => { setEditMode(false); setEditVals({}); }, []);

  const saveEdit = useCallback(() => {
    /* Prev Year = accumulate carry-forward; validate only carryForward leave types against maxAccumulateDays.
       Curr Year = annual allocation; validate against daysPerYear. */
    for (const lt of ltConfigs) {
      const maxCurr  = Number(lt.daysPerYear);
      const maxAccum = lt.carryForward && lt.maxAccumulateDays != null ? Number(lt.maxAccumulateDays) : Infinity;
      for (const row of allRows) {
        const pKey = `${row.id}_${lt.shortName}_prev`;
        const cKey = `${row.id}_${lt.shortName}_curr`;
        if (lt.carryForward && pKey in editVals && isFinite(maxAccum) && Number(editVals[pKey]) > maxAccum) {
          setPrevAlert({ ltName: lt.name, maxDays: maxAccum, kind: 'accumulate' });
          return;
        }
        if (cKey in editVals && maxCurr > 0 && Number(editVals[cKey]) > maxCurr) {
          setPrevAlert({ ltName: lt.name, maxDays: maxCurr, kind: 'perYear' });
          return;
        }
      }
    }
    const next = JSON.parse(JSON.stringify(opening));
    // save prev year values (accumulate only) → prevOpeningKey slot
    if (!next[prevOpeningKey]) next[prevOpeningKey] = {};
    allRows.forEach(row => {
      if (!next[prevOpeningKey][row.id]) next[prevOpeningKey][row.id] = {};
      ltConfigs.forEach(lt => {
        if (!lt.carryForward) return;
        const k = `${row.id}_${lt.shortName}_prev`;
        if (k in editVals) next[prevOpeningKey][row.id][lt.shortName] = Number(editVals[k]) || 0;
      });
    });
    // save curr year values → currentFY opening (syncs to Current Year Leave Opening tab)
    if (!next[fyId]) next[fyId] = {};
    allRows.forEach(row => {
      if (!next[fyId][row.id]) next[fyId][row.id] = {};
      ltConfigs.forEach(lt => {
        const k = `${row.id}_${lt.shortName}_curr`;
        if (k in editVals) next[fyId][row.id][lt.shortName] = Number(editVals[k]) || 0;
      });
    });
    setOpening(next);
    setEditMode(false);
    setEditVals({});
    showToast(L('बिदा सुरक्षित भयो', 'Saved successfully'));
  }, [opening, allRows, ltConfigs, editVals, fyId, prevOpeningKey]);

  /* company header for print/export */
  const companyHtml = `
    <div style="text-align:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #1a56db;">
      ${settings.logo ? `<img src="${settings.logo}" style="height:50px;margin-bottom:6px;display:block;margin-left:auto;margin-right:auto;" />` : ''}
      <div style="font-size:17px;font-weight:800;color:#1f2937;">${settings.companyName || settings.name || 'eHajiri TMS'}</div>
      ${settings.address ? `<div style="font-size:11px;color:#6b7280;">${settings.address}</div>` : ''}
      ${settings.phone   ? `<div style="font-size:11px;color:#6b7280;">📞 ${settings.phone}</div>`  : ''}
    </div>`;

  const handlePrint = () => {
    const content = printTRef.current?.innerHTML;
    if (!content) return;
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>Leave Transfer</title>
      <style>body{font-family:Arial,sans-serif;font-size:11px;}table{width:100%;border-collapse:collapse;}
      th,td{border:1px solid #ccc;padding:4px 7px;text-align:center;}th{background:#f0f5fa;font-weight:700;}
      .left{text-align:left;}</style></head><body>${companyHtml}${content}</body></html>`);
    w.document.close(); w.focus(); w.print(); w.close();
  };

  const handleExport = () => {
    const currentFYName = currentFY?.name || '';
    const prevFYName    = prevFY?.name    || 'Prev';
    const hdr = ['SN','Staff','Post','Dept','Branch',
      ...ltConfigs.flatMap(lt => [`${lt.name} (${prevFYName})`, `${lt.name} (${currentFYName})`])];
    const csvRows = filteredRows.map((r, i) => [
      i+1, r.fullName, r.postShort, r.deptShort, r.branchShort,
      ...ltConfigs.flatMap(lt => [r[`${lt.shortName}_prev`], r[`${lt.shortName}_curr`]]),
    ]);
    const csv = [hdr,...csvRows].map(row => row.map(v=>`"${v}"`).join(',')).join('\n');
    const a   = document.createElement('a');
    a.href    = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = `leave_transfer_${fyId}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  /* apply search + advanced filters */
  const filteredRows = useMemo(() => {
    let r = allRows;
    if (search) {
      const s = search.toLowerCase();
      r = r.filter(row =>
        row.fullName.toLowerCase().includes(s)   ||
        row.postShort.toLowerCase().includes(s)  ||
        row.deptShort.toLowerCase().includes(s)  ||
        row.branchShort.toLowerCase().includes(s)
      );
    }
    const f = tAdvFilters;
    if (f.branches.length)    r = r.filter(row => f.branches.includes(row.branch));
    if (f.departments.length) r = r.filter(row => f.departments.includes(row.department));
    if (f.posts.length)       r = r.filter(row => f.posts.includes(row.position));
    if (f.grades.length)      r = r.filter(row => f.grades.includes(row.grade));
    if (f.modes.length)       r = r.filter(row => f.modes.includes(row.mode));
    if (f.statuses.length)    r = r.filter(row => f.statuses.includes(row.empStatus));
    if (f.staffIds.length)    r = r.filter(row => f.staffIds.includes(String(row.id)));
    if (f.leaveTypes.length)  r = r; // leaveTypes filters columns, not rows — handled in display
    return r;
  }, [allRows, search, tAdvFilters]);

  /* which leave type columns to show */
  const visibleLtConfigs = useMemo(() => {
    let configs = ltConfigs;
    if (tAdvFilters.leaveAccum === 'accumulate')    configs = configs.filter(lt => lt.carryForward);
    if (tAdvFilters.leaveAccum === 'nonAccumulate') configs = configs.filter(lt => !lt.carryForward);
    if (tAdvFilters.leaveTypes.length > 0)          configs = configs.filter(lt => tAdvFilters.leaveTypes.includes(lt.shortName));
    return configs;
  }, [ltConfigs, tAdvFilters.leaveAccum, tAdvFilters.leaveTypes]);

  const numCellStyle = { width:72, textAlign:'center', border:'1px solid #d1d5db', borderRadius:4, padding:'3px 2px', fontSize:13, outline:'none', fontWeight:600 };
  const thBase = { padding:'7px 10px', textAlign:'center', fontWeight:700, fontSize:12, background:'#f0f5fa', borderBottom:'2px solid #c8d6e5', borderRight:'1px solid #dce6f0', whiteSpace:'nowrap' };
  const tdBase = { padding:'5px 8px', textAlign:'center', fontSize:13, borderBottom:'1px solid #eef0f4', borderRight:'1px solid #e8f0f8' };

  /* Enter key → move to next input (acts like Tab) */
  const handleEnterTab = useCallback((e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const all = Array.from(document.querySelectorAll('[data-transfer-input]'));
    const idx = all.indexOf(e.target);
    if (idx >= 0 && idx < all.length - 1) {
      all[idx + 1].focus();
      all[idx + 1].select();
    }
  }, []);

  return (
    <div>
      {/* ── Top toolbar ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        {/* FY */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <label style={{ fontSize:13, fontWeight:600, color:'#374151', whiteSpace:'nowrap' }}>{L('आर्थिक वर्ष','Fiscal Year')}:</label>
          <select className="form-control" style={{ width:190, fontSize:13 }} value={fyId} onChange={e => { setFyId(e.target.value); setEditMode(false); setEditVals({}); }}>
            {(settings.fiscalYears||[]).map(fy => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
          </select>
        </div>

        {/* filter */}
        <button className="btn btn-outline" onClick={openTFilter}
          style={{ position:'relative', display:'flex', alignItems:'center', gap:6 }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14}><path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/></svg>
          {L('फिल्टर','Filter')}
          {tActiveCount > 0 && <span style={{ position:'absolute', top:-7, right:-7, background:'#1a56db', color:'white', fontSize:10, fontWeight:800, width:17, height:17, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>{tActiveCount}</span>}
        </button>

        {/* edit/save/cancel */}
        {!editMode
          ? (canEditTransfer && <button className="btn btn-outline" onClick={startEdit} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14}><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
              {L('सम्पादन','Edit')}
            </button>)
          : <>
              <button className="btn btn-primary" onClick={saveEdit} style={{ display:'flex', alignItems:'center', gap:6 }}>
                <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14}><path d="M17 3H5a2 2 0 00-2 2v14l7-3 7 3V5a2 2 0 00-2-2z"/></svg>
                {L('सुरक्षित','Save')}
              </button>
              <button className="btn btn-outline" onClick={cancelEdit}>{L('रद्द','Cancel')}</button>
            </>
        }

        {/* print + export */}
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          <button className="btn btn-outline" onClick={handlePrint} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14}><path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9a1 1 0 001 1h6a1 1 0 001-1v-2H6v2zm7-6H6a1 1 0 000 2h8a1 1 0 000-2z" clipRule="evenodd"/></svg>
            {L('प्रिन्ट','Print')}
          </button>
          <button className="btn btn-outline" onClick={handleExport} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14}><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
            {L('निर्यात','Export')}
          </button>
        </div>
      </div>

      {/* ── DataGrid container ── */}
      <div className="dg-container">
        {/* search toolbar */}
        <div className="dg-toolbar">
          <div className="dg-searchbox" style={{ minWidth:220 }}>
            <svg className="dg-search-icon" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/></svg>
            <input className="dg-search-input" placeholder={L('नाम / विभाग खोज्नुस...','Search...')} value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="dg-search-clear" onClick={() => setSearch('')}>✕</button>}
          </div>
          <span style={{ fontSize:12, color:'#6b7280', marginLeft:'auto' }}>
            {filteredRows.length} / {allRows.length} {L('कर्मचारी','staff')}
          </span>
        </div>

        {/* scrollable table */}
        <div className="dg-scroll-wrapper">
          <div ref={printTRef}>
            <table className="dg-table compact" style={{ fontSize:13 }}>
              <thead>
                <tr className="dg-header-row">
                  <th className="dg-th dg-sn-col" style={{ width:40 }}>SN</th>
                  <th className="dg-th" style={{ minWidth:160, textAlign:'left' }}>{L('कर्मचारी','Staff')}</th>
                  <th className="dg-th" style={{ width:80 }}>{L('पद','Post')}</th>
                  <th className="dg-th" style={{ width:80 }}>{L('विभाग','Dept')}</th>
                  <th className="dg-th" style={{ width:80 }}>{L('शाखा','Branch')}</th>
                  {visibleLtConfigs.map(lt => (
                    <th key={lt.shortName} colSpan={2} className="dg-th"
                      style={{ background:'#eff6ff', color:'#1a56db', fontSize:13, textAlign:'center', borderBottom:'1px solid #dce6f0' }}>
                      {lt.name} <span style={{ fontSize:11, color:'#6b7280', fontWeight:400 }}>({lt.shortName})</span>
                    </th>
                  ))}
                </tr>
                <tr style={{ background:'#f8fafc' }}>
                  <th colSpan={5} className="dg-th" style={{ fontSize:13, textAlign:'left', paddingLeft:12, letterSpacing:'.3px', background:'#f8fafc' }}>
                    {prevFY ? prevFY.name : ''} {currentFY ? `→ ${currentFY.name}` : ''}
                  </th>
                  {visibleLtConfigs.map(lt => (
                    <React.Fragment key={lt.shortName}>
                      <th className="dg-th" style={{ background:'#fef3c7', color:'#92400e', fontSize:13, width:82 }}>{L('अघिल्लो वर्ष','Prev Year')}</th>
                      <th className="dg-th" style={{ background:'#d1fae5', color:'#065f46', fontSize:13, width:82 }}>{L('चालु वर्ष','Curr Year')}</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, ri) => (
                  <tr key={row.id} className="dg-row">
                    <td className="dg-sn-col">{ri + 1}</td>
                    <td className="dg-td dg-first-col" style={{ fontWeight:600 }}>{row.fullName}</td>
                    <td className="dg-td" style={{ textAlign:'center' }}>
                      <span style={{ background:'#eff6ff', color:'#1e40af', padding:'1px 7px', borderRadius:4, fontSize:13, fontWeight:600 }}>{row.postShort}</span>
                    </td>
                    <td className="dg-td" style={{ textAlign:'center' }}>
                      <span style={{ background:'#f0fdf4', color:'#166534', padding:'1px 7px', borderRadius:4, fontSize:13, fontWeight:600 }}>{row.deptShort}</span>
                    </td>
                    <td className="dg-td" style={{ textAlign:'center' }}>
                      <span style={{ background:'#fdf4ff', color:'#7e3af2', padding:'1px 7px', borderRadius:4, fontSize:13, fontWeight:600 }}>{row.branchShort}</span>
                    </td>
                    {visibleLtConfigs.map(lt => {
                      const prevKey = `${row.id}_${lt.shortName}_prev`;
                      const currKey = `${row.id}_${lt.shortName}_curr`;
                      const prevVal = editMode ? (editVals[prevKey] ?? 0) : (row[`${lt.shortName}_prev`] ?? 0);
                      const currVal = editMode ? (editVals[currKey] ?? 0) : (row[`${lt.shortName}_curr`] ?? 0);
                      return (
                        <React.Fragment key={lt.shortName}>
                          <td className="dg-td" style={{ background:'#fffbeb', textAlign:'center', padding:'4px 6px' }}>
                            {editMode
                              ? <input type="text" inputMode="numeric" pattern="[0-9.]*" value={prevVal}
                                  data-transfer-input
                                  onKeyDown={handleEnterTab}
                                  onFocus={e => e.target.select()}
                                  onChange={e => {
                                    const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                                    const maxAccum = lt.maxAccumulateDays != null ? Number(lt.maxAccumulateDays) : null;
                                    if (v !== '' && maxAccum != null && Number(v) > maxAccum) {
                                      setPrevAlert({ ltName: lt.name, maxDays: maxAccum, kind: 'accumulate' });
                                      return;
                                    }
                                    setEditVals(p => ({ ...p, [prevKey]: v }));
                                  }}
                                  style={{ ...numCellStyle, background:'#fffbeb', color:'#92400e', border:'1px solid #f59e0b' }}
                                />
                              : <span style={{ color:'#92400e', fontWeight:600 }}>{prevVal}</span>}
                          </td>
                          <td className="dg-td" style={{ background:'#f3f4f6', textAlign:'center', padding:'4px 6px' }}>
                            <span style={{ color:'#6b7280', fontWeight:600 }}>{currVal}</span>
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr><td colSpan={5 + visibleLtConfigs.length * 2} className="dg-empty">
                    <div className="dg-empty-content"><div className="dg-empty-icon">📭</div>
                    <div className="dg-empty-text">{L('कुनै कर्मचारी फेला परेन','No staff found')}</div></div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dg-footer">
          <div className="dg-info">{filteredRows.length} {L('कर्मचारी','staff')}</div>
        </div>
      </div>

      {/* validation alert popup */}
      {prevAlert && (
        <div className="modal-overlay">
          <div className="modal modal-sm" style={{ maxWidth:400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#fff7ed,#fef3c7)' }}>
              <h2 style={{ color:'#92400e' }}>⚠️ {L('बिदा सीमा उल्लङ्घन','Leave Limit Exceeded')}</h2>
              <button className="modal-close" onClick={() => setPrevAlert(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, padding:'14px 16px', fontSize:13, color:'#9a3412', lineHeight:1.8 }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:8 }}>
                  🌴 {prevAlert.ltName}
                </div>
                {prevAlert.kind === 'accumulate' ? (
                  <>
                    <div><strong>Prev Year (Max Accumulate Days):</strong> {prevAlert.maxDays} days</div>
                    <div style={{ marginTop:6, color:'#92400e' }}>
                      The Prev Year value cannot exceed the <strong>Maximum Accumulate Days</strong> set in Leave Type Settings ({prevAlert.maxDays} days).
                    </div>
                  </>
                ) : (
                  <>
                    <div><strong>Curr Year (Max Days per Year):</strong> {prevAlert.maxDays} days</div>
                    <div style={{ marginTop:6, color:'#92400e' }}>
                      The Curr Year value cannot exceed the <strong>Days per Year</strong> set in Leave Type Settings ({prevAlert.maxDays} days).
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setPrevAlert(null)}>OK, Got it</button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}><span>{toast.type==='success'?'✅':'ℹ️'}</span>{toast.msg}</div>
        </div>
      )}

      {/* filter modal */}
      <LeaveAdvancedFilter
        isOpen={tFilterOpen} onClose={() => setTFilterOpen(false)}
        onApply={applyTFilter} onReset={resetTFilter}
        fyId={fyId} setFyId={setFyId} fiscalYears={settings.fiscalYears}
        tempF={tTempF} setTF={setTTF}
        branchOpts={tBranchOpts} deptOpts={tDeptOpts}  postOpts={tPostOpts}
        gradeOpts={tGradeOpts}   modeOpts={tModeOpts}  statusOpts={tStatusOpts}
        staffOpts={tStaffOpts}   leaveTypeOpts={tLeaveTypeOpts}
        showFY={true} L={L}
      />
    </div>
  );
};

/* ═══════════════════════════════════════════ */
/* TAB 3 — Leave Balance                       */
/* ═══════════════════════════════════════════ */
const DEFAULT_BALANCE_FILTERS = {
  branches: [], departments: [], posts: [], grades: [],
  statuses: [], modes: [], staffIds: [], leaveTypes: [], leaveAccum: 'all',
};

/* ── shared pretty print-header builder ─────────────────────── */
const buildPrintHeader = (settings, reportTitle, filters = []) => {
  const co      = settings.companyName || settings.name || 'eHajiri TMS';
  const addr    = settings.address || '';
  const phone   = settings.phone   || '';
  const email   = settings.email   || '';
  const logo    = settings.logo    || '';
  const today   = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });

  const filterRows = filters.length
    ? filters.map(([k, v]) => `<td style="padding:4px 12px;font-size:11px;"><strong>${k}:</strong> ${v || 'All'}</td>`).reduce((acc, td, i) =>
        i % 3 === 0 ? [...acc, [td]] : [...acc.slice(0, -1), [...acc[acc.length-1], td]], [])
        .map(row => `<tr>${row.join('')}</tr>`).join('')
    : '';

  return `
  <div style="display:flex;align-items:flex-start;gap:18px;margin-bottom:14px;padding-bottom:14px;border-bottom:3px solid #1a56db;">
    ${logo ? `<div style="flex-shrink:0"><img src="${logo}" style="height:60px;width:auto;object-fit:contain;" /></div>` : ''}
    <div style="flex:1;text-align:center;">
      <div style="font-size:20px;font-weight:900;color:#1f2937;letter-spacing:.5px;text-transform:uppercase;">${co}</div>
      ${addr  ? `<div style="font-size:11px;color:#6b7280;margin-top:3px;">${addr}</div>` : ''}
      ${(phone||email) ? `<div style="font-size:11px;color:#6b7280;">${[phone,email].filter(Boolean).join(' | ')}</div>` : ''}
      <div style="display:inline-block;margin-top:8px;padding:4px 18px;background:#1a56db;color:white;font-size:13px;font-weight:700;border-radius:20px;letter-spacing:.5px;">${reportTitle}</div>
    </div>
    <div style="flex-shrink:0;text-align:right;font-size:10px;color:#9ca3af;white-space:nowrap;">${today}</div>
  </div>
  ${filters.length ? `<table style="width:100%;border-collapse:collapse;margin-bottom:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;">${filterRows}</table>` : ''}
  `;
};

const LeaveBalanceTab = ({ employees, leaveTypes, leaveBalances, leaves, settings, L, fd, opening, setOpening }) => {
  const ltConfigs  = useMemo(() => settings.leaveTypeConfigs || [], [settings.leaveTypeConfigs]);
  const defaultFY  = (settings.fiscalYears||[]).find(f => f.isDefault) || (settings.fiscalYears||[])[0];
  const [fyId,        setFyId]       = useState(defaultFY?.id || '');
  const [search,      setSearch]      = useState('');
  const [bFilterOpen, setBFilterOpen] = useState(false);
  const [bAdvFilters, setBAdvFilters] = useState({ ...DEFAULT_BALANCE_FILTERS });
  const [bTempF,      setBTempF]      = useState({ ...DEFAULT_BALANCE_FILTERS });
  const printRef = useRef(null);
  const [transferDone, setTransferDone] = useState(false);
  const [usedPopup,   setUsedPopup]   = useState(null); // { empId, ltShortName, ltName, empName }

  /* fiscal year helpers */
  const sortedFYs = useMemo(() => [...(settings.fiscalYears||[])].sort((a, b) => new Date(a.startDate) - new Date(b.startDate)), [settings.fiscalYears]);
  const currentFY = useMemo(() => (settings.fiscalYears||[]).find(f => String(f.id) === String(fyId)), [settings.fiscalYears, fyId]);
  const prevFY    = useMemo(() => { const idx = sortedFYs.findIndex(f => String(f.id) === String(fyId)); return idx > 0 ? sortedFYs[idx - 1] : null; }, [sortedFYs, fyId]);
  const nextFY    = useMemo(() => { const idx = sortedFYs.findIndex(f => String(f.id) === String(fyId)); return idx >= 0 && idx < sortedFYs.length - 1 ? sortedFYs[idx + 1] : null; }, [sortedFYs, fyId]);
  const prevOpeningKey = 'prev_' + fyId;

  /* filter options */
  const bBranchOpts    = useMemo(() => (settings.branches||[]).map(b => ({ value:b.name, label:b.name })), [settings.branches]);
  const bDeptOpts      = useMemo(() => (settings.departments||[]).map(d => ({ value:d.name, label:d.name })), [settings.departments]);
  const bPostOpts      = useMemo(() => (settings.posts||[]).map(p => ({ value:p.name, label:p.name })), [settings.posts]);
  const bGradeOpts     = useMemo(() => (settings.grades||[]).map(g => ({ value:g.name, label:g.name })), [settings.grades]);
  const bModeOpts      = useMemo(() => (settings.modes||[]).map(m => ({ value:m.name, label:m.name })), [settings.modes]);
  const bStatusOpts    = useMemo(() => (settings.employeeStatuses||[]).map(s => ({ value:s.name, label:s.name })), [settings.employeeStatuses]);
  const bStaffOpts     = useMemo(() => (employees||[]).filter(e=>e.active).map(e => ({
    value: String(e.id),
    label: `${e.fullName} [${e.position || '—'} | ${e.deviceId || '—'}]`,
  })), [employees]);
  const bLeaveTypeOpts = useMemo(() => ltConfigs.map(lt => ({ value:lt.shortName, label:`${lt.name} (${lt.shortName})` })), [ltConfigs]);

  const bActiveCount = useMemo(() =>
    [bAdvFilters.branches, bAdvFilters.departments, bAdvFilters.posts,
     bAdvFilters.grades, bAdvFilters.modes, bAdvFilters.statuses,
     bAdvFilters.staffIds, bAdvFilters.leaveTypes].filter(a => a.length > 0).length + (bAdvFilters.leaveAccum !== 'all' ? 1 : 0),
  [bAdvFilters]);

  const openBFilter  = useCallback(() => { setBTempF({ ...bAdvFilters }); setBFilterOpen(true);  }, [bAdvFilters]);
  const applyBFilter = useCallback(() => { setBAdvFilters({ ...bTempF }); setBFilterOpen(false); }, [bTempF]);
  const resetBFilter = useCallback(() => setBTempF({ ...DEFAULT_BALANCE_FILTERS }), []);
  const setBTF = useCallback((key, val) => setBTempF(p => ({ ...p, [key]: val })), []);

  /* visible leave type configs (apply leaveAccum + leaveTypes filters) */
  const visibleLTConfigs = useMemo(() => {
    let cfg = ltConfigs;
    if (bAdvFilters.leaveAccum === 'accumulate')    cfg = cfg.filter(lt => lt.carryForward);
    if (bAdvFilters.leaveAccum === 'nonAccumulate') cfg = cfg.filter(lt => !lt.carryForward);
    if (bAdvFilters.leaveTypes.length > 0)          cfg = cfg.filter(lt => bAdvFilters.leaveTypes.includes(lt.shortName));
    return cfg;
  }, [ltConfigs, bAdvFilters.leaveAccum, bAdvFilters.leaveTypes]);

  /* compute flat rows: one per employee × leave type */
  const allEmpRows = useMemo(() => [...(employees||[])].filter(e => e.active)
    .sort((a, b) => (a.rankingOrder ?? 9999) - (b.rankingOrder ?? 9999))
    .map(emp => ({
    id:          emp.id,
    fullName:    emp.fullName,
    branch:      emp.branch      || '',
    department:  emp.department  || '',
    position:    emp.position    || '',
    grade:       emp.grade       || '',
    mode:        emp.mode        || '',
    empStatus:   emp.empStatus   || 'Active',
    postShort:   shortOf(emp.position,   settings.posts),
    deptShort:   shortOf(emp.department, settings.departments),
    branchShort: branchAbbr(emp.branch, settings),
  })), [employees, settings]);

  /* Transfer accumulated leave balances → next year's Prev Year opening */
  const handleTransferAccLeave = useCallback(() => {
    if (!nextFY) { alert('No next fiscal year configured.'); return; }
    const accLts = ltConfigs.filter(lt => lt.carryForward);
    if (accLts.length === 0) { alert('No accumulated leave types configured.'); return; }

    /* carry-forward slot for the NEXT FY (its Prev Year row) */
    const nextPrevKey = 'prev_' + nextFY.id;

    const next = JSON.parse(JSON.stringify(opening));
    if (!next[nextPrevKey]) next[nextPrevKey] = {};

    allEmpRows.forEach(emp => {
      if (!next[nextPrevKey][emp.id]) next[nextPrevKey][emp.id] = {};
      accLts.forEach(lt => {
        const prevYear = Number(opening[prevOpeningKey]?.[emp.id]?.[lt.shortName] ?? 0);
        const currYear = Number(opening[fyId]?.[emp.id]?.[lt.shortName] ?? 0);
        const used     = (leaves||[])
          .filter(l => String(l.employeeId) === String(emp.id) && l.leaveTypeCode === lt.shortName && l.status === 'approved')
          .reduce((s, l) => s + Number(l.days), 0);
        const balance  = prevYear + currYear - used;
        /* cap at maxAccumulateDays; if not set, transfer the full balance */
        const maxAcc   = lt.maxAccumulateDays != null ? Number(lt.maxAccumulateDays) : balance;
        const transfer = Math.max(0, Math.min(balance, maxAcc));
        next[nextPrevKey][emp.id][lt.shortName] = transfer;
      });
    });

    setOpening(next);
    setTransferDone(true);
    setTimeout(() => setTransferDone(false), 3000);
  }, [opening, allEmpRows, ltConfigs, prevOpeningKey, fyId, nextFY, leaves]);

  const flatRows = useMemo(() => {
    const rows = [];
    let sn = 0;
    allEmpRows.forEach(emp => {
      visibleLTConfigs.forEach(lt => {
        const prevYear = Number(opening[prevOpeningKey]?.[emp.id]?.[lt.shortName] ?? 0);
        const currYear = Number(opening[fyId]?.[emp.id]?.[lt.shortName]        ?? 0);
        const used     = (leaves||[])
          .filter(l => String(l.employeeId) === String(emp.id) && l.leaveTypeCode === lt.shortName && l.status === 'approved')
          .reduce((s, l) => s + Number(l.days), 0);
        const total   = prevYear + currYear;
        const balance = total - used;
        if (prevYear === 0 && currYear === 0 && used === 0 && balance === 0) return;
        sn++;
        rows.push({
          sn,
          empId:       emp.id,
          fullName:    emp.fullName,
          branch:      emp.branch,
          department:  emp.department,
          position:    emp.position,
          grade:       emp.grade,
          mode:        emp.mode,
          empStatus:   emp.empStatus,
          postShort:   emp.postShort,
          deptShort:   emp.deptShort,
          branchShort: emp.branchShort,
          ltName:      lt.name,
          ltShortName: lt.shortName,
          ltType:      lt.carryForward ? L('संचित','Accumulated') : L('गैर-संचित','Non Accumulated'),
          prevYear, currYear, total, used, balance,
        });
      });
    });
    return rows;
  }, [allEmpRows, visibleLTConfigs, opening, fyId, prevOpeningKey, leaves]);

  /* apply search + row filters */
  const balanceRows = useMemo(() => {
    let r = flatRows;
    if (search) {
      const s = search.toLowerCase();
      r = r.filter(row =>
        row.fullName.toLowerCase().includes(s)   ||
        row.postShort.toLowerCase().includes(s)  ||
        row.deptShort.toLowerCase().includes(s)  ||
        row.branchShort.toLowerCase().includes(s)||
        row.ltName.toLowerCase().includes(s)
      );
    }
    const f = bAdvFilters;
    if (f.branches.length)    r = r.filter(row => f.branches.includes(row.branch));
    if (f.departments.length) r = r.filter(row => f.departments.includes(row.department));
    if (f.posts.length)       r = r.filter(row => f.posts.includes(row.position));
    if (f.grades.length)      r = r.filter(row => f.grades.includes(row.grade));
    if (f.modes.length)       r = r.filter(row => f.modes.includes(row.mode));
    if (f.statuses.length)    r = r.filter(row => f.statuses.includes(row.empStatus));
    if (f.staffIds.length)    r = r.filter(row => f.staffIds.includes(String(row.empId)));
    return r;
  }, [flatRows, search, bAdvFilters]);

  /* unique employee count */
  const uniqueEmpCount = useMemo(() => new Set(balanceRows.map(r => r.empId)).size, [balanceRows]);

  /* build filter summary for print/export */
  const filterSummary = useMemo(() => [
    ['Staff',       bAdvFilters.staffIds.length    ? `${bAdvFilters.staffIds.length} selected`    : 'All'],
    ['Fiscal Year', currentFY?.name || '—'],
    ['Leave',       bAdvFilters.leaveTypes.length  ? `${bAdvFilters.leaveTypes.length} selected`  : 'All'],
    ['Branch',      bAdvFilters.branches.length    ? bAdvFilters.branches.join(', ')              : 'All'],
    ['Department',  bAdvFilters.departments.length ? bAdvFilters.departments.join(', ')           : 'All'],
    ['Grade',       bAdvFilters.grades.length      ? bAdvFilters.grades.join(', ')                : 'All'],
    ['Post',        bAdvFilters.posts.length       ? bAdvFilters.posts.join(', ')                 : 'All'],
    ['Mode',        bAdvFilters.modes.length       ? bAdvFilters.modes.join(', ')                 : 'All'],
  ], [bAdvFilters, currentFY]);

  /* print */
  const handlePrint = () => {
    const printContent = printRef.current?.innerHTML;
    if (!printContent) return;
    const header = buildPrintHeader(settings, 'Leave Balance Report', filterSummary);
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>Leave Balance</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:11px;margin:20px;}
        table{width:100%;border-collapse:collapse;}
        th,td{border:1px solid #ccc;padding:4px 8px;text-align:center;}
        th{background:#e8f0fb;font-weight:700;font-size:10px;}
        td.left{text-align:left;}tr:nth-child(even){background:#f9fafb;}
        @media print{body{margin:8px;}button{display:none;}}
      </style></head><body>${header}${printContent}</body></html>`);
    w.document.close(); w.focus(); w.print(); w.close();
  };

  /* export CSV */
  const handleExport = () => {
    const co  = settings.companyName || settings.name || 'eHajiri TMS';
    const hdr = ['SN','Staff','Post','Dept','Branch','Leave','Leave Type','Prev.Year','Curr.Year','Total','Used','Balance'];
    const csvRows = balanceRows.map(r => [
      r.sn, r.fullName, r.postShort, r.deptShort, r.branchShort,
      r.ltName, r.ltType, r.prevYear, r.currYear, r.total, r.used, r.balance,
    ]);
    const csv = [
      [co], ['Leave Balance Report'], [`Fiscal Year: ${currentFY?.name||''}`], [],
      hdr, ...csvRows
    ].map(row => row.map(v=>`"${v}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href  = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
    a.download = `leave_balance_${fyId}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  /* cell styles */
  const thS = { padding:'7px 10px', textAlign:'center', fontWeight:700, fontSize:12, background:'#f0f5fa', borderBottom:'2px solid #c8d6e5', borderRight:'1px solid #dce6f0', whiteSpace:'nowrap' };
  const tdS = { padding:'6px 10px', textAlign:'center', fontSize:13, borderBottom:'1px solid #eef0f4', borderRight:'1px solid #e8f0f8' };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        {/* FY */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <label style={{ fontSize:13, fontWeight:600, color:'#374151', whiteSpace:'nowrap' }}>{L('आर्थिक वर्ष','Fiscal Year')}:</label>
          <select className="form-control" style={{ width:190, fontSize:13 }} value={fyId} onChange={e => setFyId(e.target.value)}>
            {(settings.fiscalYears||[]).map(fy => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
          </select>
        </div>

        {/* filter */}
        <button className="btn btn-outline" onClick={openBFilter} style={{ position:'relative', display:'flex', alignItems:'center', gap:6 }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14}><path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/></svg>
          {L('फिल्टर','Filter')}
          {bActiveCount > 0 && <span style={{ position:'absolute', top:-7, right:-7, background:'#1a56db', color:'white', fontSize:10, fontWeight:800, width:17, height:17, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 1px 3px rgba(0,0,0,.25)' }}>{bActiveCount}</span>}
        </button>

        {/* search */}
        <div className="dg-searchbox" style={{ minWidth:240 }}>
          <svg className="dg-search-icon" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/></svg>
          <input className="dg-search-input" placeholder={L('नाम / बिदा / विभाग...','Search...')} value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="dg-search-clear" onClick={() => setSearch('')}>✕</button>}
        </div>

        <span style={{ fontSize:12, color:'#6b7280' }}>{uniqueEmpCount} {L('कर्मचारी','staff')} · {balanceRows.length} {L('पङ्क्ति','rows')}</span>

        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          {/* Transfer Accumulated Leave button */}
          {nextFY && (
            <button onClick={handleTransferAccLeave}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px',
                background: transferDone ? '#059669' : 'linear-gradient(135deg,#7e3af2,#6d28d9)',
                color:'#fff', border:'none', borderRadius:6, fontSize:13, fontWeight:700,
                cursor:'pointer', boxShadow:'0 1px 4px rgba(109,40,217,.3)', whiteSpace:'nowrap' }}>
              {transferDone ? '✅ Transferred!' : `🔄 Transfer Acc. Leave → ${nextFY.name}`}
            </button>
          )}
          <button className="btn btn-outline" onClick={handlePrint} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14}><path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9a1 1 0 001 1h6a1 1 0 001-1v-2H6v2zm7-6H6a1 1 0 000 2h8a1 1 0 000-2z" clipRule="evenodd"/></svg>
            {L('प्रिन्ट','Print')}
          </button>
          <button className="btn btn-outline" onClick={handleExport} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14}><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
            {L('निर्यात','Export')}
          </button>
        </div>
      </div>

      {/* Table */}
      <div ref={printRef} style={{ overflowX:'auto', border:'1px solid #d1d5db', borderRadius:8 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr>
              <th style={{ ...thS, width:40 }}>SN</th>
              <th style={{ ...thS, textAlign:'left', minWidth:160, paddingLeft:12 }}>{L('कर्मचारी','Staff')}</th>
              <th style={{ ...thS, width:75 }}>{L('पद','Post')}</th>
              <th style={{ ...thS, width:75 }}>{L('विभाग','Dept')}</th>
              <th style={{ ...thS, width:75 }}>{L('शाखा','Branch')}</th>
              <th style={{ ...thS, width:110, background:'#f5f3ff', color:'#6d28d9' }}>{L('बिदा प्रकार','Leave Type')}</th>
              <th style={{ ...thS, minWidth:130, background:'#eff6ff', color:'#1a56db' }}>{L('बिदा','Leave')}</th>
              <th style={{ ...thS, width:90, background:'#fef3c7', color:'#92400e' }}>{L('अघिल्लो वर्ष','Prev. Year')}</th>
              <th style={{ ...thS, width:90, background:'#d1fae5', color:'#065f46' }}>{L('चालु वर्ष','Curr. Year')}</th>
              <th style={{ ...thS, width:70, background:'#f1f5f9' }}>{L('जम्मा','Total')}</th>
              <th style={{ ...thS, width:70, background:'#fff1f2', color:'#be123c' }}>{L('लिएको','Used')}</th>
              <th style={{ ...thS, width:70, background:'#f0fdf4', color:'#065f46', borderRight:'none' }}>{L('बाँकी','Balance')}</th>
            </tr>
          </thead>
          <tbody>
            {balanceRows.map((r, ri) => (
              <tr key={`${r.empId}-${r.ltName}-${ri}`} style={{ background: ri % 2 === 0 ? 'white' : '#f9fafb' }}>
                <td style={{ ...tdS, color:'#9ca3af', fontSize:13 }}>{ri + 1}</td>
                <td className="left" style={{ ...tdS, textAlign:'left', fontWeight:600, color:'#1f2937', paddingLeft:12 }}>{r.fullName}</td>
                <td style={{ ...tdS }}>
                  <span style={{ background:'#eff6ff', color:'#1e40af', padding:'1px 7px', borderRadius:4, fontSize:13, fontWeight:600 }}>{r.postShort}</span>
                </td>
                <td style={{ ...tdS }}>
                  <span style={{ background:'#f0fdf4', color:'#166534', padding:'1px 7px', borderRadius:4, fontSize:13, fontWeight:600 }}>{r.deptShort}</span>
                </td>
                <td style={{ ...tdS }}>
                  <span style={{ background:'#fdf4ff', color:'#7e3af2', padding:'1px 7px', borderRadius:4, fontSize:13, fontWeight:600 }}>{r.branchShort}</span>
                </td>
                <td style={{ ...tdS, textAlign:'center' }}>
                  <span style={{
                    fontSize:13, fontWeight:600, padding:'2px 8px', borderRadius:10,
                    background: r.ltType.includes('Non') || r.ltType.includes('गैर') ? '#f3f4f6' : '#f0fdf4',
                    color:      r.ltType.includes('Non') || r.ltType.includes('गैर') ? '#6b7280'  : '#065f46',
                    border: `1px solid ${r.ltType.includes('Non') || r.ltType.includes('गैर') ? '#e5e7eb' : '#86efac'}`,
                    whiteSpace: 'nowrap',
                  }}>
                    {r.ltType}
                  </span>
                </td>
                <td className="left" style={{ ...tdS, textAlign:'left', paddingLeft:10, fontWeight:600, color:'#1f2937', fontSize:13 }}>
                  {r.ltName}
                </td>
                <td style={{ ...tdS, background:'#fffbeb', color:'#92400e', fontWeight:600 }}>{r.prevYear}</td>
                <td style={{ ...tdS, background:'#f0fdf4', color:'#065f46', fontWeight:600 }}>{r.currYear}</td>
                <td style={{ ...tdS, fontWeight:700 }}>{r.total}</td>
                <td style={{ ...tdS, color: r.used > 0 ? '#be123c' : '#9ca3af', fontWeight: r.used > 0 ? 700 : 400 }}>
                  {r.used > 0
                    ? <button onClick={() => setUsedPopup({ empId:r.empId, ltShortName:r.ltShortName, ltName:r.ltName, empName:r.fullName })}
                        style={{ background:'none', border:'none', cursor:'pointer', color:'#be123c', fontWeight:700,
                          fontSize:13, textDecoration:'underline', padding:0 }}
                        title="Click to view used leave details">
                        {r.used}
                      </button>
                    : '—'
                  }
                </td>
                <td style={{ ...tdS, borderRight:'none' }}>
                  <span style={{ fontWeight:700, color: r.balance > 0 ? '#065f46' : r.balance < 0 ? '#be123c' : '#9ca3af' }}>{r.balance}</span>
                </td>
              </tr>
            ))}
            {balanceRows.length === 0 && (
              <tr><td colSpan={12} style={{ padding:32, textAlign:'center', color:'#9ca3af' }}>
                {L('कुनै रेकर्ड फेला परेन','No records found')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Used Leave Details Popup ── */}
      {usedPopup && (() => {
        const usedLeaves = (leaves||[]).filter(l =>
          String(l.employeeId) === String(usedPopup.empId) &&
          l.leaveTypeCode === usedPopup.ltShortName &&
          l.status === 'approved'
        );
        const totalDays = usedLeaves.reduce((s,l) => s + Number(l.days||0), 0);
        const empName = (id) =>
          id ? ((employees||[]).find(e=>String(e.id)===String(id))?.fullName || `#${id}`) : null;

        /* ── shared cell styles (like Staff Detail grid) ── */
        const thS = {
          padding:'10px 14px', fontWeight:700, fontSize:13, color:'#111827',
          background:'#f0f5fa', borderBottom:'2px solid #c8d6e5',
          borderRight:'1px solid #dce6f0', whiteSpace:'nowrap', textAlign:'left',
        };
        const tdS = {
          padding:'10px 14px', fontSize:13, color:'#374151',
          borderBottom:'1px solid #eef0f4', borderRight:'1px solid #f3f4f6',
          verticalAlign:'middle',
        };
        const dash = <span style={{ color:'#d1d5db' }}>—</span>;

        return (
          <div className="modal-overlay">
            <div onClick={e => e.stopPropagation()} style={{
              background:'white', borderRadius:14, width:'96vw', maxWidth:1060,
              maxHeight:'88vh', display:'flex', flexDirection:'column',
              boxShadow:'0 25px 60px rgba(0,0,0,.18)', overflow:'hidden',
            }}>
              {/* ── Header — clean white ── */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'16px 24px', borderBottom:'2px solid #e5e7eb',
                background:'white', flexShrink:0 }}>
                <div>
                  <div style={{ fontSize:17, fontWeight:800, color:'#111827', display:'flex', alignItems:'center', gap:8 }}>
                    📋 {L('प्रयोग भएको बिदा विवरण','Used Leave Details')}
                  </div>
                  <div style={{ fontSize:13, color:'#6b7280', marginTop:5, display:'flex', gap:14, flexWrap:'wrap', alignItems:'center' }}>
                    <span style={{ fontWeight:600, color:'#1f2937' }}>👤 {usedPopup.empName}</span>
                    <span style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8,
                      padding:'2px 10px', color:'#1e40af', fontWeight:700, fontSize:12 }}>
                      🌴 {usedPopup.ltName}
                    </span>
                    <span style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8,
                      padding:'2px 10px', color:'#065f46', fontWeight:700, fontSize:12 }}>
                      {L('जम्मा प्रयोग','Total Used')}: {totalDays} {L('दिन','day')}{totalDays !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <button onClick={() => setUsedPopup(null)}
                  style={{ background:'#f3f4f6', border:'none', borderRadius:'50%', width:36, height:36,
                    fontSize:18, cursor:'pointer', color:'#6b7280', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  ×
                </button>
              </div>

              {/* ── Table — Staff Detail style ── */}
              <div style={{ overflowX:'auto', overflowY:'auto', flex:1 }}>
                {usedLeaves.length === 0 ? (
                  <div style={{ textAlign:'center', color:'#9ca3af', padding:48, fontSize:14 }}>
                    <div style={{ fontSize:32, marginBottom:10 }}>📭</div>
                    {L('कुनै स्वीकृत बिदा फेला परेन','No approved leaves found')}
                  </div>
                ) : (
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thS, width:50, textAlign:'center' }}>SN</th>
                        <th style={{ ...thS, width:130 }}>{L('मिति देखि','From Date')}</th>
                        <th style={{ ...thS, width:130 }}>{L('मिति सम्म','To Date')}</th>
                        <th style={{ ...thS, width:70, textAlign:'center' }}>{L('दिन','Days')}</th>
                        <th style={{ ...thS, minWidth:140 }}>{L('कारण','Reason')}</th>
                        <th style={{ ...thS, width:180 }}>{L('सिफारिसकर्ता','Recommended By')}</th>
                        <th style={{ ...thS, width:130 }}>{L('सिफारिस मिति','Reco. Date')}</th>
                        <th style={{ ...thS, width:180 }}>{L('स्वीकृतकर्ता','Approved By')}</th>
                        <th style={{ ...thS, width:130, borderRight:'none' }}>{L('स्वीकृत मिति','Appr. Date')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usedLeaves.map((l, i) => {
                        const recoName = empName(l.recommendedBy);
                        const apprName = empName(l.approvedBy);
                        return (
                          <tr key={l.id} style={{ background: i%2===0 ? 'white' : '#f9fafb' }}>
                            <td style={{ ...tdS, textAlign:'center', color:'#9ca3af', width:50 }}>{i+1}</td>
                            <td style={{ ...tdS, fontWeight:600, color:'#111827' }}>{fd(l.fromDate)}</td>
                            <td style={{ ...tdS }}>{fd(l.toDate)}</td>
                            <td style={{ ...tdS, textAlign:'center' }}>
                              <span style={{ display:'inline-block', background:'#dbeafe', color:'#1e40af',
                                borderRadius:8, padding:'2px 12px', fontWeight:800, fontSize:14 }}>
                                {l.days}
                              </span>
                            </td>
                            <td style={{ ...tdS, color:'#374151' }}>{l.reason || dash}</td>
                            <td style={{ ...tdS }}>
                              {recoName
                                ? <span style={{ fontWeight:600, color:'#059669', display:'flex', alignItems:'center', gap:6 }}>
                                    <span style={{ width:24, height:24, borderRadius:'50%', background:'#d1fae5',
                                      color:'#059669', display:'inline-flex', alignItems:'center', justifyContent:'center',
                                      fontSize:11, fontWeight:800, flexShrink:0 }}>
                                      {recoName[0]}
                                    </span>
                                    {recoName}
                                  </span>
                                : dash}
                            </td>
                            <td style={{ ...tdS, color:'#6b7280', fontSize:12 }}>
                              {l.recommendedDate ? fd(l.recommendedDate) : dash}
                            </td>
                            <td style={{ ...tdS }}>
                              {apprName
                                ? <span style={{ fontWeight:600, color:'#7c3aed', display:'flex', alignItems:'center', gap:6 }}>
                                    <span style={{ width:24, height:24, borderRadius:'50%', background:'#ede9fe',
                                      color:'#7c3aed', display:'inline-flex', alignItems:'center', justifyContent:'center',
                                      fontSize:11, fontWeight:800, flexShrink:0 }}>
                                      {apprName[0]}
                                    </span>
                                    {apprName}
                                  </span>
                                : dash}
                            </td>
                            <td style={{ ...tdS, color:'#6b7280', fontSize:12, borderRight:'none' }}>
                              {l.approvedDate ? fd(l.approvedDate) : dash}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* ── Summary footer row ── */}
                    <tfoot>
                      <tr style={{ background:'#f8fafc' }}>
                        <td colSpan={3} style={{ padding:'10px 14px', fontWeight:700, fontSize:13, color:'#374151',
                          borderTop:'2px solid #c8d6e5' }}>
                          {L('जम्मा','Total')}
                        </td>
                        <td style={{ padding:'10px 14px', textAlign:'center', borderTop:'2px solid #c8d6e5' }}>
                          <span style={{ background:'#dbeafe', color:'#1e40af', borderRadius:8,
                            padding:'2px 12px', fontWeight:800, fontSize:14 }}>
                            {totalDays}
                          </span>
                        </td>
                        <td colSpan={5} style={{ borderTop:'2px solid #c8d6e5' }}></td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {/* ── Footer ── */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'12px 24px', borderTop:'1px solid #e5e7eb', background:'#f9fafb', flexShrink:0 }}>
                <div style={{ fontSize:12, color:'#6b7280' }}>
                  {usedLeaves.length} {L('रेकर्ड','record')}{usedLeaves.length !== 1 ? 's' : ''}
                </div>
                <button className="btn btn-outline" onClick={() => setUsedPopup(null)}>
                  {L('बन्द','Close')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* filter modal */}
      <LeaveAdvancedFilter
        isOpen={bFilterOpen}
        onClose={() => setBFilterOpen(false)}
        onApply={applyBFilter}
        onReset={resetBFilter}
        fyId={fyId} setFyId={setFyId} fiscalYears={settings.fiscalYears}
        tempF={bTempF} setTF={setBTF}
        branchOpts={bBranchOpts} deptOpts={bDeptOpts}   postOpts={bPostOpts}
        gradeOpts={bGradeOpts}   modeOpts={bModeOpts}   statusOpts={bStatusOpts}
        staffOpts={bStaffOpts}   leaveTypeOpts={bLeaveTypeOpts}
        showFY={true} L={L}
      />
    </div>
  );
};

/* ═══════════════════════════════════════════ */
/* TAB 4 — Leave Reports                       */
/* ═══════════════════════════════════════════ */
const LeaveReportsTab = ({ employees, leaveTypes, leaves, L, fd }) => {
  const totalLeaves   = leaves.length;
  const approved      = leaves.filter(l => l.status === 'approved').length;
  const pending       = leaves.filter(l => l.status === 'pending').length;
  const rejected      = leaves.filter(l => l.status === 'rejected').length;
  const totalDaysUsed = leaves.filter(l => l.status === 'approved').reduce((s, l) => s + Number(l.days), 0);

  const byType = useMemo(() => {
    return (leaveTypes||[]).map(lt => {
      const ltLeaves   = leaves.filter(l => l.leaveTypeCode === lt.code);
      const ltApproved = ltLeaves.filter(l => l.status === 'approved');
      return {
        code:     lt.code,
        name:     lt.nameEn || lt.name,
        color:    lt.color || '#6b7280',
        total:    ltLeaves.length,
        approved: ltApproved.length,
        days:     ltApproved.reduce((s, l) => s + Number(l.days), 0),
        pending:  ltLeaves.filter(l => l.status === 'pending').length,
      };
    }).sort((a, b) => b.days - a.days);
  }, [leaveTypes, leaves]);

  const byEmployee = useMemo(() => {
    return (employees||[]).filter(e => e.active).map(emp => {
      const empLeaves   = leaves.filter(l => String(l.employeeId) === String(emp.id));
      const empApproved = empLeaves.filter(l => l.status === 'approved');
      return {
        id: emp.id, name: emp.fullName, dept: emp.department||'—', avatar: emp.avatar,
        total: empLeaves.length,
        approved: empApproved.length,
        days: empApproved.reduce((s, l) => s + Number(l.days), 0),
        pending: empLeaves.filter(l => l.status === 'pending').length,
      };
    }).sort((a, b) => b.days - a.days);
  }, [employees, leaves]);

  const statCard = (icon, label, value, color, bg) => (
    <div style={{ background:bg, border:`1px solid ${color}33`, borderRadius:10, padding:'16px 20px', display:'flex', alignItems:'center', gap:14 }}>
      <div style={{ width:46,height:46,borderRadius:10,background:`${color}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0 }}>{icon}</div>
      <div>
        <div style={{ fontSize:24, fontWeight:800, color, lineHeight:1.1 }}>{value}</div>
        <div style={{ fontSize:12, color:'#6b7280', marginTop:2, fontWeight:500 }}>{label}</div>
      </div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:12 }}>
        {statCard('📋', L('जम्मा आवेदन','Total Applications'),    totalLeaves,            '#1a56db', '#eff6ff')}
        {statCard('✅', L('स्वीकृत','Approved'),                  approved,               '#0e9f6e', '#f0fdf4')}
        {statCard('⏳', L('विचाराधीन','Pending'),                 pending,                '#e3a008', '#fffbeb')}
        {statCard('❌', L('अस्वीकृत','Rejected'),                 rejected,               '#f05252', '#fff1f2')}
        {statCard('📅', L('जम्मा दिन','Total Days Approved'),      totalDaysUsed.toFixed(1),'#7e3af2', '#f5f3ff')}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div className="card">
          <div className="card-header"><h3>📊 {L('बिदा प्रकार अनुसार','By Leave Type')}</h3></div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#f0f5fa' }}>
                  {[L('प्रकार','Type'), L('आवेदन','Applied'), L('स्वीकृत','Approved'), L('दिन','Days'), L('विचाराधीन','Pending')].map(h => (
                    <th key={h} style={{ padding:'8px 12px', textAlign:h===L('प्रकार','Type')?'left':'center', fontSize:13, fontWeight:700, color:'#374151', borderBottom:'2px solid #c8d6e5' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byType.map((lt, i) => (
                  <tr key={lt.code} style={{ background:i%2===0?'white':'#f9fafb' }}>
                    <td style={{ padding:'8px 12px', borderBottom:'1px solid #eef0f4' }}>
                      <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ width:8,height:8,borderRadius:'50%',background:lt.color,display:'inline-block',flexShrink:0 }}></span>
                        <strong>{lt.code}</strong>
                        <span style={{ color:'#6b7280', fontSize:13 }}>{lt.name}</span>
                      </span>
                    </td>
                    <td style={{ padding:'8px 12px', textAlign:'center', borderBottom:'1px solid #eef0f4' }}>{lt.total}</td>
                    <td style={{ padding:'8px 12px', textAlign:'center', borderBottom:'1px solid #eef0f4', color:'#0e9f6e', fontWeight:600 }}>{lt.approved}</td>
                    <td style={{ padding:'8px 12px', textAlign:'center', borderBottom:'1px solid #eef0f4', color:'#1a56db', fontWeight:700 }}>{lt.days.toFixed(1)}</td>
                    <td style={{ padding:'8px 12px', textAlign:'center', borderBottom:'1px solid #eef0f4', color:'#e3a008', fontWeight:600 }}>{lt.pending||'—'}</td>
                  </tr>
                ))}
                {byType.length === 0 && <tr><td colSpan={5} style={{ padding:24, textAlign:'center', color:'#9ca3af' }}>No data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>👥 {L('कर्मचारी अनुसार','By Employee')}</h3></div>
          <div style={{ maxHeight:360, overflowY:'auto' }}>
            {byEmployee.map((emp, i) => (
              <div key={emp.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', borderBottom:'1px solid #f3f4f6', background:i%2===0?'white':'#f9fafb' }}>
                <div style={{ width:32,height:32,borderRadius:'50%',background:'#dbeafe',color:'#1a56db',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,flexShrink:0 }}>
                  {emp.avatar}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:13 }}>{emp.name}</div>
                  <div style={{ fontSize:13, color:'#6b7280' }}>{emp.dept}</div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:'#1a56db' }}>{emp.days} {L('दिन','days')}</div>
                  <div style={{ fontSize:13, color:'#6b7280' }}>{emp.approved} {L('स्वीकृत','approved')}</div>
                </div>
                {emp.pending > 0 && (
                  <span style={{ background:'#fef3c7', color:'#92400e', padding:'2px 8px', borderRadius:20, fontSize:13, fontWeight:600 }}>
                    {emp.pending} {L('विचाराधीन','pending')}
                  </span>
                )}
              </div>
            ))}
            {byEmployee.length === 0 && (
              <div style={{ padding:32, textAlign:'center', color:'#9ca3af' }}>{L('कुनै रेकर्ड छैन','No records')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════ */
/* MAIN — LeaveCalculation with 4 tabs         */
/* ═══════════════════════════════════════════ */
const TABS = [
  { key:'opening',  icon:'📂', labelNp:'बिदा प्रारम्भिक', labelEn:'Current Year Leave Opening'  },
  { key:'transfer', icon:'🔄', labelNp:'बिदा हस्तान्तरण',  labelEn:'Previous Year Opening' },
  { key:'balance',  icon:'⚖️', labelNp:'बिदा ब्यालेन्स',  labelEn:'Leave Balance'  },
  { key:'reports',  icon:'📊', labelNp:'बिदा प्रतिवेदन',  labelEn:'Leave Reports'  },
];

const LeaveCalculation = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const { filteredEmployees: employees, leaveTypes, leaveBalances, filteredLeaves: leaves } = useData();
  const { settings } = useSettings();
  const fd = useDateFormat();

  const [activeTab, setActiveTab] = useState('opening');
  const [opening,   setOpeningRaw] = useState(() => lsGet('ls_leaveOpening', {}));

  const setOpening = useCallback((next) => {
    setOpeningRaw(next);
    lsSet('ls_leaveOpening', next);
  }, []);

  const sharedProps = { employees, leaveTypes, L, fd, settings, opening, setOpening };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">🧮 {L('बिदा गणना','Leave Calculation')}</h1>
          <p className="page-subtitle">
            {L('कर्मचारीको बिदा प्रारम्भिक, हस्तान्तरण, ब्यालेन्स र प्रतिवेदन',
               'Employee leave opening, transfer, balance & reports')}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background:'white', border:'1px solid var(--border)', borderRadius:'var(--radius-md) var(--radius-md) 0 0', borderBottom:'none' }}>
        <div className="tabs" style={{ padding:'0 20px', marginBottom:0, borderBottom:'2px solid var(--border)' }}>
          {TABS.map(tab => (
            <button key={tab.key}
              className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
              style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span>{tab.icon}</span>
              {L(tab.labelNp, tab.labelEn)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ background:'white', border:'1px solid var(--border)', borderTop:'none', borderRadius:'0 0 var(--radius-md) var(--radius-md)', padding:'20px' }}>
        {activeTab === 'opening'  && <LeaveOpeningTab  {...sharedProps} />}
        {activeTab === 'transfer' && <LeaveTransferTab {...sharedProps} leaves={leaves} />}
        {activeTab === 'balance'  && <LeaveBalanceTab  {...sharedProps} leaveBalances={leaveBalances} leaves={leaves} settings={settings} />}
        {activeTab === 'reports'  && <LeaveReportsTab  {...sharedProps} leaveBalances={leaveBalances} leaves={leaves} />}
      </div>
    </div>
  );
};

export default LeaveCalculation;
