import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import ViewHalfMonthlyBtn from './ViewHalfMonthlyBtn.jsx';
import SearchableCheckSelect from '../Common/SearchableCheckSelect.jsx';
import { adToBS, bsToAD, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, getExcelHeaderRows, downloadCSV } from '../../utils/printHelper.js';

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

/* "General Manager"→"GM", "Accountant"→"Accou" */
const abbrev = (name) => {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 5);
};

function getCurrentFiscalYear(fiscalYears = []) {
  const today = new Date().toISOString().split('T')[0];
  return fiscalYears.find(fy => fy.startDate <= today && fy.endDate >= today)
      || fiscalYears.find(fy => fy.isDefault)
      || fiscalYears[fiscalYears.length - 1] || null;
}

/* ── Status cell config ──────────────────────────────────────── */
const STATUS = {
  P  : { color:'#059669', main:'P',   sup:null,  title:'Present'                   },
  P1 : { color:'#0369a1', main:'P',   sup:'1P',  title:'Present – single punch'    },
  PP : { color:'#ca8a04', main:'PH',  sup:null,  title:'Present on Public Holiday' },
  AB : { color:'#dc2626', main:'AB',  sup:null,  title:'Absent'                    },
  H  : { color:'#111827', main:'W',   sup:null,  title:'Weekend'                   },
  L  : { color:'#7c3aed', main:'L',   sup:null,  title:'Leave'                     },
  LH : { color:'#a855f7', main:'L',   sup:'½',   title:'Half-day Leave'            },
  OV : { color:'#2563eb', main:'OV',  sup:null,  title:'Office Visit'              },
  PH : { color:'#d97706', main:'H',   sup:null,  title:'Public Holiday'            },
};

const StatusCell = ({ st }) => {
  const s = STATUS[st] || STATUS.AB;
  return (
    <span style={{ color:s.color, fontSize:12, fontWeight:700,
      display:'block', textAlign:'center', cursor:'default', whiteSpace:'nowrap' }}
      title={s.title}>
      {s.main}{s.sup && <sup style={{ fontSize:8, fontWeight:800 }}>{s.sup}</sup>}
    </span>
  );
};

/* ── Advanced Search Modal ───────────────────────────────────── */
const EMPTY_FILTERS = {
  status:'working', fiscalYear:'', staffId:'',
  branch:'', dept:'', post:'', grade:'', mode:'', timingType:'', shift:'',
};

