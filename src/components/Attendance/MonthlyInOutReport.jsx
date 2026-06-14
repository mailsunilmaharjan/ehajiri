import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import ViewMonthlyBtn from './ViewMonthlyBtn.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, getExcelHeaderRows, downloadCSV } from '../../utils/printHelper.js';
import SearchableCheckSelect from '../Common/SearchableCheckSelect.jsx';

const abbrevPost = (name) => {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words.map(w => w[0].toUpperCase()).join('') : name.slice(0,5);
};

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

function getCurrentFiscalYear(fiscalYears = []) {
  const today = new Date().toISOString().split('T')[0];
  return fiscalYears.find(fy => fy.startDate <= today && fy.endDate >= today)
      || fiscalYears.find(fy => fy.isDefault)
      || fiscalYears[fiscalYears.length - 1] || null;
}

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
      label: `${e.fullName||`Staff ${e.id}`}${e.position ? ` • ${abbrevPost(e.position)}` : ''}${e.deviceId ? ` [${e.deviceId}]` : ''}`,
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

        <div style={{ padding:'16px 22px 12px',borderBottom:'1px solid #f3f4f6',
          display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <span style={{ fontSize:16,fontWeight:700,color:'#1e40af' }}>{L('एडभान्स खोज','Advance Search')}</span>
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
              <SearchableCheckSelect options={empOpts} value={local.staffId} onChange={v=>set('staffId',v)} allLabel="All Staff" />
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
  background:'#efefef', color:'#374151', fontWeight:700, fontSize:12,
  padding:'6px 8px', borderRight:'1px solid #dedede', borderBottom:'1px solid #dedede',
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
  color:       isWeekend ? '#d1d5db' : isHoliday ? '#b45309' : '#9ca3af',
  paddingTop:2, fontSize:10, fontWeight:600,
});

