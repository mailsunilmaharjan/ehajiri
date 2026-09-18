/**
 * ZKTeco Access Control Tab
 * Sub-tabs:  Time Zones | Access Levels | By Level | By Person | By Department
 *
 * Time Zone grid matches ZKBio CVAccess layout:
 *   Rows = days (Mon-Sun + 3 Holiday types)
 *   Cols = 3 intervals × (Start, End)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import KeyboardMultiSelect from '../Common/KeyboardMultiSelect.jsx';
import EnglishDatePicker from '../Common/EnglishDatePicker.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import { staffRankCompare } from '../../utils/branchUtils.js';

/* ── Constants ──────────────────────────────────────────────── */
const DAYS = [
  { key:'Mon', label:'Monday' },
  { key:'Tue', label:'Tuesday' },
  { key:'Wed', label:'Wednesday' },
  { key:'Thu', label:'Thursday' },
  { key:'Fri', label:'Friday' },
  { key:'Sat', label:'Saturday' },
  { key:'Sun', label:'Sunday' },
  { key:'H1',  label:'Holiday Type 1' },
  { key:'H2',  label:'Holiday Type 2' },
  { key:'H3',  label:'Holiday Type 3' },
];
const INTERVALS = 3;
const EMPTY_INTERVAL = { s:'00:00', e:'00:00' };
const emptySchedule = () =>
  Object.fromEntries(DAYS.map(d => [d.key, Array(INTERVALS).fill(null).map(() => ({...EMPTY_INTERVAL}))]));

