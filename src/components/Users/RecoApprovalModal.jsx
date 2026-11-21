import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import api from '../../api/client.js';
import EmpMultiSelect from '../Common/EmpMultiSelect.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import '../DataGrid/DataGrid.css';   // the staff grid uses the standard DataGrid look (.dg-th / .dg-td)
import { hqBranchName, isHQBranch } from '../../utils/branchUtils.js';

/* ── table helpers — same grid look and row height as the Staff Detail DataGrid (DataGrid.css: .dg-th / .dg-td) ── */
const TH = ({ children, wide, className = '', style: s }) => (
  <th className={`dg-th ${className}`} style={{ textAlign:'left', color:'#000', minWidth: wide ? 230 : undefined, position:'sticky', top:0, zIndex:2, ...s }}>
    {children}
  </th>
);
const TD = ({ children, style: s, className = '' }) => (
  <td className={`dg-td ${className}`} style={{ color:'#000', ...s }}>
    {children}
  </td>
);

/* Name alone — deliberately omits the [deviceId] tag EmpMultiSelect shows by
   default elsewhere (e.g. Task assignment): on this screen, picking a
   recommender/approver by their internal device PIN was more noise than
   help. Staff ID and Post move to the smaller sub-line below (staffSubLabel)
   instead, mainly to tell apart staff who share the same name. */
const staffLabel = (e) => e.fullName;
const staffSubLabel = (e, postMap) => {
  const post = postMap[e.position] || e.position || '';
  return [e.employeeId, post].filter(Boolean).join(' - ');
};

/* ── department group ── */
const DeptGroup = ({ deptName, branchName, members, assignments, onChange, employees, postMap, showBranch, startSn = 1, shortOf = (_, n) => n }) => (
  <>
    {members.map((emp, mi) => {
      const asgn    = assignments[emp.id] || {};
      const recoIds = Array.isArray(asgn.reco)     ? asgn.reco     : (asgn.reco     ? [asgn.reco]     : []);
      const apprIds = Array.isArray(asgn.approval) ? asgn.approval : (asgn.approval ? [asgn.approval] : []);
      return (
        <tr key={emp.id} className="dg-row">
          <TD className="dg-sn-col">{startSn + mi}</TD>
          {showBranch && <TD title={branchName || ''}>{mi === 0 ? (shortOf('branches', branchName) || '—') : ''}</TD>}
          <TD title={deptName || ''}>{mi === 0 ? (shortOf('departments', deptName) || '—') : ''}</TD>
          <TD>{emp.fullName}{emp.position && <span style={{ color:'#6b7280' }}>{` — ${emp.position}`}</span>}</TD>
          <TD style={{ minWidth:210, whiteSpace:'normal' }}>
            <EmpMultiSelect compact value={recoIds} employees={employees} postMap={postMap} showAvatars
              formatLabel={staffLabel}
              subLabel={e => staffSubLabel(e, postMap)}
              onChange={v => onChange({ [emp.id]: { ...asgn, reco: v } })} />
          </TD>
          <TD style={{ minWidth:210, whiteSpace:'normal' }}>
            <EmpMultiSelect compact value={apprIds} employees={employees} postMap={postMap} showAvatars
              formatLabel={staffLabel}
              subLabel={e => staffSubLabel(e, postMap)}
              onChange={v => onChange({ [emp.id]: { ...asgn, approval: v } })} />
          </TD>
        </tr>
      );
    })}
  </>
);

