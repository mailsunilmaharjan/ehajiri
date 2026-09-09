import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLeaveApply }      from '../../context/LeaveApplyContext.jsx';
import { useOfficeVisitApply } from '../../context/OfficeVisitApplyContext.jsx';
import { useMissingAttendanceApply } from '../../context/MissingAttendanceApplyContext.jsx';
import api             from '../../api/client.js';
import DataGrid        from '../DataGrid/DataGrid.jsx';
import Avatar          from '../Common/Avatar.jsx';
import HoverCard        from '../Common/HoverCard.jsx';
import useDateFormat   from '../../hooks/useDateFormat.js';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import { branchAbbr } from '../../utils/branchUtils.js';
import SearchableCheckSelect from '../Common/SearchableCheckSelect.jsx';
import { getNepalTodayISO } from '../../utils/dateUtils.js';
import { downloadBlob } from '../../utils/printHelper.js';

/* ── constants ─────────────────────────────────────────────── */
const DAY_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_NP = ['आइत','सोम','मंगल','बुध','बिही','शुक्र','शनि'];

const STATUS_STYLE = {
  Present          : { bg:'#f0fdf4', color:'#065f46', border:'#bbf7d0' },
  Absent           : { bg:'#fff5f5', color:'#991b1b', border:'#fecaca' },
  Weekend          : { bg:'#f3f4f6', color:'#6b7280', border:'#e5e7eb' },
  'Day Off'        : { bg:'#f3f4f6', color:'#6b7280', border:'#e5e7eb' },
  'Night Off'      : { bg:'#eef2ff', color:'#4338ca', border:'#c7d2fe' },
  Leave            : { bg:'#ede9fe', color:'#5b21b6', border:'#c4b5fd' },
  'Public Holiday' : { bg:'#fef3c7', color:'#92400e', border:'#fcd34d' },
  'Office Visit'   : { bg:'#dbeafe', color:'#1e40af', border:'#93c5fd' },
};
const statusStyle = (s) => STATUS_STYLE[s] || STATUS_STYLE.Leave;

// Backend always sends the status as one of these fixed English strings —
// translate for display when Nepali is active (module-level so it can't call
// the component's own L(), which needs `language` from context).
const STATUS_LABEL_NP = {
  Present: 'उपस्थित', Absent: 'अनुपस्थित', Weekend: 'विकेन्ड',
  'Day Off': 'डे अफ', 'Night Off': 'नाइट अफ', Leave: 'बिदा',
  'Public Holiday': 'सार्वजनिक बिदा', 'Office Visit': 'कार्यालय भ्रमण',
};
const statusLabel = (s, language) => (language === 'np' ? (STATUS_LABEL_NP[s] || s) : s);

const Pill = ({ children, bg, color, border }) => (
  <span style={{ background:bg, color, border:`1px solid ${border}`, borderRadius:10,
    padding:'2px 8px', fontSize:11, fontWeight:700, display:'inline-block' }}>
    {children}
  </span>
);

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const todayISO = () => getNepalTodayISO();

/* ── Advance Search Modal ───────────────────────────────────── */
const EMPTY_FILTERS = {
  staffId:'', branch:'', dept:'', post:'', mode:'', grade:'', shift:'', status:'',
};