/* ── Time input: plain text box, digits only, auto-fills cell ── */
const TimeInput = ({ value = '00:00', onChange }) => {
  const parts = (value || '00:00').split(':');
  const h = parts[0] || '00';
  const m = parts[1] || '00';

  // Shared style — width:100% so inputs stretch to fill the TD
  const style = {
    width:'100%', textAlign:'center', padding:'4px 0',
    border:'1.5px solid #d1d5db', borderRadius:5, fontSize:13,
    outline:'none', background:'white', color:'#1f2937',
    fontWeight:500, fontFamily:'monospace', minWidth:28,
    transition:'border-color .15s, box-shadow .15s',
    boxSizing:'border-box',
  };
  const focusStyle = { borderColor:'#1a56db', boxShadow:'0 0 0 2px rgba(26,86,219,.12)' };

  const onlyDigits = (e) => {
    if (!/^[0-9]$/.test(e.key) &&
        !['Backspace','Delete','ArrowLeft','ArrowRight','Tab'].includes(e.key)) {
      e.preventDefault();
    }
  };
  const clamp = (val, max) => String(Math.min(max, Math.max(0, parseInt(val)||0))).padStart(2,'0');

  return (
    <div style={{ display:'flex', alignItems:'center', gap:3, width:'100%' }}>
      <input type="text" maxLength={2} style={style} value={h}
        onKeyDown={onlyDigits}
        onChange={e => onChange(`${e.target.value.replace(/\D/g,'')}:${m}`)}
        onBlur={e  => onChange(`${clamp(e.target.value,23)}:${m}`)}
        onFocus={e => { e.target.select(); Object.assign(e.target.style, focusStyle); }}
        onBlurCapture={e => Object.assign(e.target.style, { borderColor:'#d1d5db', boxShadow:'none' })}
      />
      <span style={{ fontSize:14, fontWeight:800, color:'#9ca3af', userSelect:'none', flexShrink:0 }}>:</span>
      <input type="text" maxLength={2} style={style} value={m}
        onKeyDown={onlyDigits}
        onChange={e => onChange(`${h}:${e.target.value.replace(/\D/g,'')}`)}
        onBlur={e  => onChange(`${h}:${clamp(e.target.value,59)}`)}
        onFocus={e => { e.target.select(); Object.assign(e.target.style, focusStyle); }}
        onBlurCapture={e => Object.assign(e.target.style, { borderColor:'#d1d5db', boxShadow:'none' })}
      />
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════
   TimeZone Add/Edit Modal — app-standard UI with ZKBio grid
═════════════════════════════════════════════════════════════ */
const TimeZoneModal = ({ tz, onSave, onClose }) => {
  const [name,     setName]     = useState(tz?.name    || '');
  const [remarks,  setRemarks]  = useState(tz?.remarks || '');
  const [schedule, setSchedule] = useState(() => {
    if (tz?.schedule) {
      const s = typeof tz.schedule === 'string' ? JSON.parse(tz.schedule) : tz.schedule;
      return {
        ...emptySchedule(),
        ...Object.fromEntries(
          Object.entries(s).map(([k,v]) => [k,
            v.length >= INTERVALS ? v : [...v, ...Array(INTERVALS - v.length).fill({...EMPTY_INTERVAL})]
          ])
        ),
      };
    }
    return emptySchedule();
  });
  const [copyMon, setCopyMon] = useState(false);
  const [error,   setError]   = useState('');

  // WEEKDAYS that get copied from Monday (Tue through Sun)
  const COPY_TARGETS = ['Tue','Wed','Thu','Fri','Sat','Sun'];

  const setIv = (dayKey, idx, field, val) => {
    setSchedule(prev => {
      const updated = {
        ...prev,
        [dayKey]: prev[dayKey].map((iv, i) => i === idx ? {...iv, [field]:val} : iv),
      };
      // If copy is on and we just edited Monday, mirror to all other weekdays incl. Sun
      if (copyMon && dayKey === 'Mon') {
        COPY_TARGETS.forEach(d => { updated[d] = updated['Mon'].map(iv => ({...iv})); });
      }
      return updated;
    });
  };

  const applyMonToAll = (val) => {
    setCopyMon(val);
    if (val) {
      setSchedule(prev => {
        const next = {...prev};
        COPY_TARGETS.forEach(d => { next[d] = prev['Mon'].map(iv => ({...iv})); });
        return next;
      });
    }
  };

  const handleSave = () => {
    if (!name.trim()) { setError('Time Period Name is required'); return; }
    onSave({ name: name.trim(), remarks: remarks.trim(), schedule });
  };

  /* Ctrl+S saves — this component only exists while its modal is open */
  useSaveShortcut(true, handleSave);

  /* ── Per-interval colour palette (3 distinct colours) ── */
  const INTERVAL_COLORS = [
    { header:'#dbeafe', sub:'#eff6ff', cell:'#f8fbff', border:'#bfdbfe', text:'#1e40af' }, // Interval 1 — Blue
    { header:'#dcfce7', sub:'#f0fdf4', cell:'#f8fffe', border:'#86efac', text:'#166534' }, // Interval 2 — Green
    { header:'#fef3c7', sub:'#fffbeb', cell:'#fffef5', border:'#fcd34d', text:'#92400e' }, // Interval 3 — Amber
  ];

  // Interval header (INTERVAL 1 / 2 / 3) — bold, colour background
  const TH_INTERVAL = (n) => ({
    padding:'8px 10px',
    background: INTERVAL_COLORS[n].header,
    color: INTERVAL_COLORS[n].text,
    fontWeight:700, fontSize:11, textAlign:'center',
    border:`1px solid ${INTERVAL_COLORS[n].border}`,
    borderBottom:`2px solid ${INTERVAL_COLORS[n].border}`,
    textTransform:'uppercase', letterSpacing:'.5px',
  });

  // Sub-header (START TIME / END TIME) — NOT bold, black text
  const TH_SUB = (n) => ({
    padding:'6px 8px',
    background: INTERVAL_COLORS[n].sub,
    color:'#111827',          // black, NOT bold
    fontWeight:400, fontSize:10, textAlign:'center',
    border:`1px solid ${INTERVAL_COLORS[n].border}`,
    textTransform:'uppercase', letterSpacing:'.4px',
  });

  // Data cell tint per interval
  const TD_CELL = (n) => ({
    padding:'4px 6px',
    background: INTERVAL_COLORS[n].cell,
    border:`1px solid ${INTERVAL_COLORS[n].border}`,
  });

  // Day column uses dark background for contrast
  const TD_DAY = (key) => ({
    padding:'6px 12px',
    background: key.startsWith('H') ? '#4b5563' : '#374151',
    color:'white', fontWeight:600, fontSize:12, textAlign:'center',
    border:'1px solid #4b5563', whiteSpace:'nowrap', minWidth:110,
  });
  const DIAG_W = 110;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth:900, width:'96%', maxHeight:'94vh', overflowY:'auto' }}
           onClick={e=>e.stopPropagation()}>

        {/* ── App-standard header ── */}
        <div className="modal-header"
          style={{ position:'sticky', top:0, zIndex:10 }}>
          <h2>{tz ? '✏️ Edit — Time Zone' : '+ Add — Time Zone'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">

          {/* Name + Remarks row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:18 }}>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">
                Time Period Name <span style={{ color:'#ef4444' }}>*</span>
              </label>
              <input className={`form-control ${error?'error':''}`}
                value={name} onChange={e=>{setName(e.target.value);setError('');}}
                placeholder="e.g. Office Hours, 24-Hour Accessible" />
              {error && <div className="form-error">{error}</div>}
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">Remarks</label>
              <input className="form-control" value={remarks}
                onChange={e=>setRemarks(e.target.value)}
                placeholder="Optional description" />
            </div>
          </div>

          {/* ── Time Schedule Grid ── */}
          <div style={{ overflowX:'auto', borderRadius:8, border:'1px solid #e5e7eb',
            boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
            <table style={{ borderCollapse:'collapse', width:'100%', minWidth:740 }}>
              <thead>
                <tr>
                  {/* Diagonal header — same grey as DataGrid TH (efefef) */}
                  <th style={{ position:'relative', width:DIAG_W, minWidth:DIAG_W, height:46,
                    background:'#efefef', border:'1px solid #dedede', overflow:'hidden' }}>
                    <div style={{ position:'absolute', top:0, left:0, right:0, bottom:0,
                      background:'linear-gradient(to bottom right, transparent calc(50% - 0.5px), #9ca3af calc(50% - 0.5px), #9ca3af calc(50% + 0.5px), transparent calc(50% + 0.5px))' }} />
                    <span style={{ position:'absolute', top:4, right:6, fontSize:10, color:'#374151', fontWeight:700 }}>Time</span>
                    <span style={{ position:'absolute', bottom:4, left:6, fontSize:10, color:'#374151', fontWeight:700 }}>Date</span>
                  </th>
                  {[0,1,2].map(n => (
                    <th key={n} colSpan={2} style={TH_INTERVAL(n)}>Interval {n+1}</th>
                  ))}
                </tr>
                <tr>
                  <th style={{ width:DIAG_W, minWidth:DIAG_W, background:'#f3f4f6', border:'1px solid #dedede' }} />
                  {[0,1,2].map(n => (
                    <React.Fragment key={n}>
                      <th style={TH_SUB(n)}>Start Time</th>
                      <th style={TH_SUB(n)}>End Time</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((d, di) => (
                  <tr key={d.key}
                    style={{ background: di%2===0 ? 'white' : '#f8fafc',
                      transition:'background .1s' }}>
                    <td style={TD_DAY(d.key)}>{d.label}</td>
                    {(schedule[d.key] || Array(INTERVALS).fill({...EMPTY_INTERVAL})).map((iv, idx) => (
                      <React.Fragment key={idx}>
                        <td style={{ ...TD_CELL(idx),
                          borderLeft: idx===0 ? `2px solid ${INTERVAL_COLORS[0].border}` : TD_CELL(idx).border }}>
                          <TimeInput value={iv.s} onChange={v => setIv(d.key, idx, 's', v)} />
                        </td>
                        <td style={{ ...TD_CELL(idx),
                          borderRight: idx < INTERVALS-1
                            ? `2px solid ${INTERVAL_COLORS[idx+1].border}`
                            : TD_CELL(idx).border }}>
                          <TimeInput value={iv.e} onChange={v => setIv(d.key, idx, 'e', v)} />
                        </td>
                      </React.Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Copy Monday checkbox — app style, now includes Sunday */}
          <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:8,
            padding:'8px 12px', background:'#f0fdf4', borderRadius:8, border:'1px solid #bbf7d0' }}>
            <div style={{ width:20, height:20, borderRadius:5, border:`2px solid ${copyMon?'#1a56db':'#d1d5db'}`,
              background:copyMon?'#1a56db':'white', cursor:'pointer', flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}
              onClick={() => applyMonToAll(!copyMon)}>
              {copyMon && <svg viewBox="0 0 12 12" width="12" height="12" fill="none">
                <polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>}
            </div>
            <span style={{ fontSize:13, color:'#065f46', fontWeight:500, cursor:'pointer' }}
              onClick={() => applyMonToAll(!copyMon)}>
              Copy Monday's Setting to Others Weekdays (Tue–Sun)
            </span>
            {copyMon && (
              <span style={{ fontSize:11, color:'#059669', fontWeight:600, marginLeft:4 }}>
                ✓ Applied to Tue, Wed, Thu, Fri, Sat, Sun
              </span>
            )}
          </div>
        </div>

        {/* ── App-standard footer ── */}
        <div className="modal-footer" style={{ position:'sticky', bottom:0, background:'white', borderTop:'1px solid #e5e7eb' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <SaveButton onClick={handleSave} />
        </div>
      </div>
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════
   SetByLevelTab — Access Levels grid + dual-panel Personnel Modal
═════════════════════════════════════════════════════════════ */

/** Dual-panel "Add Personnel" modal matching ZKBio CVAccess layout */
// `level` (single) and `group` ({ id, name, levelIds, levelNames }) are mutually
// exclusive. In group mode, adds/removes apply to ONE canonical level (the
// first in the group) — its device-side AccGroup mask already unions every
// timezone in the group (see buildAccGroupParams server-side), so membership
// in just that one level already grants every window the shift covers. The
// member LIST shown is still the union across all levels in the group, since
// someone may have been added to a sibling level individually before.
const PersonnelModal = ({ level, group, timezones, onClose, toast2 }) => {
  const { settings } = useSettings();
  const deptShort   = (name) => settings.departments?.find(d=>d.name===name)?.shortName || name || '—';
  const branchShort = (name) => settings.branches?.find(b=>b.name===name)?.shortName || name || '—';
  const levelIds = group ? group.levelIds : [level.id];
  const levelIdsKey = levelIds.join(',');
  const canonicalLevelId = levelIds[0];
  const [members,       setMembers]       = useState([]);     // right panel — already in level(s)
  const [leftSelected,  setLeftSelected]  = useState([]);     // checked in left panel
  const [rightSelected, setRightSelected] = useState([]);     // checked in right panel
  const [allEmps,       setAllEmps]       = useState([]);
  const [personAccessAll, setPersonAccessAll] = useState([]); // every employee's current level/group, for the "Level" filter
  const [loading,       setLoading]       = useState(false);
  const [filterOpen,    setFilterOpen]    = useState(false);
  const [filters,       setFilters]       = useState({
    branches:[], departments:[], posts:[], grades:[], levels:[], modes:[],
  });
  const filterBoxRef = useRef(null);

  useEffect(() => {
    if (!filterOpen) return;
    const close = (e) => { if (!filterBoxRef.current?.contains(e.target)) setFilterOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterOpen]);

  // Load all employees (ranked), existing members, and everyone's current
  // level/group assignment (for the "Level" filter) — in group mode, members
  // are the union across every level in the group (deduped by employee id).
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [emps, pa, ...memberLists] = await Promise.all([
          api.get('/employees'),
          api.get('/zkteco/person-access'),
          ...levelIds.map(id => api.get(`/zkteco/access-levels/${id}/members`)),
        ]);
        // Sort by branch ranking order, then staff ranking_order, then full_name
        setAllEmps((emps||[]).filter(e=>e.active!==false).sort((a,b)=>staffRankCompare(a,b,settings)));
        setPersonAccessAll(pa||[]);
        const merged = new Map();
        memberLists.flat().forEach(m => { if (m) merged.set(m.id, m); });
        setMembers([...merged.values()]);
      } catch {}
      finally { setLoading(false); }
    };
    init();
  }, [levelIdsKey]);

  const memberIds = new Set(members.map(m => m.id));

  // Each employee's current Level/Shift Group label, for the "Level" filter —
  // group_name when their level belongs to one, else the level name itself,
  // else "Unassigned".
  const levelLabelByEmp = new Map(
    personAccessAll.filter(p => p.access_level_id).map(p => [p.employee_id, p.group_name || p.level_name])
  );
  const levelOf = (empId) => levelLabelByEmp.get(empId) || 'Unassigned';

  const uniq = (field) => [...new Set(allEmps.map(e => e[field]).filter(Boolean))].sort();
  // Prefer the canonical lists configured in Settings → Setup (so every
  // configured Branch/Department/etc. is selectable even if no one's been
  // assigned it yet); fall back to whatever's actually on employee records.
  const sNames = (key) => (settings[key] || []).map(x => x.name || x).filter(Boolean).sort();
  const branchOpts = sNames('branches').length    ? sNames('branches')    : uniq('branch');
  const deptOpts    = sNames('departments').length ? sNames('departments') : uniq('department');
  const postOpts    = sNames('posts').length       ? sNames('posts')       : uniq('position');
  const gradeOpts   = sNames('grades').length      ? sNames('grades')      : uniq('grade');
  const modeOpts    = sNames('modes').length       ? sNames('modes')       : uniq('mode');
  const shiftOpts   = [...new Set(allEmps.map(e => levelOf(e.id)))].sort();
  const activeFilterCount = filters.branches.length + filters.departments.length + filters.posts.length
    + filters.grades.length + filters.levels.length + filters.modes.length;

  // Left panel — employees NOT yet in the level(s), narrowed by the Filter
  // popover; the DataGrid's own search box handles free-text name/ID search.
  const leftFiltered = allEmps.filter(e => {
    if (memberIds.has(e.id)) return false;
    if (filters.branches.length    && !filters.branches.includes(e.branch||''))       return false;
    if (filters.departments.length && !filters.departments.includes(e.department||'')) return false;
    if (filters.posts.length       && !filters.posts.includes(e.position||''))         return false;
    if (filters.grades.length      && !filters.grades.includes(e.grade||''))           return false;
    if (filters.modes.length       && !filters.modes.includes(e.mode||''))             return false;
    if (filters.levels.length      && !filters.levels.includes(levelOf(e.id)))         return false;
    return true;
  });

  const move = async (empIds, add) => {
    if (!empIds.length) return;
    try {
      if (add) {
        const r = await api.post(`/zkteco/access-levels/${canonicalLevelId}/members`, { employeeIds:empIds });
        const newMembers = allEmps.filter(e=>empIds.includes(e.id)).map(e=>({
          id:e.id, emp_code:e.employeeId, full_name:e.fullName,
          branch:e.branch||'', department:e.department||'',
        }));
        setMembers(p=>[...p,...newMembers]);
        setLeftSelected([]);
        setGridVersion(v=>v+1);
        toast2(`Added ${r.added} — synced to ${r.syncedDevices} device(s)`);
      } else {
        let syncedDevices = 0;
        // Remove from every level in the group, in case they were individually
        // added to a sibling level before group-mode assignment existed.
        for (const id of empIds) {
          for (const lvId of levelIds) {
            const r = await api.delete(`/zkteco/access-levels/${lvId}/members/${id}`);
            syncedDevices += r.syncedDevices||0;
          }
        }
        setMembers(p=>p.filter(m=>!empIds.includes(m.id)));
        setRightSelected([]);
        setGridVersion(v=>v+1);
        toast2(`Removed ${empIds.length} — synced to ${syncedDevices} device(s)`);
      }
    } catch (err) { toast2(err.message,'danger'); }
  };

  // Shared column shape for both panels — left-side employees are pre-mapped
  // to the same emp_code/full_name fields the members API already returns,
  // so one column set covers both standard DataGrids.
  const personColumns = [
    { field:'emp_code', header:'P.ID', width:70,
      render:v=><span style={{ fontFamily:'monospace', color:'#1a56db', fontWeight:700, fontSize:12 }}>{v}</span> },
    { field:'full_name', header:'Full Name' },
    { field:'branch', header:'Branch', width:70,
      render:v=><span style={{ fontSize:12 }}>{branchShort(v)}</span> },
    { field:'department', header:'Dept.', width:70,
      render:v=><span style={{ fontSize:12 }}>{deptShort(v)}</span> },
  ];
  const leftRows = leftFiltered.map(e => ({
    id: e.id, emp_code: e.employeeId,
    full_name: e.fullName||'',
    branch: e.branch||'',
    department: e.department||'',
  }));

  // DataGrid manages selection internally (uncontrolled) — bump this after
  // every successful move() to remount both grids and clear stale checkboxes.
  const [gridVersion, setGridVersion] = useState(0);

  const tz = level ? timezones.find(t=>t.id===level.timezone_id) : null;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth:1320,width:'98%',maxHeight:'94vh',overflowY:'auto' }}
           onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header" style={{ position:'sticky',top:0,zIndex:10 }}>
          <div>
            <h2>👥 Add Personnel — {group ? `📦 ${group.name}` : level.name}</h2>
            <div style={{ fontSize:12,color:'#6b7280',marginTop:2 }}>
              {group
                ? <span>Shift Group · {group.levelNames.length} levels: <strong>{group.levelNames.join(', ')}</strong></span>
                : <>
                    {tz&&<span>Time Zone: <strong>{tz.name}</strong> &nbsp;·&nbsp;</span>}
                    {level.area_name&&<span>Area: <strong>{level.area_name}</strong></span>}
                  </>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ padding:'14px 18px' }}>
          {/* Dual panel — standard DataGrid on both sides */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr auto 1fr', gap:10, alignItems:'start' }}>

            {/* LEFT — Alternative (not yet in level) */}
            <div>
              <div style={{ fontWeight:700, fontSize:12, color:'#374151', marginBottom:6 }}>
                Alternative
                <span style={{ marginLeft:6,fontSize:11,color:'#9ca3af',fontWeight:400 }}>
                  ({leftFiltered.length} staff, ordered by ranking)
                </span>
              </div>
              <div className="dg-fixed-height" style={{ height:540 }}>
              <DataGrid
                key={`left-${gridVersion}`}
                columns={personColumns}
                data={leftRows}
                rowKey="id"
                showCheckbox
                onSelectionChange={setLeftSelected}
                defaultPageSize={10}
                showSearch
                showFilterButton={false}
                compact
                loading={loading}
                toolbar={
                  <div style={{ position:'relative' }} ref={filterBoxRef}>
                    <button className={`btn btn-outline btn-sm ${activeFilterCount?'active':''}`}
                      onClick={()=>setFilterOpen(o=>!o)}
                      style={{ display:'flex', alignItems:'center', gap:5,
                        ...(activeFilterCount ? { background:'#eff6ff', color:'#1a56db', borderColor:'#bfdbfe' } : {}) }}>
                      🔽 Filter{activeFilterCount>0 && (
                        <span style={{ background:'#1a56db', color:'white', borderRadius:10, padding:'0 6px', fontSize:10, fontWeight:700 }}>
                          {activeFilterCount}
                        </span>
                      )}
                    </button>
                    {filterOpen && (
                      <div style={{ position:'absolute', top:'calc(100% + 4px)', right:0, zIndex:40, width:560,
                        background:'white', border:'1px solid #d1d5db', borderRadius:8,
                        boxShadow:'0 8px 24px rgba(0,0,0,.15)', padding:12 }}>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10 }}>
                          <KeyboardMultiSelect label="Branch"     options={branchOpts} values={filters.branches}    onChange={v=>setFilters(p=>({...p,branches:v}))} />
                          <KeyboardMultiSelect label="Department" options={deptOpts}   values={filters.departments} onChange={v=>setFilters(p=>({...p,departments:v}))} />
                          <KeyboardMultiSelect label="Post"       options={postOpts}   values={filters.posts}       onChange={v=>setFilters(p=>({...p,posts:v}))} />
                          <KeyboardMultiSelect label="Grade"      options={gradeOpts}  values={filters.grades}      onChange={v=>setFilters(p=>({...p,grades:v}))} />
                          <KeyboardMultiSelect label="Shift"      options={shiftOpts}  values={filters.levels}      onChange={v=>setFilters(p=>({...p,levels:v}))} />
                          <KeyboardMultiSelect label="Mode"       options={modeOpts}   values={filters.modes}       onChange={v=>setFilters(p=>({...p,modes:v}))} />
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', marginTop:10, paddingTop:10, borderTop:'1px solid #f1f5f9' }}>
                          <button className="btn btn-outline btn-sm"
                            onClick={()=>setFilters({ branches:[], departments:[], posts:[], grades:[], levels:[], modes:[] })}>
                            ✕ Clear All
                          </button>
                          <button className="btn btn-primary btn-sm" onClick={()=>setFilterOpen(false)}>Done</button>
                        </div>
                      </div>
                    )}
                  </div>
                }
              />
              </div>
            </div>

            {/* Transfer buttons */}
            <div style={{ display:'flex',flexDirection:'column',gap:6,paddingTop:60,alignItems:'center' }}>
              {[
                { label:'»»', title:'Add All',      onClick:()=>move(leftFiltered.map(e=>e.id),true) },
                { label:'»',  title:'Add Selected', onClick:()=>move(leftSelected,true) },
                { label:'«',  title:'Remove Selected',onClick:()=>move(rightSelected,false) },
                { label:'««', title:'Remove All',   onClick:()=>move(members.map(m=>m.id),false) },
              ].map(b=>(
                <button key={b.label} title={b.title} onClick={b.onClick}
                  style={{ width:38,height:32,background:'#f3f4f6',border:'1px solid #d1d5db',
                    borderRadius:5,cursor:'pointer',fontWeight:700,fontSize:13,color:'#374151',
                    transition:'background .12s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='#e0e7ff'}
                  onMouseLeave={e=>e.currentTarget.style.background='#f3f4f6'}>
                  {b.label}
                </button>
              ))}
            </div>

            {/* RIGHT — Selected (in level) */}
            <div>
              <div style={{ fontWeight:700,fontSize:12,color:'#374151',marginBottom:6 }}>
                Selected
                <span style={{ marginLeft:6,background:'#1a56db',color:'white',
                  borderRadius:10,padding:'1px 8px',fontSize:11,fontWeight:700 }}>
                  {members.length}
                </span>
              </div>
              <div className="dg-fixed-height" style={{ height:540 }}>
              <DataGrid
                key={`right-${gridVersion}`}
                columns={personColumns}
                data={members}
                rowKey="id"
                showCheckbox
                onSelectionChange={setRightSelected}
                defaultPageSize={10}
                showSearch
                compact
                loading={loading}
              />
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ position:'sticky',bottom:0,background:'white',borderTop:'1px solid #e5e7eb' }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
};

/** Set Access By Level — shows Access Levels grid + Personnel button */
const SetByLevelTab = ({ levels, employees, areas, timezones, toast2, L, onRefresh }) => {
  const [personnelLevel, setPersonnelLevel] = useState(null); // which level we're managing

  if (levels.length === 0) {
    return (
      <div style={{ textAlign:'center',padding:'40px 20px',color:'#9ca3af' }}>
        <div style={{ fontSize:34,marginBottom:8 }}>🏆</div>
        <div style={{ fontWeight:600,fontSize:14,marginBottom:6 }}>No Access Levels defined</div>
        <div style={{ fontSize:13,maxWidth:400,margin:'0 auto' }}>
          Go to the <strong>Access Levels</strong> tab and create at least one level first.
        </div>
      </div>
    );
  }

  /* DataGrid columns — Staff-detail style */
  const columns = [
    { field:'name', header:'Level Name',
      render: v => <strong style={{ color:'#1f2937' }}>{v}</strong> },
    { field:'area_name', header:'Area Name', width:140,
      render: v => v
        ? <span style={{ background:'#fef3c7',color:'#92400e',borderRadius:10,padding:'2px 9px',fontSize:11,fontWeight:700 }}>🗺️ {v}</span>
        : <span style={{ color:'#d1d5db' }}>—</span> },
    { field:'timezone_name', header:'Time Period', width:160,
      render: v => v
        ? <span style={{ fontFamily:'monospace',fontSize:12,color:'#1a56db' }}>{v}</span>
        : <span style={{ color:'#d1d5db' }}>—</span> },
    { field:'personnel_count', header:'Personnel', width:95, align:'center',
      render: v => (
        <span style={{ fontWeight:700, color: v>0?'#059669':'#9ca3af' }}>
          {v || 0}
        </span>
      ),
    },
    { field:'remarks', header:'Remarks', render: v => v || '—' },
    { field:'actions', header:'Operate', width:95, sortable:false, filterable:false,
      render:(_, row) => (
        <button
          title="Add / Manage Personnel"
          onClick={e=>{ e.stopPropagation(); setPersonnelLevel(row); }}
          style={{ display:'inline-flex',alignItems:'center',gap:5,
            background:'#eff6ff',color:'#1a56db',border:'1px solid #bfdbfe',
            borderRadius:6,padding:'4px 10px',fontSize:12,fontWeight:700,cursor:'pointer' }}>
          👥+ Personnel
        </button>
      ),
    },
  ];

  return (
    <div>
      <DataGrid
        columns={columns}
        data={levels}
        defaultPageSize={15}
        showSearch
        compact={false}
        showCheckbox={false}
        onRowDoubleClick={row=>setPersonnelLevel(row)}
      />

      {personnelLevel && (
        <PersonnelModal
          level={personnelLevel}
          timezones={timezones}
          onClose={()=>{ setPersonnelLevel(null); onRefresh?.(); }}
          toast2={toast2}
        />
      )}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════
   Main Access Control Tab
═════════════════════════════════════════════════════════════ */
const ZKTecoAccessTab = ({ L, language, showToast, areas }) => {
  const { settings }   = useSettings();
  const { employees }  = useData();
  const navigate = useNavigate();

  const [subTab,     setSubTab]     = useState('timezones');
  const [timezones,  setTimezones]  = useState([]);
  const [levels,     setLevels]     = useState([]);
  const [personAccess, setPersonAccess] = useState([]);
  const [deptAccess,   setDeptAccess]   = useState([]);
  const [holidays,   setHolidays]   = useState([]);
  const [devices,    setDevices]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushDeviceId, setPushDeviceId] = useState('');
  const [toast,      setToast]      = useState(null);

  /* ── Holiday modal ── */
  const [hlModal,  setHlModal]  = useState(false);
  const [hlEdit,   setHlEdit]   = useState(null);
  const [hlForm,   setHlForm]   = useState({ holidayName:'', startDate:'', endDate:'', timezoneId:'', remarks:'' });
  const [hlDelConf,setHlDelConf]= useState(null);

  /* ── Time Zone modal ── */
  const [tzModal,  setTzModal]  = useState(false);
  const [tzEdit,   setTzEdit]   = useState(null);
  const [tzDelConf,setTzDelConf]= useState(null);

  /* ── Access Level modal ── */
  const [lvModal,  setLvModal]  = useState(false);
  const [lvEdit,   setLvEdit]   = useState(null);
  const [lvForm,   setLvForm]   = useState({ name:'', timezoneId:'', areaId:'', groupId:'', remarks:'', active:true });
  const [lvDelConf,setLvDelConf]= useState(null);

  /* ── By Person modal ── */
  const [pModal,   setPModal]   = useState(false);
  const [pForm,    setPForm]    = useState({ employeeIds:[], accessLevelIds:[], areaIds:[] });
  const [pDelConf, setPDelConf] = useState(null);

  /* ── By Dept modal ── */
  const [dModal,   setDModal]   = useState(false);
  const [dForm,    setDForm]    = useState({ department:'', accessLevelId:'', timezoneId:'', areaId:'' });
  const [dDelConf, setDDelConf] = useState(null);

  const toast2 = (msg, type='success') => { setToast({ msg,type }); setTimeout(()=>setToast(null),3500); };

  const depts = [...new Set(employees.filter(e=>e.active!==false&&e.department).map(e=>e.department))].sort();

  // Cluster Access Levels by Shift Group (alphabetically), ungrouped levels last —
  // so the two (or more) levels under e.g. "09-17 Shift" sit next to each other
  // instead of being interleaved with levels from other shifts.
  const levelsByGroup = [...levels].sort((a, b) => {
    const ga = a.group_name || '￿', gb = b.group_name || '￿';
    if (ga !== gb) return ga.localeCompare(gb);
    return (a.name || '').localeCompare(b.name || '');
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tz,lv,pa,da,hl,devs] = await Promise.all([
        api.get('/zkteco/timezones'),
        api.get('/zkteco/access-levels'),
        api.get('/zkteco/person-access'),
        api.get('/zkteco/dept-access'),
        api.get('/zkteco/acc-holidays'),
        api.get('/zkteco/devices'),
      ]);
      setTimezones(tz||[]);
      setLevels(lv||[]);
      setPersonAccess(pa||[]);
      setDeptAccess(da||[]);
      setHolidays(hl||[]);
      setDevices((devs||[]).filter(d=>d.serial_number));
    } catch (err) { toast2(err.message,'danger'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ─ Time Zone schedule summary ─ */
  const scheduleSummary = (schedule) => {
    if (!schedule) return '—';
    const s = typeof schedule==='string' ? JSON.parse(schedule) : schedule;
    const mon = s['Mon']?.[0];
    if (!mon) return '—';
    if (mon.s==='00:00' && mon.e==='23:59') return '24-Hour';
    if (mon.s==='00:00' && mon.e==='00:00') return 'No Access';
    return `${mon.s}–${mon.e}`;
  };

  /* ── SelectInput helper ── */
  const Sel = ({ label, value, onChange, options, allLabel, required }) => (
    <div className="form-group" style={{ marginBottom:12 }}>
      <label className="form-label" style={{ fontSize:12 }}>
        {label}{required&&<span style={{ color:'#ef4444' }}> *</span>}
      </label>
      <select className="form-control" value={value} onChange={e=>onChange(e.target.value)}>
        <option value="">{allLabel||'—'}</option>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  // Checkbox-dropdown multi-select — same visual footprint as Sel above.
  const MultiSel = ({ label, values, onChange, options, allLabel, required }) => {
    const [open, setOpen] = useState(false);
    const boxRef = useRef(null);
    useEffect(() => {
      if (!open) return;
      const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
      document.addEventListener('mousedown', close);
      return () => document.removeEventListener('mousedown', close);
    }, [open]);
    const toggle = (v) => onChange(values.includes(v) ? values.filter(x=>x!==v) : [...values, v]);
    const labelText = values.length
      ? options.filter(o=>values.includes(o.value)).map(o=>o.label).join(', ')
      : (allLabel || '—');
    return (
      <div className="form-group" style={{ marginBottom:12, position:'relative' }} ref={boxRef}>
        <label className="form-label" style={{ fontSize:12 }}>
          {label}{required&&<span style={{ color:'#ef4444' }}> *</span>}
        </label>
        <div className="form-control" onClick={()=>setOpen(o=>!o)}
          style={{ cursor:'pointer', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: values.length?'inherit':'#9ca3af' }}>{labelText}</span>
          <span style={{ marginLeft:6, color:'#9ca3af' }}>▾</span>
        </div>
        {open && (
          <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:20, background:'white',
            border:'1px solid #d1d5db', borderRadius:6, maxHeight:220, overflowY:'auto', boxShadow:'0 4px 12px rgba(0,0,0,.1)' }}>
            {options.map(o => (
              <label key={o.value} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', fontSize:13, cursor:'pointer' }}
                onMouseDown={e=>e.preventDefault()} onClick={()=>toggle(o.value)}>
                <input type="checkbox" checked={values.includes(o.value)} readOnly style={{ accentColor:'#1a56db' }} />
                {o.label}
              </label>
            ))}
          </div>
        )}
      </div>
    );
  };

  /* Sub-tabs */
  const subTabs = [
    { key:'timezones',   label:'🕐 Time Zones',        count: timezones.length },
    { key:'levels',      label:'🏆 Access Levels',      count: levels.length },
    { key:'by-level',    label:'👥 By Level',           count: null },
    { key:'by-person',   label:'👤 By Person',          count: personAccess.length||null },
    { key:'by-dept',     label:'🏗️ By Dept',           count: deptAccess.length||null },
    { key:'holidays',    label:'🎌 Holidays',           count: holidays.length||null },
  ];

  const handlePushAccessRules = async () => {
    if (!pushDeviceId) { toast2('Select a device first','danger'); return; }
    setPushLoading(true);
    try {
      const r = await api.post(`/zkteco/devices/${pushDeviceId}/push-access-rules`);
      toast2(`Queued: ${r.timezones} TimeZones + ${r.groups} Groups + ${r.holidays} Holidays → device`);
    } catch (err) { toast2(err.message,'danger'); }
    finally { setPushLoading(false); }
  };

  /* ── Save handlers for the small Access-tab modals — extracted so Ctrl+S can call them too ── */
  const handleSaveLevel = async () => {
    if(!lvForm.name.trim()){toast2('Name required','danger');return;}
    try {
      const body={
        name:lvForm.name, timezoneId:lvForm.timezoneId||null, areaId:lvForm.areaId||null, groupId:null, remarks:lvForm.remarks,
        active: lvForm.active,
      };
      if(lvEdit) await api.put(`/zkteco/access-levels/${lvEdit.id}`,body);
      else       await api.post('/zkteco/access-levels',body);
      toast2(lvEdit?'Updated':'Created');setLvModal(false);load();
    } catch(err){toast2(err.message,'danger');}
  };
  // Opens the Set Access By Person modal. Pass a By-Person grid row to
  // pre-select that staff member (double-click / right-click "Set Access");
  // omit it to open blank (toolbar "+ Set Access By Person"). Pre-fills ALL
  // access levels currently held by this employee (across every area), not
  // just the one row clicked — matches the multi-select shown in the Staff →
  // Device Connectivity panel, so both screens reflect the same assignments.
  const openPersonModal = (row) => {
    if (row) {
      const mine = personAccess.filter(p => p.employee_id === row.employee_id && p.access_level_id);
      setPForm({
        employeeIds: [String(row.employee_id)],
        accessLevelIds: mine.map(p => String(p.access_level_id)),
        areaIds: [],
      });
    } else {
      setPForm({ employeeIds:[], accessLevelIds:[], areaIds:[] });
    }
    setPModal(true);
  };

  // Replace, don't accumulate: each save wipes the selected staff's existing
  // access-level rows first, then re-inserts exactly the current selection. A
  // person can be tracked under several levels at once (rosters/personnel
  // counts), but the device only ever enforces ONE Grp — whichever was
  // (re)assigned most recently wins there; see resolveGrpForEmployee on the
  // server. Mirrors the Device Connectivity panel's Save behavior so the two
  // stay consistent.
  const handleSavePerson = async () => {
    if(!pForm.employeeIds.length){toast2('Select at least one staff member','danger');return;}
    try{
      let saved = 0, syncedDevices = 0;
      for (const empId of pForm.employeeIds) {
        await api.delete(`/zkteco/person-access/employee/${empId}`);
        if (pForm.accessLevelIds.length) {
          // Group by area — levels in the same area are sent together in one
          // call; levels pointed at different areas get their own separate call.
          // An explicit Area override applies the whole selection to every
          // chosen area instead.
          const byArea = new Map();
          if (pForm.areaIds.length) {
            for (const areaId of pForm.areaIds) byArea.set(areaId, pForm.accessLevelIds.map(id => parseInt(id)));
          } else {
            for (const lvId of pForm.accessLevelIds) {
              const lv = levels.find(l => String(l.id) === lvId);
              const areaKey = lv?.area_id ? String(lv.area_id) : '';
              if (!byArea.has(areaKey)) byArea.set(areaKey, []);
              byArea.get(areaKey).push(parseInt(lvId));
            }
          }
          for (const [areaKey, ids] of byArea) {
            const r = await api.post('/zkteco/person-access', {
              employeeId: parseInt(empId), accessLevelIds: ids, areaIds:[areaKey || null],
            });
            saved += r.saved||0; syncedDevices += r.syncedDevices||0;
          }
        } else {
          const r = await api.post('/zkteco/person-access', { employeeId: parseInt(empId), accessLevelId: null, areaIds:[null] });
          saved += r.saved||0; syncedDevices += r.syncedDevices||0;
        }
      }
      toast2(`Access rule saved — ${saved} assignment(s), synced to ${syncedDevices} device(s)`);
      setPModal(false);load();
    } catch(err){toast2(err.message,'danger');}
  };
  const handleSaveDept = async () => {
    if(!dForm.department){toast2('Select a department','danger');return;}
    try{
      await api.post('/zkteco/dept-access',{department:dForm.department,accessLevelId:dForm.accessLevelId||null,timezoneId:dForm.timezoneId||null,areaId:dForm.areaId||null});
      toast2('Access rule saved');setDModal(false);load();
    } catch(err){toast2(err.message,'danger');}
  };
  const handleSaveHoliday = async () => {
    if(!hlForm.holidayName.trim()||!hlForm.startDate||!hlForm.endDate){toast2('Name and dates required','danger');return;}
    try{
      const body={holidayName:hlForm.holidayName,startDate:hlForm.startDate,endDate:hlForm.endDate,
        timezoneId:hlForm.timezoneId||null,remarks:hlForm.remarks};
      if(hlEdit) await api.put(`/zkteco/acc-holidays/${hlEdit.id}`,body);
      else       await api.post('/zkteco/acc-holidays',body);
      toast2(hlEdit?'Holiday updated':'Holiday created');setHlModal(false);load();
    } catch(err){toast2(err.message,'danger');}
  };
  /* Ctrl+S saves whichever of these small modals is currently open */
  useSaveShortcut(lvModal, handleSaveLevel);
  useSaveShortcut(pModal,  handleSavePerson);
  useSaveShortcut(dModal,  handleSaveDept);
  useSaveShortcut(hlModal, handleSaveHoliday);

  return (
    <div>
      {/* Push access rules to device bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10,
        padding:'8px 12px', background:'linear-gradient(135deg,#f0fdf4,#eff6ff)',
        borderRadius:8, border:'1px solid #bbf7d0' }}>
        <span style={{ fontSize:12, fontWeight:700, color:'#065f46', whiteSpace:'nowrap' }}>
          📡 Push Access Rules to Device:
        </span>
        <select className="form-control" style={{ flex:'1 1 180px', maxWidth:260, fontSize:12, padding:'4px 8px', height:30 }}
          value={pushDeviceId} onChange={e=>setPushDeviceId(e.target.value)}>
          <option value="">— Select Device —</option>
          {devices.map(d=>(
            <option key={d.id} value={d.id}>{d.name} ({d.serial_number})</option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" onClick={handlePushAccessRules}
          disabled={pushLoading} style={{ whiteSpace:'nowrap', height:30, fontSize:12 }}>
          {pushLoading ? '⏳ Pushing…' : '📤 Push All Access Rules'}
        </button>
        <span style={{ fontSize:11, color:'#6b7280' }}>
          Sends AccTimeZone + AccGroup + AccHoliday commands to device
        </span>
      </div>

      {/* Sub-tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e5e7eb', marginBottom:14, flexWrap:'wrap' }}>
        {subTabs.map(t=>(
          <button key={t.key} onClick={()=>setSubTab(t.key)}
            style={{ padding:'7px 12px', background:'none', border:'none', marginBottom:-2,
              borderBottom:subTab===t.key?'2px solid #1a56db':'2px solid transparent',
              color:subTab===t.key?'#1a56db':'#6b7280', fontWeight:subTab===t.key?700:400,
              cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', gap:5 }}>
            {t.label}
            {t.count>0&&<span style={{ background:'#1a56db',color:'white',borderRadius:9,
              padding:'0 5px',fontSize:10,fontWeight:700 }}>{t.count}</span>}
          </button>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8, paddingRight:4 }}>
          <button className="btn btn-outline btn-sm" onClick={load}>🔃 Refresh</button>
        </div>
      </div>

      {/* ══════ TIME ZONES ══════ */}
      {subTab==='timezones'&&(
        <DataGrid
          columns={[
            { field:'id',       header:'#',               width:50, render:v=><span style={{ color:'#9ca3af',fontSize:11 }}>{v}</span> },
            { field:'name', header:'Time Period Name',
              render:(v,row) => {
                const isSystem = v==='24-Hour Accessible'||v==='No Access';
                return (
                  <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                    <strong style={{ color:'#1f2937' }}>{v}</strong>
                    {isSystem && (
                      <span style={{ background:'#ede9fe',color:'#5b21b6',border:'1px solid #c4b5fd',
                        borderRadius:8,padding:'1px 8px',fontSize:10,fontWeight:700 }}>
                        🔒 System
                      </span>
                    )}
                  </div>
                );
              }
            },
            { field:'schedule', header:'Mon Schedule', width:120, sortable:false,
              render:v=><span style={{ fontFamily:'monospace',fontSize:12,color:'#0369a1' }}>{scheduleSummary(v)}</span> },
            { field:'remarks',  header:'Remarks', render:v=>v||'—' },
            { field:'actions',  header:'', width:75, sortable:false, filterable:false,
              render:(_,row) => {
                const isSystem = row.name==='24-Hour Accessible'||row.name==='No Access';
                return (
                  <div style={{ display:'flex',gap:4 }}>
                    <button className="dg-action-btn edit" title="Edit"
                      onClick={e=>{e.stopPropagation();setTzEdit(row);setTzModal(true);}}>✏</button>
                    {!isSystem && (
                      <button className="dg-action-btn delete" title="Delete"
                        onClick={e=>{e.stopPropagation();setTzDelConf(row.id);}}>🗑</button>
                    )}
                  </div>
                );
              }
            },
          ]}
          data={timezones}
          defaultPageSize={15}
          showSearch
          compact
          loading={loading}
          showCheckbox={false}
          onRowDoubleClick={row=>{setTzEdit(row);setTzModal(true);}}
          toolbar={
            <button className="btn btn-primary btn-sm"
              onClick={()=>{setTzEdit(null);setTzModal(true);}}>
              + Add Time Zone
            </button>
          }
        />
      )}

      {/* ══════ ACCESS LEVELS ══════ */}
      {subTab==='levels'&&(
        <DataGrid
          columns={[
            { field:'name',          header:'Access Level Name', render:(v,row)=><strong style={row?.active===false?{ color:'#9ca3af', textDecoration:'line-through' }:undefined}>{v}</strong> },
            { field:'effective_access_group_id', header:'AccGroup #', width:90, render:v=>v!=null
              ?<span style={{ background:'#dbeafe',color:'#1e40af',borderRadius:10,padding:'2px 8px',fontSize:11,fontWeight:700 }}>#{v}</span>
              :'—' },
            { field:'active',         header:'Status',     width:90, render:v=>v!==false
              ?<span style={{ background:'#dcfce7',color:'#166534',borderRadius:10,padding:'2px 8px',fontSize:11,fontWeight:700 }}>Active</span>
              :<span style={{ background:'#fee2e2',color:'#991b1b',borderRadius:10,padding:'2px 8px',fontSize:11,fontWeight:700 }}>Disabled</span> },
            { field:'timezone_name', header:'Time Zone',  width:160, render:v=>v||'—' },
            { field:'area_name',     header:'Area',       width:130, render:v=>v
              ?<span style={{ background:'#fef3c7',color:'#92400e',borderRadius:10,padding:'2px 8px',fontSize:11,fontWeight:700 }}>🗺️ {v}</span>
              :'—' },
            { field:'remarks',       header:'Remarks',    render:v=>v||'—' },
            { field:'actions',       header:'',           width:75, sortable:false, filterable:false,
              render:(_,row)=>(
                <div style={{ display:'flex',gap:4 }}>
                  <button className="dg-action-btn edit"   onClick={e=>{e.stopPropagation();setLvEdit(row);setLvForm({name:row.name,timezoneId:row.timezone_id?String(row.timezone_id):'',areaId:row.area_id?String(row.area_id):'',groupId:'',remarks:row.remarks||'',active:row.active!==false});setLvModal(true);}}>✏</button>
                  {!row.is_system && (
                    <button className="dg-action-btn delete" onClick={e=>{e.stopPropagation();setLvDelConf(row.id);}}>🗑</button>
                  )}
                </div>
              ),
            },
          ]}
          data={levelsByGroup}
          defaultPageSize={15}
          showSearch
          compact
          loading={loading}
          showCheckbox={false}
          toolbar={
            <button className="btn btn-primary btn-sm"
              onClick={()=>{setLvEdit(null);setLvForm({name:'',timezoneId:'',areaId:'',groupId:'',remarks:'',active:true});setLvModal(true);}}>
              + Add Access Level
            </button>
          }
        />
      )}

      {/* ══════ SET ACCESS BY LEVEL ══════ */}
      {subTab==='by-level'&&(
        <SetByLevelTab
          levels={levelsByGroup}
          employees={employees}
          areas={areas}
          timezones={timezones}
          toast2={toast2}
          L={L}
          onRefresh={load}
        />
      )}

      {/* ══════ BY PERSON ══════ */}
      {subTab==='by-person'&&(
        <DataGrid
          columns={[
            { field:'full_name',     header:'Staff',       render:v=><strong>{v}</strong> },
            { field:'emp_code',      header:'ID',          width:90 },
            { field:'department',    header:'Dept.',       width:130 },
            { field:'level_names',   header:'Access Level',width:220, render:v=>v||'—' },
            { field:'area_name',     header:'Area',        width:120, render:v=>v
              ?<span style={{ background:'#fef3c7',color:'#92400e',borderRadius:10,padding:'2px 8px',fontSize:11,fontWeight:700 }}>🗺️ {v}</span>:'—' },
            { field:'actions',       header:'',            width:60,  sortable:false, filterable:false,
              render:(_,row)=>(
                <button className="dg-action-btn delete"
                  onClick={e=>{e.stopPropagation();setPDelConf(row.id);}}>🗑</button>
              ),
            },
          ]}
          data={personAccess}
          defaultPageSize={20}
          showSearch
          compact
          loading={loading}
          showCheckbox={false}
          onRowDoubleClick={(row)=>navigate(`/users?editEmployee=${row.employee_id}`)}
          contextMenu={[
            { label:'Set Access', icon:'👤', onClick:(row)=>openPersonModal(row) },
            'divider',
            { label:'Delete',     icon:'🗑', className:'danger', onClick:(row)=>setPDelConf(row.id) },
          ]}
          toolbar={
            <button className="btn btn-primary btn-sm" onClick={()=>openPersonModal()}>
              + Set Access By Person
            </button>
          }
        />
      )}

      {/* ══════ BY DEPARTMENT ══════ */}
      {subTab==='by-dept'&&(
        <DataGrid
          columns={[
            { field:'department',    header:'Department',  render:v=><strong>{v}</strong> },
            { field:'member_count',  header:'Members',     width:80,  align:'center', render:v=><span style={{ fontWeight:700,color:'#1a56db' }}>{v||0}</span> },
            { field:'level_name',    header:'Access Level',width:150, render:v=>v||'—' },
            { field:'timezone_name', header:'Time Zone',   width:140, render:v=>v||'—' },
            { field:'area_name',     header:'Area',        width:120, render:v=>v
              ?<span style={{ background:'#fef3c7',color:'#92400e',borderRadius:10,padding:'2px 8px',fontSize:11,fontWeight:700 }}>🗺️ {v}</span>:'—' },
            { field:'actions',       header:'',            width:60,  sortable:false, filterable:false,
              render:(_,row)=>(
                <button className="dg-action-btn delete"
                  onClick={e=>{e.stopPropagation();setDDelConf(row.id);}}>🗑</button>
              ),
            },
          ]}
          data={deptAccess}
          defaultPageSize={20}
          showSearch
          compact
          loading={loading}
          showCheckbox={false}
          toolbar={
            <button className="btn btn-primary btn-sm"
              onClick={()=>{setDForm({department:'',accessLevelId:'',timezoneId:'',areaId:''});setDModal(true);}}>
              + Set Access By Department
            </button>
          }
        />
      )}

      {/* ══════ HOLIDAYS ══════ */}
      {subTab==='holidays'&&(
        <DataGrid
          columns={[
            { field:'id',           header:'#',          width:50,  render:v=><span style={{ color:'#9ca3af',fontSize:11 }}>{v}</span> },
            { field:'holiday_name', header:'Holiday Name', render:v=><strong>{v}</strong> },
            { field:'start_date',   header:'Start Date', width:110, render:v=>v?String(v).slice(0,10):'—' },
            { field:'end_date',     header:'End Date',   width:110, render:v=>v?String(v).slice(0,10):'—' },
            { field:'timezone_name',header:'Time Zone',  width:150, render:v=>v||'—' },
            { field:'remarks',      header:'Remarks',    render:v=>v||'—' },
            { field:'actions',      header:'',           width:75,  sortable:false, filterable:false,
              render:(_,row)=>(
                <div style={{ display:'flex',gap:4 }}>
                  <button className="dg-action-btn edit" onClick={e=>{e.stopPropagation();
                    setHlEdit(row);
                    setHlForm({ holidayName:row.holiday_name, startDate:String(row.start_date).slice(0,10),
                      endDate:String(row.end_date).slice(0,10), timezoneId:row.timezone_id?String(row.timezone_id):'', remarks:row.remarks||'' });
                    setHlModal(true);}}>✏</button>
                  <button className="dg-action-btn delete" onClick={e=>{e.stopPropagation();setHlDelConf(row.id);}}>🗑</button>
                </div>
              ),
            },
          ]}
          data={holidays}
          defaultPageSize={20}
          showSearch
          compact
          loading={loading}
          showCheckbox={false}
          toolbar={
            <button className="btn btn-primary btn-sm"
              onClick={()=>{setHlEdit(null);setHlForm({ holidayName:'', startDate:'', endDate:'', timezoneId:'', remarks:'' });setHlModal(true);}}>
              + Add Holiday
            </button>
          }
        />
      )}

      {/* ══ TIME ZONE MODAL ══ */}
      {tzModal&&(
        <TimeZoneModal
          tz={tzEdit}
          onClose={()=>setTzModal(false)}
          onSave={async(data)=>{
            try {
              if (tzEdit) await api.put(`/zkteco/timezones/${tzEdit.id}`, data);
              else        await api.post('/zkteco/timezones', data);
              toast2(tzEdit?'Updated':'Created');
              setTzModal(false);
              load();
            } catch(err) { toast2(err.message,'danger'); }
          }}
        />
      )}

      {/* ══ ACCESS LEVEL MODAL ══ */}
      {lvModal&&(
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:480 }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2>{lvEdit?'✏️ Edit':'+'} Access Level</h2>
              <button className="modal-close" onClick={()=>setLvModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom:12 }}>
                <label className="form-label" style={{ fontSize:12 }}>Level Name *</label>
                <input className="form-control" value={lvForm.name}
                  onChange={e=>setLvForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Office Staff" />
              </div>
              <Sel label="Time Zone" value={lvForm.timezoneId} allLabel="— No Time Zone —"
                onChange={v=>setLvForm(p=>({...p,timezoneId:v}))}
                options={timezones.map(t=>({value:String(t.id),label:t.name}))} />
              <Sel label="Area" value={lvForm.areaId} allLabel="— All Areas —"
                onChange={v=>setLvForm(p=>({...p,areaId:v}))}
                options={areas.map(a=>({value:String(a.id),label:'  '.repeat(a.depth||0)+a.name}))} />

              <div className="form-group" style={{ marginBottom:12 }}>
                <label className="form-label" style={{ fontSize:12 }}>Remarks</label>
                <input className="form-control" value={lvForm.remarks}
                  onChange={e=>setLvForm(p=>({...p,remarks:e.target.value}))} />
              </div>

              <div className="form-group" style={{ marginBottom:0, display:'flex', alignItems:'center', gap:8,
                background: lvForm.active?'#f0fdf4':'#fef2f2', border:`1px solid ${lvForm.active?'#bbf7d0':'#fecaca'}`,
                borderRadius:8, padding:'8px 12px' }}>
                <input type="checkbox" id="lvActive" checked={lvForm.active}
                  onChange={e=>setLvForm(p=>({...p,active:e.target.checked}))} />
                <label htmlFor="lvActive" style={{ fontSize:12, fontWeight:600, marginBottom:0,
                  color: lvForm.active?'#166534':'#991b1b' }}>
                  {lvForm.active ? 'Active — grants access on the device' : 'Disabled — revokes access on the device (time window zeroed)'}
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setLvModal(false)}>Cancel</button>
              <SaveButton onClick={handleSaveLevel} />
            </div>
          </div>
        </div>
      )}

      {/* ══ BY PERSON MODAL ══ */}
      {pModal&&(
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:460 }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2>👤 Set Access By Person</h2>
              <button className="modal-close" onClick={()=>setPModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <MultiSel label="Staff *" values={pForm.employeeIds} allLabel="— Select Staff —" required
                onChange={v=>setPForm(p=>({...p,employeeIds:v}))}
                options={employees.filter(e=>e.active!==false).sort((a,b)=>(a.fullName||'').localeCompare(b.fullName||'')).map(e=>({value:String(e.id),label:e.fullName+' ('+e.employeeId+')'}))} />
              <MultiSel label="Access Level" values={pForm.accessLevelIds} allLabel="— None (no restriction) —"
                onChange={v=>setPForm(p=>({...p, accessLevelIds:v}))}
                options={levels.filter(l=>l.active!==false).map(l=>({value:String(l.id),label:l.name}))} />
              <MultiSel label="Area" values={pForm.areaIds} allLabel="— All Areas —"
                onChange={v=>setPForm(p=>({...p,areaIds:v}))}
                options={areas.map(a=>({value:String(a.id),label:'  '.repeat(a.depth||0)+a.name}))} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setPModal(false)}>Cancel</button>
              <SaveButton onClick={handleSavePerson} />
            </div>
          </div>
        </div>
      )}

      {/* ══ BY DEPT MODAL ══ */}
      {dModal&&(
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:460 }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2>🏗️ Set Access By Department</h2>
              <button className="modal-close" onClick={()=>setDModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <Sel label="Department *" value={dForm.department} allLabel="— Select Department —"
                onChange={v=>setDForm(p=>({...p,department:v}))} required
                options={depts.map(d=>({value:d,label:d}))} />
              <Sel label="Access Level" value={dForm.accessLevelId} allLabel="— Custom —"
                onChange={v=>setDForm(p=>({...p,accessLevelId:v}))}
                options={levels.filter(l=>l.active!==false).map(l=>({value:String(l.id),label:l.name}))} />
              <Sel label="Time Zone" value={dForm.timezoneId} allLabel="— None —"
                onChange={v=>setDForm(p=>({...p,timezoneId:v}))}
                options={timezones.map(t=>({value:String(t.id),label:t.name}))} />
              <Sel label="Area" value={dForm.areaId} allLabel="— All Areas —"
                onChange={v=>setDForm(p=>({...p,areaId:v}))}
                options={areas.map(a=>({value:String(a.id),label:'  '.repeat(a.depth||0)+a.name}))} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setDModal(false)}>Cancel</button>
              <SaveButton onClick={handleSaveDept} />
            </div>
          </div>
        </div>
      )}

      {/* ══ HOLIDAY MODAL ══ */}
      {hlModal&&(
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:480 }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2>{hlEdit?'✏️ Edit':'+'} Holiday</h2>
              <button className="modal-close" onClick={()=>setHlModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group" style={{ marginBottom:12 }}>
                <label className="form-label" style={{ fontSize:12 }}>Holiday Name *</label>
                <input className="form-control" value={hlForm.holidayName}
                  onChange={e=>setHlForm(p=>({...p,holidayName:e.target.value}))}
                  placeholder="e.g. New Year, Dashain" />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label" style={{ fontSize:12 }}>Start Date *</label>
                  <EnglishDatePicker value={hlForm.startDate}
                    onChange={v=>setHlForm(p=>({...p,startDate:v}))} />
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label" style={{ fontSize:12 }}>End Date *</label>
                  <EnglishDatePicker value={hlForm.endDate}
                    onChange={v=>setHlForm(p=>({...p,endDate:v}))} />
                </div>
              </div>
              <Sel label="Time Zone (holiday access)" value={hlForm.timezoneId} allLabel="— Default (UID 1) —"
                onChange={v=>setHlForm(p=>({...p,timezoneId:v}))}
                options={timezones.map(t=>({value:String(t.id),label:t.name}))} />
              <div className="form-group" style={{ marginBottom:0 }}>
                <label className="form-label" style={{ fontSize:12 }}>Remarks</label>
                <input className="form-control" value={hlForm.remarks}
                  onChange={e=>setHlForm(p=>({...p,remarks:e.target.value}))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setHlModal(false)}>Cancel</button>
              <SaveButton onClick={handleSaveHoliday} />
            </div>
          </div>
        </div>
      )}

      {/* Delete confirms */}
      {[
        { cond:tzDelConf,  msg:'Delete this time zone?',    onConfirm:async()=>{ await api.delete(`/zkteco/timezones/${tzDelConf}`);   toast2('Deleted');setTzDelConf(null);load(); }, onClose:()=>setTzDelConf(null) },
        { cond:lvDelConf,  msg:'Delete this access level?', onConfirm:async()=>{ await api.delete(`/zkteco/access-levels/${lvDelConf}`);toast2('Deleted');setLvDelConf(null);load(); }, onClose:()=>setLvDelConf(null) },
        { cond:pDelConf,   msg:'Remove this person access?',onConfirm:async()=>{ await api.delete(`/zkteco/person-access/${pDelConf}`); toast2('Removed');setPDelConf(null); load(); }, onClose:()=>setPDelConf(null) },
        { cond:dDelConf,   msg:'Remove this dept access?',  onConfirm:async()=>{ await api.delete(`/zkteco/dept-access/${dDelConf}`);   toast2('Removed');setDDelConf(null); load(); }, onClose:()=>setDDelConf(null) },
        { cond:hlDelConf,  msg:'Delete this holiday?',      onConfirm:async()=>{ await api.delete(`/zkteco/acc-holidays/${hlDelConf}`); toast2('Deleted');setHlDelConf(null);load(); }, onClose:()=>setHlDelConf(null) },
      ].filter(c=>c.cond).map((c,i)=>(
        <div key={i} className="modal-overlay">
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ Confirm</h2><button className="modal-close" onClick={c.onClose}>✕</button></div>
            <div className="modal-body"><p>{c.msg}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={c.onClose}>Cancel</button>
              <button className="btn btn-danger" onClick={async()=>{try{await c.onConfirm();}catch(err){toast2(err.message,'danger');}}}>🗑 Delete</button>
            </div>
          </div>
        </div>
      ))}

      {/* Toast */}
      {toast&&(
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            <span>{toast.type==='success'?'✅':'❌'}</span>
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ZKTecoAccessTab;