/* ═══════════════════════════════════════════════════
   MAIN MODAL
═══════════════════════════════════════════════════ */
const RecoApprovalModal = ({ employees, onClose }) => {
  const { canEdit } = useAuth();
  const canSave = canEdit('recoApprovalConfig');
  const { settings, updateSettings } = useSettings();

  const [assignments,      setAssignments]      = useState({});
  const [isRecoCompulsory, setIsRecoCompulsory] = useState(!!settings.recoApprovalCompulsory);
  const [loading,          setLoading]          = useState(true);
  const [loadError,        setLoadError]        = useState('');
  const [saving,           setSaving]           = useState(false);
  const [saveError,        setSaveError]        = useState('');
  const [saved,            setSaved]            = useState(false);
  const [activeSection,    setActiveSection]    = useState('company');
  const [applyAllReco,     setApplyAllReco]     = useState(false);
  const [applyAllApproval, setApplyAllApproval] = useState(false);
  const [globalRecoIds,     setGlobalRecoIds]     = useState([]);
  const [globalApprovalIds, setGlobalApprovalIds] = useState([]);

  const [searchOpen,   setSearchOpen]   = useState(false);
  const [filterName,   setFilterName]   = useState('');
  const [filterBranch, setFilterBranch] = useState([]);   // multi-select (check boxes)
  const [filterDept,   setFilterDept]   = useState([]);
  const [draftFilter,  setDraftFilter]  = useState({ branch:[], dept:[] });
  const filtersActive = !!(filterName || filterBranch.length || filterDept.length);
  const popupFilterCount = (filterBranch.length ? 1 : 0) + (filterDept.length ? 1 : 0);
  const searchBoxRef = useRef(null);

  useEffect(() => {
    if (!searchOpen) return;
    // clicks inside an open drop-down list (portaled to <body>) don't count as "outside"
    const close = (e) => { if (!searchBoxRef.current?.contains(e.target) && !e.target.closest?.('[data-dd-open]')) setSearchOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [searchOpen]);

  /* DB is the source of truth — always load fresh on open, never trust
     whatever's cached in this browser's localStorage (that was the whole
     bug: a purely per-browser save that looked successful but never
     actually persisted anywhere shared). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get('/reco-approval');
        if (!cancelled) setAssignments(data || {});
      } catch (e) {
        if (!cancelled) setLoadError(e.message || 'Failed to load saved configuration.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Escape closes the whole modal — but only once nothing narrower already
  // consumed it; each EmpMultiSelect's own Escape handler closes just its
  // open list first and calls stopPropagation so it never reaches here.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeEmps = employees.filter(e => e.active !== false);
  const companyHQ  = hqBranchName(settings);

  // Branch / Department short names (Settings → shortName), full name kept as the cell tooltip
  const shortOf = useCallback((list, name) => {
    if (!name) return name;
    const rec = (settings[list] || []).find(x => x.name === name);
    return rec?.shortName || rec?.short_name || name;
  }, [settings.branches, settings.departments]);

  const postMap = useMemo(() => {
    const m = {};
    (settings.posts || []).forEach(p => { if (p.name && p.shortName) m[p.name] = p.shortName; });
    return m;
  }, [settings.posts]);

  const hqEmps = useMemo(() =>
    activeEmps.filter(e => isHQBranch(e.branch, settings)), [activeEmps, settings]);

  /* Search — narrows which staff rows are DISPLAYED in the active tab, AND
     narrows the header "apply for all" target to just those matching rows
     (previously always applied org-wide regardless of an active filter —
     e.g. filtering to one branch and using "apply for all" there still
     silently overwrote every OTHER branch's assignments too). The picker's
     own choices (employees={activeEmps} below) intentionally stay
     unfiltered — you may still want to pick someone from another branch as
     this filtered group's recommender/approver. */
  const branchOptions = useMemo(() =>
    [...new Set(activeEmps.map(e => e.branch).filter(Boolean))].sort(), [activeEmps]);
  const deptOptions = useMemo(() =>
    [...new Set(activeEmps.map(e => e.department).filter(Boolean))].sort(), [activeEmps]);

  const matchesFilter = useCallback((e) => {
    if (filterBranch.length && !filterBranch.includes(e.branch)) return false;
    if (filterDept.length && !filterDept.includes(e.department)) return false;
    if (filterName && !e.fullName?.toLowerCase().includes(filterName.toLowerCase())) return false;
    return true;
  }, [filterName, filterBranch, filterDept]);

  const filteredActiveEmps = useMemo(() => activeEmps.filter(matchesFilter), [activeEmps, matchesFilter]);

  const companyGroups = useMemo(() => {
    const map = {};
    hqEmps.filter(matchesFilter).forEach(e => { const d = e.department || '(No Department)'; if (!map[d]) map[d] = []; map[d].push(e); });
    return Object.entries(map).sort(([a],[b]) => a.localeCompare(b)).map(([dept, members]) => ({ dept, members }));
  }, [hqEmps, matchesFilter]);

  const branchGroups = useMemo(() => {
    const branchEmps = activeEmps.filter(e => !isHQBranch(e.branch, settings)).filter(matchesFilter);
    const map = {};
    branchEmps.forEach(e => {
      const k = `${e.branch}||${e.department || '(No Department)'}`;
      if (!map[k]) map[k] = { branch: e.branch, dept: e.department || '(No Department)', members: [] };
      map[k].members.push(e);
    });
    return Object.values(map).sort((a,b) => a.branch.localeCompare(b.branch) || a.dept.localeCompare(b.dept));
  }, [activeEmps, settings, matchesFilter]);

  const openSearch = () => { setDraftFilter({ branch:filterBranch, dept:filterDept }); setSearchOpen(true); };
  const applySearch = () => {
    setFilterBranch(draftFilter.branch); setFilterDept(draftFilter.dept);
    setSearchOpen(false);
  };
  const resetSearch = () => {
    setDraftFilter({ branch:[], dept:[] });
    setFilterBranch([]); setFilterDept([]);
    setSearchOpen(false);
  };

  const handleChange = useCallback((patch) => {
    setAssignments(prev => {
      const next = { ...prev };
      Object.entries(patch).forEach(([id, vals]) => { next[id] = { ...prev[id], ...vals }; });
      return next;
    });
  }, []);

  /* Header-level "apply for all" — broadcasts to every staff member shown
     across BOTH Company HQ and Branch Wise sections (not just the active
     tab), but only within whatever the current search filter matches —
     see filteredActiveEmps above. */
  const applyGlobalReco = useCallback((ids) => {
    const patch = {};
    filteredActiveEmps.forEach(m => { patch[m.id] = { reco: ids }; });
    handleChange(patch);
  }, [filteredActiveEmps, handleChange]);

  const applyGlobalApproval = useCallback((ids) => {
    const patch = {};
    filteredActiveEmps.forEach(m => { patch[m.id] = { approval: ids }; });
    handleChange(patch);
  }, [filteredActiveEmps, handleChange]);

  /* "Clear all" (in either header picker's footer) wipes every staff
     member's Recommendator AND Approval assignment — client-side only
     until Save Configuration is clicked, same as every other edit here. */
  const clearAllAssignments = useCallback(() => {
    if (!window.confirm('Clear Recommendator and Approval for every staff member?\n\nYou still need to click Save Configuration afterward to make this permanent.')) return;
    setAssignments({});
    setApplyAllReco(false); setGlobalRecoIds([]);
    setApplyAllApproval(false); setGlobalApprovalIds([]);
  }, []);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError('');
    try {
      await api.put('/reco-approval', assignments);
      await updateSettings({ recoApprovalCompulsory: isRecoCompulsory });
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 1200);
    } catch (e) {
      setSaveError(e.message || 'Save failed — please try again.');
    } finally {
      setSaving(false);
    }
  };

  /* Ctrl+S saves — this component only exists while its modal is open */
  useSaveShortcut(canSave, handleSave);

  const configured = Object.values(assignments).filter(a => {
    const r = Array.isArray(a?.reco)     ? a.reco.length     : (a?.reco     ? 1 : 0);
    const p = Array.isArray(a?.approval) ? a.approval.length : (a?.approval ? 1 : 0);
    return r > 0 || p > 0;
  }).length;

  return (
    <div className="modal-overlay" style={{ zIndex:1100 }}>
      {/* Same look as the global form style (ui-kit.css "GLOBAL FORM LOOK"): grey header bar, content in one
          white rounded card on a grey form, grey footer with compact buttons. */}
      <div onClick={e => e.stopPropagation()} style={{
        background:'var(--ui-modal-body-bg, #f8fafc)', borderRadius:'var(--ui-modal-radius, 16px)',
        width:'calc(100vw - 32px)', maxWidth:'none', height:'calc(100vh - 32px)',   // fills the screen at any resolution
        display:'flex', flexDirection:'column',
        boxShadow:'0 30px 80px rgba(15,23,42,.35)',
        animation:'slideUp .25s ease', zIndex:1101, position:'relative',
      }}>

        {/* Header — title, then "Is Recommendation Compulsory" (left, amber box), ✕ on the right */}
        <div style={{ padding:'14px 20px', minHeight:64, boxSizing:'border-box', borderBottom:'1px solid var(--ui-modal-line, #e2e8f0)',
          background:'var(--ui-modal-head-bg, #f8fafc)', borderRadius:'var(--ui-modal-radius, 16px) var(--ui-modal-radius, 16px) 0 0', flexShrink:0,
          display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontSize:'var(--ui-modal-title-font, 17px)', fontWeight:'var(--ui-modal-title-weight, 700)', color:'var(--ui-modal-title-color, #0f2a3d)' }}>
            👥 Set Recommendator &amp; Approval
            {configured > 0 && <span style={{ marginLeft:8, background:'#dbeafe', color:'#1e40af', verticalAlign:'middle',
              borderRadius:10, padding:'1px 8px', fontWeight:700, fontSize:11 }}>{configured} configured</span>}
          </div>
          <label htmlFor="recoCompulsory" title="When ticked, the approval button stays disabled until the assigned recommendator has recommended the leave / office visit."
            style={{ marginLeft:12, display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer', whiteSpace:'nowrap',
              padding:'4px 10px', borderRadius:8, background: isRecoCompulsory ? '#fde68a' : '#fef3c7',
              border:`1.5px solid ${isRecoCompulsory ? '#d97706' : '#fcd34d'}`,
              boxShadow: isRecoCompulsory ? '0 0 0 2px #fef3c7' : '0 1px 2px rgba(15,23,42,.05)',
              fontSize:12, fontWeight:700, color:'#111827', transition:'border .2s' }}>
            <input type="checkbox" id="recoCompulsory" checked={isRecoCompulsory}
              onChange={e => setIsRecoCompulsory(e.target.checked)}
              style={{ accentColor:'#f59e0b', width:13, height:13, margin:0, padding:0, flexShrink:0, alignSelf:'center', display:'block', cursor:'pointer' }} />
            Is Recommendation Compulsory
            {isRecoCompulsory && <span style={{ background:'#fff', color:'#92400e',
              borderRadius:8, padding:'1px 8px', fontSize:11, fontWeight:700 }}>Enabled</span>}
          </label>
          <button onClick={onClose} title="Close (Esc)" style={{ marginLeft:'auto', background:'#fff', border:'none', borderRadius:10,
            width:32, height:32, fontSize:14, cursor:'pointer', color:'var(--ui-modal-title-color, #0f2a3d)',
            boxShadow:'0 1px 3px rgba(15,23,42,.12)',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>✕</button>
        </div>

        {/* Content card: tabs + table */}
        <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', margin:'14px 18px', background:'#fff',
          border:'1px solid var(--ui-card-border, #e8edf5)', borderRadius:'var(--ui-card-radius, 14px)', overflow:'hidden',
          boxShadow:'0 1px 2px rgba(15,23,42,.04)' }}>

        {/* Tabs */}
        <div style={{ padding:'0 24px', borderBottom:'1px solid #e5e7eb', background:'#f8fafc', flexShrink:0,
          display:'flex', alignItems:'center', justifyContent:'space-between', position:'relative' }}>
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

          <div ref={searchBoxRef} style={{ position:'relative', display:'flex', alignItems:'center', gap:8 }}>
            {/* live staff-name search (filters the grid as you type) */}
            <div style={{ display:'flex', alignItems:'center', width:240, height:32, background:'#fff', border:'1px solid #d1d5db', borderRadius:7 }}>
              <svg viewBox="0 0 20 20" width="14" height="14"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/></svg>
              <input type="text" value={filterName} onChange={e => setFilterName(e.target.value)} placeholder="Search staff name…"
                style={{ border:'none', outline:'none', background:'transparent', fontSize:13, flex:1, minWidth:0, fontFamily:'inherit' }} />
              {filterName && <button type="button" onClick={() => setFilterName('')} title="Clear"
                style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:15, padding:'0 8px' }}>×</button>}
            </div>
            <button onClick={() => (searchOpen ? setSearchOpen(false) : openSearch())} style={{
              display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px',
              border:`1.5px solid ${popupFilterCount ? '#1e40af' : '#1a56db'}`, borderRadius:7,
              background: popupFilterCount ? '#1e40af' : '#1a56db', color:'#fff',
              fontSize:12.5, fontWeight:600, cursor:'pointer' }}>
              🔍 Search
              {popupFilterCount > 0 && (
                <span style={{ background:'#fff', color:'#1e40af', borderRadius:10, fontSize:10, fontWeight:700,
                  padding:'1px 6px', minWidth:16, textAlign:'center' }}>
                  {popupFilterCount}
                </span>
              )}
            </button>

            {searchOpen && (
              <div
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setSearchOpen(false); } }}
                style={{ position:'absolute', top:'calc(100% + 6px)', right:0, zIndex:50, width:300,
                  background:'#fff', border:'1px solid #d1d5db', borderRadius:10,
                  boxShadow:'0 10px 28px rgba(0,0,0,.16)', padding:16 }}>
                <div style={{ fontSize:13, fontWeight:700, color:'#111827', marginBottom:12 }}>Filter Staff</div>

                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:11.5, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>Branch</label>
                  <SearchableSelect multiple value={draftFilter.branch} onChange={v => setDraftFilter(f => ({ ...f, branch:v }))}
                    placeholder="All Branches" options={branchOptions.map(b => ({ value:b, label:b }))} />
                </div>

                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11.5, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>Department</label>
                  <SearchableSelect multiple value={draftFilter.dept} onChange={v => setDraftFilter(f => ({ ...f, dept:v }))}
                    placeholder="All Departments" options={deptOptions.map(d => ({ value:d, label:d }))} />
                </div>

                <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                  <button onClick={resetSearch} style={{ padding:'6px 14px', border:'1px solid #d1d5db',
                    borderRadius:6, background:'#fff', color:'#374151', fontSize:12.5, fontWeight:600, cursor:'pointer' }}>
                    Reset
                  </button>
                  <button onClick={applySearch} style={{ padding:'6px 16px', border:'none',
                    borderRadius:6, background:'#1a56db', color:'#fff', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>
                    Search
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Table — single overflow:auto container fixes nested-scroll issue */}
        <div style={{ flex:1, minHeight:0, overflow:'auto', padding:'0 14px 12px' }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:40, color:'#9ca3af', fontSize:13 }}>
              Loading saved configuration…
            </div>
          ) : loadError ? (
            <div style={{ textAlign:'center', padding:40, color:'#dc2626', fontSize:13 }}>
              Failed to load saved configuration: {loadError}
            </div>
          ) : (activeSection==='company' ? companyGroups : branchGroups).length === 0 ? (
            <div style={{ textAlign:'center', padding:40, color:'#9ca3af', fontSize:13 }}>
              {filtersActive ? 'No staff match your search.' : 'No staff found for this section.'}
            </div>
          ) : (
            <table className="dg-table striped" style={{ width:'100%', minWidth:620, borderCollapse:'collapse', border:'1px solid #dedede' }}>
              <thead>
                <tr>
                  <TH className="dg-sn-col" style={{ textAlign:'center' }}>SN</TH>
                  {activeSection==='branch' && <TH>Branch</TH>}
                  <TH>Department</TH>
                  <TH>Staff Name</TH>
                  <TH wide>
                    <div style={{ whiteSpace:'normal' }}>
                      <div>Recommendator</div>
                      <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:10,
                        fontWeight:400, color:'#6b7280', cursor:'pointer', marginTop:3 }}>
                        <input type="checkbox" checked={applyAllReco}
                          onChange={e => { setApplyAllReco(e.target.checked); if (!e.target.checked) setGlobalRecoIds([]); }}
                          style={{ width:11, height:11, accentColor:'#1a56db', cursor:'pointer' }} />
                        {filtersActive ? 'apply to shown' : 'apply for all'}
                      </label>
                      {applyAllReco && (
                        <div style={{ marginTop:4, minWidth:200 }}>
                          <EmpMultiSelect value={globalRecoIds} employees={activeEmps} postMap={postMap} showAvatars
                            formatLabel={staffLabel}
                            subLabel={e => staffSubLabel(e, postMap)}
                            placeholder="Select Recommendators"
                            onChange={v => { setGlobalRecoIds(v); applyGlobalReco(v); }}
                            onClearAll={clearAllAssignments} />
                        </div>
                      )}
                    </div>
                  </TH>
                  <TH wide>
                    <div style={{ whiteSpace:'normal' }}>
                      <div>Approval</div>
                      <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:10,
                        fontWeight:400, color:'#6b7280', cursor:'pointer', marginTop:3 }}>
                        <input type="checkbox" checked={applyAllApproval}
                          onChange={e => { setApplyAllApproval(e.target.checked); if (!e.target.checked) setGlobalApprovalIds([]); }}
                          style={{ width:11, height:11, accentColor:'#1a56db', cursor:'pointer' }} />
                        {filtersActive ? 'apply to shown' : 'apply for all'}
                      </label>
                      {applyAllApproval && (
                        <div style={{ marginTop:4, minWidth:200 }}>
                          <EmpMultiSelect value={globalApprovalIds} employees={activeEmps} postMap={postMap} showAvatars
                            formatLabel={staffLabel}
                            subLabel={e => staffSubLabel(e, postMap)}
                            placeholder="Select Approvers"
                            onChange={v => { setGlobalApprovalIds(v); applyGlobalApproval(v); }}
                            onClearAll={clearAllAssignments} />
                        </div>
                      )}
                    </div>
                  </TH>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // running SN across the department groups, like the Staff Detail grid
                  let sn = 1;
                  const groups = activeSection === 'company' ? companyGroups : branchGroups;
                  return groups.map(g => {
                    const start = sn; sn += g.members.length;
                    return (
                      <DeptGroup key={activeSection === 'company' ? g.dept : `${g.branch}||${g.dept}`}
                        deptName={g.dept} branchName={activeSection === 'company' ? null : g.branch}
                        members={g.members} assignments={assignments} onChange={handleChange}
                        employees={activeEmps} postMap={postMap} showBranch={activeSection !== 'company'} startSn={start} shortOf={shortOf} />
                    );
                  });
                })()}
              </tbody>
            </table>
          )}
        </div>

        </div>{/* /content card */}

        {/* Footer */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'12px 20px', borderTop:'1px solid var(--ui-modal-line, #e2e8f0)', background:'var(--ui-modal-foot-bg, #f8fafc)',
          borderRadius:'0 0 var(--ui-modal-radius, 16px) var(--ui-modal-radius, 16px)', flexShrink:0 }}>
          <div style={{ fontSize:12, color: saveError ? '#dc2626' : '#6b7280' }}>
            {saveError ? `⚠ ${saveError}`
              : !canSave ? `👁 View only · ${activeEmps.length} total staff · ${configured} configured`
              : `${activeEmps.length} total staff · ${configured} configured`}
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} style={{ minHeight:32, padding:'6px 14px', border:'1px solid #dbe3ee',
              borderRadius:8, background:'#fff', fontSize:12.5, fontWeight:600, color:'#334155', cursor:'pointer' }}>
              Cancel
            </button>
            {canSave && (
              <button onClick={handleSave} disabled={saving || loading} title="Ctrl+S" style={{ minHeight:32, padding:'6px 16px', border:'none', borderRadius:8,
                background: saved ? '#059669' : 'var(--ui-btn-primary-bg, #1a56db)', color:'#fff', opacity: (saving || loading) ? 0.7 : 1,
                fontSize:12.5, fontWeight:600, cursor: (saving || loading) ? 'default' : 'pointer', boxShadow:'0 4px 12px rgba(37,99,235,.3)' }}>
                {saved ? '✅ Saved!' : saving ? 'Saving…' : <>💾 <u>S</u>ave Configuration</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecoApprovalModal;
