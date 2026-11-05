import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import api from '../../api/client.js';
import EmpMultiSelect from '../Common/EmpMultiSelect.jsx';
import { hqBranchName, isHQBranch } from '../../utils/branchUtils.js';

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
const DeptGroup = ({ deptName, branchName, members, assignments, onChange, employees, postMap, showBranch }) => {
  const getNames = (ids) => {
    if (!ids || ids.length === 0) return null;
    return employees.filter(e => (ids).includes(String(e.id))).map(e => e.fullName).join(', ');
  };

  return (
    <>
      {/* staff rows */}
      {members.map((emp, mi) => {
        const asgn      = assignments[emp.id] || {};
        const recoIds   = Array.isArray(asgn.reco)     ? asgn.reco     : (asgn.reco     ? [asgn.reco]     : []);
        const apprIds   = Array.isArray(asgn.approval) ? asgn.approval : (asgn.approval ? [asgn.approval] : []);
        const recoNames = getNames(recoIds);
        const apprNames = getNames(apprIds);
        return (
          <tr key={emp.id} style={{ background: mi % 2 === 0 ? '#fff' : '#fafafa' }}>
            {showBranch && (
              <TD style={{ background:'transparent', color:'#6b7280', fontSize:12 }}>
                {mi === 0 ? (branchName || '—') : ''}
              </TD>
            )}
            <TD style={{ background:'transparent', color:'#6b7280', fontSize:12 }}>
              {mi === 0 ? (deptName || '—') : ''}
            </TD>
            <TD>
              <div style={{ fontWeight:600, color:'#111827', fontSize:13 }}>
                {emp.fullName}
                {emp.position && (
                  <span style={{ fontWeight:400, color:'#374151', fontSize:12 }}>
                    {` — ${emp.position}`}
                  </span>
                )}
              </div>
            </TD>
            <TD style={{ minWidth:210 }}>
              <EmpMultiSelect value={recoIds} employees={employees} postMap={postMap} showAvatars
                formatLabel={staffLabel}
                subLabel={e => staffSubLabel(e, postMap)}
                onChange={v => onChange({ [emp.id]: { ...asgn, reco: v } })} />
              {recoNames && <div style={{ fontSize:10, color:'#059669', marginTop:2 }}>✓ {recoNames}</div>}
            </TD>
            <TD style={{ minWidth:210 }}>
              <EmpMultiSelect value={apprIds} employees={employees} postMap={postMap} showAvatars
                formatLabel={staffLabel}
                subLabel={e => staffSubLabel(e, postMap)}
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
  const [filterBranch, setFilterBranch] = useState('');
  const [filterDept,   setFilterDept]   = useState('');
  const [draftFilter,  setDraftFilter]  = useState({ name:'', branch:'', dept:'' });
  const filtersActive = !!(filterName || filterBranch || filterDept);
  const searchBoxRef = useRef(null);

  useEffect(() => {
    if (!searchOpen) return;
    const close = (e) => { if (!searchBoxRef.current?.contains(e.target)) setSearchOpen(false); };
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
    if (filterBranch && e.branch !== filterBranch) return false;
    if (filterDept && e.department !== filterDept) return false;
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

  const openSearch = () => { setDraftFilter({ name:filterName, branch:filterBranch, dept:filterDept }); setSearchOpen(true); };
  const applySearch = () => {
    setFilterName(draftFilter.name); setFilterBranch(draftFilter.branch); setFilterDept(draftFilter.dept);
    setSearchOpen(false);
  };
  const resetSearch = () => {
    setDraftFilter({ name:'', branch:'', dept:'' });
    setFilterName(''); setFilterBranch(''); setFilterDept('');
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

          <div ref={searchBoxRef} style={{ position:'relative' }}>
            <button onClick={() => (searchOpen ? setSearchOpen(false) : openSearch())} style={{
              display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px',
              border:`1.5px solid ${filtersActive ? '#1a56db' : '#d1d5db'}`, borderRadius:7,
              background: filtersActive ? '#eff6ff' : '#fff', color: filtersActive ? '#1e40af' : '#374151',
              fontSize:12.5, fontWeight:600, cursor:'pointer' }}>
              🔍 Search
              {filtersActive && (
                <span style={{ background:'#1a56db', color:'#fff', borderRadius:10, fontSize:10, fontWeight:700,
                  padding:'1px 6px', minWidth:16, textAlign:'center' }}>
                  {[filterName, filterBranch, filterDept].filter(Boolean).length}
                </span>
              )}
            </button>

            {searchOpen && (
              <div
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setSearchOpen(false); } }}
                style={{ position:'absolute', top:'calc(100% + 6px)', right:0, zIndex:50, width:300,
                  background:'#fff', border:'1px solid #d1d5db', borderRadius:10,
                  boxShadow:'0 10px 28px rgba(0,0,0,.16)', padding:16 }}>
                <div style={{ fontSize:13, fontWeight:700, color:'#111827', marginBottom:12 }}>Search Staff</div>

                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:11.5, fontWeight:600, color:'#6b7280', display:'block', marginBottom:4 }}>Staff Name</label>
                  <input type="text" value={draftFilter.name} autoFocus
                    onChange={e => setDraftFilter(f => ({ ...f, name:e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') applySearch(); }}
                    placeholder="Search by name…"
                    style={{ width:'100%', boxSizing:'border-box', padding:'7px 10px', border:'1px solid #d1d5db',
                      borderRadius:6, fontSize:13, outline:'none' }} />
                </div>

                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:11.5, fontWeight:600, color:'#6b7280', display:'block', marginBottom:4 }}>Branch</label>
                  <select value={draftFilter.branch} onChange={e => setDraftFilter(f => ({ ...f, branch:e.target.value }))}
                    style={{ width:'100%', boxSizing:'border-box', padding:'7px 10px', border:'1px solid #d1d5db',
                      borderRadius:6, fontSize:13, outline:'none', background:'#fff' }}>
                    <option value="">All Branches</option>
                    {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11.5, fontWeight:600, color:'#6b7280', display:'block', marginBottom:4 }}>Department</label>
                  <select value={draftFilter.dept} onChange={e => setDraftFilter(f => ({ ...f, dept:e.target.value }))}
                    style={{ width:'100%', boxSizing:'border-box', padding:'7px 10px', border:'1px solid #d1d5db',
                      borderRadius:6, fontSize:13, outline:'none', background:'#fff' }}>
                    <option value="">All Depts</option>
                    {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
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
        <div style={{ flex:1, minHeight:0, overflow:'auto', padding:'0 24px 14px' }}>
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
            <table style={{ width:'100%', minWidth:620, borderCollapse:'collapse', border:'1px solid #dedede' }}>
              <thead>
                <tr>
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
          <div style={{ fontSize:12, color: saveError ? '#dc2626' : '#6b7280' }}>
            {saveError ? `⚠ ${saveError}`
              : !canSave ? `👁 View only · ${activeEmps.length} total staff · ${configured} configured`
              : `${activeEmps.length} total staff · ${configured} configured`}
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} style={{ padding:'8px 20px', border:'1.5px solid #d1d5db',
              borderRadius:8, background:'#fff', fontSize:13, fontWeight:600, color:'#374151', cursor:'pointer' }}>
              Cancel
            </button>
            {canSave && (
              <button onClick={handleSave} disabled={saving || loading} title="Ctrl+S" style={{ padding:'8px 24px', border:'none', borderRadius:8,
                background: saved ? '#059669' : '#1a56db', color:'#fff', opacity: (saving || loading) ? 0.7 : 1,
                fontSize:13, fontWeight:700, cursor: (saving || loading) ? 'default' : 'pointer', boxShadow:'0 2px 8px rgba(26,86,219,.3)' }}>
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
