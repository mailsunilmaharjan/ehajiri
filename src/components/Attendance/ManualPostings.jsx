import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import DataGrid        from '../DataGrid/DataGrid.jsx';
import Avatar          from '../Common/Avatar.jsx';
import HoverCard       from '../Common/HoverCard.jsx';
import NepaliDatePicker  from '../Common/NepaliDatePicker.jsx';
import EnglishDatePicker from '../Common/EnglishDatePicker.jsx';
import SearchableSelect  from '../Common/SearchableSelect.jsx';
import SearchableCheckSelect from '../Common/SearchableCheckSelect.jsx';
import SaveButton        from '../Common/SaveButton.jsx';
import LastSavedBy       from '../Common/LastSavedBy.jsx';
import useSaveShortcut   from '../../hooks/useSaveShortcut.js';
import useDateFormat     from '../../hooks/useDateFormat.js';
import useRecoApproval    from '../../hooks/useRecoApproval.js';
import { getDeviceInfo } from '../../utils/deviceInfo.js';

const empty = { employeeId: '', date: '', checkIn: '', checkOut: '', remark: '', recommendedBy: '', approvedBy: '',
  updatedByName: '', updatedAt: null, updatedDevice: '' };

const TimeInput = ({ value, onChange, placeholder }) => (
  <input
    type="time"
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    style={{
      height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7,
      padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none',
    }}
  />
);

const DateInput = ({ value, onChange }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} />;
  }
  return <EnglishDatePicker value={value} onChange={onChange} />;
};

/* ── Advance Search ─────────────────────────────────────────── */
const EMPTY_FILTERS = { _status:'working', fiscalYear:'', branch:'', dept:'', post:'', shift:'' };

