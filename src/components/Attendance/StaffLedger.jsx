import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLeaveApply }      from '../../context/LeaveApplyContext.jsx';
import { useOfficeVisitApply } from '../../context/OfficeVisitApplyContext.jsx';
import { useMissingAttendanceApply } from '../../context/MissingAttendanceApplyContext.jsx';
import api             from '../../api/client.js';
import DataGrid        from '../DataGrid/DataGrid.jsx';
import useDateFormat   from '../../hooks/useDateFormat.js';
import ViewHalfMonthlyBtn from './ViewHalfMonthlyBtn.jsx';
import ViewMonthlyBtn    from './ViewMonthlyBtn.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits, getNepalNow, getNepalTodayISO, getCurrentFiscalYear } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, getExcelHeaderRows, downloadCSV } from '../../utils/printHelper.js';
import { staffRankCompare } from '../../utils/branchUtils.js';

/* ── Constants ──────────────────────────────────────────────── */
const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

const STATUS_STYLE = {
  Present          : { bg:'#f0fdf4', color:'#065f46', border:'#bbf7d0' },
  Absent           : { bg:'#fff5f5', color:'#991b1b', border:'#fecaca' },
  Weekend          : { bg:'#f3f4f6', color:'#6b7280', border:'#e5e7eb' },
  Leave            : { bg:'#ede9fe', color:'#5b21b6', border:'#c4b5fd' },
  'Public Holiday' : { bg:'#fef3c7', color:'#92400e', border:'#fcd34d' },
  'Office Visit'   : { bg:'#dbeafe', color:'#1e40af', border:'#93c5fd' },
};
const statusStyle = (s) => STATUS_STYLE[s] || STATUS_STYLE.Leave;

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

