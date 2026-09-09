import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import ExcelJS from 'exceljs';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import ViewMonthlyBtn from './ViewMonthlyBtn.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits, getNepalNow, getNepalTodayISO, getCurrentFiscalYear } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, downloadBlob } from '../../utils/printHelper.js';
import SearchableCheckSelect from '../Common/SearchableCheckSelect.jsx';
import Avatar from '../Common/Avatar.jsx';
import LoadingIndicator from '../Common/LoadingIndicator.jsx';

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

/* Nepali day abbreviations keyed by English day code */
const DOW_NP = { Sun:'आइत', Mon:'सोम', Tue:'मंगल', Wed:'बुध', Thu:'बिही', Fri:'शुक्र', Sat:'शनि' };

/* Format ISO timestamp */
const fmtTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

/* Leave abbreviation: "Sick Leave"→"SL", "Leave"→"L" */
const leaveAbbrev = (name) => {
  if (!name) return 'L';
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 2).toUpperCase();
};

/* ── Advance Search ── */
const EMPTY_FILTERS = {
  _status:'working', staffId:'', branch:'', dept:'', post:'',
  grade:'', mode:'', timingType:'', shift:'',
};

const AdvanceSearchModal = ({ filters, onApply, onClose, L, settings, employees, shifts }) => {
  const [local, setLocal] = useState({ ...filters });
  const set = (k, v) => setLocal(p => ({ ...p, [k]: v }));

  const activeFlag  = (local._status || 'working') === 'working';
  const activeEmps  = employees.filter(e => (e.active !== false) === activeFlag);

  const modes       = (settings.modes      || []).map(m => ({ value:m.name, label:m.name }));
  const grades      = (settings.grades     || []).map(g => ({ value:g.name, label:g.name }));
  const timingTypes = (settings.timingTypes|| []).map(t => ({ value:t.name||t, label:t.name||t }));
  const shiftOpts   = shifts.map(s => ({ value:s.code, label:s.name||s.code }));
  const empOpts     = activeEmps
    .sort((a,b) => (a.fullName||'').localeCompare(b.fullName||''))
    .map(e => ({
      value: String(e.id),
      label: e.fullName || `Staff ${e.id}`,
      sub: [e.employeeId, e.position].filter(Boolean).join(' - '),
      photo: e.profilePhoto,
    }));
  const branches = [...new Set(activeEmps.map(e=>e.branch).filter(Boolean))].sort().map(b=>({value:b,label:b}));
  const depts    = [...new Set(activeEmps.map(e=>e.department).filter(Boolean))].sort().map(d=>({value:d,label:d}));
  const posts    = [...new Set(activeEmps.map(e=>e.position).filter(Boolean))].sort().map(p=>({value:p,label:p}));

  const Lbl   = ({ text }) => <div style={{ fontSize:13,fontWeight:600,color:'#111827',marginBottom:6 }}>{text}</div>;
  const Field = ({ label, children }) => <div style={{ position:'relative',overflow:'visible' }}><Lbl text={label}/>{children}</div>;

  return (
    <div className="modal-overlay">
      <div style={{ background:'white',borderRadius:16,width:'min(960px,96vw)',
        boxShadow:'0 20px 60px rgba(0,0,0,.18)',overflow:'visible',position:'relative' }}
        onClick={e=>e.stopPropagation()}>

        <div style={{ padding:'16px 22px 12px',background:'#ffffff',borderBottom:'1px solid #f3f4f6',
          display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <span style={{ fontSize:16,fontWeight:700,color:'#1e40af' }}>{L('विस्तृत खोज','Advance Search')}</span>
          <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:'#6b7280',fontSize:20,lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:'16px 22px',display:'flex',flexDirection:'column',gap:14 }}>
          <Field label={L('स्थिति','Status')}>
            <div style={{ display:'flex',gap:0,border:'1px solid #d1d5db',borderRadius:8,overflow:'hidden' }}>
              {[['working',L('कार्यरत','Working')],['notworking',L('अवकाश','Not Working')]].map(([v,label])=>(
                <button key={v} onClick={()=>{ set('_status',v); set('staffId',''); }}
                  style={{ flex:1,padding:'8px 12px',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,
                    background:(local._status||'working')===v?'#1a56db':'white',
                    color:(local._status||'working')===v?'white':'#374151',transition:'background .15s' }}>
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14 }}>
            <Field label={L('कर्मचारी','Staff')}>
              <SearchableCheckSelect options={empOpts} value={local.staffId} showAvatar onChange={v=>set('staffId',v)} allLabel="All Staff" />
            </Field>
            <Field label={L('शाखा','Branch')}>
              <SearchableCheckSelect options={branches} value={local.branch} onChange={v=>set('branch',v)} allLabel="All Branches" />
            </Field>
            <Field label={L('विभाग','Department')}>
              <SearchableCheckSelect options={depts} value={local.dept} onChange={v=>set('dept',v)} allLabel="All Depts" />
            </Field>
          </div>

          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14 }}>
            <Field label={L('पद','Post')}>
              <SearchableCheckSelect options={posts} value={local.post} onChange={v=>set('post',v)} allLabel="All Posts" />
            </Field>
            <Field label={L('ग्रेड','Grade')}>
              <SearchableCheckSelect options={grades} value={local.grade} onChange={v=>set('grade',v)} allLabel="All Grades" />
            </Field>
            <Field label={L('नियुक्ति','Mode')}>
              <SearchableCheckSelect options={modes} value={local.mode} onChange={v=>set('mode',v)} allLabel="All Modes" />
            </Field>
          </div>

          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14 }}>
            <Field label={L('टाइमिङ','Timing Type')}>
              <SearchableCheckSelect options={timingTypes} value={local.timingType} onChange={v=>set('timingType',v)} allLabel="All Types" />
            </Field>
            <Field label={L('सिफ्ट','Shift')}>
              <SearchableCheckSelect options={shiftOpts} value={local.shift} onChange={v=>set('shift',v)} allLabel="All Shifts" />
            </Field>
            <div />
          </div>
        </div>

        <div style={{ padding:'10px 22px 16px',borderTop:'1px solid #f3f4f6',display:'flex',justifyContent:'flex-end',gap:10 }}>
          <button onClick={() => { onApply({ ...EMPTY_FILTERS }); onClose(); }}
            style={{ padding:'8px 18px',border:'1.5px solid #d1d5db',borderRadius:8,background:'white',color:'#374151',fontSize:13,fontWeight:600,cursor:'pointer' }}>
            {L('रिसेट','Reset')}
          </button>
          <button onClick={() => { onApply(local); onClose(); }}
            style={{ padding:'8px 22px',border:'none',borderRadius:8,background:'#1a56db',color:'white',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:'0 2px 8px rgba(26,86,219,.3)' }}>
            {L('खोज्नुस','Search')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Standard DataGrid header styles ── */
const TH = {
  background:'#efefef', color:'#374151', fontWeight:700, fontSize:12.5,
  padding:'4px 8px', borderRight:'1px solid #dedede', borderBottom:'1px solid #dedede',
  whiteSpace:'nowrap', textAlign:'center', userSelect:'none',
};
const thDay = (isWeekend, isHoliday) => ({
  ...TH,
  background: isWeekend ? '#e5e7eb' : isHoliday ? '#fef3c7' : '#efefef',
  color:       isWeekend ? '#9ca3af' : isHoliday ? '#92400e' : '#374151',
  borderBottom:'none', paddingBottom:2,
});
const thDow = (isWeekend, isHoliday) => ({
  ...TH,
  background: isWeekend ? '#f3f4f6' : isHoliday ? '#fef9e7' : '#f5f5f5',
  color:       isWeekend ? '#d1d5db' : isHoliday ? '#b45309' : '#4b5563',
  paddingTop:2, fontSize:10, fontWeight:600,
});

/* Fixed left column */
const TD_FIX = {
  padding:'0 8px', fontSize:12.5, fontWeight:400,
  borderRight:'1px solid #dedede',
  verticalAlign:'middle', whiteSpace:'nowrap',
};

/* Row label configs */
const ROWS = [
  { key:'in',  label:'IN',  color:'#1a56db' },
  { key:'out', label:'OUT', color:'#059669' },
  { key:'wh',  label:'WH',  color:'#374151' },
  { key:'ot',  label:'OT',  color:'#7c3aed' },
];
// ROWS is module-level (defined before `language` exists), so its `label`
// stays untranslated English there — resolve the displayed text at render
// time instead.
const ROW_LABEL_NP = { in:'आउने', out:'जाने', wh:'घण्टा', ot:'ओभरटाइम' };
const rowLabel = (key, language, fallback) => (language === 'np' ? (ROW_LABEL_NP[key] || fallback) : fallback);

const LabelCell = ({ label, color, isLast }) => (
  <td style={{
    background:'#f9fafb', borderRight:'1px solid #dedede',
    borderBottom: isLast ? '2px solid #c5cdd8' : '1px solid #ebebeb',
    padding:'3px 8px', textAlign:'center', verticalAlign:'middle', width:52,
  }}>
    <span style={{ color, fontSize:12, fontWeight:700 }}>
      {label}
    </span>
  </td>
);

/* ── Day value cell ── */
const DayCell = ({ rowKey, day, isWeekend, isHoliday, holidayName, isLast, language }) => {
  const LL = (np, en) => (language === 'np' ? np : en);
  const isWH     = rowKey === 'wh';
  const cellBg   = isWeekend ? '#f9fafb' : isHoliday ? '#fefce8' : 'white';
  const whBg     = isWeekend ? '#f3f4f6' : isHoliday ? '#fef9e7' : '#f8fafc';
  const bdBottom = isLast ? '2px solid #c5cdd8' : (isWH ? '1px solid #c9d1db' : '1px solid #ebebeb');
  const bdRight  = isWH ? '1px solid #c9d1db' : '1px solid #e5e7eb';
  const bg       = isWH ? whBg : cellBg;
  const color    = ROWS.find(r => r.key === rowKey)?.color || '#374151';

  /* IN row — status badges when no punch */
  if (rowKey === 'in' && !day?.timeIn) {
    let badge = null;
    if (day?.leave) {
      badge = (
        <span title={day.leave.name}
          style={{ background:'#ede9fe', color:'#5b21b6', borderRadius:4,
            padding:'1px 5px', fontSize:10, fontWeight:800, cursor:'help' }}>
          {leaveAbbrev(day.leave.name)}
        </span>
      );
    } else if (isHoliday) {
      badge = (
        <span title={holidayName || LL('सार्वजनिक बिदा','Public Holiday')}
          style={{ background:'#fef3c7', color:'#92400e', borderRadius:4,
            padding:'1px 5px', fontSize:10, fontWeight:800, cursor:'help' }}>
          {LL('साबि','PH')}
        </span>
      );
    } else if (day?.visit) {
      const tip = [day.visit.purpose, day.visit.location].filter(Boolean).join(' | ');
      badge = (
        <span title={tip || LL('कार्यालय भ्रमण','Office Visit')}
          style={{ background:'#dbeafe', color:'#1e40af', borderRadius:4,
            padding:'1px 5px', fontSize:10, fontWeight:800, cursor:'help' }}>
          {LL('भ्रमण','OV')}
        </span>
      );
    } else if (day?.offType) {
      badge = (
        <span title={LL(day.offType==='Night Off' ? 'नाइट अफ' : 'डे अफ', day.offType)}
          style={{ background: day.offType==='Night Off' ? '#e0e7ff' : '#e5e7eb',
            color: day.offType==='Night Off' ? '#4338ca' : '#6b7280', borderRadius:4,
            padding:'1px 5px', fontSize:10, fontWeight:800, cursor:'help' }}>
          {day.offType==='Night Off' ? LL('रा.अ','NO') : LL('दि.अ','DO')}
        </span>
      );
    } else if (isWeekend) {
      badge = (
        <span title={LL('विकेन्ड','Weekend')}
          style={{ background:'#e5e7eb', color:'#6b7280', borderRadius:4,
            padding:'1px 5px', fontSize:10, fontWeight:800, cursor:'help' }}>
          {LL('ब','W')}
        </span>
      );
    }
    return (
      <td style={{ background:bg, borderRight:bdRight, borderBottom:bdBottom,
        padding:'3px 4px', minWidth:54, textAlign:'center', verticalAlign:'middle' }}>
        {badge || <span style={{ color:'#d1d5db', fontSize:11 }}>—</span>}
      </td>
    );
  }

  let value = null;
  if (rowKey === 'in')  value = fmtTime(day?.timeIn);
  if (rowKey === 'out') value = fmtTime(day?.timeOut);
  if (rowKey === 'wh')  value = day?.workedHrs;
  if (rowKey === 'ot')  value = day?.otHrs;

  const isSinglePunch = rowKey === 'in' && day?.punches === 1;
  // A half-day leave still has a real punch (the other half was worked) — show
  // the time as usual, with the leave type + "1/2" underneath instead of no
  // indication at all that leave was taken that day.
  const halfLeave = rowKey === 'in' && day?.leave?.halfDay ? day.leave : null;

  return (
    <td style={{ background:bg, borderRight:bdRight, borderBottom:bdBottom,
      padding:'3px 4px', minWidth:54, textAlign:'center', verticalAlign:'middle' }}>
      {value
        ? <div style={{ display:'flex', flexDirection:'column', alignItems:'center', lineHeight:1.15 }}>
            <span style={{
              fontSize:13,
              fontWeight: (rowKey==='in' || rowKey==='wh') ? 700 : 400,
              color: isSinglePunch ? '#d97706' : (isWH ? '#374151' : color),
            }} title={isSinglePunch ? LL('एकल पन्च मात्र','Single punch only') : ''}>
              {value}{isSinglePunch && <span style={{ fontSize:9, marginLeft:1 }}>⚠</span>}
            </span>
            {halfLeave && (
              <span title={halfLeave.name} style={{ fontSize:9, fontWeight:800, color:'#5b21b6', marginTop:1 }}>
                {leaveAbbrev(halfLeave.name)} 1/2
              </span>
            )}
          </div>
        : <span style={{
            color: isWH ? '#9ca3af' : (isWeekend||isHoliday ? '#e5e7eb' : '#d1d5db'),
            fontSize:13, fontWeight:400,
          }}>—</span>
      }
    </td>
  );
};

/* Total WH / Total OT cell — each is its own column, only showing a value on
   the row it belongs to (WH row or OT row respectively), dash elsewhere. */
const TotalCell = ({ emp, rowKey, isLast, which }) => {
  const bdBottom = isLast ? '2px solid #c5cdd8' : '1px solid #ebebeb';
  if (rowKey !== which) {
    return (
      <td style={{ background:'#f8fafc', borderLeft: which==='wh' ? '2px solid #c9d1db' : undefined,
        borderRight:'1px solid #dedede', borderBottom:bdBottom,
        padding:'3px 4px', minWidth:54, textAlign:'center' }}>
        <span style={{ color:'#d1d5db', fontSize:11, fontWeight:400 }}>—</span>
      </td>
    );
  }
  const total = which === 'wh' ? emp.totalWorkedHrs : (emp.eligibleForOt ? emp.totalApprovedOTFormatted : null);
  const color = which === 'wh' ? '#065f46' : '#059669';
  return (
    <td style={{ background:'#f0fdf4', borderLeft: which==='wh' ? '2px solid #c9d1db' : undefined,
      borderRight:'1px solid #dedede', borderBottom:bdBottom,
      padding:'3px 8px', minWidth:64, textAlign:'center', verticalAlign:'middle' }}>
      {total && total !== '—'
        ? <strong style={{ fontFamily:'monospace', fontSize:12, fontWeight:900, color }}>
            {total}
          </strong>
        : <span style={{ color:'#d1d5db' }}>—</span>
      }
    </td>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Monthly IN & OUT Report
═══════════════════════════════════════════════════════════════ */
const MonthlyInOutReport = () => {
  const [searchParams] = useSearchParams();
  const { language }   = useLanguage();
  const { settings }   = useSettings();
  const { filteredEmployees: allEmployees, shifts } = useData();
  const fd             = useDateFormat();
  const L = (np, en)   => language === 'np' ? np : en;

  const now     = getNepalNow();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(getNepalTodayISO());

  const urlYear  = parseInt(searchParams.get('year'));
  const urlMonth = parseInt(searchParams.get('month'));

  // Always default to current running month
  const initYear  = useNP ? (todayBS?.year  || now.getFullYear())  : now.getFullYear();
  const initMonth = useNP ? (todayBS?.month || now.getMonth() + 1) : now.getMonth() + 1;

  const { isEmployee, isBranchManager, isDeptHead, currentUser } = useAuth();
  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';

  // Print header shows the branch's own name/address, but only when the
  // person printing is themselves scoped to one branch (their own login) —
  // admin/superAdmin can see every branch at once, so singling one out in
  // the header would misrepresent a report that may span all of them.
  const printBranch = useMemo(() => {
    if (!(isBranchManager || isDeptHead || isEmployee)) return null;
    const myBranch = currentUser?.branch;
    if (!myBranch) return null;
    const rec = (settings.branches || []).find(b => b.name === myBranch);
    return { name: myBranch, address: rec?.address || '', phone: rec?.phone || '' };
  }, [isBranchManager, isDeptHead, isEmployee, currentUser, settings.branches]);

  const [year,        setYear]        = useState(initYear);
  const [month,       setMonth]       = useState(initMonth);
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [search,      setSearch]      = useState('');
  const [filters,    setFilters]    = useState({ ...EMPTY_FILTERS, staffId: myEmpId });
  const [showSearch, setShowSearch] = useState(false);
  // Ctrl+A opens Advance Search — same shortcut across every report/page
  // that has one, skipped while typing in a text field so it doesn't hijack
  // native "select all text" there.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.key.toLowerCase() !== 'a') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      setShowSearch(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const staffStatus = filters._status || 'working';

  const currentFY = getCurrentFiscalYear(settings.fiscalYears || []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let apiUrl;
      if (useNP) {
        const startAD = bsToAD(year, month, 1);
        const endAD   = bsToAD(year, month, getBSDays(year, month));
        if (startAD && endAD) {
          apiUrl = `/attendance/half-in-out?startDate=${isoDate(startAD)}&endDate=${isoDate(endAD)}`;
        }
      }
      if (!apiUrl) {
        const lastDay = new Date(year, month, 0).getDate();
        const pad = n => String(n).padStart(2,'0');
        const s = `${year}-${pad(month)}-01`;
        const e = `${year}-${pad(month)}-${pad(lastDay)}`;
        apiUrl = `/attendance/half-in-out?startDate=${s}&endDate=${e}`;
      }
      apiUrl += `&active=${staffStatus === 'notworking' ? 'false' : 'true'}&orgScope=1`;
      setData(await api.get(apiUrl));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year, month, useNP, staffStatus]);

  useEffect(() => { load(); }, [load]);

  const period    = data?.period;
  const dates     = data?.dates     || [];
  const allRows   = data?.employees || [];

  /* Branch short-name from settings (PKR etc.) */
  const branchShortMap = useMemo(() => {
    const m = {};
    (settings.branches||[]).forEach(b => {
      const sn = b.shortName || b.short_name;
      if (b.name && sn) m[b.name.toLowerCase().trim()] = sn;
    });
    return m;
  }, [settings.branches]);
  const resolveShort = emp =>
    branchShortMap[(emp.branch||'').toLowerCase().trim()]
    || (emp.branchShort && emp.branchShort !== '—' ? emp.branchShort : null)
    || emp.branch || '—';

  const q = search.toLowerCase();
  const employees = allRows.filter(e => {
    if (filters.staffId && String(e.id) !== filters.staffId)  return false;
    if (filters.branch  && e.branch     !== filters.branch)   return false;
    if (filters.dept    && e.department !== filters.dept)     return false;
    if (filters.post    && e.position   !== filters.post)     return false;
    if (filters.grade   && e.grade      !== filters.grade)    return false;
    if (filters.mode    && e.mode       !== filters.mode)     return false;
    if (filters.timingType && e.timingType !== filters.timingType) return false;
    if (filters.shift   && e.shift      !== filters.shift)    return false;
    if (q && !(e.fullName||'').toLowerCase().includes(q) &&
             !(e.postShort||'').toLowerCase().includes(q) &&
             !(e.deptShort||'').toLowerCase().includes(q)) return false;
    return true;
  });
  const activeFilterCount = Object.entries(filters).filter(([k,v]) => k !== '_status' && Boolean(v)).length;

  const periodLabel = () => {
    const mn     = useNP ? (BS_MONTHS_NP[month-1]||'') : MONTHS_EN[month-1];
    const yr     = settings.nepaliDigits ? toNepaliDigits(year) : String(year);
    const calStr = useNP ? ' BS' : '';
    return `${mn} ${yr}${calStr}`;
  };

  const rptTitle = 'Monthly IN & OUT Report';
  const rptSub = () => periodLabel();

  // Mirrors the on-screen 4-stacked-row-per-employee matrix exactly (one
  // column per day, SN/Staff merged vertically across IN/OUT/WH/OT rows,
  // Total WH/OT only populated on their own row) — same structure as
  // exportExcel below, just as an HTML table. WH values are bold throughout
  // (day cells and the Total WH column), matching the on-screen weight.
  const handlePrint = () => {
    if (!employees.length) return;
    const dayHeaders = dates.map((d, idx) => {
      const n = useNP ? (idx + 1) : d.dayNum;
      return `<th style="padding:2px 3px;border:1px solid #dedede;background:#efefef;font-size:8px">${n}<br/>${d.dayKey.slice(0,3)}</th>`;
    }).join('');
    const rowColors = { in:'#1a56db', out:'#059669', wh:'#374151', ot:'#7c3aed' };
    const dataRows = employees.map((e,i) => {
      const post = (settings.posts||[]).find(p=>p.name===e.position)?.shortName || e.postShort || e.position || '—';
      const dept = (settings.departments||[]).find(d=>d.name===e.department)?.shortName || e.deptShort || e.department || '—';
      const staffCellHtml = `
        <div style="font-weight:700">${e.fullName}</div>
        <div style="font-size:7px;color:#6b7280">${post} | ${dept}</div>
        <div style="font-size:7px;color:#6b7280">Branch : ${resolveShort(e)}</div>`;
      return ROWS.map((rowDef, rIdx) => {
        const isFirst = rIdx === 0;
        const isLast  = rIdx === ROWS.length - 1;
        const bdBottom = isLast ? '2px solid #c5cdd8' : '1px solid #ebebeb';
        const dayCells = dates.map(d => {
          const day = e.days[d.date];
          let value = '';
          if (rowDef.key === 'in')  value = fmtTime(day?.timeIn)  || '';
          if (rowDef.key === 'out') value = fmtTime(day?.timeOut) || '';
          if (rowDef.key === 'wh')  value = day?.workedHrs || '';
          if (rowDef.key === 'ot')  value = day?.otHrs || '';
          const bold = rowDef.key === 'wh' ? 'font-weight:700;' : '';
          return `<td style="padding:1px 2px;border-right:1px solid #ebebeb;border-bottom:${bdBottom};text-align:center;font-size:8px;${bold}">${value}</td>`;
        }).join('');
        return `<tr>
          ${isFirst ? `<td rowspan="4" style="padding:2px 4px;border:1px solid #dedede;border-bottom:2px solid #c5cdd8;text-align:center;vertical-align:middle">${i+1}</td>
          <td rowspan="4" style="padding:2px 5px;border:1px solid #dedede;border-bottom:2px solid #c5cdd8;vertical-align:middle">${staffCellHtml}</td>` : ''}
          <td style="padding:1px 5px;border:1px solid #dedede;border-bottom:${bdBottom};text-align:center;color:${rowColors[rowDef.key]};font-weight:700;font-size:8px">${rowLabel(rowDef.key, language, rowDef.label)}</td>
          ${dayCells}
          <td style="padding:1px 4px;border:1px solid #dedede;border-bottom:${bdBottom};text-align:center;color:#065f46;font-weight:700;font-size:8px">${rowDef.key==='wh' ? (e.totalWorkedHrs||'') : ''}</td>
          <td style="padding:1px 4px;border:1px solid #dedede;border-bottom:${bdBottom};text-align:center;color:#059669;font-weight:700;font-size:8px">${rowDef.key==='ot' ? (e.eligibleForOt ? (e.totalApprovedOTFormatted||'—') : '') : ''}</td>
        </tr>`;
      }).join('');
    }).join('');
    const contentHtml = `<table style="border-collapse:collapse;width:100%;font-size:9px">
      <thead><tr>
        <th style="padding:3px 4px;border:1px solid #dedede;background:#efefef">SN</th>
        <th style="padding:3px 4px;border:1px solid #dedede;background:#efefef;text-align:left">Staff</th>
        <th style="padding:3px 4px;border:1px solid #dedede;background:#efefef"></th>
        ${dayHeaders}
        <th style="padding:3px 4px;border:1px solid #dedede;background:#f0fdf4;color:#065f46">Total WH</th>
        <th style="padding:3px 4px;border:1px solid #dedede;background:#f0fdf4;color:#059669">Total OT</th>
      </tr></thead>
      <tbody>${dataRows}</tbody>
    </table>`;
    openPrintWindow(buildPrintDoc({ settings, language, reportTitle: rptTitle, reportSub: rptSub(), contentHtml, isLandscape: true, branch: printBranch }), true);
  };

  // Mirrors the on-screen 4-row-per-employee matrix exactly (SN/Staff/Post/
  // Dept/Branch merged vertically across the IN/OUT/WH/OT rows, one column
  // per day, Total WH/OT only populated on their own row), including the
  // same border/underline conventions as the DataGrid: a border under the
  // header, a light line between each IN/OUT/WH row, and a heavier line
  // under each employee's OT row separating one staff block from the next
  // (the DataGrid's "isLast" 2px border). Needs exceljs, not the xlsx
  // package — xlsx's free tier only reads styles, it can't write them.
  const exportExcel = async () => {
    if (!employees.length) return;

    const companyName = language === 'np'
      ? (settings.companyNameNp || settings.companyNameEn || '')
      : (settings.companyNameEn || settings.companyNameNp || '');
    const companyAddr = language === 'np'
      ? (settings.companyAddressNp || settings.companyAddressEn || '')
      : (settings.companyAddressEn || settings.companyAddressNp || '');
    const companyPhone = settings.companyPhone ? `Tel: ${settings.companyPhone}` : '';

    const FIXED_COLS = ['SN', 'Staff', ''];
    const dayCols = dates.map((d, idx) => useNP ? (idx + 1) : d.dayNum);
    const dayDows = dates.map(d => d.dayKey.slice(0, 3));
    const nCols = FIXED_COLS.length + dayCols.length + 2;
    const lastCol = nCols; // 1-indexed

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Monthly IN-OUT');

    const thin   = { style: 'thin',   color: { argb: 'FFDEDEDE' } };
    const light  = { style: 'thin',   color: { argb: 'FFEBEBEB' } };
    const heavy  = { style: 'medium', color: { argb: 'FFC5CDD8' } };

    // ── Company/report header block ──
    [companyName, [companyAddr, companyPhone].filter(Boolean).join('  |  '), rptTitle,
      rptSub() + (period ? `   (${period.startDate} to ${period.endDate})` : ''), ''
    ].forEach((text, i) => {
      const row = ws.addRow([text]);
      ws.mergeCells(row.number, 1, row.number, lastCol);
      row.getCell(1).font = i === 0 ? { bold: true, size: 13 } : i === 2 ? { bold: true, size: 12 } : { size: 10, color: { argb: 'FF6B7280' } };
    });
    // ws.rowCount, not a hardcoded 5 — see the matching comment in
    // MonthlyPresentAbsentReport.jsx's exportExcel: an embedded company logo
    // (ws.addImage before any addRow) shifts ExcelJS's row numbering by +1,
    // and a hardcoded offset silently breaks the moment this report also
    // grows a logo the same way that one did.
    const headerOffset = ws.rowCount;

    // ── Table header (2 rows, matching the on-screen rowSpan={2} layout) ──
    const hdr1 = ws.addRow([...FIXED_COLS, ...dayCols, 'Total WH', 'Total OT']);
    const hdr2 = ws.addRow([...FIXED_COLS.map(() => ''), ...dayDows, '', '']);
    // Merge BEFORE styling — ExcelJS resets a merged range's non-master
    // cells when mergeCells() runs, which would silently drop any border/
    // fill applied beforehand.
    [1, 2, 3, lastCol - 1, lastCol].forEach(c => {
      ws.mergeCells(headerOffset + 1, c, headerOffset + 2, c);
    });
    [hdr1, hdr2].forEach((row, rowIdx) => {
      row.eachCell({ includeEmpty: true }, cell => {
        cell.font = { bold: true, size: 10.5, color: { argb: 'FF374151' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { right: thin, bottom: rowIdx === 1 ? heavy : thin };
      });
    });
    ws.getRow(headerOffset + 1).getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

    // ── Data rows ──
    employees.forEach((e, i) => {
      const post   = (settings.posts||[]).find(p=>p.name===e.position)?.shortName || e.postShort || e.position || '—';
      const dept   = (settings.departments||[]).find(d=>d.name===e.department)?.shortName || e.deptShort || e.department || '—';
      const branch = resolveShort(e);
      const staffCell = `${e.fullName}\n${post} | ${dept}\nBranch : ${branch}`;
      const blockStartRow = ws.rowCount + 1;
      const addedRows = [];

      ROWS.forEach((rowDef, rIdx) => {
        const cells = [
          rIdx === 0 ? i + 1 : '', rIdx === 0 ? staffCell : '', rowDef.label,
          ...dates.map(d => {
            const day = e.days[d.date];
            if (rowDef.key === 'in')  return fmtTime(day?.timeIn)  || '';
            if (rowDef.key === 'out') return fmtTime(day?.timeOut) || '';
            if (rowDef.key === 'wh')  return day?.workedHrs || '';
            if (rowDef.key === 'ot')  return day?.otHrs || '';
            return '';
          }),
          rowDef.key === 'wh' ? (e.totalWorkedHrs || '') : '',
          rowDef.key === 'ot' ? (e.eligibleForOt ? (e.totalApprovedOTFormatted || '') : '') : '',
        ];
        addedRows.push(ws.addRow(cells));
      });

      // Merge BEFORE styling, same reason as the table header above.
      [1, 2].forEach(c => ws.mergeCells(blockStartRow, c, blockStartRow + ROWS.length - 1, c));
      ws.getCell(blockStartRow, 2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

      addedRows.forEach((row, rIdx) => {
        const isLast = rIdx === ROWS.length - 1;
        const isWH   = ROWS[rIdx].key === 'wh';
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          if (colNum === 2) return; // Staff cell alignment set once above — don't overwrite its wrapText
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = { right: colNum <= 3 ? thin : { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: isLast ? heavy : light };
          // Worked Hours row — day values and the Total WH cell all bold,
          // matching the on-screen matrix's own bold WH weight.
          if (isWH && colNum > 3) cell.font = { bold: true, size: 9 };
        });
        row.getCell(2).border = { right: thin, bottom: isLast ? heavy : light };
        row.getCell(3).font = { bold: true, size: 9.5,
          color: { in: 'FF1A56DB', out: 'FF059669', wh: 'FF374151', ot: 'FF7C3AED' }[ROWS[rIdx].key] };
      });
    });

    ws.columns = [
      { width: 5 }, { width: 28 }, { width: 6 },
      ...dayCols.map(() => ({ width: 7 })),
      { width: 9 }, { width: 9 },
    ];
    ws.views = [{ state: 'frozen', ySplit: headerOffset + 2 }];

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `MonthlyInOut_${period?.startDate || ''}.xlsx`);
  };

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🔄 {L('मासिक IN & OUT रिपोर्ट','Monthly IN & OUT Report')}</h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY && (
              <span style={{ background:'#eff6ff',color:'#1a56db',borderRadius:6,
                padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>
                {currentFY.name}
              </span>
            )}
            {periodLabel()}
            {period && (
              <span style={{ marginLeft:8,fontSize:11,color:'#9ca3af' }}>
                {fd(period.startDate)} → {fd(period.endDate)}
              </span>
            )}
          </p>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' }}>
          <button onClick={handlePrint}
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#eff6ff',border:'1px solid #93c5fd',color:'#1d4ed8',
              borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            🖨️ Print
          </button>
          <button onClick={exportExcel}
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#f0fdf4',border:'1px solid #86efac',color:'#15803d',
              borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            📥 Export
          </button>
          <ViewMonthlyBtn year={year} month={month} useNP={useNP}
            currentPath="/attendance/reports/monthly/in-out" />
        </div>
      </div>

      {/* ── Period selector + controls (right-aligned) ── */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap',justifyContent:'flex-end' }}>
        <select className="form-control" style={{ width:useNP?115:85,height:36,fontSize:13 }}
          value={year} onChange={e=>setYear(+e.target.value)}>
          {useNP
            ? [todayBS?.year-1,todayBS?.year,todayBS?.year+1].filter(Boolean).map(y=>(
                <option key={y} value={y}>{settings.nepaliDigits?toNepaliDigits(y):y} BS</option>))
            : [now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1].map(y=>(
                <option key={y} value={y}>{y}</option>))
          }
        </select>
        <select className="form-control" style={{ width:useNP?120:140,height:36,fontSize:13 }}
          value={month} onChange={e=>setMonth(+e.target.value)}>
          {useNP
            ? BS_MONTHS_NP.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
            : MONTHS_EN.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
          }
        </select>

        {/* Working / Not Working toggle */}
        <div style={{ display:'flex', gap:0, border:'1px solid #d1d5db', borderRadius:8, overflow:'hidden' }}>
          {[['working', L('कार्यरत','Working')], ['notworking', L('अवकाश','Not Working')]].map(([v, label]) => (
            <button key={v}
              onClick={() => setFilters(p => ({ ...p, _status:v, staffId:'' }))}
              style={{ padding:'5px 14px', border:'none', cursor:'pointer',
                fontSize:13, fontWeight:600, transition:'background .15s',
                background: staffStatus === v ? '#1a56db' : 'white',
                color: staffStatus === v ? 'white' : '#374151' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Advance Search button */}
        <button onClick={() => setShowSearch(true)}
          style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'0 14px',height:36,
            background: activeFilterCount>0 ? '#ede9fe' : '#f5f3ff',
            border: `1.5px solid ${activeFilterCount>0 ? '#7c3aed' : '#c4b5fd'}`,
            color: activeFilterCount>0 ? '#5b21b6' : '#6d28d9',
            borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
          </svg>
          {L('विस्तृत खोज','Advance Search')}
          {activeFilterCount > 0 && (
            <span style={{ background:'#1a56db',color:'white',borderRadius:'50%',
              width:18,height:18,display:'inline-flex',alignItems:'center',justifyContent:'center',
              fontSize:11,fontWeight:800 }}>{activeFilterCount}</span>
          )}
        </button>

        <button className="btn btn-outline btn-sm" style={{ height:36 }} onClick={load} disabled={loading}>🔃</button>

        {/* Search box */}
        <div style={{ display:'flex',alignItems:'center',gap:6,background:'white',
          border:'1px solid #dedede',borderRadius:6,padding:'0 10px',height:36 }}>
          <svg viewBox="0 0 20 20" fill="#9ca3af" width="14" height="14">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
          </svg>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder={L('खोज्नुस...','Search...')}
            style={{ border:'none',outline:'none',fontSize:13,background:'transparent',width:160 }} />
          {search && (
            <button onClick={()=>setSearch('')}
              style={{ background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:13,padding:0 }}>✕</button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,
          padding:'10px 16px',marginBottom:12,color:'#991b1b',fontWeight:600 }}>❌ {error}</div>
      )}
      {loading && <LoadingIndicator />}

      {/* ── 4-row-per-employee matrix ── */}
      {!loading && data && (
        <div style={{ overflowX:'auto', borderRadius:8,
          border:'1px solid #dedede', boxShadow:'0 1px 3px rgba(0,0,0,.07)' }}>
          <table style={{ borderCollapse:'collapse', width:'100%' }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ ...TH, minWidth:34, position:'sticky', left:0, zIndex:4 }}>SN</th>
                <th rowSpan={2} style={{ ...TH, textAlign:'left', minWidth:170, position:'sticky', left:34, zIndex:4 }}>
                  {L('कर्मचारी','Staff')}
                </th>
                <th rowSpan={2} style={{ ...TH, minWidth:58 }}></th>

                {dates.map(({ date, dayNum, dayKey, isWeekend, isHoliday }, dateIdx) => {
                  // BS mode: sequential 1…N; AD mode: actual AD day number
                  const dispNum = useNP
                    ? (settings.nepaliDigits ? toNepaliDigits(dateIdx + 1) : dateIdx + 1)
                    : dayNum;
                  return (
                    <th key={date} style={thDay(isWeekend, isHoliday)}>{dispNum}</th>
                  );
                })}

                {/* Total WH header */}
                <th rowSpan={2} style={{ ...TH, background:'#f0fdf4', color:'#065f46',
                  borderLeft:'2px solid #c9d1db', minWidth:64 }}>
                  {useNP ? 'कुल WH' : 'Total WH'}
                </th>
                {/* Total OT header */}
                <th rowSpan={2} style={{ ...TH, background:'#f0fdf4', color:'#059669', minWidth:64 }}>
                  {useNP ? 'कुल OT' : 'Total OT'}
                </th>
              </tr>
              <tr>
                {dates.map(({ date, dayKey, isWeekend, isHoliday }) => (
                  <th key={date} style={thDow(isWeekend, isHoliday)}>
                    {dayKey.slice(0,3)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {employees.length === 0 && (
                <tr>
                  <td colSpan={5 + dates.length}
                    style={{ textAlign:'center',padding:'40px',color:'#9ca3af',fontSize:13 }}>
                    {search ? L('कुनै कर्मचारी भेटिएन','No staff found') : L('डेटा छैन','No data')}
                  </td>
                </tr>
              )}

              {employees.map((emp, idx) => (
                <React.Fragment key={emp.id}>
                  {ROWS.map((row, rIdx) => {
                    const isLast = rIdx === ROWS.length - 1;
                    return (
                      <tr key={row.key}
                        style={{ background: rIdx===2 ? '#fafafa' : rIdx===3 ? '#fdfcff' : 'white' }}>

                        {rIdx === 0 && (
                          <>
                            <td rowSpan={4} style={{ ...TD_FIX, background:'#efefef', color:'#6b7280',
                              textAlign:'center', position:'sticky', left:0, zIndex:1,
                              borderBottom:'2px solid #c5cdd8' }}>
                              {idx+1}
                            </td>
                            <td rowSpan={4} style={{ ...TD_FIX, background:'white', color:'#1f2937',
                              position:'sticky', left:34, zIndex:1, borderBottom:'2px solid #c5cdd8',
                              whiteSpace:'normal', padding:'6px 8px' }}>
                              <span style={{ display:'flex', alignItems:'flex-start', gap:6 }}>
                                <Avatar photo={emp.profilePhoto} name={emp.fullName} size={20} />
                                <span>
                                  <div style={{ fontWeight:600 }}>{emp.fullName}</div>
                                  <div style={{ fontSize:11, color:'#6b7280' }}>
                                    {(settings.posts||[]).find(p=>p.name===emp.position)?.shortName || emp.postShort || emp.position || '—'}
                                    {' | '}
                                    {(settings.departments||[]).find(d=>d.name===emp.department)?.shortName || emp.deptShort || emp.department || '—'}
                                  </div>
                                  <div style={{ fontSize:11, color:'#6b7280' }}>{L('शाखा','Branch')} : {resolveShort(emp)}</div>
                                </span>
                              </span>
                            </td>
                          </>
                        )}

                        <LabelCell label={rowLabel(row.key, language, row.label)} color={row.color} isLast={isLast} />

                        {/* isWeekend prefers this employee's own roster-aware
                            flag (set once a roster entry covers the date);
                            dates[].isWeekend is just the flat company-wide
                            pattern shared by everyone, used only as a
                            fallback for a day with no per-employee data. */}
                        {dates.map(({ date, isWeekend, isHoliday, holidayName }) => (
                          <DayCell
                            key={date}
                            rowKey={row.key}
                            day={emp.days[date]}
                            isWeekend={emp.days?.[date]?.isWeekend ?? isWeekend}
                            isHoliday={isHoliday}
                            holidayName={holidayName}
                            isLast={isLast}
                            language={language}
                          />
                        ))}

                        <TotalCell emp={emp} rowKey={row.key} isLast={isLast} which="wh" />
                        <TotalCell emp={emp} rowKey={row.key} isLast={isLast} which="ot" />
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {!loading && employees.length > 0 && (
        <div style={{ marginTop:10,display:'flex',gap:12,flexWrap:'wrap',fontSize:11,
          color:'#6b7280',padding:'8px 14px',background:'#f9fafb',
          borderRadius:8,border:'1px solid #e5e7eb',alignItems:'center' }}>
          <strong style={{ color:'#374151' }}>{L('व्याख्या','Legend')}:</strong>
          {ROWS.map(r=>(
            <span key={r.key} style={{ display:'inline-flex',alignItems:'center',gap:4 }}>
              <span style={{ background:r.color,color:'white',borderRadius:4,
                padding:'1px 7px',fontSize:11,fontWeight:800 }}>{rowLabel(r.key, language, r.label)}</span>
              <span>= {r.key==='in'?L('आउने समय','Time In'):r.key==='out'?L('जाने समय','Time Out'):r.key==='wh'?L('काम भएको घण्टा','Worked Hours'):L('ओभरटाइम','Over Time')}</span>
            </span>
          ))}
          <span><span style={{ background:'#e5e7eb',color:'#6b7280',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:800 }}>{L('ब','W')}</span> = {L('विकेन्ड','Weekend')}</span>
          <span><span style={{ background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:800 }}>{L('साबि','PH')}</span> = {L('सार्वजनिक बिदा','Public Holiday')}</span>
          <span><span style={{ background:'#ede9fe',color:'#5b21b6',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:800 }}>SL</span> = {L('बिदा','Leave')}</span>
          <span><span style={{ background:'#dbeafe',color:'#1e40af',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:800 }}>{L('भ्रमण','OV')}</span> = {L('कार्यालय भ्रमण','Office Visit')}</span>
          <span><strong style={{ color:'#d97706' }}>⚠</strong> = {L('एकल पन्च','Single punch')}</span>
          <span style={{ marginLeft:'auto' }}>{employees.length} {L('कर्मचारी','staff')}</span>
        </div>
      )}
      {/* ── Advance Search Modal ── */}
      {showSearch && (
        <AdvanceSearchModal
          filters={filters}
          onApply={f => { setFilters({ ...f, staffId: myEmpId || f.staffId }); }}
          onClose={() => setShowSearch(false)}
          L={L}
          settings={settings}
          employees={allEmployees}
          shifts={shifts}
        />
      )}
    </div>
  );
};

export default MonthlyInOutReport;