/* Fixed left column */
const TD_FIX = {
  padding:'0 8px', fontSize:13, fontWeight:400,
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
const DayCell = ({ rowKey, day, isWeekend, isHoliday, holidayName, isLast }) => {
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
        <span title={day.leave}
          style={{ background:'#ede9fe', color:'#5b21b6', borderRadius:4,
            padding:'1px 5px', fontSize:10, fontWeight:800, cursor:'help' }}>
          {leaveAbbrev(day.leave)}
        </span>
      );
    } else if (isHoliday) {
      badge = (
        <span title={holidayName || 'Public Holiday'}
          style={{ background:'#fef3c7', color:'#92400e', borderRadius:4,
            padding:'1px 5px', fontSize:10, fontWeight:800, cursor:'help' }}>
          PH
        </span>
      );
    } else if (day?.visit) {
      const tip = [day.visit.purpose, day.visit.location].filter(Boolean).join(' | ');
      badge = (
        <span title={tip || 'Office Visit'}
          style={{ background:'#dbeafe', color:'#1e40af', borderRadius:4,
            padding:'1px 5px', fontSize:10, fontWeight:800, cursor:'help' }}>
          OV
        </span>
      );
    } else if (isWeekend) {
      badge = (
        <span title="Weekend"
          style={{ color:'#374151', fontSize:13, fontWeight:400 }}>
          W
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

  return (
    <td style={{ background:bg, borderRight:bdRight, borderBottom:bdBottom,
      padding:'3px 4px', minWidth:54, textAlign:'center', verticalAlign:'middle' }}>
      {value
        ? <span style={{
            fontSize:13,
            fontWeight: (rowKey==='in' || rowKey==='wh') ? 700 : 400,
            color: isSinglePunch ? '#d97706' : (isWH ? '#374151' : color),
          }} title={isSinglePunch ? 'Single punch only' : ''}>
            {value}{isSinglePunch && <span style={{ fontSize:9, marginLeft:1 }}>⚠</span>}
          </span>
        : <span style={{
            color: isWH ? '#9ca3af' : (isWeekend||isHoliday ? '#e5e7eb' : '#d1d5db'),
            fontSize:13, fontWeight:400,
          }}>—</span>
      }
    </td>
  );
};

/* Total WH cell — shown only in WH row */
const TotalCell = ({ emp, rowKey, isLast }) => {
  const bdBottom = isLast ? '2px solid #c5cdd8' : '1px solid #ebebeb';
  if (rowKey !== 'wh') {
    return (
      <td style={{ background:'#f8fafc', borderLeft:'2px solid #c9d1db',
        borderRight:'1px solid #dedede', borderBottom:bdBottom,
        padding:'3px 4px', minWidth:54, textAlign:'center' }}>
        <span style={{ color:'#d1d5db', fontSize:11, fontWeight: rowKey==='wh'?700:400 }}>—</span>
      </td>
    );
  }
  const total = emp.totalWorkedHrs;
  return (
    <td style={{ background:'#f0fdf4', borderLeft:'2px solid #c9d1db',
      borderRight:'1px solid #dedede', borderBottom:bdBottom,
      padding:'3px 8px', minWidth:64, textAlign:'center', verticalAlign:'middle' }}>
      {total && total !== '—'
        ? <strong style={{ fontFamily:'monospace', fontSize:12, fontWeight:900, color:'#065f46' }}>
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

  const now     = new Date();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(now);

  const urlYear  = parseInt(searchParams.get('year'));
  const urlMonth = parseInt(searchParams.get('month'));

  // Always default to current running month
  const initYear  = useNP ? (todayBS?.year  || now.getFullYear())  : now.getFullYear();
  const initMonth = useNP ? (todayBS?.month || now.getMonth() + 1) : now.getMonth() + 1;

  const { isEmployee, currentUser } = useAuth();
  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';

  const [year,        setYear]        = useState(initYear);
  const [month,       setMonth]       = useState(initMonth);
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [search,      setSearch]      = useState('');
  const [filters,    setFilters]    = useState({ ...EMPTY_FILTERS, staffId: myEmpId });
  const [showSearch, setShowSearch] = useState(false);
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
      apiUrl += `&active=${staffStatus === 'notworking' ? 'false' : 'true'}`;
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

  const handlePrint = () => {
    if (!employees.length) return;
    const dayHeaders = dates.map((d, idx) => {
      const n = useNP ? (idx + 1) : d.dayNum;
      return `<th style="padding:3px 4px;border:1px solid #dedede;background:#efefef;font-size:9px">${n}<br/>${d.dayKey.slice(0,3)}</th>`;
    }).join('');
    const dataRows = employees.map((e,i) => {
      const dayCells = dates.flatMap(d => {
        const day = e.days[d.date];
        return [
          `<td style="padding:2px 3px;border:1px solid #ebebeb;text-align:center;font-size:9px;font-family:monospace">${fmtTime(day?.timeIn)||''}</td>`,
          `<td style="padding:2px 3px;border:1px solid #ebebeb;text-align:center;font-size:9px;font-family:monospace">${fmtTime(day?.timeOut)||''}</td>`,
          `<td style="padding:2px 3px;border:1px solid #c9d1db;text-align:center;font-size:9px;font-weight:700">${day?.workedHrs||''}</td>`,
          `<td style="padding:2px 3px;border:1px solid #ebebeb;text-align:center;font-size:9px">${day?.otHrs||''}</td>`,
        ];
      }).join('');
      return `<tr>
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center">${i+1}</td>
        <td style="padding:3px 5px;border:1px solid #dedede">${e.fullName}</td>
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center">${e.postShort||''}</td>
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center">${e.deptShort||''}</td>
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center;color:#7c3aed;font-weight:700">${resolveShort(e)}</td>
        ${dayCells}
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center;font-weight:700;color:#065f46">${e.totalWorkedHrs||''}</td>
      </tr>`;
    }).join('');
    const contentHtml = `<table style="border-collapse:collapse;width:100%;font-size:10px">
      <thead><tr>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">SN</th>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#efefef;text-align:left">Staff</th>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">Post</th>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">Dept</th>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">Branch</th>
        ${dayHeaders}
        <th style="padding:4px 5px;border:1px solid #dedede;background:#f0fdf4;color:#065f46">Total WH</th>
      </tr></thead>
      <tbody>${dataRows}</tbody>
    </table>`;
    openPrintWindow(buildPrintDoc({ settings, language, reportTitle: rptTitle, reportSub: rptSub(), contentHtml, isLandscape: true }), true);
  };

  const exportCSV = () => {
    if (!employees.length) return;
    const dayHdrs = dates.flatMap((d, idx) => {
      const n = useNP ? (idx + 1) : d.dayNum;
      return [`${n}(${d.dayKey.slice(0,3)}) IN`, `${n}(${d.dayKey.slice(0,3)}) OUT`, `${n} WH`, `${n} OT`];
    });
    const header = 'SN,Staff,Post,Dept,Branch,' + dayHdrs.join(',') + ',Total WH';
    const dataRows = employees.map((e,i) => {
      const cells = dates.flatMap(d => [
        e.days[d.date]?.timeIn   || '',
        e.days[d.date]?.timeOut  || '',
        e.days[d.date]?.workedHrs|| '',
        e.days[d.date]?.otHrs    || '',
      ]);
      return [i+1, e.fullName, e.postShort, e.deptShort, resolveShort(e), ...cells, e.totalWorkedHrs||'']
        .map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',');
    }).join('\n');
    downloadCSV(getExcelHeaderRows(settings, language, rptTitle, rptSub()) + header + '\n' + dataRows,
      `MonthlyInOut_${period?.startDate||''}.csv`);
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
          <button onClick={exportCSV}
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
            background: activeFilterCount>0 ? '#eff6ff' : 'white',
            border: `1.5px solid ${activeFilterCount>0 ? '#1a56db' : '#d1d5db'}`,
            color: activeFilterCount>0 ? '#1e40af' : '#374151',
            borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
          </svg>
          {L('एडभान्स खोज','Advance Search')}
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
      {loading && (
        <div style={{ textAlign:'center',padding:'60px 20px',color:'#9ca3af' }}>
          <div style={{ fontSize:36,marginBottom:8 }}>⏳</div>
          <div style={{ fontWeight:600,fontSize:14 }}>Loading…</div>
        </div>
      )}

      {/* ── 4-row-per-employee matrix ── */}
      {!loading && data && (
        <div style={{ overflowX:'auto', borderRadius:8,
          border:'1px solid #dedede', boxShadow:'0 1px 3px rgba(0,0,0,.07)' }}>
          <table style={{ borderCollapse:'collapse', width:'100%' }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ ...TH, minWidth:34, position:'sticky', left:0, zIndex:4 }}>SN</th>
                <th rowSpan={2} style={{ ...TH, textAlign:'left', minWidth:140, position:'sticky', left:34, zIndex:4 }}>
                  {L('कर्मचारी','Staff')}
                </th>
                <th rowSpan={2} style={{ ...TH, minWidth:46 }}>{L('पद','Post')}</th>
                <th rowSpan={2} style={{ ...TH, minWidth:46 }}>{L('विभाग','Dept.')}</th>
                <th rowSpan={2} style={{ ...TH, minWidth:44 }}>{L('शाखा','Branch')}</th>
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
                  <td colSpan={7 + dates.length}
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
                              position:'sticky', left:34, zIndex:1, borderBottom:'2px solid #c5cdd8' }}>
                              {emp.fullName}
                            </td>
                            <td rowSpan={4} style={{ ...TD_FIX, color:'#0369a1', textAlign:'left',
                              borderBottom:'2px solid #c5cdd8' }} title={emp.position}>
                              {(settings.posts||[]).find(p=>p.name===emp.position)?.shortName || emp.postShort || emp.position || '—'}
                            </td>
                            <td rowSpan={4} style={{ ...TD_FIX, color:'#059669', textAlign:'left',
                              borderBottom:'2px solid #c5cdd8' }} title={emp.department}>
                              {(settings.departments||[]).find(d=>d.name===emp.department)?.shortName || emp.deptShort || emp.department || '—'}
                            </td>
                            <td rowSpan={4} style={{ ...TD_FIX, color:'#7c3aed', textAlign:'left',
                              borderBottom:'2px solid #c5cdd8' }} title={emp.branch}>{resolveShort(emp)}</td>
                          </>
                        )}

                        <LabelCell label={row.label} color={row.color} isLast={isLast} />

                        {dates.map(({ date, isWeekend, isHoliday, holidayName }) => (
                          <DayCell
                            key={date}
                            rowKey={row.key}
                            day={emp.days[date]}
                            isWeekend={isWeekend}
                            isHoliday={isHoliday}
                            holidayName={holidayName}
                            isLast={isLast}
                          />
                        ))}

                        <TotalCell emp={emp} rowKey={row.key} isLast={isLast} />
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
                padding:'1px 7px',fontSize:11,fontWeight:800 }}>{r.label}</span>
              <span>= {r.key==='in'?'Time In':r.key==='out'?'Time Out':r.key==='wh'?'Worked Hours':'Over Time'}</span>
            </span>
          ))}
          <span><span style={{ background:'#e5e7eb',color:'#6b7280',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:800 }}>W</span> = Weekend</span>
          <span><span style={{ background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:800 }}>PH</span> = Public Holiday</span>
          <span><span style={{ background:'#ede9fe',color:'#5b21b6',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:800 }}>SL</span> = Leave</span>
          <span><span style={{ background:'#dbeafe',color:'#1e40af',borderRadius:4,padding:'1px 6px',fontSize:11,fontWeight:800 }}>OV</span> = Office Visit</span>
          <span><strong style={{ color:'#d97706' }}>⚠</strong> = Single punch</span>
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