const AdvanceSearchModal = ({ filters, onApply, onClose, settings, employees, shifts }) => {
  const [local, setLocal] = useState({ ...filters });
  const set = (k, v) => setLocal(p => ({ ...p, [k]: v }));

  const activeFlag = (local._status || 'working') === 'working';
  const activeEmps = employees.filter(e => (e.active !== false) === activeFlag);

  const fiscalYears = (settings.fiscalYears || []).map(fy => ({ value: fy.name, label: fy.name }));
  const branches    = [...new Set(activeEmps.map(e => e.branch).filter(Boolean))].sort().map(b => ({ value:b, label:b }));
  const depts       = [...new Set(activeEmps.map(e => e.department).filter(Boolean))].sort().map(d => ({ value:d, label:d }));
  const posts       = [...new Set(activeEmps.map(e => e.position).filter(Boolean))].sort().map(p => ({ value:p, label:p }));
  const shiftOpts   = (shifts || []).map(s => ({ value:s.code, label:s.name || s.code }));

  // Field moved to module level (a component defined in render remounts its children, closing open dropdowns)

  return (
    <div className="modal-overlay">
      <div style={{ background:'white', borderRadius:16, width:'min(720px,96vw)',
        boxShadow:'0 20px 60px rgba(0,0,0,.18)', overflow:'visible', position:'relative' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'16px 22px 12px', background:'#ffffff', borderBottom:'1px solid #f3f4f6',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:16, fontWeight:700, color:'#1e40af' }}>Advance Search</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#6b7280', fontSize:20, lineHeight:1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding:'16px 22px', display:'flex', flexDirection:'column', gap:14 }}>

          {/* Row 0: Working Status */}
          <Field label="Working Status">
            <div style={{ display:'flex', gap:0, border:'1px solid #d1d5db', borderRadius:8, overflow:'hidden' }}>
              {[['working','Working'],['notworking','Not Working']].map(([v,label]) => (
                <button key={v} onClick={() => set('_status', v)}
                  style={{ flex:1, padding:'8px 12px', border:'none', cursor:'pointer', fontSize:13, fontWeight:600,
                    background:(local._status||'working')===v ? '#1a56db' : 'white',
                    color:(local._status||'working')===v ? 'white' : '#374151', transition:'background .15s' }}>
                  {label}
                </button>
              ))}
            </div>
          </Field>

          {/* Row 1: Fiscal Year | Branch | Department */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label="Fiscal Year">
              <SearchableCheckSelect options={fiscalYears} value={local.fiscalYear} onChange={v => set('fiscalYear', v)} allLabel="All Fiscal Years" />
            </Field>
            <Field label="Branch">
              <SearchableCheckSelect options={branches} value={local.branch} onChange={v => set('branch', v)} allLabel="All Branches" />
            </Field>
            <Field label="Department">
              <SearchableCheckSelect options={depts} value={local.dept} onChange={v => set('dept', v)} allLabel="All Depts" />
            </Field>
          </div>

          {/* Row 2: Post | Shift */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label="Post">
              <SearchableCheckSelect options={posts} value={local.post} onChange={v => set('post', v)} allLabel="All Posts" />
            </Field>
            <Field label="Shift">
              <SearchableCheckSelect options={shiftOpts} value={local.shift} onChange={v => set('shift', v)} allLabel="All Shifts" />
            </Field>
            <div />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:'10px 22px 16px', borderTop:'1px solid #f3f4f6', display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={() => { onApply({ ...EMPTY_FILTERS }); onClose(); }}
            style={{ padding:'8px 18px', border:'1.5px solid #d1d5db', borderRadius:8, background:'white', color:'#374151', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            Reset
          </button>
          <button onClick={() => { onApply(local); onClose(); }}
            style={{ padding:'8px 22px', border:'none', borderRadius:8, background:'#1a56db', color:'white', fontSize:13, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 8px rgba(26,86,219,.3)' }}>
            Search
          </button>
        </div>
      </div>
    </div>
  );
};

const ManualPostings = () => {
  const { canManageSystem, currentUser } = useAuth();
  const { filteredEmployees, employees: allEmployees, shifts } = useData();
  const { settings } = useSettings();
  const fd = useDateFormat();
  const location = useLocation();
  const { assignments: recoConfig, getRecoIds, getApprovalIds, refresh: refreshRecoApproval } = useRecoApproval();
  const isRecoCompulsory = settings.recoApprovalCompulsory || false;

  const isRecommenderFor = (empId) => {
    const r = recoConfig[String(empId)]?.reco;
    const ids = Array.isArray(r) ? r : (r ? [r] : []);
    return ids.map(String).includes(String(currentUser?.id));
  };
  const isApproverFor = (empId) => {
    const a = recoConfig[String(empId)]?.approval;
    const ids = Array.isArray(a) ? a : (a ? [a] : []);
    return ids.map(String).includes(String(currentUser?.id));
  };
  // Whether this employee has ANY recommender configured — if not,
  // Recommendation Compulsory is unsatisfiable for them and must not block
  // their approver. Mirrors authorizeRecoAction's server-side check.
  const hasRecommenderFor = (empId) => {
    const r = recoConfig[String(empId)]?.reco;
    const ids = Array.isArray(r) ? r : (r ? [r] : []);
    return ids.length > 0;
  };
  const canApproveRow = (row) => !isRecoCompulsory || !!row.recommendedById || !hasRecommenderFor(row.employeeId);

  const empById = useMemo(
    () => Object.fromEntries((allEmployees || []).map(e => [String(e.id), e])),
    [allEmployees]
  );

  // Names of the employee's CONFIGURED recommender(s)/approver(s) (Staff
  // Detail → "Set Recommendator & Approval") — distinct from the grid's own
  // "Recommended By"/"Approved By" columns, which are who actually acted on
  // this specific record.
  const recoApprovalNames = (empId, type) => {
    const v = recoConfig[String(empId)]?.[type];
    const ids = Array.isArray(v) ? v : (v ? [v] : []);
    return ids.length ? ids.map(id => empById[String(id)]?.fullName || `#${id}`).join(', ') : '—';
  };

  // Recommendator / Approval cell: the one person who actually acted on THIS posting (photo + name); "—" until someone has.
  const actorCell = (id, name) => {
    if (!id && !name) return <span style={{ color: '#d1d5db' }}>—</span>;
    const emp = empById[String(id)];
    const full = emp?.fullName || name || (id ? `#${id}` : '—');
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' }}>
        <Avatar photo={emp?.profilePhoto} name={full} size={20} />
        {full}
      </span>
    );
  };

  // "Posted by Application" = the staff member filed it for themselves through the app (Inform Late In / Early Out, missing-attendance request);
  // a posting made for someone else by a user on this page is "Manual Posted by <that user>".
  const postedByApplication = (row) => !!row.createdBy && row.createdBy === row.fullName;

  const [records,       setRecords]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [modal,         setModal]         = useState(false);
  const [editId,        setEditId]        = useState(null);
  const [form,          setForm]          = useState(empty);
  const [errors,        setErrors]        = useState({});
  const [saving,        setSaving]        = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [toast,         setToast]         = useState(null);
  const [filters,       setFilters]       = useState({ ...EMPTY_FILTERS });
  const [showSearch,    setShowSearch]    = useState(false);
  const [fromDate,      setFromDate]      = useState('');   // header filter: posting date range (ISO), empty = no limit
  const [toDate,        setToDate]        = useState('');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/attendance/manual-postings');
      setRecords(Array.isArray(data) ? data : []);
    } catch (e) {
      showToast(e.message || 'Failed to load', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  // useRecoApproval only fetches once, when this hook first mounts — this
  // page stays mounted for the whole session, so without this, opening the
  // Add/Edit modal any time after a staff member's Recommendator/Approval
  // config was set (or changed) elsewhere would show "No recommendator/
  // approver configured" even though it genuinely is.
  useEffect(() => { if (modal) refreshRecoApproval(); }, [modal]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Auto-open add form if navigated from daily attendance with pre-filled data */
  useEffect(() => {
    const state = location.state;
    if (state?.employeeId) {
      setEditId(null);
      setForm({
        ...empty,
        employeeId : String(state.employeeId),
        date       : state.date || '',
        // Pre-fill the punch times the staff member already has for that day
        checkIn    : state.checkIn  || '',
        checkOut   : state.checkOut || '',
      });
      setErrors({});
      setModal(true);
      window.history.replaceState({}, '');  // clear state so refresh doesn't reopen
    }
  }, []);

  const openAdd = () => {
    setEditId(null);
    setForm(empty);
    setErrors({});
    setModal(true);
  };

  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      employeeId    : String(row.employeeId),
      date          : row.date ? String(row.date).split('T')[0] : '',
      checkIn       : row.check_in  ? String(row.check_in).slice(0, 5) : '',
      checkOut      : row.check_out ? String(row.check_out).slice(0, 5) : '',
      remark        : row.remark || '',
      recommendedBy : row.recommendedById ? String(row.recommendedById) : '',
      approvedBy    : row.approvedById    ? String(row.approvedById)    : '',
      updatedByName : row.updatedByName || '',
      updatedAt     : row.updated_at || row.updatedAt || null,
      updatedDevice : row.updatedDevice || '',
    });
    setErrors({});
    setModal(true);
  };

  const validate = () => {
    const e = {};
    if (!form.employeeId) e.employeeId = 'Staff is required';
    if (!form.date)       e.date       = 'Date is required';
    return e;
  };

  const save = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      const payload = {
        employeeId    : Number(form.employeeId),
        date          : form.date,
        checkIn       : form.checkIn       || null,
        checkOut      : form.checkOut      || null,
        remark        : form.remark        || null,
        recommendedBy : form.recommendedBy ? Number(form.recommendedBy) : null,
        approvedBy    : form.approvedBy    ? Number(form.approvedBy)    : null,
        // Marks this as the Manual Posting grid (vs the FAB's self-service
        // "Inform Late In"), so a Branch Manager's entry lands Approved.
        isManual      : true,
        deviceInfo    : getDeviceInfo(),
      };
      if (editId) {
        await api.put(`/attendance/manual-postings/${editId}`, payload);
        showToast('Record updated successfully');
      } else {
        await api.post('/attendance/manual-postings', payload);
        showToast('Record posted successfully');
      }
      setModal(false);
      load();
    } catch (err) {
      showToast(err.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* Ctrl+S saves the Add/Edit Manual Entry modal — same action as the Save button */
  useSaveShortcut(modal, save);

  const remove = async (id) => {
    try {
      await api.delete(`/attendance/manual-postings/${id}`);
      showToast('Record deleted');
      setDeleteConfirm(null);
      load();
    } catch (e) {
      showToast(e.message || 'Delete failed', 'error');
    }
  };

  // Recommend/approve/reject a staff self-service "Inform Late In/Early Out"
  // request (status='pending') — once approved it becomes real attendance
  // data, same as this page's own admin-entered rows always have been. The
  // backend independently re-checks who's actually the configured
  // recommender/approver (and, for approve, whether recommendation already
  // happened when compulsory) — these buttons are only shown/enabled to
  // match that, not the source of truth for it.
  const decide = async (row, decision) => {
    try {
      await api.patch(`/attendance/manual-postings/${row.id}/${decision}`, { approvedBy: currentUser?.id || null });
      showToast(decision === 'approve' ? 'Request approved' : decision === 'reject' ? 'Request rejected' : 'Recommended');
      load();
    } catch (e) {
      showToast(e.message || 'Action failed', 'error');
    }
  };

  const fmt = (t) => {
    if (!t) return '—';
    const s = String(t).slice(0, 5);
    const [h, m] = s.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const columns = useMemo(() => [
    {
      field: 'fullName', header: 'Full Name',
      minWidth: 150,
      render: (v, row) => (
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <Avatar photo={empById[String(row.employeeId)]?.profilePhoto} name={v} size={20} />
          {v}
        </span>
      ),
    },
    {
      field: 'postShort', header: 'Post',
      width: 80, minWidth: 70, align: 'center',
      render: (v) => <span style={{ color: '#1f2937', fontSize: 12 }}>{v || '—'}</span>,
    },
    {
      field: 'deptShort', header: 'Department',
      width: 100, minWidth: 85, align: 'center',
      render: (v) => <span style={{ fontWeight: 600, color: '#374151', fontSize: 12 }}>{v || '—'}</span>,
    },
    {
      field: 'branchShort', header: 'Branch',
      width: 85, minWidth: 75, align: 'center',
      render: (v) => <span style={{ fontWeight: 600, color: '#6b7280', fontSize: 12 }}>{v || '—'}</span>,
    },
    {
      field: 'date', header: 'Date',
      width: 110,
      render: (v) => v ? String(v).split('T')[0] : '—',
    },
    {
      field: 'check_in', header: 'Check In',
      width: 100, align: 'center',
      render: (v) => (
        <span style={{ color: v ? '#065f46' : '#9ca3af', fontWeight: v ? 600 : 400 }}>
          {fmt(v)}
        </span>
      ),
    },
    {
      field: 'check_out', header: 'Check Out',
      width: 105, align: 'center',
      render: (v) => (
        <span style={{ color: v ? '#1e40af' : '#9ca3af', fontWeight: v ? 600 : 400 }}>
          {fmt(v)}
        </span>
      ),
    },
    {
      field: 'lateBy', header: 'Late By',
      width: 80, align: 'center',
      render: (v, row) => row.lateIn && v
        ? <span style={{ color: '#b45309', fontWeight: 600 }}>{v}</span>
        : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'earlyBy', header: 'Early By',
      width: 80, align: 'center',
      render: (v, row) => row.earlyOut && v
        ? <span style={{ color: '#b45309', fontWeight: 600 }}>{v}</span>
        : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'remark', header: 'Remark / Reason',
      minWidth: 160,
      render: (v) => v
        ? <span style={{ fontSize: 12, color: '#4b5563' }}>{v}</span>
        : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'status', header: 'Status',
      width: 95, align: 'center',
      render: (v) => {
        const s = v || 'approved';
        const style = s === 'pending'  ? { bg: '#fffbeb', color: '#b45309' }
                    : s === 'rejected' ? { bg: '#fef2f2', color: '#dc2626' }
                    :                    { bg: '#f0fdf4', color: '#15803d' };
        return (
          <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'capitalize',
            background: style.bg, color: style.color, borderRadius: 20, padding: '3px 10px' }}>
            {s}
          </span>
        );
      },
    },
    {
      field: 'recommendatorNames', header: 'Recommendator',
      width: 160, sortable: false, filterable: false,
      render: (_, row) => actorCell(row.recommendedById, row.recommendedByName),
    },
    {
      field: 'recommendedDate', header: 'Recom. Date',
      width: 100, align: 'center',
      render: (v) => v ? String(v).split('T')[0] : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'approvalNames', header: 'Approval',
      width: 160, sortable: false, filterable: false,
      render: (_, row) => actorCell(row.approvedById, row.approvedByName),
    },
    {
      field: 'approvedDate', header: 'Approval Date',
      width: 105, align: 'center',
      render: (v) => v ? String(v).split('T')[0] : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'createdBy', header: 'Posted By',
      width: 80, align: 'center',
      render: (v, row) => {
        if (!v) return <span style={{ color: '#d1d5db' }}>—</span>;
        const poster = Object.values(empById).find(e => e.fullName === v);
        const via = postedByApplication(row) ? 'Posted by Application' : `Manual Posted by ${v}`;
        const on = row.created_at ? new Date(row.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        return (
          <HoverCard minWidth={180} fontSize={12}
            trigger={<span style={{ display: 'inline-flex', cursor: 'default' }}><Avatar photo={poster?.profilePhoto} name={v} size={22} /></span>}
            content={<div style={{ lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, color: '#111827' }}>{v}</div>
              {poster && <div style={{ color: '#6b7280' }}>{[poster.position, poster.department].filter(Boolean).join(' · ')}</div>}
              <div style={{ color: '#374151' }}>{via}</div>
              {on && <div style={{ color: '#6b7280' }}>On {on}</div>}
            </div>} />
        );
      },
    },
    {
      field: 'created_at', header: 'Posted On',
      width: 130,
      render: (v) => v
        ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—',
    },
  ], [canManageSystem, empById, recoConfig, isRecoCompulsory, currentUser?.id]);

  /* Apply Advance Search filters to the loaded records */
  const filteredRecords = useMemo(() => records.filter(r => {
    const recDate = r.date ? String(r.date).split('T')[0] : '';
    if (fromDate && recDate < fromDate) return false;
    if (toDate   && recDate > toDate)   return false;
    if (filters.fiscalYear) {
      const fy = (settings.fiscalYears || []).find(f => f.name === filters.fiscalYear);
      if (fy && (recDate < fy.startDate || recDate > fy.endDate)) return false;
    }
    const emp = empById[String(r.employeeId)];
    if (emp) {
      const working = emp.active !== false;
      if ((filters._status || 'working') === 'working' ? !working : working) return false;
      if (filters.branch && emp.branch      !== filters.branch) return false;
      if (filters.dept   && emp.department  !== filters.dept)   return false;
      if (filters.post   && emp.position    !== filters.post)   return false;
      if (filters.shift  && emp.shift       !== filters.shift)  return false;
    }
    return true;
  }), [records, filters, empById, settings.fiscalYears, fromDate, toDate]);

  const activeFilterCount = Object.entries(filters)
    .filter(([k, v]) => k === '_status' ? v !== 'working' : v !== '').length;

  // options for the Department / Post drop-downs in the filter row (working or not, as chosen in Advance Search)
  const filterEmps = (allEmployees || []).filter(e => (e.active !== false) === ((filters._status || 'working') === 'working'));
  const deptOptions = [...new Set(filterEmps.map(e => e.department).filter(Boolean))].sort();
  const postOptions = [...new Set(filterEmps.map(e => e.position).filter(Boolean))].sort();
  const anyFilter = !!(fromDate || toDate || activeFilterCount);

  // Right-click menu: Recommend / Approve / Reject for pending requests (shown only to the people allowed to act), then Edit / Delete for admins.
  const menuItems = [
    { label: 'Recommend', icon: '👍', visible: (r) => r.status === 'pending' && isRecommenderFor(r.employeeId) && !r.recommendedById, onClick: (r) => decide(r, 'recommend') },
    { label: 'Approve', icon: '✅', visible: (r) => r.status === 'pending' && (canManageSystem || isApproverFor(r.employeeId)),
      disabled: (r) => !canApproveRow(r), title: (r) => canApproveRow(r) ? '' : 'Awaiting recommendation first', onClick: (r) => decide(r, 'approve') },
    { label: 'Reject', icon: '❌', className: 'danger', visible: (r) => r.status === 'pending' && (canManageSystem || isApproverFor(r.employeeId)), onClick: (r) => decide(r, 'reject') },
    ...(canManageSystem ? ['divider',
      { label: 'Edit', icon: '✏️', onClick: (r) => openEdit(r) },
      { label: 'Delete', icon: '🗑', className: 'danger', onClick: (r) => setDeleteConfirm(r.id) }] : []),
  ];

  const f = (k) => (v) => setForm(p => ({ ...p, [k]: v }));

  // Employees allowed as Recommended By / Approved By for the selected employee
  // — recomputed fresh every render (cheap) so a just-loaded assignments
  // fetch is picked up immediately, no stale-memo risk.
  const recoIds     = getRecoIds(form.employeeId);
  const approvalIds = getApprovalIds(form.employeeId);
  const recoOptions     = filteredEmployees.filter(e => recoIds.includes(String(e.id)));
  const approvalOptions = filteredEmployees.filter(e => approvalIds.includes(String(e.id)));

  const field = (label, required, err, children) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
        {label}{required && <span style={{ color: '#dc2626' }}> *</span>}
      </label>
      {children}
      {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
    </div>
  );

  return (
    <div className="page-container">
      {/* Page header */}
      <div className="page-header" style={{ marginBottom: 6 }}>
        <h1 className="page-title">✍️ Manual Postings</h1>
        {canManageSystem && (
          <button className="btn btn-primary" onClick={openAdd} style={{ height: 30, padding: '0 14px', fontSize: 12 }}>
            + Add Manual Entry
          </button>
        )}
      </div>

      {/* Filter row: posting date range, Department, Post + Advance Search */}
      <div className="ui-compact-controls" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>From Date</span>
        <DateInput value={fromDate} onChange={setFromDate} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>To Date</span>
        <DateInput value={toDate} onChange={setToDate} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Department</span>
        <select value={filters.dept} onChange={e => setFilters(p => ({ ...p, dept: e.target.value }))} style={{ width: 150 }}>
          <option value="">All Depts</option>{deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Post</span>
        <select value={filters.post} onChange={e => setFilters(p => ({ ...p, post: e.target.value }))} style={{ width: 150 }}>
          <option value="">All Posts</option>{postOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn-filter" onClick={() => setShowSearch(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
          </svg>
          Advance Search{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        {anyFilter && (
          <button className="btn btn-outline" onClick={() => { setFromDate(''); setToDate(''); setFilters({ ...EMPTY_FILTERS }); }}>✕ Reset</button>
        )}
      </div>

      {/* DataGrid */}
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading...</div>
      ) : (
        <DataGrid
          columns={columns}
          data={filteredRecords}
          defaultPageSize={20}
          compact={true}
          fillToBottom
          showFilterButton={false}
          remarks={(row) => (
            <>
              <div><b>Remarks — {row.fullName}{row.staffId ? ` (${row.staffId})` : ''}:</b> {row.remark ? row.remark : <span className="dg-muted">no remarks on this posting</span>}</div>
              <div style={{ marginTop: 2 }}>
                <b>Posted:</b> {postedByApplication(row) ? 'Posted by Application' : `Manual Posted by ${row.createdBy || '—'}`}
                {row.status && row.status !== 'approved' && <> &nbsp;·&nbsp; <b>Status:</b> <span style={{ textTransform: 'capitalize' }}>{row.status}</span></>}
              </div>
            </>
          )}
          onRowDoubleClick={canManageSystem ? openEdit : undefined}
          onDeleteKey={canManageSystem ? (row) => setDeleteConfirm(row.id) : null}
          contextMenu={menuItems.length ? menuItems : undefined}
        />
      )}

      {/* Add / Edit Modal */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editId ? '✏️ Edit Manual Entry' : '+ Add Manual Entry'}</h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {field('Staff', true, errors.employeeId,
                <div style={{ outline: errors.employeeId ? '1.5px solid #dc2626' : 'none', borderRadius: 7 }}>
                  <SearchableSelect
                    value={form.employeeId}
                    onChange={v => setForm(p => ({ ...p, employeeId: v, recommendedBy: '', approvedBy: '' }))}
                    options={filteredEmployees.map(e => ({
                      value: String(e.id),
                      label: e.fullName,
                      sub: [e.employeeId, e.position].filter(Boolean).join(' - '),
                      photo: e.profilePhoto,
                    }))}
                    placeholder="— Select Staff —"
                    showAvatar
                  />
                </div>
              )}

              {field('Date', true, errors.date,
                <DateInput value={form.date} onChange={f('date')} />
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {field('Check In Time', false, null,
                  <TimeInput value={form.checkIn} onChange={f('checkIn')} />
                )}
                {field('Check Out Time', false, null,
                  <TimeInput value={form.checkOut} onChange={f('checkOut')} />
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {field('Recommended By', false, null,
                  <SearchableSelect
                    value={form.recommendedBy}
                    onChange={v => setForm(p => ({ ...p, recommendedBy: v }))}
                    options={recoOptions.map(e => ({
                      value: String(e.id),
                      label: e.fullName,
                      sub: [e.employeeId, e.position].filter(Boolean).join(' - '),
                      photo: e.profilePhoto,
                    }))}
                    placeholder={!form.employeeId ? '— Select staff first —' : recoOptions.length === 0 ? 'No recommendator configured' : '— Select —'}
                    disabled={!form.employeeId || recoOptions.length === 0}
                    showAvatar
                  />
                )}
                {field('Approved By', false, null,
                  <SearchableSelect
                    value={form.approvedBy}
                    onChange={v => setForm(p => ({ ...p, approvedBy: v }))}
                    options={approvalOptions.map(e => ({
                      value: String(e.id),
                      label: e.fullName,
                      sub: [e.employeeId, e.position].filter(Boolean).join(' - '),
                      photo: e.profilePhoto,
                    }))}
                    placeholder={!form.employeeId ? '— Select staff first —' : approvalOptions.length === 0 ? 'No approver configured' : '— Select —'}
                    disabled={!form.employeeId || approvalOptions.length === 0}
                    showAvatar
                  />
                )}
              </div>

              {field('Remark / Reason', false, null,
                <textarea
                  value={form.remark}
                  onChange={e => setForm(p => ({ ...p, remark: e.target.value }))}
                  rows={3}
                  placeholder="Optional note or reason for manual posting..."
                  style={{
                    border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px',
                    fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                  }}
                />
              )}
            </div>
            <div className="modal-footer">
              <LastSavedBy updatedByName={form.updatedByName} updatedAt={form.updatedAt} updatedDevice={form.updatedDevice} fd={fd} />
              <div style={{ display:'flex', gap:10, marginLeft:'auto' }}>
                <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
                <SaveButton onClick={save} disabled={saving} icon={saving ? '⏳' : '💾'} label={saving ? 'Saving…' : 'Save'} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚠️ Delete Entry</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: '#374151' }}>Are you sure you want to delete this manual posting?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => remove(deleteConfirm)}>🗑 Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
          color:      toast.type === 'error' ? '#dc2626'  : '#065f46',
          border:     `1px solid ${toast.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,.12)',
        }}>
          {toast.type === 'error' ? '❌' : '✅'} {toast.msg}
        </div>
      )}

      {/* Advance Search Modal */}
      {showSearch && (
        <AdvanceSearchModal
          filters={filters}
          onApply={setFilters}
          onClose={() => setShowSearch(false)}
          settings={settings}
          employees={allEmployees || []}
          shifts={shifts || []}
        />
      )}
    </div>
  );
};

export default ManualPostings;

const Field = ({ label, children }) => (
  <div style={{ position:'relative', overflow:'visible' }}>
    <div style={{ fontSize:13, fontWeight:600, color:'#111827', marginBottom:6 }}>{label}</div>
    {children}
  </div>
);