const AdvanceSearchModal = ({ filters, onApply, onClose, L, settings, allRows, employees, shifts }) => {
  const [local, setLocal] = useState({ ...filters });
  const set = (k, v) => setLocal(p => ({ ...p, [k]: v }));

  const modes  = (settings.modes  || []).map(m => ({ value: m.name, label: m.name }));
  const grades = (settings.grades || []).map(g => ({ value: g.name, label: g.name }));

  const depts    = [...new Set(allRows.map(r => r.deptFull  ).filter(Boolean))].sort().map(d=>({value:d,label:d}));
  const branches = [...new Set(allRows.map(r => r.branchName).filter(Boolean))].sort().map(b=>({value:b,label:b}));
  const posts    = [...new Set(allRows.map(r => r.postFull  ).filter(Boolean))].sort().map(p=>({value:p,label:p}));

  const staffOpts = employees
    .filter(e => e.active !== false)
    .sort((a,b) => (a.fullName||'').localeCompare(b.fullName||''))
    .map(e => {
      const name = e.fullName || `Staff ${e.id}`;
      const sub  = [e.employeeId, e.position].filter(Boolean).join(' - ');
      return { value: String(e.id), label: name, sub, photo: e.profilePhoto };
    });

  const shiftOpts = shifts.map(s => ({ value: s.code, label: s.name || s.code }));

  const statusOpts = [
    { value:'Present',      label: L('उपस्थित','Present')       },
    { value:'Absent',       label: L('अनुपस्थित','Absent')      },
    { value:'Weekend',      label: L('विकेन्ड','Weekend')        },
    { value:'Day Off',      label: L('डे अफ','Day Off')          },
    { value:'Night Off',    label: L('नाइट अफ','Night Off')      },
    { value:'Leave',        label: L('बिदा','Leave')             },
    { value:'Office Visit', label: L('कार्यालय भ्रमण','Office Visit') },
  ];

  /* Shared label style matching screenshot */
  const Lbl = ({ text }) => (
    <div style={{ fontSize:13, fontWeight:600, color:'#111827', marginBottom:8 }}>{text}</div>
  );

  /* Each field wrapper — overflow visible so dropdown isn't clipped */
  const Field = ({ label, children }) => (
    <div style={{ position:'relative', overflow:'visible' }}>
      <Lbl text={label} />
      {children}
    </div>
  );

  return (
    <div className="modal-overlay">
      {/* Modal — no overflow:hidden so dropdowns float freely */}
      <div style={{
        background:'white', borderRadius:16, width:'min(960px, 96vw)',
        boxShadow:'0 20px 60px rgba(0,0,0,.18)', overflow:'visible',
        position:'relative',
      }} onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={{ padding:'20px 24px 16px', background:'#ffffff',borderBottom:'1px solid #f3f4f6',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:18, fontWeight:700, color:'#1e40af', letterSpacing:'-.2px' }}>
            {L('विस्तृत खोज','Advance Search')}
          </span>
          <button onClick={onClose}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#6b7280',
              fontSize:20, lineHeight:1, padding:'2px 6px', borderRadius:6,
              transition:'background .12s' }}
            onMouseEnter={e=>e.currentTarget.style.background='#f3f4f6'}
            onMouseLeave={e=>e.currentTarget.style.background='none'}>
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>

          {/* Row 1: Staff | Branch — 2 equal columns */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <Field label={L('कर्मचारी','Staff')}>
              <SearchableCheckSelect options={staffOpts} value={local.staffId} showAvatar
                onChange={v=>set('staffId',v)} allLabel={L('All Staff','All Staff')} />
            </Field>
            <Field label={L('शाखा','Branch')}>
              <SearchableCheckSelect options={branches} value={local.branch}
                onChange={v=>set('branch',v)} allLabel={L('All Branches','All Branches')} />
            </Field>
          </div>

          {/* Row 2: Department | Post | Mode — 3 equal columns */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
            <Field label={L('विभाग','Department')}>
              <SearchableCheckSelect options={depts} value={local.dept}
                onChange={v=>set('dept',v)} allLabel={L('All Departments','All Departments')} />
            </Field>
            <Field label={L('पद','Post')}>
              <SearchableCheckSelect options={posts} value={local.post}
                onChange={v=>set('post',v)} allLabel={L('All Posts','All Posts')} />
            </Field>
            <Field label={L('नियुक्ति','Mode')}>
              <SearchableCheckSelect options={modes} value={local.mode}
                onChange={v=>set('mode',v)} allLabel={L('All Modes','All Modes')} />
            </Field>
          </div>

          {/* Row 3: Grade | Shift | Status — 3 equal columns */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
            <Field label={L('ग्रेड','Grade')}>
              <SearchableCheckSelect options={grades} value={local.grade}
                onChange={v=>set('grade',v)} allLabel={L('All Grades','All Grades')} />
            </Field>
            <Field label={L('सिफ्ट','Shift')}>
              <SearchableCheckSelect options={shiftOpts} value={local.shift}
                onChange={v=>set('shift',v)} allLabel={L('All Shifts','All Shifts')} />
            </Field>
            <Field label={L('स्थिति','Status')}>
              <SearchableCheckSelect options={statusOpts} value={local.status}
                onChange={v=>set('status',v)} allLabel={L('All','All')} />
            </Field>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ padding:'14px 24px 20px', borderTop:'1px solid #f3f4f6',
          display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button
            onClick={() => { onApply({ ...EMPTY_FILTERS }); onClose(); }}
            style={{ padding:'9px 22px', border:'1.5px solid #d1d5db', borderRadius:8,
              background:'white', color:'#374151', fontSize:14, fontWeight:600,
              cursor:'pointer', transition:'all .15s' }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor='#9ca3af'; e.currentTarget.style.background='#f9fafb'; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor='#d1d5db'; e.currentTarget.style.background='white'; }}>
            {L('रिसेट','Reset')}
          </button>
          <button
            onClick={() => { onApply(local); onClose(); }}
            style={{ padding:'9px 26px', border:'none', borderRadius:8,
              background:'#1a56db', color:'white', fontSize:14, fontWeight:700,
              cursor:'pointer', boxShadow:'0 2px 8px rgba(26,86,219,.3)', transition:'all .15s' }}
            onMouseEnter={e=>e.currentTarget.style.background='#1e40af'}
            onMouseLeave={e=>e.currentTarget.style.background='#1a56db'}>
            {L('खोज्नुस','Search')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   Daily Attendance Report
═══════════════════════════════════════════════════════════ */
const DailyAttendanceReport = () => {
  const navigate           = useNavigate();
  const [searchParams]     = useSearchParams();
  const { open: openLeave }       = useLeaveApply();
  const { open: openOfficeVisit } = useOfficeVisitApply();
  const { open: openMissingAttendance } = useMissingAttendanceApply();
  const { language }   = useLanguage();
  const { settings }   = useSettings();
  const { filteredEmployees: employees, shifts, getApprovedLeaveForDate, getLeaveTypeName, getEmployeeName, getEmployeeById, leaveTypes, rosterVersion } = useData();

  /* language-aware leave type name */
  const getLeaveLabel = (code) => {
    const lt = leaveTypes?.find(l => l.code === code);
    if (lt) return language === 'np' ? lt.name : (lt.nameEn || lt.name || code);
    return getLeaveTypeName(code);
  };
  const { currentUser, isEmployee } = useAuth();
  const fd             = useDateFormat();
  const L = (np, en)   => language === 'np' ? np : en;

  /* employees can only view their own record */
  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';

  const [date,        setDate]        = useState(todayISO);
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [searchModal,  setSearchModal]  = useState(false);
  // Ctrl+A opens Advance Search — same shortcut across every report/page
  // that has one, skipped while typing in a text field so it doesn't hijack
  // native "select all text" there.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.key.toLowerCase() !== 'a') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      setSearchModal(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [filters,      setFilters]      = useState({
    staffId: myEmpId, branch:'', dept:'', post:'', mode:'', grade:'', shift:'', status:'',
  });
  // Quick-filter chip selection — seeded from ?quick= so links elsewhere in
  // the app (Dashboard's Absent/On Leave/On Office Visit/Late Arrivals stat
  // cards) can land here already filtered to the matching list.
  const [quickFilter, setQuickFilter] = useState(searchParams.get('quick') || '');

  /* ── load ── */
  const load = useCallback(async (d) => {
    setLoading(true); setError(null);
    try { setData(await api.get(`/attendance/daily?date=${d}&orgScope=1`)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(date); }, [date, load, rosterVersion]);

  /* ── date helpers ── */
  const [Y, M, D] = date.split('-').map(Number);
  const dowIndex  = new Date(Y, M - 1, D).getDay();
  const dayLabel  = language === 'np' ? DAY_NP[dowIndex] : DAY_EN[dowIndex];
  const displayDate = fd(date);

  const shiftDate = (days) => {
    const d = new Date(Y, M - 1, D + days);
    setDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  };

  /* ── overlay approved leaves onto attendance rows ── */
  const allRows = (data?.rows || []).map(r => {
    const leave = getApprovedLeaveForDate(r.id, date);
    if (!leave) return r;
    return {
      ...r,
      status:     'On Leave',
      hasLeave:   true,
      leaveType:  getLeaveLabel(leave.leaveTypeCode) || leave.leaveTypeCode,
      leaveReason: leave.reason || '',
      leaveDays:   leave.days,
      recommendedBy: leave.recommendedBy,
      approvedBy:    leave.approvedBy,
    };
  });
  const rows = allRows.filter(r => {
    // staffId: stored as String(employee.id) from the employees dropdown
    if (filters.staffId && String(r.id) !== String(filters.staffId)) return false;
    // dept: compare against full dept name
    if (filters.dept    && r.deptFull   !== filters.dept)   return false;
    // branch: compare against full branch name
    if (filters.branch  && r.branchName !== filters.branch) return false;
    // post: compare against full post name
    if (filters.post    && r.postFull   !== filters.post)   return false;
    // shift: compare shift code (now returned by backend as r.shiftCode)
    if (filters.shift   && r.shiftCode  !== filters.shift)  return false;
    // mode: employee employment mode (returned by backend)
    if (filters.mode    && r.mode       !== filters.mode)   return false;
    // grade: employee grade (returned by backend)
    if (filters.grade   && r.grade      !== filters.grade)  return false;
    // status
    if (filters.status) {
      if (filters.status === 'Leave'        && !r.hasLeave) return false;
      if (filters.status === 'Office Visit' && !r.hasVisit) return false;
      if (filters.status !== 'Leave' && filters.status !== 'Office Visit'
          && r.status !== filters.status) return false;
    }
    return true;
  });

  // Apply quick-filter chips on top of advance-search filters
  const quickRows = rows.filter(r => {
    switch (quickFilter) {
      case 'absent':    return r.status === 'Absent';
      case 'late-early':return !!(r.lateIn || r.earlyOut);
      case 'leave':     return !!r.hasLeave;
      case 'visit':     return !!r.hasVisit;
      case 'ot':        return !!(r.ot && r.ot !== '—');
      default:          return true;
    }
  });

  const activeCount = Object.values(filters).filter(Boolean).length;

  /* ── summary ── */
  const summary = data ? {
    total  : allRows.length,
    present: allRows.filter(r => r.status==='Present').length,
    absent : allRows.filter(r => r.status==='Absent').length,
    leave  : allRows.filter(r => r.hasLeave).length,
    visit  : allRows.filter(r => r.hasVisit).length,
    weekend: allRows.filter(r => r.status==='Weekend').length,
    late   : allRows.filter(r => r.lateIn).length,
    early  : allRows.filter(r => r.earlyOut).length,
  } : null;

  /* ── columns ── */
  // No width specified — autoWidth=true lets the table auto-fit to content
  const columns = [
    {
      field:'id', header:L('स्टाफ आईडी','Staff ID'), sortable:false,
      render: (v) => <span style={{ color:'#374151' }}>{getEmployeeById(v)?.employeeId || '—'}</span>,
    },
    {
      field:'fullName', header:L('कर्मचारी','Staff'), sortable:true,
      render: (v, row) => (
        <span style={{ display:'flex', alignItems:'center', gap:6, color:'#1f2937' }}>
          <Avatar photo={getEmployeeById(row.id)?.profilePhoto} name={v} size={22} />
          {v}
        </span>
      ),
    },
    {
      field:'postShort', header:L('पद','Post'),
      render: (v, row) => {
        const fromSettings = (settings.posts || []).find(p => p.name === row.postFull)?.shortName;
        const display = fromSettings || v || '—';
        return (
          <span title={row.postFull || ''} style={{ color:'#1f2937', cursor:'default' }}>
            {display}
          </span>
        );
      },
    },
    {
      field:'deptShort', header:L('विभाग','Dept.'),
      render: (v, row) => {
        const fromSettings = (settings.departments || []).find(d => d.name === row.deptFull)?.shortName;
        const display = fromSettings || v || '—';
        return (
          <span title={row.deptFull || ''} style={{ color:'#1f2937', cursor:'default' }}>
            {display}
          </span>
        );
      },
    },
    {
      field:'branchShort', header:L('शाखा','Branch'),
      render: (v, row) => {
        const fromSettings = (settings.branches || []).find(b => b.name === row.branchName)?.shortName;
        const display = fromSettings || v || '—';
        return (
          <span title={row.branchName || ''} style={{ color:'#1f2937', cursor:'default' }}>
            {display}
          </span>
        );
      },
    },
    {
      field:'_date', header:L('मिति','Date'), sortable:false,
      render: () => <span style={{ whiteSpace:'nowrap' }}>{displayDate}</span>,
    },
    {
      field:'_day', header:L('दिन','Day'), sortable:false,
      render: () => (
        <span style={{ color: data?.isWeekend?'#9ca3af':'#374151', fontWeight:500 }}>
          {dayLabel}
        </span>
      ),
    },
    {
      field:'shiftName', header:L('सिफ्ट','Shift'),
      render: v => <span style={{ color:'#1f2937', whiteSpace:'nowrap' }}>{v||'—'}</span>,
    },
    {
      field:'timeIn', header:L('आउने','Time In'), align:'center',
      render: (v, row) => {
        if (!v) return <span style={{ color:'#d1d5db' }}>—</span>;
        const warn = row.punchCount === 1;
        const onTime = row.lateIn === 'On Time';
        return (
          <span style={{ color: onTime ? '#1f2937' : (warn?'#f59e0b':'#3b82f6'), fontWeight: onTime?400:700, whiteSpace:'nowrap' }}
            title={warn?'Single punch only':''}>
            {fmtTime(v)}
          </span>
        );
      },
    },
    {
      field:'timeOut', header:L('जाने','Time Out'), align:'center',
      render: (v, row) => {
        if (!v) {
          if (row.timeIn) {
            return (
              <span
                onClick={e => { e.stopPropagation(); openMissingAttendance(row.id, date); }}
                title={L('टाइम आउट रेकर्ड भएन — अनुरोध पठाउन क्लिक गर्नुस्','Missing time out — click to request')}
                style={{ color:'#dc2626', fontWeight:700, cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted', textUnderlineOffset:3 }}>
                —
              </span>
            );
          }
          return <span style={{ color:'#d1d5db' }}>—</span>;
        }
        const warn = row.punchCount === 1;
        const onTime = row.earlyOut === 'On Time';
        return (
          <span style={{ color: onTime ? '#1f2937' : (warn?'#f59e0b':'#6b7280'), fontWeight: onTime?400:700, whiteSpace:'nowrap' }}
            title={warn?'Single punch only':''}>
            {fmtTime(v)}
          </span>
        );
      },
    },
    {
      field:'totalHrs', header:L('घण्टा','Total Hrs'), align:'center',
      render: v => v
        ? <span style={{ color:'#0369a1', fontWeight:700 }}>{v}</span>
        : <span style={{ color:'#d1d5db' }}>—</span>,
    },
    {
      field:'otApprovedFormatted', header:L('ओटी','OT'), align:'center',
      render: (v, row) => row.eligibleForOt && v
        ? <span style={{ color:'#059669', fontWeight:700 }}>{v}</span>
        : <span style={{ color:'#d1d5db' }}>—</span>,
    },
    {
      field:'lateIn', header:L('IN स्थिति','IN Status'),
      render: v => {
        if (!v) return <span style={{ color:'#d1d5db' }}>—</span>;
        if (v === 'On Time') return <span style={{ color:'#1f2937', whiteSpace:'nowrap' }}>{v}</span>;
        const isEarly = v.startsWith('Early In');
        return <span style={{ color: isEarly ? '#10b981' : '#ef4444', fontWeight:700, whiteSpace:'nowrap' }}>{v}</span>;
      },
    },
    {
      field:'earlyOut', header:L('OUT स्थिति','OUT Status'),
      render: v => {
        if (!v) return <span style={{ color:'#d1d5db' }}>—</span>;
        if (v === 'On Time') return <span style={{ color:'#1f2937', whiteSpace:'nowrap' }}>{v}</span>;
        const isLateOut = v.startsWith('Late Out');
        return <span style={{ color: isLateOut ? '#3b82f6' : '#f59e0b', fontWeight:700, whiteSpace:'nowrap' }}>{v}</span>;
      },
    },
    {
      field:'status', header:L('स्थिति','Status'),
      render: (v, row) => {
        if (v === 'On Leave') {
          /* Badge only — no leave name below */
          return <Pill bg="#eff6ff" color="#1e40af" border="#bfdbfe">🏖️ {L('बिदामा','On Leave')}</Pill>;
        }
        const s = statusStyle(v);
        return <Pill bg={s.bg} color={s.color} border={s.border}>{statusLabel(v, language)}</Pill>;
      },
    },
    {
      field:'remarks', header:L('कैफियत','Remarks'), sortable:false, wrap:true, fill:true,
      render: (v, row) => {
        if (row.status === 'On Leave') {
          const parts = [];
          if (row.leaveType)  parts.push(<span key="type" style={{ fontWeight:700, color:'#1e40af' }}>{row.leaveType}</span>);
          if (row.leaveReason) parts.push(<span key="reason" style={{ color:'#374151' }}>{row.leaveReason}</span>);
          if (row.recommendedBy) parts.push(
            <span key="reco" style={{ color:'#059669' }}>
              <span style={{ fontWeight:600 }}>{L('सिफारिस:','Reco. by:')}</span> {getEmployeeName(row.recommendedBy)}
            </span>
          );
          if (row.approvedBy) parts.push(
            <span key="appr" style={{ color:'#7c3aed' }}>
              <span style={{ fontWeight:600 }}>{L('स्वीकृत:','Appr. by:')}</span> {getEmployeeName(row.approvedBy)}
            </span>
          );
          return (
            <div style={{ display:'flex', flexWrap:'wrap', gap:'0 8px', alignItems:'center', width:'100%' }}>
              {parts.map((p, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span style={{ color:'#d1d5db', fontSize:10 }}>|</span>}
                  {p}
                </React.Fragment>
              ))}
            </div>
          );
        }
        if (!v) return <span style={{ color:'#d1d5db' }}>—</span>;
        const segs = v.split(' | ').map(s => s.trim()).filter(Boolean);
        const isMeta = (s) => s.includes('Recom. by') || s.includes('App. by');
        const ellipsis = { overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' };
        if (!segs.some(isMeta)) {
          return (
            <HoverCard arrow fill content={v} trigger={
              <span style={{ color:'#374151', lineHeight:1.4, display:'block', width:'100%', ...ellipsis }}>{v}</span>
            } />
          );
        }
        const fullText = <div style={{ display:'flex', flexDirection:'column', gap:4 }}>{segs.map((s, i) => <div key={i}>{s}</div>)}</div>;
        return (
          <HoverCard arrow fill content={fullText} trigger={
            <div style={{ display:'flex', flexDirection:'column', gap:1, width:'100%', overflow:'hidden' }}>
              {segs.map((seg, i) => isMeta(seg)
                ? <span key={i} style={{ fontSize:11, color:'#9ca3af', lineHeight:1.3, ...ellipsis }}>{seg}</span>
                : <span key={i} style={{ color:'#374151', lineHeight:1.3, ...ellipsis }}>{seg}</span>
              )}
            </div>
          } />
        );
      },
    },
  ];

  return (
    <div className="page-container">

      {/* ══ Page Header — same style as all pages, but tighter: the date nav +
          summary row below acts as part of the header, so no 20px gap here ══ */}
      <div className="page-header" style={{ marginBottom: 8 }}>
        <div>
          <h1 className="page-title">
            📋 {L('दैनिक हाजिरी रिपोर्ट','Daily Attendance Report')}
            <span style={{ fontSize:14, fontWeight:600, color:'#6b7280', marginLeft:10 }}>
              [ {displayDate} &nbsp;·&nbsp; {dayLabel} ]
            </span>
            {data?.isWeekend && (
              <span style={{ marginLeft:8, background:'#f3f4f6', color:'#6b7280',
                borderRadius:6, padding:'1px 8px', fontSize:11, fontWeight:600 }}>
                {L('विकेन्ड','Weekend')}
              </span>
            )}
          </h1>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {/* Excel Export */}
          <button
            onClick={() => {
              if (!quickRows.length) return;
              const BOM = '﻿';
              const exCompanyName = language==='np'?(settings.companyNameNp||settings.companyNameEn):(settings.companyNameEn||settings.companyNameNp);
              const exCompanyAddr = language==='np'?(settings.companyAddressNp||settings.companyAddressEn):(settings.companyAddressEn||settings.companyAddressNp);
              const se = summary || {};

              // Company header rows + blank row + report info + summary + blank + data headers + data
              const csvRows = [
                [`"${exCompanyName||''}"`],
                [`"${exCompanyAddr||''}${settings.companyPhone?' | Tel: '+settings.companyPhone:''}"`],
                [`"Daily Attendance Report"`],
                [`"Date: ${displayDate}  |  Day: ${dayLabel}${data?.isWeekend?' (Weekend)':''}"`],
                [`"Total: ${se.total}  |  Present: ${se.present}  |  Absent: ${se.absent}  |  Leave: ${se.leave}  |  Office Visit: ${se.visit||0}  |  Weekend: ${se.weekend}  |  Late In: ${se.late}  |  Early Out: ${se.early}"`],
                [''],
                ['"SN","Staff","Post","Dept.","Branch","Date","Day","Shift","Time In","Time Out","Total Hrs","OT","IN Status","OUT Status","Status","Remarks"'],
              ].map(r => Array.isArray(r) ? r.join(',') : r);

              quickRows.forEach((r, i) => {
                csvRows.push([
                  i+1, r.fullName, r.postShort||'', r.deptShort||'', r.branchShort||'',
                  displayDate, dayLabel, r.shiftName||'',
                  r.timeIn  ? fmtTime(r.timeIn)  : '',
                  r.timeOut ? fmtTime(r.timeOut) : '',
                  r.totalHrs||'', (r.eligibleForOt && r.otApprovedFormatted) || '', r.lateIn||'', r.earlyOut||'',
                  r.status||'', (r.remarks||'').replace(/"/g,'""'),
                ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
              });
              const blob = new Blob([BOM + csvRows.join('\n')], { type:'text/csv;charset=utf-8;' });
              downloadBlob(blob, `DailyAttendance_${date}.csv`);
            }}
            style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'6px 14px', height:34,
              background:'#f0fdf4', border:'1px solid #86efac', color:'#15803d',
              borderRadius:6, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            📥 {L('Excel','Excel')}
          </button>

          {/* Print — A4 Portrait, new window */}
          <button
            onClick={() => {
              if (!quickRows.length) return;
              const companyName = language==='np'?(settings.companyNameNp||settings.companyNameEn):(settings.companyNameEn||settings.companyNameNp);
              const companyAddr = language==='np'?(settings.companyAddressNp||settings.companyAddressEn):(settings.companyAddressEn||settings.companyAddressNp);
              const logoHtml = settings.companyLogo
                ? `<img src="${settings.companyLogo}" style="height:38px;object-fit:contain;display:block;margin:0 auto 4px;" />`
                : '';

              // Summary
              const s = summary || {};
              const sumLine = [
                [L('जम्मा','Total'),          s.total,   '#374151'],
                [L('उपस्थित','Present'),      s.present, '#065f46'],
                [L('अनुपस्थित','Absent'),     s.absent,  '#991b1b'],
                [L('बिदा','Leave'),           s.leave,   '#5b21b6'],
                [L('कार्यालय भ्रमण','Office Visit'), s.visit, '#1e40af'],
                [L('विकेन्ड','Weekend'),      s.weekend, '#6b7280'],
                [L('ढिलो आएको','Late In'),    s.late,    '#dc2626'],
                [L('चाँडो गएको','Early Out'), s.early,   '#d97706'],
              ].map(([l,v,c])=>`<span>${l}: <strong style="color:${c}">${v}</strong></span>`).join(' &nbsp;·&nbsp; ');

              // Table rows
              const rowsHtml = quickRows.map((r,i) => {
                const stColor = {Present:'#065f46,#d1fae5',Absent:'#991b1b,#fee2e2',
                  Weekend:'#6b7280,#f3f4f6',Leave:'#5b21b6,#ede9fe','Public Holiday':'#92400e,#fef3c7',
                  'Office Visit':'#1e40af,#dbeafe'}[r.status]||'#374151,#f9fafb';
                const [sc,sb] = stColor.split(',');
                const bg = i%2===0?'white':'#f9fafb';
                const td = (v,c='#374151',fw=400) =>
                  `<td style="padding:4px 7px;border:1px solid #e5e7eb;color:${c};font-weight:${fw};font-size:9px;background:${bg};">${v||'—'}</td>`;
                return `<tr>
                  <td style="padding:4px 5px;border:1px solid #dedede;background:#efefef;color:#6b7280;font-weight:700;font-size:9px;text-align:center;">${i+1}</td>
                  ${td(r.fullName,'#1f2937',700)}
                  ${td(r.postShort,'#0369a1',700)}
                  ${td(r.deptShort,'#059669',700)}
                  ${td(r.branchShort,'#7c3aed',700)}
                  ${td(r.shiftName||'—','#7c3aed')}
                  ${td(r.timeIn?fmtTime(r.timeIn):'—','#1a56db',700)}
                  ${td(r.timeOut?fmtTime(r.timeOut):'—','#374151',700)}
                  ${td(r.totalHrs||'—','#0369a1',700)}
                  ${td((r.eligibleForOt && r.otApprovedFormatted)||'—','#059669',700)}
                  ${td(r.lateIn||'—',r.lateIn?.startsWith('Late')?'#dc2626':'#059669')}
                  ${td(r.earlyOut||'—',r.earlyOut?.startsWith('Early Out')?'#d97706':'#2563eb')}
                  <td style="padding:4px 5px;border:1px solid #e5e7eb;background:${bg};text-align:center;">
                    <span style="background:${sb};color:${sc};border-radius:4px;padding:1px 5px;font-size:8px;font-weight:700;">${statusLabel(r.status, language)}</span>
                  </td>
                  ${td(r.remarks||'—','#374151')}
                </tr>`;
              }).join('');

              const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>Daily Attendance Report</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { -webkit-print-color-adjust:exact; print-color-adjust:exact; box-sizing:border-box; }
  body { font-family:Arial,sans-serif; font-size:10px; margin:0; padding:0; }
  /* Header: grid keeps logo left + info truly centered on page */
  .header { display:grid; grid-template-columns:48px 1fr 48px; align-items:center;
            gap:0; margin-bottom:8px; padding-bottom:8px; border-bottom:2px solid #374151; }
  .header-logo { grid-column:1; align-self:flex-start; }
  .header-info { grid-column:2; text-align:center; }
  .header-spacer{ grid-column:3; }
  .company-name { font-size:15px; font-weight:800; color:#1f2937; margin-bottom:2px; }
  .company-sub  { font-size:10px; color:#6b7280; margin-bottom:4px; }
  .report-title { font-size:13px; font-weight:800; color:#1e40af; }
  .report-date  { font-size:11px; color:#374151; font-weight:600; margin:2px 0; }
  /* Footer */
  .footer { margin-top:40px; display:flex; justify-content:space-between; gap:24px; }
  .footer-col { flex:1; text-align:center; }
  .footer-line { border-bottom:1.5px dotted #374151; height:28px; margin-bottom:6px; }
  .footer-label{ font-size:11px; font-weight:700; color:#374151; }
  hr { border:none; border-top:1.5px solid #374151; margin:6px 0; }
  .summary { font-size:10px; padding:4px 8px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:4px; margin-bottom:6px; }
  table { border-collapse:collapse; width:100%; font-size:9px; }
  th { background:#efefef; color:#374151; font-weight:700; padding:5px 7px; border:1px solid #dedede; text-align:center; white-space:nowrap; }
  td { vertical-align:middle; }
</style>
</head><body>
<div class="header">
  <div class="header-logo">
    ${settings.companyLogo ? `<img src="${settings.companyLogo}" style="height:40px;object-fit:contain;" />` : ''}
  </div>
  <div class="header-info">
    <div class="company-name">${companyName||''}</div>
    <div class="company-sub">${companyAddr||''}${settings.companyPhone?' · Tel: '+settings.companyPhone:''}</div>
    <div class="report-title">📋 Daily Attendance Report</div>
    <div class="report-date">${displayDate} &nbsp;·&nbsp; ${dayLabel}${data?.isWeekend?' (Weekend)':''}</div>
  </div>
  <div class="header-spacer"></div>
</div>
<div class="summary">${sumLine}</div>
<table>
  <thead>
    <tr>
      <th style="width:22px;">SN</th>
      <th style="text-align:left;">Staff</th>
      <th>Post</th><th>Dept</th><th>Branch</th>
      <th>Shift</th><th>In</th><th>Out</th><th>Hrs</th><th>OT</th>
      <th>IN Status</th><th>OUT Status</th><th>Status</th>
      <th style="text-align:left;">Remarks</th>
    </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
</table>
<div class="footer">
  <div class="footer-col">
    <div class="footer-line"></div>
    <div class="footer-label">Prepared by</div>
  </div>
  <div class="footer-col">
    <div class="footer-line"></div>
    <div class="footer-label">Recommend By</div>
  </div>
  <div class="footer-col">
    <div class="footer-line"></div>
    <div class="footer-label">Approved by</div>
  </div>
</div>
<script>window.onload=function(){window.focus();window.print();setTimeout(()=>window.close(),1000);}</script>
</body></html>`;

              const w = window.open('','_blank','width=900,height=1200,scrollbars=yes');
              if (w) { w.document.write(html); w.document.close(); }
            }}
            style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'6px 14px', height:34,
              background:'#eff6ff', border:'1px solid #93c5fd', color:'#1d4ed8',
              borderRadius:6, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            🖨️ {L('प्रिन्ट','Print')}
          </button>
        </div>
      </div>

      {/* ══ Date nav (centred) + summary (right) ══ */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr auto 1fr', alignItems:'center', gap:8, marginBottom:14 }}>

        {/* LEFT spacer — keeps centre truly centred */}
        <div />

        {/* CENTRE: ← Date: [input] → Today */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={() => shiftDate(-1)}
            style={{ width:32, height:34, border:'1px solid #d1d5db', borderRadius:6,
              background:'white', cursor:'pointer', fontSize:16, display:'flex',
              alignItems:'center', justifyContent:'center', flexShrink:0 }}>←</button>

          <span style={{ fontSize:13, fontWeight:700, color:'#374151', whiteSpace:'nowrap' }}>
            {L('मिति','Date')}:
          </span>

          <div style={{ minWidth:155 }}>
            {settings.defaultCalendar === 'np'
              ? <NepaliDatePicker value={date} onChange={setDate} maxToday={false} />
              : <input type="date" className="form-control" value={date}
                  onChange={e => setDate(e.target.value)}
                  style={{ height:34, borderRadius:6, fontSize:13 }} />
            }
          </div>

          <button onClick={() => shiftDate(+1)}
            style={{ width:32, height:34, border:'1px solid #d1d5db', borderRadius:6,
              background:'white', cursor:'pointer', fontSize:16, display:'flex',
              alignItems:'center', justifyContent:'center', flexShrink:0 }}>→</button>

          <button onClick={() => setDate(todayISO())}
            style={{ height:34, padding:'0 14px', border:'1px solid #bfdbfe', borderRadius:6,
              background:'#eff6ff', color:'#1a56db', cursor:'pointer', fontSize:13, fontWeight:700 }}>
            {L('आज','Today')}
          </button>
        </div>

        {/* RIGHT: inline summary stats */}
        <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        {summary && (
          <div style={{ display:'flex', alignItems:'stretch', gap:0,
            background:'white', border:'1px solid #e5e7eb', borderRadius:8,
            overflow:'hidden', flexShrink:0, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
            {[
              { key:'',        label:L('जम्मा','Total'),               value:summary.total,   numColor:'#1f2937', bg:'white'   },
              { key:'Present', label:L('उपस्थित','Present'),           value:summary.present, numColor:'#059669', bg:'#f0fdf4' },
              { key:'Absent',  label:L('अनुपस्थित','Absent'),          value:summary.absent,  numColor:'#dc2626', bg:'#fef2f2' },
              { key:'Leave',   label:L('बिदा','Leave'),                value:summary.leave,   numColor:'#7c3aed', bg:'#faf5ff' },
              { key:'Visit',   label:L('कार्यालय भ्रमण','Office Visit'), value:summary.visit,   numColor:'#0369a1', bg:'#f0f9ff' },
              { key:'Weekend', label:L('विकेन्ड','Weekend'),           value:summary.weekend, numColor:'#6b7280', bg:'white'   },
              { key:'__late',  label:L('ढिलो','Late'),                 value:summary.late,    numColor:'#d97706', bg:'#fffbeb' },
              { key:'__early', label:L('चाँडो','Early'),               value:summary.early,   numColor:'#b45309', bg:'#fef3c7' },
            ].map((s, i, arr) => {
              const active = filters.status === s.key && s.key && !s.key.startsWith('__');
              return (
                <div key={s.label}
                  onClick={() => {
                    const clickable = s.key && !s.key.startsWith('__');
                    if (clickable) setFilters(p => ({ ...p, status: p.status===s.key ? '' : s.key }));
                  }}
                  style={{
                    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                    padding:'6px 11px', minWidth:58,
                    cursor: (s.key && !s.key.startsWith('__')) ? 'pointer' : 'default',
                    background: active ? s.bg : 'transparent',
                    borderRight: i < arr.length-1 ? '1px solid #f3f4f6' : 'none',
                    transition:'background .15s',
                    outline: active ? `2px solid ${s.numColor}44` : 'none',
                    outlineOffset: -2,
                  }}>
                  <span style={{ fontSize:17, fontWeight:800, color:s.numColor, lineHeight:1.1 }}>{s.value}</span>
                  <span style={{ fontSize:10, color:'#374151', fontWeight:500, marginTop:2, whiteSpace:'nowrap' }}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* ══ Error ══ */}
      {error && (
        <div style={{ background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:8,
          padding:'10px 16px', marginBottom:12, color:'#991b1b', fontWeight:600 }}>
          ❌ {error}
        </div>
      )}

      {/* ══ DataGrid ══ */}
      <DataGrid
        columns={columns}
        data={quickRows}
        defaultPageSize={25}
        showSearch={true}
        searchPlaceholder={L('कर्मचारी खोज्नुस...','Search staff...')}
        compact={false}
        loading={loading}
        contextMenu={isEmployee ? [
          {
            label: 'Leave Posting',
            icon: '🌴',
            onClick: (row) => openLeave(row.id),
          },
          {
            label: 'Office Visit Posting',
            icon: '🚗',
            onClick: (row) => openOfficeVisit(row.id),
          },
          {
            label: 'Request for Missing Attendance',
            icon: '📩',
            onClick: (row) => openMissingAttendance(row.id, date),
          },
        ] : [
          {
            label: 'Add Manual Attendance',
            icon: '✍️',
            onClick: (row) => navigate('/attendance/manual-postings', { state: { employeeId: row.id, employeeName: row.name, date } }),
          },
          'divider',
          {
            label: 'Leave Posting',
            icon: '🌴',
            onClick: (row) => openLeave(row.id),
          },
          {
            label: 'Office Visit Posting',
            icon: '🚗',
            onClick: (row) => openOfficeVisit(row.id),
          },
          {
            label: 'Request for Missing Attendance',
            icon: '📩',
            onClick: (row) => openMissingAttendance(row.id, date),
          },
        ]}
        showCheckbox={false}
        autoWidth={true}
        showFilterButton={false}
        toolbar={
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            {/* Advance Search button — replaces the DataGrid Filter button */}
            <button onClick={() => setSearchModal(true)}
              style={{ height:32, padding:'0 14px',
                border:`1.5px solid ${activeCount?'#7c3aed':'#c4b5fd'}`,
                borderRadius:6, background: activeCount?'#ede9fe':'#f5f3ff',
                color: activeCount?'#5b21b6':'#6d28d9',
                cursor:'pointer', fontSize:12, fontWeight: activeCount?700:600,
                display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
              <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              {L('विस्तृत खोज','Advance Search')}
              {activeCount > 0 && (
                <span style={{ background:'#1a56db', color:'white', borderRadius:'50%',
                  width:17, height:17, fontSize:10, fontWeight:700,
                  display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                  {activeCount}
                </span>
              )}
            </button>
            {activeCount > 0 && (
              <button className="btn btn-outline btn-sm" style={{ height:32 }}
                onClick={() => setFilters({ staffId:'', branch:'', dept:'', post:'', mode:'', grade:'', shift:'', status:'' })}>
                ✕ {L('हटाउनुस','Clear')}
              </button>
            )}
            <div style={{ width:1, height:22, background:'#e5e7eb', margin:'0 2px' }} />
            {[
              { key:'',           label:L('सबै','All'),                    icon:'👥', count: rows.length,                                           color:'#374151', bg:'#f3f4f6',  border:'#e5e7eb'  },
              { key:'absent',     label:L('अनुपस्थित','Absent'),           icon:'📅', count: rows.filter(r=>r.status==='Absent').length,            color:'#991b1b', bg:'#fee2e2',  border:'#fca5a5'  },
              { key:'late-early', label:L('आउने/जाने समस्या','IN/OUT Issues'), icon:'⏰', count: rows.filter(r=>!!(r.lateIn||r.earlyOut)).length,       color:'#92400e', bg:'#fef3c7',  border:'#fcd34d'  },
              { key:'leave',      label:L('बिदा','Leave'),                 icon:'🌴', count: rows.filter(r=>r.hasLeave).length,                     color:'#5b21b6', bg:'#ede9fe',  border:'#c4b5fd'  },
              { key:'visit',      label:L('कार्यालय भ्रमण','Office Visit'), icon:'🚗', count: rows.filter(r=>r.hasVisit).length,                     color:'#0369a1', bg:'#e0f2fe',  border:'#bae6fd'  },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setQuickFilter(f.key)}
                style={{
                  display:'inline-flex', alignItems:'center', gap:5,
                  padding:'4px 12px', border:`1.5px solid ${quickFilter===f.key ? f.color : f.border}`,
                  borderRadius:20, background: quickFilter===f.key ? f.bg : 'white',
                  color: quickFilter===f.key ? f.color : '#6b7280',
                  fontWeight: quickFilter===f.key ? 700 : 500,
                  fontSize:12, cursor:'pointer', transition:'all .15s',
                  boxShadow: quickFilter===f.key ? `0 0 0 2px ${f.border}` : 'none',
                }}>
                <span>{f.icon}</span>
                {f.label}
                {f.count > 0 && (
                  <span style={{
                    background: quickFilter===f.key ? f.color : '#e5e7eb',
                    color: quickFilter===f.key ? 'white' : '#6b7280',
                    borderRadius:'50%', minWidth:18, height:18, fontSize:10, fontWeight:700,
                    display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'0 4px',
                  }}>
                    {f.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        }
      />

      {/* ══ Legend ══ */}
      <div style={{ marginTop:10, display:'flex', gap:16, flexWrap:'wrap', fontSize:11, color:'#6b7280',
        padding:'7px 12px', background:'#f9fafb', borderRadius:8, border:'1px solid #e5e7eb' }}>
        <strong style={{ color:'#374151' }}>{L('व्याख्या','Legend')}:</strong>
        <span><strong style={{ color:'#dc2626' }}>Late: HH:mm</strong> — {L('ढिलो (ग्रेस पछि)','Late (after grace)')}</span>
        <span><strong style={{ color:'#d97706' }}>Early: HH:mm</strong> — {L('चाँडो गएको','Left early')}</span>
        <span style={{ marginLeft:'auto', color:'#9ca3af' }}>
          {L('पद/विभाग/शाखामा Short Name देखाइन्छ — hover गर्नुस पूरा नाम हेर्न',
            'Post/Dept/Branch show short names — hover for full name')}
        </span>
      </div>

      {/* ══ Advance Search Modal ══ */}
      {searchModal && (
        <AdvanceSearchModal
          filters={filters}
          onApply={f => setFilters({ ...f, staffId: myEmpId || f.staffId })}
          onClose={() => setSearchModal(false)}
          L={L}
          settings={settings}
          allRows={allRows}
          employees={employees}
          shifts={shifts}
        />
      )}
    </div>
  );
};

export default DailyAttendanceReport;
