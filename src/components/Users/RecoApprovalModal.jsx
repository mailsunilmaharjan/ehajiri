import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../context/SettingsContext.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';

const STORAGE_KEY = 'ehajiri_reco_approval';
const loadSaved  = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } };
const persistAll = (data) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

/* ─────────────────────────────────────────────────────────
   Multi-select employee dropdown with checkboxes
   value: string[] of employee IDs
   onChange: (string[]) => void
───────────────────────────────────────────────────────── */
const EmpMultiSelect = ({ value = [], onChange, employees, postMap, placeholder = '— Select —' }) => {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const [rect,   setRect]   = useState(null);
  const trigRef = useRef(null);
  const inpRef  = useRef(null);
  const dropRef = useRef(null);

  const selected = Array.isArray(value) ? value.map(String) : (value ? [String(value)] : []);

  const options = useMemo(() => employees.map(e => {
    const short = postMap[e.position] || '';
    const dev   = e.deviceId ? ` [${e.deviceId}]` : '';
    return { id: String(e.id), label: `${e.fullName}${short ? ' '+short : ''}${dev}`, name: e.fullName };
  }), [employees, postMap]);

  const filtered  = search ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())) : options;
  const selLabels = options.filter(o => selected.includes(o.id)).map(o => o.name);

  const displayText = selLabels.length === 0 ? placeholder
    : selLabels.length === 1 ? selLabels[0]
    : `${selLabels.length} selected`;

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
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', scroll, true); };
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
        padding:'9px 10px', border:`1.5px solid ${open ? '#1a56db' : '#d1d5db'}`,
        borderRadius:6, background: selected.length > 0 ? '#f0f9ff' : '#fff',
        cursor:'pointer', fontSize:12, color: selected.length > 0 ? '#1f2937' : '#9ca3af',
        fontFamily:'inherit', boxShadow: open ? '0 0 0 2px rgba(26,86,219,.1)' : 'none',
        minHeight:38,
      }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, textAlign:'left' }}>
          {displayText}
        </span>
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
              : filtered.map(o => {
                  const checked = selected.includes(o.id);
                  return (
                    <div key={o.id} onMouseDown={e => { e.preventDefault(); toggle(o.id); }}
                      style={{ padding:'7px 10px', display:'flex', alignItems:'center', gap:8,
                        cursor:'pointer', fontSize:12,
                        background: checked ? '#eff6ff' : 'transparent',
                        borderLeft: checked ? '3px solid #1a56db' : '3px solid transparent' }}
                      onMouseEnter={e => { if (!checked) e.currentTarget.style.background='#f8fafc'; }}
                      onMouseLeave={e => { if (!checked) e.currentTarget.style.background=checked?'#eff6ff':'transparent'; }}>
                      {/* checkbox */}
                      <span style={{
                        width:14, height:14, borderRadius:3, flexShrink:0,
                        border:`2px solid ${checked ? '#1a56db' : '#d1d5db'}`,
                        background: checked ? '#1a56db' : '#fff',
                        display:'flex', alignItems:'center', justifyContent:'center',
                      }}>
                        {checked && (
                          <svg viewBox="0 0 12 12" fill="none" width="9" height="9">
                            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </span>
                      <span style={{ color: checked ? '#1a56db' : '#374151', fontWeight: checked ? 600 : 400 }}>
                        {o.label}
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
            <button type="button" onMouseDown={e => { e.preventDefault(); setOpen(false); setSearch(''); }}
              style={{ padding:'3px 12px', background:'#1a56db', color:'#fff', border:'none',
                borderRadius:5, fontSize:12, fontWeight:600, cursor:'pointer' }}>Done</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

/* ── table helpers ── */
const TH = ({ children, wide }) => (
  <th style={{
    padding:'6px 10px', background:'#efefef', color:'#374151', fontSize:14, fontWeight:700,
    borderBottom:'2px solid #dedede', borderRight:'1px solid #dedede', textAlign:'left',
    whiteSpace:'nowrap', minWidth: wide ? 230 : undefined,
    position:'sticky', top:0, zIndex:2,
  }}>
    {children}
  </th>
);
const TD = ({ children, style: s }) => (
  <td style={{ padding:'6px 10px', fontSize:13, color:'#111827', borderBottom:'1px solid #eef0f4',
    borderRight:'1px solid #e5e7eb', verticalAlign:'middle', ...s }}>
    {children}
  </td>
);

/* ── department group ── */
const DeptGroup = ({ deptName, branchName, members, assignments, onChange, employees, postMap, showBranch }) => {
  const [applyReco,     setApplyReco]     = useState(false);
  const [applyApproval, setApplyApproval] = useState(false);
  const [deptRecos,     setDeptRecos]     = useState([]);
  const [deptApprovals, setDeptApprovals] = useState([]);

  const applyAllReco = useCallback((ids) => {
    const patch = {};
    members.forEach(m => { patch[m.id] = { ...assignments[m.id], reco: ids }; });
    onChange(patch);
  }, [members, assignments, onChange]);

  const applyAllApproval = useCallback((ids) => {
    const patch = {};
    members.forEach(m => { patch[m.id] = { ...assignments[m.id], approval: ids }; });
    onChange(patch);
  }, [members, assignments, onChange]);

  const getNames = (ids) => {
    if (!ids || ids.length === 0) return null;
    return employees.filter(e => (ids).includes(String(e.id))).map(e => e.fullName).join(', ');
  };

  const rowBase = { padding:'7px 10px', background:'#f0f5ff', borderBottom:'1px solid #e0eaff',
    borderRight:'1px solid #e5e7eb', verticalAlign:'top', fontSize:11 };

  return (
    <>
      {/* dept apply-all row */}
      <tr>
        {showBranch && (
          <TD style={{ fontWeight:700, color:'#111827', background:'#faf5ff', verticalAlign:'top', paddingTop:10, width:110 }}>
            {branchName || '—'}
          </TD>
        )}
        <TD style={{ fontWeight:700, color:'#111827', background:'#f8fafc', verticalAlign:'top', paddingTop:10, width:130 }}>
          {deptName || '—'}
        </TD>
        <td style={{ ...rowBase, color:'#111827', fontWeight:600 }}>
          Apply for all in <em>{deptName}</em>
        </td>
        <td style={rowBase}>
          <label style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4, cursor:'pointer' }}>
            <input type="checkbox" checked={applyReco}
              onChange={e => { setApplyReco(e.target.checked); if (!e.target.checked) setDeptRecos([]); }}
              style={{ accentColor:'#1a56db', width:12, height:12 }} />
            <span style={{ fontSize:11, color:'#6b7280' }}>Apply Recommendator to all</span>
          </label>
          {applyReco && (
            <EmpMultiSelect value={deptRecos} employees={employees} postMap={postMap}
              placeholder="Select Recommendators"
              onChange={v => { setDeptRecos(v); applyAllReco(v); }} />
          )}
        </td>
        <td style={rowBase}>
          <label style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4, cursor:'pointer' }}>
            <input type="checkbox" checked={applyApproval}
              onChange={e => { setApplyApproval(e.target.checked); if (!e.target.checked) setDeptApprovals([]); }}
              style={{ accentColor:'#1a56db', width:12, height:12 }} />
            <span style={{ fontSize:11, color:'#6b7280' }}>Apply Approval to all</span>
          </label>
          {applyApproval && (
            <EmpMultiSelect value={deptApprovals} employees={employees} postMap={postMap}
              placeholder="Select Approvers"
              onChange={v => { setDeptApprovals(v); applyAllApproval(v); }} />
          )}
        </td>
      </tr>

      {/* staff rows */}
      {members.map((emp, mi) => {
        const asgn      = assignments[emp.id] || {};
        const recoIds   = Array.isArray(asgn.reco)     ? asgn.reco     : (asgn.reco     ? [asgn.reco]     : []);
        const apprIds   = Array.isArray(asgn.approval) ? asgn.approval : (asgn.approval ? [asgn.approval] : []);
        const recoNames = getNames(recoIds);
        const apprNames = getNames(apprIds);
        return (
          <tr key={emp.id} style={{ background: mi % 2 === 0 ? '#fff' : '#fafafa' }}>
            {showBranch && <TD style={{ background:'transparent' }} />}
            <TD style={{ background:'transparent' }} />
            <TD>
              <div style={{ fontWeight:600, color:'#111827', fontSize:13 }}>
                {emp.fullName}
                {(emp.position || emp.deviceId) && (
                  <span style={{ fontWeight:400, color:'#374151', fontSize:12 }}>
                    {emp.position ? ` — ${emp.position}` : ''}{emp.deviceId ? ` [${emp.deviceId}]` : ''}
                  </span>
                )}
              </div>
            </TD>
            <TD style={{ minWidth:210 }}>
              <EmpMultiSelect value={recoIds} employees={employees} postMap={postMap}
                onChange={v => onChange({ [emp.id]: { ...asgn, reco: v } })} />
              {recoNames && <div style={{ fontSize:10, color:'#059669', marginTop:2 }}>✓ {recoNames}</div>}
            </TD>
            <TD style={{ minWidth:210 }}>
              <EmpMultiSelect value={apprIds} employees={employees} postMap={postMap}
                onChange={v => onChange({ [emp.id]: { ...asgn, approval: v } })} />
              {apprNames && <div style={{ fontSize:10, color:'#1a56db', marginTop:2 }}>✓ {apprNames}</div>}
            </TD>
          </tr>
        );
      })}
    </>
  );
};

/* ═══════════════════════════════════════════════════
   MAIN MODAL
═══════════════════════════════════════════════════ */
const loadIsRecoCompulsory = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')._settings?.isRecoCompulsory || false; } catch { return false; }
};