const AdvanceSearchModal = ({ filters, onApply, onClose, L, settings, employees, shifts, month, onMonthChange, useNP }) => {
  const [local,      setLocal]      = useState({ ...filters });
  const [localMonth, setLocalMonth] = useState(month);
  const set = (k, v) => setLocal(p => ({ ...p, [k]: v }));

  const statusOpts = [
    { value:'working',    label: L('कार्यरत','Working')     },
    { value:'notworking', label: L('अवकाश','Not Working')  },
  ];

  const monthOpts = useNP
    ? BS_MONTHS_NP.map((m, i)  => ({ value: String(i+1), label: m }))
    : MONTHS_EN.map((m, i)     => ({ value: String(i+1), label: m }));

  const fyOpts = (settings.fiscalYears || []).map(fy => ({ value: fy.name, label: fy.name }));
  const modes       = (settings.modes   || []).map(m => ({ value:m.name,  label:m.name  }));
  const grades      = (settings.grades  || []).map(g => ({ value:g.name,  label:g.name  }));
  const timingTypes = (settings.timingTypes || []).map(t => ({ value:t.name||t, label:t.name||t }));

  const shiftOpts = shifts.map(s => ({ value:s.code, label:s.name || s.code }));

  // Employee options filtered by current status selection
  const activeFlag = local.status === 'working';
  const empOpts = employees
    .filter(e => (e.active !== false) === activeFlag)
    .sort((a,b) => (a.fullName||'').localeCompare(b.fullName||''))
    .map(e => ({
      value: String(e.id),
      label: `${e.fullName || `Staff ${e.id}`}${e.position ? ` • ${abbrev(e.position)}` : ''}${e.deviceId ? ` [${e.deviceId}]` : ''}`,
    }));

  const branches = [...new Set(employees.filter(e=>(e.active!==false)===activeFlag).map(e=>e.branch).filter(Boolean))].sort().map(b=>({value:b,label:b}));
  const depts    = [...new Set(employees.filter(e=>(e.active!==false)===activeFlag).map(e=>e.department).filter(Boolean))].sort().map(d=>({value:d,label:d}));
  const posts    = [...new Set(employees.filter(e=>(e.active!==false)===activeFlag).map(e=>e.position).filter(Boolean))].sort().map(p=>({value:p,label:p}));

  const Lbl = ({ text }) => (
    <div style={{ fontSize:13, fontWeight:600, color:'#111827', marginBottom:6 }}>{text}</div>
  );
  const Field = ({ label, children }) => (
    <div style={{ position:'relative', overflow:'visible' }}>
      <Lbl text={label} />
      {children}
    </div>
  );

  return (
    <div className="modal-overlay">
      <div style={{
        background:'white', borderRadius:16, width:'min(960px,96vw)',
        boxShadow:'0 20px 60px rgba(0,0,0,.18)', overflow:'visible', position:'relative',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid #f3f4f6',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:17, fontWeight:700, color:'#1e40af' }}>
            {L('एडभान्स खोज','Advance Search')}
          </span>
          <button onClick={onClose}
            style={{ background:'none',border:'none',cursor:'pointer',color:'#6b7280',
              fontSize:20,lineHeight:1,padding:'2px 6px',borderRadius:6 }}
            onMouseEnter={e=>e.currentTarget.style.background='#f3f4f6'}
            onMouseLeave={e=>e.currentTarget.style.background='none'}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding:'18px 24px', display:'flex', flexDirection:'column', gap:16 }}>

          {/* Row 1: Status | Fiscal Year | Month */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('स्थिति','Status')}>
              <SearchableCheckSelect options={statusOpts} value={local.status}
                onChange={v=>{ set('status',v||'working'); set('staffId',''); }}
                allLabel={L('All','All')} />
            </Field>
            <Field label={L('वित्तीय वर्ष','Fiscal Year')}>
              <SearchableCheckSelect options={fyOpts} value={local.fiscalYear}
                onChange={v=>set('fiscalYear',v)} allLabel={L('Current FY','Current FY')} />
            </Field>
            <Field label={L('महिना','Month')}>
              <SearchableCheckSelect
                options={monthOpts}
                value={String(localMonth)}
                onChange={v => setLocalMonth(v ? +v : month)}
                allLabel={useNP
                  ? (BS_MONTHS_NP[month-1] || '')
                  : (MONTHS_EN[month-1]    || '')}
              />
            </Field>
          </div>

          {/* Row 2: Staff | Branch | Department */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('कर्मचारी','Staff')}>
              <SearchableCheckSelect options={empOpts} value={local.staffId}
                onChange={v=>set('staffId',v)} allLabel={L('All Staff','All Staff')} />
            </Field>
            <Field label={L('शाखा','Branch')}>
              <SearchableCheckSelect options={branches} value={local.branch}
                onChange={v=>set('branch',v)} allLabel={L('All Branches','All Branches')} />
            </Field>
            <Field label={L('विभाग','Department')}>
              <SearchableCheckSelect options={depts} value={local.dept}
                onChange={v=>set('dept',v)} allLabel={L('All Depts','All Depts')} />
            </Field>
          </div>

          {/* Row 3: Post | Grade | Mode */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('पद','Post')}>
              <SearchableCheckSelect options={posts} value={local.post}
                onChange={v=>set('post',v)} allLabel={L('All Posts','All Posts')} />
            </Field>
            <Field label={L('ग्रेड','Grade')}>
              <SearchableCheckSelect options={grades} value={local.grade}
                onChange={v=>set('grade',v)} allLabel={L('All Grades','All Grades')} />
            </Field>
            <Field label={L('नियुक्ति','Mode')}>
              <SearchableCheckSelect options={modes} value={local.mode}
                onChange={v=>set('mode',v)} allLabel={L('All Modes','All Modes')} />
            </Field>
          </div>

          {/* Row 4: Timing Type | Shift */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('टाइमिङ प्रकार','Timing Type')}>
              <SearchableCheckSelect options={timingTypes} value={local.timingType}
                onChange={v=>set('timingType',v)} allLabel={L('All Types','All Types')} />
            </Field>
            <Field label={L('सिफ्ट','Shift')}>
              <SearchableCheckSelect options={shiftOpts} value={local.shift}
                onChange={v=>set('shift',v)} allLabel={L('All Shifts','All Shifts')} />
            </Field>
            <div />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 24px 18px', borderTop:'1px solid #f3f4f6',
          display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button
            onClick={() => { onApply({ ...EMPTY_FILTERS }); onMonthChange(month); onClose(); }}
            style={{ padding:'8px 20px', border:'1.5px solid #d1d5db', borderRadius:8,
              background:'white', color:'#374151', fontSize:14, fontWeight:600, cursor:'pointer' }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#9ca3af';e.currentTarget.style.background='#f9fafb';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='white';}}>
            {L('रिसेट','Reset')}
          </button>
          <button
            onClick={() => { onApply(local); onMonthChange(localMonth); onClose(); }}
            style={{ padding:'8px 24px', border:'none', borderRadius:8,
              background:'#1a56db', color:'white', fontSize:14, fontWeight:700,
              cursor:'pointer', boxShadow:'0 2px 8px rgba(26,86,219,.3)' }}
            onMouseEnter={e=>e.currentTarget.style.background='#1e40af'}
            onMouseLeave={e=>e.currentTarget.style.background='#1a56db'}>
            {L('खोज्नुस','Search')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Half Present Absent Report
═══════════════════════════════════════════════════════════════ */
const PresentAbsentReport = () => {
  const [searchParams] = useSearchParams();
  const { language }   = useLanguage();
  const { settings }   = useSettings();
  const { filteredEmployees: allEmployees, shifts, getApprovedLeaveForDate } = useData();
  const fd             = useDateFormat();
  const L = (np, en)   => language === 'np' ? np : en;

  const now    = new Date();
  const useNP  = settings.defaultCalendar === 'np';
  const todayBS = adToBS(now);

  const urlYear  = parseInt(searchParams.get('year'));
  const urlMonth = parseInt(searchParams.get('month'));
  const urlHalf  = parseInt(searchParams.get('half'));

  const initYM = () => {
    if (urlYear && urlMonth) {
      if (useNP) {
        const bs = adToBS(new Date(urlYear, urlMonth - 1, 15));
        if (bs) return { year: bs.year, month: bs.month };
      }
      return { year: urlYear, month: urlMonth };
    }
    return {
      year:  useNP ? (todayBS?.year  || now.getFullYear())  : now.getFullYear(),
      month: useNP ? (todayBS?.month || now.getMonth() + 1) : now.getMonth() + 1,
    };
  };

  const init = initYM();
  const currentFY = getCurrentFiscalYear(settings.fiscalYears || []);

  const { isEmployee, currentUser } = useAuth();
  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';

  const [year,        setYear]        = useState(init.year);
  const [month,       setMonth]       = useState(init.month);
  const [half,        setHalf]        = useState(urlHalf || (now.getDate() <= 15 ? 1 : 2));
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [showSearch,  setShowSearch]  = useState(false);
  const [filters,     setFilters]     = useState({ ...EMPTY_FILTERS, fiscalYear: currentFY?.name || '', staffId: myEmpId });

  const activeParam = filters.status !== 'notworking';

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let apiYear = year, apiMonth = month;
      if (useNP) {
        const ad = bsToAD(year, month, 15);
        if (ad) { apiYear = ad.getFullYear(); apiMonth = ad.getMonth() + 1; }
      }
      setData(await api.get(
        `/attendance/present-absent?year=${apiYear}&month=${apiMonth}&half=${half}&active=${activeParam}`
      ));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year, month, half, activeParam, useNP]);

  useEffect(() => { load(); }, [load]);

  const period    = data?.period;
  const dates     = data?.dates     || [];
  const allRows = (data?.employees || []).map(emp => {
    const newDays = { ...emp.days };
    Object.keys(newDays).forEach(dateStr => {
      if (newDays[dateStr] === 'AB') {
        const leave = getApprovedLeaveForDate(emp.id, dateStr);
        if (leave) newDays[dateStr] = 'L';
      }
    });
    return { ...emp, days: newDays };
  });

  /* Branch short-name from settings — uses camelCase shortName as stored in frontend settings */
  const branchShortMap = React.useMemo(() => {
    const m = {};
    (settings.branches || []).forEach(b => {
      const sn = b.shortName || b.short_name;
      if (b.name && sn) m[b.name.toLowerCase().trim()] = sn;
    });
    return m;
  }, [settings.branches]);

  /* Resolve branch short name: settings first, then API branchShort (skip if it's '—'), then full name */
  const resolveShort = (emp) =>
    branchShortMap[(emp.branch||'').toLowerCase().trim()]
    || (emp.branchShort && emp.branchShort !== '—' ? emp.branchShort : null)
    || emp.branch
    || '—';

  /* ── Client-side filtering ── */
  const employees = allRows.filter(e => {
    if (filters.staffId  && String(e.id) !== filters.staffId)       return false;
    if (filters.branch   && e.branch     !== filters.branch)         return false;
    if (filters.dept     && e.department !== filters.dept)           return false;
    if (filters.post     && e.position   !== filters.post)           return false;
    if (filters.grade    && e.grade      !== filters.grade)          return false;
    if (filters.mode     && e.mode       !== filters.mode)           return false;
    if (filters.timingType && e.timingType !== filters.timingType)   return false;
    if (filters.shift    && e.shift      !== filters.shift)          return false;
    return true;
  });

  const activeFilterCount = Object.entries(filters).filter(([k,v]) =>
    k !== 'status' && k !== 'fiscalYear' && v !== ''
  ).length + (filters.status !== 'working' ? 1 : 0);

  const periodLabel = () => {
    const mn     = useNP ? (BS_MONTHS_NP[month-1] || '') : MONTHS_EN[month-1];
    const yr     = settings.nepaliDigits ? toNepaliDigits(year) : String(year);
    const calStr = useNP ? ' BS' : '';
    const hStr   = half===1 ? L('पहिलो अर्ध (१–१५)','1st Half (1–15)') : L('दोस्रो अर्ध (१६–अन्त)','2nd Half (16–End)');
    return `${mn} ${yr}${calStr} · ${hStr}`;
  };

  /* Totals per date column */
  const dateTotals = dates.map(({ date }) => {
    let p=0, ab=0, l=0, ov=0;
    employees.forEach(e => {
      const st = e.days[date];
      if      (st==='P'||st==='PP'||st==='P1') p++;
      else if (st==='AB')                       ab++;
      else if (st==='L'||st==='LH')             l++;
      else if (st==='OV')                        ov++;
    });
    return { p, ab, l, ov };
  });

  const grandP  = employees.reduce((s,e) => s + (e.totalP  || 0), 0);
  const grandAB = employees.reduce((s,e) => s + (e.totalAB || 0), 0);
  const grandL  = employees.reduce((s,e) => s + (e.totalL  || 0), 0);
  const grandOV = employees.reduce((s,e) => s + (e.totalOV || 0), 0);

  /* Auto-width for Staff column: fit the widest name (approx 7.5px per char at 13px font) */
  const staffColWidth = React.useMemo(() => {
    if (!employees.length) return 120;
    const maxLen = Math.max(...employees.map(e => (e.fullName||'').length));
    return Math.min(Math.max(maxLen * 7.5, 80), 220);
  }, [employees]);

  /* ── Standard DataGrid header style (matches .dg-th) ── */
  const thBase = {
    background:'#efefef', color:'#374151',
    fontWeight:700, fontSize:12,
    borderRight:'1px solid #dedede', borderBottom:'2px solid #dedede',
    padding:'6px 8px', textAlign:'center',
    whiteSpace:'nowrap', position:'sticky', top:0, zIndex:3,
    userSelect:'none',
  };
  const thSub = {
    ...thBase, fontSize:11, borderBottom:'1px solid #dedede',
    padding:'3px 8px', top:29,
  };
  const thWeekend    = { ...thBase, background:'#e5e7eb', color:'#111827' };
  const thHoliday    = { ...thBase, background:'#fef3c7', color:'#92400e' };
  const thSubWeekend = { ...thSub,  background:'#e5e7eb', color:'#111827' };
  const thSubHoliday = { ...thSub, background:'#fef3c7', color:'#92400e' };
  const thTotalP   = { ...thBase, background:'#d1fae5', color:'#065f46' };
  const thTotalAB  = { ...thBase, background:'#fee2e2', color:'#991b1b' };

  const tdBase = {
    padding:'4px 6px', fontSize:12,
    borderRight:'1px solid #e5e7eb', borderBottom:'1px solid #f3f4f6',
    verticalAlign:'middle', whiteSpace:'nowrap', textAlign:'center',
  };

  const reportTitle = 'Half Present Absent Report';
  const reportSub = () => periodLabel();

  const handlePrint = () => {
    if (!employees.length) return;
    const dayHeaders = dates.map(d => `<th style="padding:3px 4px;border:1px solid #dedede;background:#efefef;font-size:10px">${d.dayNum}<br/>${d.dayKey.slice(0,3)}</th>`).join('');
    const dataRows = employees.map((e,i) => {
      const dayCells = dates.map(d => {
        const lbl = STATUS[e.days[d.date]]?.label || '';
        return `<td style="padding:2px 3px;border:1px solid #dedede;text-align:center;font-size:10px">${lbl}</td>`;
      }).join('');
      return `<tr>
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center">${i+1}</td>
        <td style="padding:3px 5px;border:1px solid #dedede">${e.fullName}</td>
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center">${e.postShort||''}</td>
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center">${e.deptShort||''}</td>
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center">${e.branchShort||''}</td>
        ${dayCells}
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center;font-weight:700;color:#065f46">${e.totalP}</td>
        <td style="padding:3px 5px;border:1px solid #dedede;text-align:center;font-weight:700;color:#991b1b">${e.totalAB}</td>
      </tr>`;
    }).join('');
    const contentHtml = `<table style="border-collapse:collapse;width:100%;font-size:11px">
      <thead><tr>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">SN</th>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#efefef;text-align:left">Staff</th>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">Post</th>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">Dept</th>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">Branch</th>
        ${dayHeaders}
        <th style="padding:4px 5px;border:1px solid #dedede;background:#d1fae5;color:#065f46">P</th>
        <th style="padding:4px 5px;border:1px solid #dedede;background:#fee2e2;color:#991b1b">AB</th>
      </tr></thead>
      <tbody>${dataRows}</tbody>
    </table>`;
    openPrintWindow(buildPrintDoc({ settings, language, reportTitle, reportSub: reportSub(), contentHtml, isLandscape: true }), true);
  };

  const exportCSV = () => {
    if (!employees.length) return;
    const headers = ['SN','Staff','Post','Dept','Branch',
      ...dates.map(d=>`${d.dayNum}(${d.dayKey})`), 'Total P','Total AB'];
    const dataRows = employees.map((e,i) => [
      i+1, e.fullName, e.postShort, e.deptShort, e.branchShort,
      ...dates.map(d => STATUS[e.days[d.date]]?.label || ''),
      e.totalP, e.totalAB,
    ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    downloadCSV(getExcelHeaderRows(settings, language, reportTitle, reportSub()) + headers.join(',') + '\n' + dataRows,
      `HalfPresentAbsent_${period?.startDate||''}_${period?.endDate||''}.csv`);
  };

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            ✅ {L('अर्ध उपस्थित/अनुपस्थित रिपोर्ट','Half Present Absent Report')}
          </h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY && (
              <span style={{ background:'#eff6ff',color:'#1a56db',borderRadius:6,
                padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>
                {currentFY.name}
              </span>
            )}
            {periodLabel()}
            {period && (
              <span style={{ marginLeft:8, fontSize:11, color:'#9ca3af' }}>
                {fd(period.startDate)} → {fd(period.endDate)}
                <span style={{ marginLeft:5,background:'#f1f5f9',color:'#475569',
                  borderRadius:4,padding:'1px 6px',fontSize:10,fontWeight:600 }}>
                  {period.totalWorkingDays} {L('दिन','days')}
                </span>
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
          <ViewHalfMonthlyBtn year={year} month={month} half={half} useNP={useNP}
            currentPath="/attendance/reports/half-monthly/present-absent" />
        </div>
      </div>

      {/* ── Period selector + controls ── */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap',justifyContent:'flex-end' }}>
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
        <select className="form-control" style={{ width:useNP?120:140,height:36,fontSize:13 }}
          value={month} onChange={e=>setMonth(+e.target.value)}>
          {useNP
            ? BS_MONTHS_NP.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
            : MONTHS_EN.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
          }
        </select>

        {/* 1st/2nd Half toggle */}
        <div style={{ display:'flex',gap:0,border:'1px solid #d1d5db',borderRadius:8,overflow:'hidden' }}>
          {[1,2].map(h=>(
            <button key={h} onClick={()=>setHalf(h)}
              style={{ padding:'5px 16px',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,
                background:half===h?'#1a56db':'white',color:half===h?'white':'#374151',transition:'background .15s' }}>
              {h===1?L('पहिलो अर्ध','1st Half'):L('दोस्रो अर्ध','2nd Half')}
            </button>
          ))}
        </div>

        {/* Working / Not Working toggle */}
        <div style={{ display:'flex',gap:0,border:'1px solid #d1d5db',borderRadius:8,overflow:'hidden' }}>
          {[['working',L('कार्यरत','Working')],['notworking',L('अवकाश','Not Working')]].map(([v,label])=>(
            <button key={v}
              onClick={() => setFilters(p => ({ ...p, status:v, staffId:'' }))}
              style={{ padding:'5px 14px',border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
                background:filters.status===v?'#1a56db':'white',
                color:filters.status===v?'white':'#374151',transition:'background .15s' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Staff selector */}
        <span style={{ fontSize:13,fontWeight:600,color:'#374151',whiteSpace:'nowrap' }}>
          {L('कर्मचारी','Staff')} :
        </span>
        <select className="form-control" style={{ width:220,height:36,fontSize:13 }}
          value={filters.staffId}
          onChange={e => setFilters(p => ({ ...p, staffId: e.target.value }))}>
          <option value="">— {L('सबै कर्मचारी','All Staff')} —</option>
          {allRows.map(e => (
            <option key={e.id} value={String(e.id)}>{e.fullName}</option>
          ))}
        </select>

        {/* Advance Search button */}
        <button onClick={() => setShowSearch(true)}
          style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'0 14px',height:36,
            background: activeFilterCount > 0 ? '#eff6ff' : 'white',
            border: `1.5px solid ${activeFilterCount > 0 ? '#1a56db' : '#d1d5db'}`,
            color: activeFilterCount > 0 ? '#1e40af' : '#374151',
            borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',transition:'all .15s' }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
          </svg>
          {L('एडभान्स खोज','Advance Search')}
          {activeFilterCount > 0 && (
            <span style={{ background:'#1a56db',color:'white',borderRadius:'50%',
              width:18,height:18,display:'inline-flex',alignItems:'center',justifyContent:'center',
              fontSize:11,fontWeight:800 }}>{activeFilterCount}</span>
          )}
        </button>

        <button className="btn btn-outline btn-sm" style={{ height:36 }} onClick={load} disabled={loading}>🔃</button>
      </div>

      {error && (
        <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,
          padding:'10px 16px',marginBottom:12,color:'#991b1b',fontWeight:600 }}>
          ❌ {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign:'center',padding:'60px 20px',color:'#9ca3af' }}>
          <div style={{ fontSize:36,marginBottom:8 }}>⏳</div>
          <div style={{ fontWeight:600,fontSize:14 }}>Loading…</div>
        </div>
      )}

      {/* ── Matrix Table ── */}
      {!loading && data && (
        <div style={{ overflowX:'auto', borderRadius:8, border:'1px solid #dedede',
          boxShadow:'0 1px 3px rgba(0,0,0,.07)' }}>
          <table style={{ borderCollapse:'collapse', width:'100%', minWidth:600 }}>
            <thead>
              {/* Row 1 — column labels */}
              <tr>
                <th style={{ ...thBase, minWidth:34, left:0, position:'sticky', zIndex:4 }}>SN</th>
                <th style={{ ...thBase, textAlign:'left', width:staffColWidth, minWidth:staffColWidth, position:'sticky', left:34, zIndex:4 }}>
                  {L('कर्मचारी','Staff')}
                </th>
                <th style={{ ...thBase, minWidth:60 }}>{L('पद','Post')}</th>
                <th style={{ ...thBase, minWidth:60 }}>{L('विभाग','Dept.')}</th>
                <th style={{ ...thBase, minWidth:52 }}>{L('शाखा','Branch')}</th>

                {dates.map(({ date, dayNum, isWeekend, isHoliday }) => (
                  <th key={date} style={{
                    ...(isWeekend ? thWeekend : isHoliday ? thHoliday : thBase),
                    minWidth:32, fontSize:11,
                  }}>
                    {dayNum}
                  </th>
                ))}
                <th style={{ ...thTotalP,  minWidth:38 }}>P</th>
                <th style={{ ...thTotalAB, minWidth:38 }}>AB</th>
              </tr>

              {/* Row 2 — day abbreviations */}
              <tr>
                <th style={{ ...thSub, left:0, position:'sticky', zIndex:4 }}></th>
                <th style={{ ...thSub, textAlign:'left', position:'sticky', left:34, zIndex:4 }}></th>
                <th style={thSub}></th>
                <th style={thSub}></th>
                <th style={thSub}></th>

                {dates.map(({ date, dayKey, isWeekend, isHoliday }) => (
                  <th key={date} style={{
                    ...(isWeekend ? thSubWeekend : isHoliday ? thSubHoliday : thSub),
                    fontSize:10,
                  }}>
                    {dayKey.slice(0,3)}
                  </th>
                ))}
                <th style={{ ...thSub, background:'#d1fae5', color:'#065f46' }}>Total</th>
                <th style={{ ...thSub, background:'#fee2e2', color:'#991b1b' }}>Total</th>
              </tr>
            </thead>

            <tbody>
              {employees.length === 0 && (
                <tr>
                  <td colSpan={5 + dates.length + 2}
                    style={{ textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:13 }}>
                    {L('कुनै कर्मचारी भेटिएन','No staff found matching the filters')}
                  </td>
                </tr>
              )}

              {employees.map((emp, idx) => (
                <tr key={emp.id}
                  style={{ background: idx%2===0 ? 'white' : '#f9fafb' }}
                  onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
                  onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?'white':'#f9fafb'}>

                  <td style={{ ...tdBase, fontWeight:600, color:'#6b7280',
                    position:'sticky', left:0, background:'#efefef', zIndex:1,
                    borderRight:'1px solid #dedede' }}>
                    {idx+1}
                  </td>
                  <td style={{ ...tdBase, textAlign:'left', fontWeight:700, color:'#1f2937',
                    position:'sticky', left:34, background:'inherit', zIndex:1,
                    width:staffColWidth, minWidth:staffColWidth, whiteSpace:'nowrap' }}>
                    {emp.fullName}
                  </td>
                  <td style={{ ...tdBase, color:'#0369a1', fontWeight:700, textAlign:'left' }} title={emp.position}>
                    {(settings.posts||[]).find(p=>p.name===emp.position)?.shortName || emp.postShort || emp.position || '—'}
                  </td>
                  <td style={{ ...tdBase, color:'#059669', fontWeight:700, textAlign:'left' }} title={emp.department}>
                    {(settings.departments||[]).find(d=>d.name===emp.department)?.shortName || emp.deptShort || emp.department || '—'}
                  </td>
                  <td style={{ ...tdBase, color:'#7c3aed', fontWeight:700, textAlign:'left' }} title={emp.branch}>{resolveShort(emp)}</td>

                  {dates.map(({ date }) => (
                    <td key={date} style={{ ...tdBase, padding:'3px' }}>
                      <StatusCell st={emp.days[date]} />
                    </td>
                  ))}

                  <td style={{ ...tdBase, fontWeight:800, color:'#065f46',
                    background:'#f0fdf4', fontSize:13 }}>{emp.totalP}</td>
                  <td style={{ ...tdBase, fontWeight:800,
                    color:emp.totalAB>0?'#991b1b':'#d1d5db',
                    background:emp.totalAB>0?'#fff5f5':'white', fontSize:13 }}>{emp.totalAB}</td>
                </tr>
              ))}

              {/* Leave summary row */}
              {employees.length > 0 && grandL > 0 && (
                <tr style={{ background:'#faf5ff', borderTop:'2px solid #ddd6fe' }}>
                  <td style={{ ...tdBase, background:'#ede9fe', color:'#6b7280', fontWeight:600,
                    position:'sticky', left:0, zIndex:1, borderRight:'1px solid #dedede' }}></td>
                  <td colSpan={4} style={{ ...tdBase, fontWeight:700, color:'#5b21b6',
                    textAlign:'left', background:'#ede9fe',
                    position:'sticky', left:34, zIndex:1 }}>
                    🌴 {L('बिदा जम्मा','Leave Total')}
                  </td>
                  {dateTotals.map((dt, i) => (
                    <td key={i} style={{ ...tdBase, textAlign:'center', fontWeight:700,
                      color: dt.l > 0 ? '#7c3aed' : '#d1d5db' }}>
                      {dt.l > 0 ? dt.l : '—'}
                    </td>
                  ))}
                  <td style={{ ...tdBase, fontWeight:800, color:'#5b21b6', background:'#ede9fe', textAlign:'center' }}>{grandL}</td>
                  <td style={{ ...tdBase, color:'#d1d5db', textAlign:'center' }}>—</td>
                </tr>
              )}

              {/* Office Visit summary row */}
              {employees.length > 0 && grandOV > 0 && (
                <tr style={{ background:'#eff6ff', borderTop:'1px solid #bfdbfe' }}>
                  <td style={{ ...tdBase, background:'#dbeafe', color:'#6b7280', fontWeight:600,
                    position:'sticky', left:0, zIndex:1, borderRight:'1px solid #dedede' }}></td>
                  <td colSpan={4} style={{ ...tdBase, fontWeight:700, color:'#1e40af',
                    textAlign:'left', background:'#dbeafe',
                    position:'sticky', left:34, zIndex:1 }}>
                    🚗 {L('कार्यालय भ्रमण जम्मा','Office Visit Total')}
                  </td>
                  {dateTotals.map((dt, i) => (
                    <td key={i} style={{ ...tdBase, textAlign:'center', fontWeight:700,
                      color: dt.ov > 0 ? '#2563eb' : '#d1d5db' }}>
                      {dt.ov > 0 ? dt.ov : '—'}
                    </td>
                  ))}
                  <td style={{ ...tdBase, color:'#d1d5db', textAlign:'center' }}>—</td>
                  <td style={{ ...tdBase, fontWeight:800, color:'#1e40af', background:'#dbeafe', textAlign:'center' }}>{grandOV}</td>
                </tr>
              )}

            </tbody>
          </table>
        </div>
      )}

      {/* ── Legend ── */}
      {!loading && employees.length > 0 && (
        <div style={{ marginTop:10, padding:'10px 14px', background:'#f9fafb',
          borderRadius:8, border:'1px solid #e5e7eb' }}>
          <div style={{ fontWeight:700, fontSize:12, color:'#374151', marginBottom:6 }}>
            {L('व्याख्या','Legend')}:
          </div>
          <div style={{ display:'flex',gap:12,flexWrap:'wrap',fontSize:11 }}>
            {[
              { st:'P',  desc:'Present'                   },
              { st:'P1', desc:'Single Punch'              },
              { st:'AB', desc:'Absent'                    },
              { st:'H',  desc:'Weekend (W)'               },
              { st:'L',  desc:'Leave'                     },
              { st:'LH', desc:'Half-day Leave'            },
              { st:'OV', desc:'Office Visit'              },
              { st:'PH', desc:'Public Holiday'            },
              { st:'PP', desc:'Present on Public Holiday' },
            ].map(({ st, desc }) => {
              const s = STATUS[st];
              return (
                <div key={st} style={{ display:'flex',alignItems:'center',gap:5 }}>
                  <span style={{ color:s.color, fontWeight:800 }}>
                    {s.main}{s.sup && <sup style={{ fontSize:8 }}>{s.sup}</sup>}
                  </span>
                  <span style={{ color:'#6b7280' }}>= {desc}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Advanced Search Modal ── */}
      {showSearch && (
        <AdvanceSearchModal
          filters={filters}
          onApply={f => setFilters({ ...f, staffId: myEmpId || f.staffId })}
          onClose={() => setShowSearch(false)}
          L={L}
          settings={settings}
          employees={allEmployees}
          shifts={shifts}
          month={month}
          onMonthChange={setMonth}
          useNP={useNP}
        />
      )}
    </div>
  );
};

export default PresentAbsentReport;