/* ── Searchable Staff Dropdown ──────────────────────────────── */
const StaffSelect = ({ employees, value, onChange }) => {
  const [open,    setOpen]    = useState(false);
  const [search,  setSearch]  = useState('');
  const ref    = useRef();
  const inpRef = useRef();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => { if (open && inpRef.current) inpRef.current.focus(); }, [open]);

  const filtered = employees.filter(e =>
    !search ||
    (e.fullName||'').toLowerCase().includes(search.toLowerCase()) ||
    (e.deviceId  ? String(e.deviceId) : '').includes(search) ||
    (e.position||'').toLowerCase().includes(search.toLowerCase())
  );

  const selected = employees.find(e => String(e.id) === String(value));

  return (
    <div ref={ref} style={{ flex:1, minWidth:220, position:'relative' }}>
      {/* Trigger */}
      <div onClick={() => setOpen(p => !p)}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          height:36, padding:'0 10px', border:`1.5px solid ${open?'#1a56db':'#d1d5db'}`,
          borderRadius:8, background:'white', cursor:'pointer',
          boxShadow:open?'0 0 0 2px rgba(26,86,219,.1)':'none', transition:'all .15s' }}>
        <span style={{ fontSize:13, color:selected?'#1f2937':'#9ca3af',
          fontWeight:selected?600:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
          {selected
            ? `${selected.fullName}${selected.deviceId ? ` (${selected.deviceId})` : ''}`
            : '— Select Staff Member —'}
        </span>
        <svg viewBox="0 0 20 20" fill={open?'#1a56db':'#9ca3af'} width="13" height="13"
          style={{ flexShrink:0, marginLeft:6, transform:open?'rotate(180deg)':'none', transition:'transform .2s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:500,
          background:'white', border:'1px solid #d1d5db', borderRadius:8,
          boxShadow:'0 8px 28px rgba(0,0,0,.13)', overflow:'hidden' }}>
          {/* Search */}
          <div style={{ padding:'8px 10px', background:'#f9fafb', borderBottom:'1px solid #f3f4f6' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, background:'white',
              border:'1px solid #e5e7eb', borderRadius:6, padding:'5px 8px' }}>
              <svg viewBox="0 0 20 20" fill="#9ca3af" width="13" height="13">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              <input ref={inpRef} value={search} onChange={e=>setSearch(e.target.value)}
                onClick={e=>e.stopPropagation()} placeholder="Search by name, device ID, post..."
                style={{ border:'none', outline:'none', fontSize:12, flex:1, background:'transparent' }} />
              {search && (
                <button onMouseDown={e=>{e.preventDefault();setSearch('');}}
                  style={{ background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:13,padding:0 }}>✕</button>
              )}
            </div>
          </div>
          {/* Options */}
          <div style={{ maxHeight:240, overflowY:'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding:'12px',textAlign:'center',color:'#9ca3af',fontSize:12 }}>No staff found</div>
            )}
            {filtered.map((e, idx) => {
              const active = String(e.id) === String(value);
              return (
                <div key={e.id}
                  onMouseDown={ev=>{ ev.preventDefault(); onChange(String(e.id)); setOpen(false); setSearch(''); }}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'5px 14px',
                    cursor:'pointer', background:active?'#eff6ff':'white',
                    borderBottom:'1px solid #d1d5db', transition:'background .1s' }}
                  onMouseEnter={ev=>{ if(!active) ev.currentTarget.style.background='#f5f8ff'; }}
                  onMouseLeave={ev=>{ ev.currentTarget.style.background=active?'#eff6ff':'white'; }}>
                  {/* Rank badge */}
                  <div style={{ width:22, height:22, borderRadius:'50%', background:active?'#1a56db':'#f3f4f6',
                    color:active?'white':'#9ca3af', fontSize:10, fontWeight:700, flexShrink:0,
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {idx+1}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:active?700:600, color:active?'#1e40af':'#1f2937',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {e.fullName}
                    </div>
                    <div style={{ fontSize:11, color:'#9ca3af' }}>
                      {e.deviceId  && <span style={{ marginRight:6, fontFamily:'monospace' }}>{e.deviceId}</span>}
                      {e.position  && <span>{e.position}</span>}
                    </div>
                  </div>
                  {active && (
                    <svg viewBox="0 0 20 20" fill="#1a56db" width="14" height="14" style={{ flexShrink:0 }}>
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
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

/* ═══════════════════════════════════════════════════════════
   Staff Ledger — Full-Month Individual Attendance Report
═══════════════════════════════════════════════════════════ */
const StaffLedger = () => {
  const [searchParams] = useSearchParams();
  const location       = useLocation();
  const navigate        = useNavigate();
  const { open: openLeave }       = useLeaveApply();
  const { open: openOfficeVisit } = useOfficeVisitApply();
  const { open: openMissingAttendance } = useMissingAttendanceApply();
  const { language }   = useLanguage();
  const { settings }   = useSettings();
  const { filteredEmployees: employees, getApprovedLeaveForDate, getLeaveTypeName, getEmployeeName, leaveTypes, rosterVersion } = useData();

  /* language-aware leave type name */
  const getLeaveLabel = (code) => {
    const lt = leaveTypes?.find(l => l.code === code);
    if (lt) return language === 'np' ? lt.name : (lt.nameEn || lt.name || code);
    return getLeaveTypeName(code);
  };
  const { currentUser } = useAuth();
  const fd             = useDateFormat();
  const L = (np,en)    => language==='np' ? np : en;

  const isStaffLogin = currentUser?.role === 'employee';

  // Half-monthly context: shows 1st/2nd Half toggle (1–15 or 16–end of month)
  // Monthly context: shows full month range (no toggle)
  const isHalfMonthlyCtx = location.pathname.includes('/half-monthly/');

  const useNP      = settings.defaultCalendar === 'np';
  const now        = getNepalNow();
  const todayBS    = adToBS(getNepalTodayISO());
  const currentFY  = getCurrentFiscalYear(settings.fiscalYears || []);

  // Always default to current month — ignore any year/month URL params
  // Only half is taken from URL (or auto-detected from today's date)
  const urlHalf  = parseInt(searchParams.get('half'));
  const initYear  = useNP ? (todayBS?.year  || now.getFullYear())  : now.getFullYear();
  const initMonth = useNP ? (todayBS?.month || now.getMonth() + 1) : now.getMonth() + 1;
  // 1st half if today ≤ 15, 2nd half if today ≥ 16
  const initHalf  = urlHalf || (now.getDate() <= 15 ? 1 : 2);

  const [year,   setYear]   = useState(initYear);
  const [month,  setMonth]  = useState(initMonth);
  const [half,   setHalf]   = useState(initHalf);   // used in half-monthly context only
  const [empId,        setEmpId]        = useState('');
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [showAdvSearch,  setShowAdvSearch]  = useState(false);
  const [statusFilter,   setStatusFilter]   = useState('');      // '' = All
  const [staffStatus,    setStaffStatus]    = useState('working'); // 'working'|'notworking'

  /* ── Sorted employees filtered by working status ── */
  const sortedEmps = [...employees]
    .filter(e => staffStatus === 'notworking' ? e.active === false : e.active !== false)
    .sort((a,b) => staffRankCompare(a, b, settings));

  /* ── Auto-select default employee once the list is available ── */
  useEffect(() => {
    if (empId || !sortedEmps.length) return;   // already selected or list not ready
    if (isStaffLogin) {
      // Staff login → find and show their own record
      const own = sortedEmps.find(e => String(e.id) === String(currentUser?.id));
      if (own) setEmpId(String(own.id));
    } else {
      // Admin / Manager → show the first employee in ranking order
      setEmpId(String(sortedEmps[0].id));
    }
  }, [sortedEmps.length]);   // run once after employees load

  /* ── Compute EXACT AD date range ── */
  const getDateRange = useCallback(() => {
    if (isHalfMonthlyCtx) {
      // Half-monthly: 1st half = 1–15, 2nd half = 16–end
      if (useNP) {
        const halfStartDay = half === 1 ? 1 : 16;
        const halfEndDay   = half === 1 ? 15 : getBSDays(year, month);
        const firstAD = bsToAD(year, month, halfStartDay);
        const lastAD  = bsToAD(year, month, halfEndDay);
        if (firstAD && lastAD) return { startDate: isoDate(firstAD), endDate: isoDate(lastAD) };
      }
      const lastDayOfMonth = new Date(year, month, 0).getDate();
      return half === 1
        ? { startDate: `${year}-${pad(month)}-01`,  endDate: `${year}-${pad(month)}-15` }
        : { startDate: `${year}-${pad(month)}-16`,  endDate: `${year}-${pad(month)}-${pad(lastDayOfMonth)}` };
    }
    // Monthly context (default): full calendar month
    if (useNP) {
      const firstAD = bsToAD(year, month, 1);
      const lastDay = getBSDays(year, month);
      const lastAD  = bsToAD(year, month, lastDay);
      if (firstAD && lastAD) return { startDate: isoDate(firstAD), endDate: isoDate(lastAD) };
    }
    const lastDay = new Date(year, month, 0).getDate();
    return {
      startDate: `${year}-${pad(month)}-01`,
      endDate  : `${year}-${pad(month)}-${pad(lastDay)}`,
    };
  }, [year, month, half, useNP, isHalfMonthlyCtx]);

  /* ── Load data ── */
  const load = useCallback(async () => {
    if (!empId) return;
    setLoading(true); setError(null);
    try {
      const { startDate, endDate } = getDateRange();
      const url = `/attendance/staff-ledger?startDate=${startDate}&endDate=${endDate}&employeeId=${empId}`;
      setData(await api.get(url));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year, month, half, empId, getDateRange]);

  useEffect(() => { if (empId) load(); }, [year, month, half, empId]);

  /* ── Period label ── */
  const periodLabel = () => {
    let label;
    if (useNP) {
      const bsM = BS_MONTHS_NP[month-1] || '';
      const fmt  = n => settings.nepaliDigits ? toNepaliDigits(n) : String(n);
      label = `${bsM} ${fmt(year)} BS`;
    } else {
      label = `${MONTHS_EN[month-1]} ${year}`;
    }
    if (isHalfMonthlyCtx) {
      label += ` · ${half === 1 ? L('पहिलो अर्ध (१–१५)','1st Half (1–15)') : L('दोस्रो अर्ध (१६–अन्त)','2nd Half (16–End)')}`;
    }
    return label;
  };

  const emp     = data?.employee;
  /* overlay approved leaves on each day row */
  const days    = (data?.days || []).map(r => {
    const leave = getApprovedLeaveForDate(emp?.id, r.dateStr);
    if (!leave || r.status === 'Weekend' || r.status === 'Holiday') return r;
    if (r.status === 'Absent') {
      return {
        ...r,
        status:    'On Leave',
        hasLeave:  true,
        leaveInfo: {
          typeName:      getLeaveLabel(leave.leaveTypeCode) || leave.leaveTypeCode,
          reason:        leave.reason || '',
          recommendedBy: leave.recommendedBy ? getEmployeeName(leave.recommendedBy) : null,
          approvedBy:    leave.approvedBy    ? getEmployeeName(leave.approvedBy)    : null,
        },
      };
    }
    /* Present but also has leave — show in remarks */
    return {
      ...r,
      leaveInfo: {
        typeName:  getLeaveTypeName(leave.leaveTypeCode) || leave.leaveTypeCode,
        reason:    leave.reason || '',
      },
    };
  });
  const summary = data?.summary || {};
  const period  = data?.period  || {};

  /* ── Staff navigation ── */
  const currentIdx = empId ? sortedEmps.findIndex(e => String(e.id) === String(empId)) : -1;
  const navTo = (idx) => {
    if (idx >= 0 && idx < sortedEmps.length) setEmpId(String(sortedEmps[idx].id));
  };

  /* ── DataGrid columns (no Staff/Post/Dept/Branch — in header card) ── */
  const Pill = ({ children, bg, color, border }) => (
    <span style={{ background:bg,color,border:`1px solid ${border}`,borderRadius:10,
      padding:'2px 9px',fontSize:11,fontWeight:700,display:'inline-block' }}>
      {children}
    </span>
  );

  const columns = [
    {
      field:'dateStr', header:L('मिति','Date'),
      render:(v,row)=>(
        <span style={{ fontSize:13,color:row.isWeekend?'#9ca3af':'#1f2937',whiteSpace:'nowrap' }}>
          {fd(v)}
        </span>
      ),
    },
    {
      field:'dayFull', header:L('दिन','Day'),
      render:(v,row)=>(
        <span style={{ fontSize:13,color:row.isWeekend?'#9ca3af':'#374151' }}>{v || '—'}</span>
      ),
    },
    {
      field:'_shift', header:L('सिफ्ट','Shift'), sortable:false,
      render:(_,row)=>(
        <span style={{ fontSize:13,color:'#1f2937' }}>
          {!row.isWeekend ? (row.shiftName||'—') : '—'}
        </span>
      ),
    },
    {
      field:'timeIn', header:L('आउने','Time In'), align:'center',
      render:(v,row)=>{
        if(!v) return <span style={{ color:'#d1d5db', fontSize:13 }}>—</span>;
        const warn=row.punches===1;
        const onTime=row.lateFormatted==='On Time';
        return(
          <span style={{ color: onTime ? '#1f2937' : (warn?'#f59e0b':'#3b82f6'), fontSize:13, fontWeight: onTime?400:700, whiteSpace:'nowrap' }}
            title={warn?'Single punch only':''}>
            {fmtTime(v)}
          </span>
        );
      },
    },
    {
      field:'timeOut', header:L('جاने','Time Out'), align:'center',
      render:(v,row)=>{
        if(!v) return <span style={{ color:'#d1d5db', fontSize:13 }}>—</span>;
        const warn=row.punches===1;
        const onTime=row.earlyFormatted==='On Time';
        return(
          <span style={{ color: onTime ? '#1f2937' : (warn?'#f59e0b':'#6b7280'), fontSize:13, fontWeight: onTime?400:700, whiteSpace:'nowrap' }}
            title={warn?'Single punch only':''}>
            {fmtTime(v)}
          </span>
        );
      },
    },
    {
      field:'totalFormatted', header:L('घण्टा','Total Hrs'), align:'center',
      render:v=>v
        ?<span style={{ color:'#0369a1', fontSize:13, fontWeight:700 }}>{v}</span>
        :<span style={{ color:'#d1d5db', fontSize:13 }}>—</span>,
    },
    {
      field:'lateFormatted', header:L('IN स्थिति','IN Status'),
      render:v=>{
        if(!v) return <span style={{ color:'#d1d5db', fontSize:13 }}>—</span>;
        if (v === 'On Time') return <span style={{ color:'#1f2937', fontSize:13 }}>{v}</span>;
        const isEarly = v.startsWith('Early In');
        return <span style={{ color: isEarly ? '#10b981' : '#ef4444', fontWeight:700, fontSize:13 }}>{v}</span>;
      },
    },
    {
      field:'earlyFormatted', header:L('OUT स्थिति','OUT Status'),
      render:v=>{
        if(!v) return <span style={{ color:'#d1d5db', fontSize:13 }}>—</span>;
        if (v === 'On Time') return <span style={{ color:'#1f2937', fontSize:13 }}>{v}</span>;
        const isLateOut = v.startsWith('Late Out');
        return <span style={{ color: isLateOut ? '#3b82f6' : '#f59e0b', fontWeight:700, fontSize:13 }}>{v}</span>;
      },
    },
    {
      field:'otApprovedFormatted', header:L('ओटी','OT'), align:'center',
      render:v=>(emp?.eligibleForOt && v)
        ?<span style={{ color:'#059669', fontSize:13, fontWeight:700 }}>{v}</span>
        :<span style={{ color:'#d1d5db', fontSize:13 }}>—</span>,
    },
    {
      field:'status', header:L('स्थिति','Status'),
      render:(v,row)=>{
        if (v === 'On Leave') {
          /* Badge only — no leave name below */
          return <Pill bg="#eff6ff" color="#1e40af" border="#bfdbfe">{L('बिदामा','On Leave')}</Pill>;
        }
        const s=statusStyle(v);
        return <Pill bg={s.bg} color={s.color} border={s.border}>{v}</Pill>;
      },
    },
    {
      field:'remarks', header:L('कैफियत','Remarks'), sortable:false, wrap:true,
      render:(v,row)=>{
        if (row.leaveInfo) {
          const parts = [];
          if (row.leaveInfo.typeName) parts.push(
            <span key="type" style={{ fontWeight:700, color:'#1e40af' }}>{row.leaveInfo.typeName}</span>
          );
          if (row.leaveInfo.reason) parts.push(
            <span key="reason" style={{ color:'#374151' }}>{row.leaveInfo.reason}</span>
          );
          if (row.leaveInfo.recommendedBy) parts.push(
            <span key="reco" style={{ color:'#059669' }}>
              <span style={{ fontWeight:600 }}>{L('सिफारिस:','Reco. by:')}</span> {row.leaveInfo.recommendedBy}
            </span>
          );
          if (row.leaveInfo.approvedBy) parts.push(
            <span key="appr" style={{ color:'#7c3aed' }}>
              <span style={{ fontWeight:600 }}>{L('स्वीकृत:','Appr. by:')}</span> {row.leaveInfo.approvedBy}
            </span>
          );
          return (
            <div style={{ fontSize:12, display:'flex', flexWrap:'wrap', gap:'0 8px', alignItems:'center' }}>
              {parts.map((p, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span style={{ color:'#d1d5db', fontSize:10 }}>|</span>}
                  {p}
                </React.Fragment>
              ))}
            </div>
          );
        }
        if (!v) return <span style={{ color:'#d1d5db', fontSize:12 }}>—</span>;
        const segs = v.split(' | ').map(s => s.trim()).filter(Boolean);
        const isMeta = (s) => s.includes('Recom. by') || s.includes('App. by');
        if (!segs.some(isMeta)) return <span style={{ fontSize:12, color:'#374151' }}>{v}</span>;
        return (
          <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
            {segs.map((seg, i) => isMeta(seg)
              ? <span key={i} style={{ fontSize:10, color:'#9ca3af', lineHeight:1.3 }}>{seg}</span>
              : <span key={i} style={{ fontSize:12, color:'#374151', lineHeight:1.3 }}>{seg}</span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {isHalfMonthlyCtx
              ? `📒 ${L('अर्धमासिक स्टाफ लेजर','Half Monthly Staff Ledger')}`
              : `📒 ${L('मासिक स्टाफ लेजर','Monthly Staff Ledger')}`}
          </h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY && (
              <span style={{ background:'#eff6ff',color:'#1a56db',borderRadius:6,
                padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>
                {currentFY.name}
              </span>
            )}
            {periodLabel()}
            {period.startDate && (
              <span style={{ marginLeft:8, fontSize:11, color:'#9ca3af' }}>
                {fd(period.startDate)} → {fd(period.endDate)}
                <span style={{ marginLeft:5, background:'#f1f5f9', color:'#475569',
                  borderRadius:4, padding:'1px 6px', fontSize:10, fontWeight:600 }}>
                  {period.totalWorkingDays} {L('दिन','days')}
                </span>
              </span>
            )}
          </p>
        </div>
        {/* Right side: navigation + print + export */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          {/* Print */}
          <button onClick={()=>{
              if (!days.length || !emp) return;
              const reportTitle = isHalfMonthlyCtx ? '📒 Half Monthly Staff Ledger' : '📒 Monthly Staff Ledger';
              const reportSub   = periodLabel();   // period only — no staff name in header
              const s = summary || {};
              const visitCount         = days.filter(r => r.hasVisit).length;
              const presentInHoliday   = days.filter(r => r.isPublicHoliday && r.timeIn).length;
              const presentInWeekend   = days.filter(r => r.isWeekend      && r.timeIn).length;

              // Staff info row + summary row — placed BELOW the header black line, ABOVE the grid
              const staffInfoHtml = `
                <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;
                            padding:7px 0;margin-bottom:6px;border-bottom:2px solid #000;">
                  <span><strong style="color:#6b7280">Staff Name:</strong>
                    <strong style="color:#1f2937;margin-left:4px">${emp.fullName||'—'}</strong></span>
                  <span><strong style="color:#6b7280">Post:</strong>
                    <span style="color:#0369a1;font-weight:700;margin-left:4px">${emp.postShort||emp.position||'—'}</span></span>
                  <span><strong style="color:#6b7280">Department:</strong>
                    <span style="color:#059669;font-weight:700;margin-left:4px">${emp.deptShort||emp.department||'—'}</span></span>
                  <span><strong style="color:#6b7280">Grade:</strong>
                    <span style="margin-left:4px">${emp.grade||'—'}</span></span>
                  <span><strong style="color:#6b7280">Mode:</strong>
                    <span style="margin-left:4px">${emp.mode||'—'}</span></span>
                  <span><strong style="color:#6b7280">Branch:</strong>
                    <span style="color:#7c3aed;font-weight:700;margin-left:4px">${emp.branchShort||emp.branch||'—'}</span></span>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:10px;
                            padding:4px 8px;margin-bottom:8px;
                            background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;">
                  <span>Present: <strong style="color:#065f46">${s.presentCount||0}</strong></span>
                  <span>·</span>
                  <span>Absent: <strong style="color:#991b1b">${s.absentCount||0}</strong></span>
                  <span>·</span>
                  <span>Leave: <strong style="color:#5b21b6">${s.leaveCount||0}</strong></span>
                  <span>·</span>
                  <span>Office Visit: <strong style="color:#1e40af">${visitCount}</strong></span>
                  <span>·</span>
                  <span>Late In: <strong style="color:#dc2626">${s.lateCount||0}</strong></span>
                  <span>·</span>
                  <span>Early Out: <strong style="color:#d97706">${s.earlyCount||0}</strong></span>
                  <span>·</span>
                  <span>Att. Rate: <strong style="color:#1a56db">${s.attendanceRate||0}%</strong></span>
                  <span>·</span>
                  <span>Present in Holiday: <strong style="color:#92400e">${presentInHoliday}</strong></span>
                  <span>·</span>
                  <span>Present in Weekend: <strong style="color:#6b7280">${presentInWeekend}</strong></span>
                </div>`;

              // Date column uses fd() to match the data grid display (BS if Nepali calendar)
              const tableRows = days.map((r,i) => `<tr>
                <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;background:#efefef;color:#6b7280;font-weight:600">${i+1}</td>
                <td style="padding:4px 6px;border:1px solid #dedede;font-weight:600">${fd(r.dateStr)||r.dateStr||''}</td>
                <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.dayFull?r.dayFull.slice(0,3):''}</td>
                <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;font-family:monospace;color:#1a56db;font-weight:700">${r.timeIn?fmtTime(r.timeIn):''}</td>
                <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;font-family:monospace">${r.timeOut?fmtTime(r.timeOut):''}</td>
                <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;color:#0369a1;font-weight:700">${r.totalFormatted||''}</td>
                <td style="padding:4px 6px;border:1px solid #dedede;color:${r.lateFormatted?.startsWith('Late')?'#dc2626':'#059669'}">${r.lateFormatted||''}</td>
                <td style="padding:4px 6px;border:1px solid #dedede;color:${r.earlyFormatted?.startsWith('Early Out')?'#d97706':'#2563eb'}">${r.earlyFormatted||''}</td>
                <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;color:#059669;font-weight:700">${(emp?.eligibleForOt && r.otApprovedFormatted)||''}</td>
                <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.status||''}</td>
                <td style="padding:4px 6px;border:1px solid #dedede;font-size:9px">${r.remarks||''}</td>
              </tr>`).join('');

              const contentHtml = staffInfoHtml + `
                <table style="border-collapse:collapse;width:100%;font-size:10px">
                  <thead><tr>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef">SN</th>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef;text-align:left">Date</th>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef">Day</th>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef">Time In</th>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef">Time Out</th>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef">Total Hrs</th>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef">IN Status</th>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef">OUT Status</th>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef">OT</th>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef">Status</th>
                    <th style="padding:5px 6px;border:1px solid #dedede;background:#efefef;text-align:left">Remarks</th>
                  </tr></thead>
                  <tbody>${tableRows}</tbody>
                </table>`;
              openPrintWindow(buildPrintDoc({ settings, language, reportTitle, reportSub, contentHtml, isLandscape:false }), false);
            }}
            title="Print"
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#eff6ff',border:'1px solid #93c5fd',color:'#1d4ed8',
              borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
              <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9h8v3H6v-3zm8-4a1 1 0 110 2 1 1 0 010-2z" clipRule="evenodd"/>
            </svg>
            Print
          </button>
          {/* Export CSV */}
          <button
            title="Export CSV"
            onClick={() => {
              if (!days.length || !emp) return;
              const reportTitle = isHalfMonthlyCtx ? 'Half Monthly Staff Ledger' : 'Monthly Staff Ledger';
              const s = summary || {};
              const visitCount2       = days.filter(r => r.hasVisit).length;
              const presentInHoliday2 = days.filter(r => r.isPublicHoliday && r.timeIn).length;
              const presentInWeekend2 = days.filter(r => r.isWeekend      && r.timeIn).length;
              // Staff info + summary as extra CSV rows after company header
              const staffInfoRow = `"Staff Name: ${emp.fullName||''}","Post: ${emp.postShort||emp.position||''}","Dept: ${emp.deptShort||emp.department||''}","Grade: ${emp.grade||''}","Mode: ${emp.mode||''}","Branch: ${emp.branchShort||emp.branch||''}"`;
              const summaryRow = `"Present: ${s.presentCount||0}  Absent: ${s.absentCount||0}  Leave: ${s.leaveCount||0}  Office Visit: ${visitCount2}  Late In: ${s.lateCount||0}  Early Out: ${s.earlyCount||0}  Att.Rate: ${s.attendanceRate||0}%  Present in Holiday: ${presentInHoliday2}  Present in Weekend: ${presentInWeekend2}${emp?.eligibleForOt ? `  Total OT: ${s.otApprovedFormatted||'0:00'}` : ''}"`;
              const header = ['SN','Date','Day','Time In','Time Out','Total Hrs','IN Status','OUT Status','OT','Status','Remarks'];
              const dataRows = days.map(r => [
                r.sn, fd(r.dateStr)||r.dateStr, r.dayFull,
                r.timeIn  ? fmtTime(r.timeIn)  : '',
                r.timeOut ? fmtTime(r.timeOut) : '',
                r.totalFormatted||'',
                r.lateFormatted||'',
                r.earlyFormatted||'',
                (emp?.eligibleForOt && r.otApprovedFormatted)||'',
                r.status, r.remarks||''
              ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
              const excelContent = getExcelHeaderRows(settings, language, reportTitle, periodLabel())
                + staffInfoRow + '\n'
                + summaryRow  + '\n'
                + '""\n'       // blank separator
                + header.join(',') + '\n'
                + dataRows;
              downloadCSV(excelContent, `StaffLedger_${emp.fullName||'Staff'}_${data?.period?.startDate||''}.csv`);
            }}
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#f0fdf4',border:'1px solid #86efac',color:'#15803d',
              borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
            Export
          </button>
          {/* View Half Monthly Reports — shown only in half-monthly context */}
          {isHalfMonthlyCtx && (
            <ViewHalfMonthlyBtn year={year} month={month} half={half} useNP={useNP}
              currentPath="/attendance/reports/half-monthly/ledger" />
          )}
          {/* View Monthly Reports — shown when on monthly path */}
          {!isHalfMonthlyCtx && location.pathname.includes('/monthly/') && (
            <ViewMonthlyBtn year={year} month={month} useNP={useNP}
              currentPath="/attendance/reports/monthly/ledger" />
          )}
        </div>
      </div>

      {/* ── Selectors bar ── */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap',justifyContent:'flex-end' }}>
        {/* Year */}
        <select className="form-control" style={{ width:useNP?115:85,height:36,fontSize:13 }}
          value={year} onChange={e=>setYear(+e.target.value)}>
          {useNP
            ? [todayBS?.year-1,todayBS?.year,todayBS?.year+1].filter(Boolean).map(y=>(
                <option key={y} value={y}>{settings.nepaliDigits?toNepaliDigits(y):y} BS</option>
              ))
            : [now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1].map(y=>(
                <option key={y} value={y}>{y}</option>
              ))
          }
        </select>
        {/* Month */}
        <select className="form-control" style={{ width:useNP?120:140,height:36,fontSize:13 }}
          value={month} onChange={e=>setMonth(+e.target.value)}>
          {useNP
            ? BS_MONTHS_NP.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
            : MONTHS_EN.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
          }
        </select>

        {/* 1st/2nd Half toggle — shown only in half-monthly context */}
        {isHalfMonthlyCtx && (
          <div style={{ display:'flex',gap:0,border:'1px solid #d1d5db',borderRadius:8,overflow:'hidden' }}>
            {[1,2].map(h=>(
              <button key={h} onClick={()=>setHalf(h)}
                style={{ padding:'5px 16px',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,
                  background:half===h?'#1a56db':'white',color:half===h?'white':'#374151',
                  transition:'background .15s' }}>
                {h===1 ? L('पहिलो अर्ध','1st Half') : L('दोस्रो अर्ध','2nd Half')}
              </button>
            ))}
          </div>
        )}

        {/* Divider */}
        <div style={{ width:1,height:24,background:'#e5e7eb' }}/>

        {/* Staff selector — hidden for staff-role users (locked to their own record) */}
        {isStaffLogin ? (
          <span style={{ fontSize:13,fontWeight:600,color:'#1f2937',
            background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,
            padding:'5px 14px',flexShrink:0 }}>
            👤 {sortedEmps.find(e=>String(e.id)===empId)?.fullName || '—'}
          </span>
        ) : (
          <>
            {/* Status toggle: Working / Not Working */}
            <div style={{ display:'flex',gap:0,border:'1px solid #d1d5db',borderRadius:8,overflow:'hidden',flexShrink:0 }}>
              {[['working',L('कार्यरत','Working')],['notworking',L('अवकाश','Not Working')]].map(([v,label])=>(
                <button key={v} onClick={()=>{ setStaffStatus(v); setEmpId(''); }}
                  style={{ padding:'5px 14px',border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
                    background:staffStatus===v?'#1a56db':'white',
                    color:staffStatus===v?'white':'#374151',transition:'background .15s' }}>
                  {label}
                </button>
              ))}
            </div>
            <span style={{ fontSize:13,fontWeight:600,color:'#374151',flexShrink:0,whiteSpace:'nowrap' }}>
              Staff :
            </span>
            <div style={{ width:280, flexShrink:0 }}>
              <StaffSelect employees={sortedEmps} value={empId} onChange={setEmpId} />
            </div>
          </>
        )}

        <button className="btn btn-outline btn-sm" style={{ height:36,flexShrink:0 }}
          onClick={load} disabled={!empId||loading}>
          🔃
        </button>
      </div>

      {error && (
        <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,
          padding:'10px 16px',marginBottom:12,color:'#991b1b',fontWeight:600 }}>
          ❌ {error}
        </div>
      )}

      {/* ── Empty state — only shown when there are staff to pick but none selected ── */}
      {!empId && !loading && sortedEmps.length > 0 && (
        <div style={{ textAlign:'center',padding:'60px 20px',color:'#9ca3af' }}>
          <div style={{ fontSize:48,marginBottom:12 }}>📒</div>
          <div style={{ fontWeight:600,fontSize:15,color:'#374151',marginBottom:6 }}>
            {L('कर्मचारी छान्नुस','Select a staff member')}
          </div>
          <div style={{ fontSize:13 }}>
            {L('माथिको Staff dropdown बाट कर्मचारी छान्नुस।',
              'Choose a staff member from the Staff dropdown above.')}
          </div>
        </div>
      )}

      {/* ── Staff Info Card + Navigation side panel ── */}
      {emp && (
        <div style={{ display:'flex', gap:10, marginBottom:10, alignItems:'stretch' }}>

        {/* Staff info card */}
        <div style={{ flex:1, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10,
          padding:'10px 16px', borderLeft:'4px solid #1a56db' }}>
          {/* Name + Post | Dept | Branch | Grade | Mode — all on one line */}
          <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:10 }}>
            <span style={{ fontSize:15, fontWeight:800, color:'#1f2937', whiteSpace:'nowrap' }}>{emp.fullName}</span>
            <div style={{ display:'flex', gap:0, flexWrap:'wrap', fontSize:12,
              border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden', width:'fit-content' }}>
              {[
                { show: emp.position && emp.position !== '—',
                  icon:'🎖️', label:L('पद','Post'),
                  value: (settings.posts||[]).find(p=>p.name===emp.position)?.shortName || (emp.postShort !== '—' ? emp.postShort : null) || emp.position },
                { show: emp.department && emp.department !== '—',
                  icon:'🏗️', label:L('विभाग','Dept'),
                  value: (settings.departments||[]).find(d=>d.name===emp.department)?.shortName || (emp.deptShort !== '—' ? emp.deptShort : null) || emp.department },
                { show: emp.branch && emp.branch !== '—',
                  icon:'🏪', label:L('शाखा','Branch'),
                  value: (settings.branches||[]).find(b=>b.name===emp.branch)?.shortName || (emp.branchShort !== '—' ? emp.branchShort : null) || emp.branch },
                { show: !!emp.grade,  icon:'🎓', label:L('ग्रेड','Grade'),    value: emp.grade },
                { show: !!emp.mode,   icon:'💼', label:L('नियुक्ति','Mode'), value: emp.mode  },
              ].filter(f => f.show).map((f, i, arr) => (
                <div key={f.label} style={{
                  display:'inline-flex', flexDirection:'row', alignItems:'center', gap:5,
                  padding:'6px 14px',
                  borderRight: i < arr.length - 1 ? '1px solid #e2e8f0' : 'none',
                  background: '#f8fafc',
                }}>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4,
                    fontSize:11, fontWeight:600, color:'#374151', whiteSpace:'nowrap' }}>
                    <span>{f.icon}</span>
                    {f.label} :
                  </span>
                  <span style={{ fontSize:12, fontWeight:400, color:'#111827', whiteSpace:'nowrap' }}>
                    {f.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Summary pills — compact */}
          {summary.totalWorkingDays>0&&(
            <div style={{ display:'flex', gap:6, marginTop:8, flexWrap:'wrap' }}>
              {[
                { label:L('Present','Present'),        value:summary.presentCount,           c:'#d1fae5', tc:'#065f46' },
                { label:L('Absent','Absent'),           value:summary.absentCount,            c:'#fee2e2', tc:'#991b1b' },
                { label:L('Leave','Leave'),             value:summary.leaveCount,             c:'#ede9fe', tc:'#5b21b6' },
                { label:L('Late','Late'),               value:summary.lateCount,              c:'#fef3c7', tc:'#92400e' },
                { label:L('Early Out','OUT Issues'),    value:summary.earlyCount,             c:'#fef3c7', tc:'#92400e' },
                { label:L('Att. Rate','Att. Rate'),    value:`${summary.attendanceRate}%`,    c:'#eff6ff', tc:'#1a56db' },
                { label:L('P in Holiday','P in Holiday'), value:days.filter(r=>r.isPublicHoliday&&r.timeIn).length, c:'#fef3c7', tc:'#92400e' },
                { label:L('P in Weekend','P in Weekend'), value:days.filter(r=>r.isWeekend&&r.timeIn).length,       c:'#f3f4f6', tc:'#6b7280' },
                ...(emp?.eligibleForOt ? [
                  { label:L('Total OT','Total OT'), value:summary.otApprovedFormatted || '0:00', c:'#d1fae5', tc:'#059669' },
                ] : []),
              ].map(s=>(
                <div key={s.label} style={{ background:s.c, border:`1px solid ${s.tc}22`,
                  borderRadius:6, padding:'3px 10px', textAlign:'center' }}>
                  <span style={{ fontSize:13, fontWeight:800, color:s.tc }}>{s.value} </span>
                  <span style={{ fontSize:10, color:s.tc, opacity:.75 }}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Navigation panel — right of the staff card, single horizontal line */}
        {/* Hidden for staff-role users — they're locked to their own record */}
        {!isStaffLogin && sortedEmps.length > 1 && (
          <div style={{ display:'flex', flexDirection:'row', alignItems:'center', justifyContent:'center',
            gap:8, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10,
            padding:'10px 16px', flexShrink:0 }}>
            <button
              disabled={currentIdx <= 0}
              onClick={() => navTo(currentIdx - 1)}
              style={{ display:'inline-flex', alignItems:'center', gap:4,
                padding:'6px 14px', border:'1px solid #bae6fd', borderRadius:8,
                background: currentIdx <= 0 ? '#f1f5f9' : '#e0f2fe',
                color: currentIdx <= 0 ? '#cbd5e1' : '#0369a1',
                cursor: currentIdx <= 0 ? 'not-allowed' : 'pointer',
                fontSize:13, fontWeight:700, whiteSpace:'nowrap' }}>
              ← {L('पछाडि','Back')}
            </button>
            <span style={{ fontSize:12, fontWeight:700, color:'#374151',
              background:'white', borderRadius:7, padding:'5px 14px',
              border:'1px solid #e2e8f0', whiteSpace:'nowrap' }}>
              Staff: {currentIdx >= 0 ? currentIdx + 1 : '—'} / {sortedEmps.length}
            </span>
            <button
              disabled={currentIdx < 0 || currentIdx >= sortedEmps.length - 1}
              onClick={() => navTo(currentIdx + 1)}
              style={{ display:'inline-flex', alignItems:'center', gap:4,
                padding:'6px 14px', border:'1px solid #86efac', borderRadius:8,
                background: (currentIdx < 0 || currentIdx >= sortedEmps.length-1) ? '#f1f5f9' : '#dcfce7',
                color: (currentIdx < 0 || currentIdx >= sortedEmps.length-1) ? '#cbd5e1' : '#15803d',
                cursor: (currentIdx < 0 || currentIdx >= sortedEmps.length-1) ? 'not-allowed' : 'pointer',
                fontSize:13, fontWeight:700, whiteSpace:'nowrap' }}>
              {L('अर्को','Next')} →
            </button>
          </div>
        )}

        </div>
      )}

      {/* ── DataGrid ── */}
      {(loading||(emp&&days.length>0))&&(
        <DataGrid
          columns={columns}
          data={days.filter(r => {
            if (!statusFilter) return true;
            if (statusFilter === '_late')          return !!r.lateFormatted?.startsWith('Late');
            if (statusFilter === '_early')         return !!r.earlyFormatted?.startsWith('Early Out');
            if (statusFilter === '_holiday_punch') return r.isPublicHoliday && !!r.timeIn;
            if (statusFilter === '_weekend_punch') return r.isWeekend       && !!r.timeIn;
            return r.status === statusFilter;
          })}
          defaultPageSize={35}
          showSearch={false}
          compact={false}
          loading={loading}
          showCheckbox={false}
          autoWidth={true}
          showFilterButton={false}
          contextMenu={!emp ? null : isStaffLogin ? [
            {
              label: 'Request for Missing Attendance',
              icon: '📩',
              onClick: (row) => openMissingAttendance(emp.id, row.dateStr),
            },
          ] : [
            {
              label: 'Add Manual Attendance',
              icon: '✍️',
              onClick: (row) => navigate('/attendance/manual-postings', { state: { employeeId: emp.id, employeeName: emp.fullName, date: row.dateStr } }),
            },
            'divider',
            {
              label: 'Leave Posting',
              icon: '🌴',
              onClick: () => openLeave(emp.id),
            },
            {
              label: 'Office Visit Posting',
              icon: '🚗',
              onClick: () => openOfficeVisit(emp.id),
            },
          ]}
          toolbarLeft={
            <div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
              <span style={{ fontSize:12, fontWeight:700, color:'#374151', whiteSpace:'nowrap' }}>
                {L('फिल्टर','Filter By')} :
              </span>
              {[
                { value:'',               label:L('सबै','All'),                  color:'#374151' },
                { value:'Present',        label:L('उपस्थित','Present'),          color:'#065f46' },
                { value:'Absent',         label:L('अनुपस्थित','Absent'),         color:'#991b1b' },
                { value:'Weekend',        label:L('विकेन्ड','Weekend'),           color:'#6b7280' },
                { value:'Leave',          label:L('बिदा','Leave'),                color:'#5b21b6' },
                { value:'Public Holiday', label:L('सार्व. बिदा','P. Holiday'),   color:'#92400e' },
                { value:'_late',          label:L('ढिला','Late In'),              color:'#dc2626' },
                { value:'_early',         label:L('चाँडो','Early Out'),           color:'#d97706' },
                { value:'_holiday_punch', label:L('P in Holiday','P in Holiday'), color:'#92400e' },
                { value:'_weekend_punch', label:L('P in Weekend','P in Weekend'), color:'#6b7280' },
              ].map(opt => (
                <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
                  style={{ padding:'3px 10px',
                    border:`1.5px solid ${statusFilter===opt.value ? opt.color : '#e5e7eb'}`,
                    borderRadius:20, fontSize:11,
                    fontWeight: statusFilter===opt.value ? 700 : 500,
                    background: statusFilter===opt.value ? opt.color+'15' : 'white',
                    color: statusFilter===opt.value ? opt.color : '#6b7280',
                    cursor:'pointer', transition:'all .12s', fontFamily:'inherit' }}>
                  {opt.label}
                </button>
              ))}
              {statusFilter && (
                <button onClick={() => setStatusFilter('')}
                  style={{ padding:'3px 9px', border:'1px solid #fca5a5', borderRadius:20,
                    fontSize:11, color:'#dc2626', background:'#fff5f5',
                    cursor:'pointer', fontWeight:600, fontFamily:'inherit' }}>
                  ✕ {L('रिसेट','Reset')}
                </button>
              )}
            </div>
          }
          toolbar={null}
        />
      )}

      {/* ── Legend ── */}
      {emp&&days.length>0&&(
        <div style={{ marginTop:10,display:'flex',gap:12,flexWrap:'wrap',fontSize:11,
          color:'#6b7280',padding:'7px 12px',background:'#f9fafb',
          borderRadius:8,border:'1px solid #e5e7eb' }}>
          <strong style={{ color:'#374151' }}>{L('व्याख्या','Legend')}:</strong>
          <span><strong style={{ color:'#dc2626' }}>Late: HH:mm</strong> = {L('ढिलो आएको','Late arrival')}</span>
          <span><strong style={{ color:'#d97706' }}>Early: HH:mm</strong> = {L('चाँडो गएको','Left early')}</span>
          <span><strong style={{ color:'#059669' }}>OT HH:mm</strong> = {L('ओभरटाइम','Overtime')}</span>
        </div>
      )}
    </div>
  );
};

export default StaffLedger;