const RecoApprovalModal = ({ employees, onClose }) => {
  const { settings } = useSettings();

  const [assignments,      setAssignments]      = useState(loadSaved);
  const [isRecoCompulsory, setIsRecoCompulsory] = useState(loadIsRecoCompulsory);
  const [saved,            setSaved]            = useState(false);
  const [activeSection,    setActiveSection]    = useState('company');

  const activeEmps = employees.filter(e => e.active !== false);
  const companyHQ  = settings.companyNameEn || '';

  const postMap = useMemo(() => {
    const m = {};
    (settings.posts || []).forEach(p => { if (p.name && p.shortName) m[p.name] = p.shortName; });
    return m;
  }, [settings.posts]);

  const hqEmps = useMemo(() =>
    activeEmps.filter(e =>
      companyHQ
        ? (e.branch === companyHQ || (!e.branch && (settings.branches||[]).length === 0))
        : !e.branch
    ), [activeEmps, companyHQ, settings.branches]);

  const companyGroups = useMemo(() => {
    const map = {};
    hqEmps.forEach(e => { const d = e.department || '(No Department)'; if (!map[d]) map[d] = []; map[d].push(e); });
    return Object.entries(map).sort(([a],[b]) => a.localeCompare(b)).map(([dept, members]) => ({ dept, members }));
  }, [hqEmps]);

  const branchGroups = useMemo(() => {
    const branchEmps = activeEmps.filter(e => e.branch && e.branch !== companyHQ);
    const map = {};
    branchEmps.forEach(e => {
      const k = `${e.branch}||${e.department || '(No Department)'}`;
      if (!map[k]) map[k] = { branch: e.branch, dept: e.department || '(No Department)', members: [] };
      map[k].members.push(e);
    });
    return Object.values(map).sort((a,b) => a.branch.localeCompare(b.branch) || a.dept.localeCompare(b.dept));
  }, [activeEmps, companyHQ]);

  const handleChange = useCallback((patch) => {
    setAssignments(prev => {
      const next = { ...prev };
      Object.entries(patch).forEach(([id, vals]) => { next[id] = { ...prev[id], ...vals }; });
      return next;
    });
  }, []);

  const handleSave = () => {
    const data = { ...assignments, _settings: { isRecoCompulsory } };
    persistAll(data);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 1200);
  };

  /* Ctrl+S saves — this component only exists while its modal is open */
  useSaveShortcut(true, handleSave);

  const configured = Object.values(assignments).filter(a => {
    const r = Array.isArray(a?.reco)     ? a.reco.length     : (a?.reco     ? 1 : 0);
    const p = Array.isArray(a?.approval) ? a.approval.length : (a?.approval ? 1 : 0);
    return r > 0 || p > 0;
  }).length;

  return (
    <div className="modal-overlay" style={{ zIndex:1100 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:'#fff', borderRadius:14,
        width:'96vw', maxWidth:1350, height:'90vh',
        display:'flex', flexDirection:'column',
        boxShadow:'0 25px 60px rgba(0,0,0,.3)',
        animation:'slideUp .25s ease', zIndex:1101, position:'relative',
      }}>

        {/* Header */}
        <div style={{ padding:'14px 24px', borderBottom:'2px solid #e5e7eb',
          background:'#ffffff',
          borderRadius:'14px 14px 0 0', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16 }}>
            <div>
              <div style={{ fontSize:16, fontWeight:800, color:'#111827' }}>
                👥 Set Recommendator &amp; Approval
              </div>
              <div style={{ fontSize:13, color:'#374151', marginTop:2 }}>
                Configure who recommends and approves leave &amp; office visits — select multiple people per staff member
                {configured > 0 && <span style={{ marginLeft:8, background:'#dbeafe', color:'#1e40af',
                  borderRadius:10, padding:'1px 8px', fontWeight:700, fontSize:11 }}>{configured} configured</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ background:'#f3f4f6', border:'none', borderRadius:'50%',
              width:34, height:34, fontSize:18, cursor:'pointer', color:'#6b7280',
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>×</button>
          </div>

          {/* ── Is Recommendation Compulsory ── */}
          <div style={{ marginTop:12, padding:'10px 14px', background:'white', borderRadius:8,
            border:`1.5px solid ${isRecoCompulsory ? '#f59e0b' : '#e2e8f0'}`,
            boxShadow: isRecoCompulsory ? '0 0 0 2px #fef3c7' : 'none',
            transition:'border .2s', display:'flex', alignItems:'flex-start', gap:10 }}>
            <input type="checkbox" id="recoCompulsory" checked={isRecoCompulsory}
              onChange={e => setIsRecoCompulsory(e.target.checked)}
              style={{ accentColor:'#f59e0b', width:16, height:16, marginTop:2, cursor:'pointer', flexShrink:0 }} />
            <div>
              <label htmlFor="recoCompulsory" style={{ fontSize:13, fontWeight:700, color:'#111827', cursor:'pointer', display:'block' }}>
                Is Recommendation Compulsory
                {isRecoCompulsory && <span style={{ marginLeft:8, background:'#fef3c7', color:'#92400e',
                  borderRadius:8, padding:'1px 8px', fontSize:11, fontWeight:700 }}>Enabled</span>}
              </label>
              <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>
                When enabled: leave &amp; office visit applications must be recommended first before the approval button becomes active.
                The approval button stays disabled until the assigned recommendator has approved.
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ padding:'0 24px', borderBottom:'1px solid #e5e7eb', background:'#f8fafc', flexShrink:0 }}>
          <div style={{ display:'inline-flex', paddingTop:8 }}>
            {[
              { key:'company', label:`🏢 Company HQ${companyHQ ? ' — '+companyHQ : ''}` },
              { key:'branch',  label:'🌿 Branch Wise' },
            ].map(s => (
              <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
                padding:'7px 20px', border:'none', cursor:'pointer', fontFamily:'inherit',
                fontSize:13, fontWeight: activeSection===s.key ? 700 : 500,
                background: activeSection===s.key ? '#fff' : 'transparent',
                color: activeSection===s.key ? '#1a56db' : '#6b7280',
                borderBottom: activeSection===s.key ? '2px solid #1a56db' : '2px solid transparent',
                borderRadius:'6px 6px 0 0',
              }}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* Table — single overflow:auto container fixes nested-scroll issue */}
        <div style={{ flex:1, minHeight:0, overflow:'auto', padding:'14px 24px' }}>
          {(activeSection==='company' ? companyGroups : branchGroups).length === 0 ? (
            <div style={{ textAlign:'center', padding:40, color:'#9ca3af', fontSize:13 }}>
              No staff found for this section.
            </div>
          ) : (
            <table style={{ width:'100%', minWidth:620, borderCollapse:'collapse', border:'1px solid #dedede' }}>
              <thead>
                <tr>
                  {activeSection==='branch' && <TH>Branch</TH>}
                  <TH>Department</TH>
                  <TH>Staff Name</TH>
                  <TH wide>Recommendator</TH>
                  <TH wide>Approval</TH>
                </tr>
              </thead>
              <tbody>
                {activeSection==='company'
                  ? companyGroups.map(g => (
                      <DeptGroup key={g.dept} deptName={g.dept} branchName={null}
                        members={g.members} assignments={assignments} onChange={handleChange}
                        employees={activeEmps} postMap={postMap} showBranch={false} />
                    ))
                  : branchGroups.map(g => (
                      <DeptGroup key={`${g.branch}||${g.dept}`} deptName={g.dept} branchName={g.branch}
                        members={g.members} assignments={assignments} onChange={handleChange}
                        employees={activeEmps} postMap={postMap} showBranch={true} />
                    ))
                }
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'11px 24px', borderTop:'1px solid #e5e7eb', background:'#f9fafb',
          borderRadius:'0 0 14px 14px', flexShrink:0 }}>
          <div style={{ fontSize:12, color:'#6b7280' }}>
            {activeEmps.length} total staff · {configured} configured
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} style={{ padding:'8px 20px', border:'1.5px solid #d1d5db',
              borderRadius:8, background:'#fff', fontSize:13, fontWeight:600, color:'#374151', cursor:'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSave} title="Ctrl+S" style={{ padding:'8px 24px', border:'none', borderRadius:8,
              background: saved ? '#059669' : '#1a56db', color:'#fff',
              fontSize:13, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 8px rgba(26,86,219,.3)' }}>
              {saved ? '✅ Saved!' : <>💾 <u>S</u>ave Configuration</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecoApprovalModal;
