import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import ViewMonthlyBtn from './ViewMonthlyBtn.jsx';
import SearchableCheckSelect from '../Common/SearchableCheckSelect.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits, getNepalNow, getNepalTodayISO, getCurrentFiscalYear } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, getExcelHeaderRows, downloadCSV } from '../../utils/printHelper.js';

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

const abbrev = (name) => {
  if (!name) return '—';
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 5);
};

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

/* ── Shared cell styles (matches DataGrid .dg-th) ── */
const TH_BASE = {
  background:'#efefef', color:'#374151', fontWeight:700, fontSize:12.5,
  padding:'4px 8px', borderRight:'1px solid #dedede', borderBottom:'1px solid #dedede',
  whiteSpace:'nowrap', textAlign:'center', userSelect:'none',
};
const TH_GRP     = { ...TH_BASE, background:'#e4e4e4', borderBottom:'none', paddingBottom:3 };
const TH_SUB     = { ...TH_BASE, paddingTop:3, fontSize:11, color:'#6b7280' };
const TH_WKD     = { ...TH_GRP, color:'#6b7280' };
const TH_HOL     = { ...TH_GRP, background:'#fef3c7', color:'#92400e' };
const TH_HOL_SUB = { ...TH_SUB, background:'#fef9e7', color:'#92400e' };
const TH_OV      = { ...TH_BASE, background:'#eff6ff', color:'#1e40af' };
const TD_BASE    = {
  padding:'3px 8px', fontSize:12.5, color:'#374151',
  borderRight:'1px solid #e5e7eb', borderBottom:'1px solid #f3f4f6',
  verticalAlign:'middle', whiteSpace:'nowrap', textAlign:'center',
};

/* ── Advance Search Modal ── */
const EMPTY_FILTERS = {
  _status:'working', staffId:'', branch:'', dept:'', post:'', grade:'', mode:'', timingType:'', shift:'',
};

const AdvanceSearchModal = ({ filters, onApply, onClose, L, settings, employees, shifts }) => {
  const [local, setLocal] = useState({ ...filters });
  const set = (k, v) => setLocal(p => ({ ...p, [k]: v }));

  const modes       = (settings.modes   || []).map(m => ({ value:m.name,  label:m.name  }));
  const grades      = (settings.grades  || []).map(g => ({ value:g.name,  label:g.name  }));
  const timingTypes = (settings.timingTypes || []).map(t => ({ value:t.name||t, label:t.name||t }));
  const shiftOpts   = shifts.map(s => ({ value:s.code, label:s.name || s.code }));

  const activeFlag = (local._status || 'working') === 'working';
  const empOpts = employees.filter(e => (e.active !== false) === activeFlag)
    .sort((a,b) => (a.fullName||'').localeCompare(b.fullName||''))
    .map(e => ({
      value: String(e.id),
      label: `${e.fullName||`Staff ${e.id}`}${e.position ? ` • ${abbrev(e.position)}` : ''}${e.deviceId ? ` [${e.deviceId}]` : ''}`,
    }));

  const filteredEmps = employees.filter(e => (e.active !== false) === activeFlag);
  const branches = [...new Set(filteredEmps.map(e=>e.branch).filter(Boolean))].sort().map(b=>({value:b,label:b}));
  const depts    = [...new Set(filteredEmps.map(e=>e.department).filter(Boolean))].sort().map(d=>({value:d,label:d}));
  const posts    = [...new Set(filteredEmps.map(e=>e.position).filter(Boolean))].sort().map(p=>({value:p,label:p}));

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

        <div style={{ padding:'18px 24px 14px', background:'#ffffff',borderBottom:'1px solid #f3f4f6',
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

        <div style={{ padding:'18px 24px', display:'flex', flexDirection:'column', gap:16 }}>

          {/* Row 0: Status */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:14, marginBottom:4 }}>
            <Field label={L('स्थिति','Status')}>
              <div style={{ display:'flex', gap:0, border:'1px solid #d1d5db', borderRadius:8, overflow:'hidden' }}>
                {[['working', L('कार्यरत','Working')], ['notworking', L('अवकाश','Not Working')]].map(([v, label]) => (
                  <button key={v}
                    onClick={() => { set('_status', v); set('staffId', ''); }}
                    style={{ flex:1, padding:'8px 12px', border:'none', cursor:'pointer',
                      fontSize:13, fontWeight:600, transition:'background .15s',
                      background: (local._status || 'working') === v ? '#1a56db' : 'white',
                      color: (local._status || 'working') === v ? 'white' : '#374151' }}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {/* Row 1: Staff | Branch | Department */}
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

          {/* Row 2: Post | Grade | Mode */}
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

          {/* Row 3: Timing Type | Shift */}
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

        <div style={{ padding:'12px 24px 18px', borderTop:'1px solid #f3f4f6',
          display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={() => { onApply({ ...EMPTY_FILTERS }); onClose(); }}
            style={{ padding:'8px 20px', border:'1.5px solid #d1d5db', borderRadius:8,
              background:'white', color:'#374151', fontSize:14, fontWeight:600, cursor:'pointer' }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#9ca3af';e.currentTarget.style.background='#f9fafb';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='white';}}>
            {L('रिसेट','Reset')}
          </button>
          <button onClick={() => { onApply(local); onClose(); }}
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
   Monthly Summary Report
═══════════════════════════════════════════════════════════════ */
const MonthlySummaryReport = () => {
  const [searchParams] = useSearchParams();
  const { language }   = useLanguage();
  const { settings }   = useSettings();
  const { filteredEmployees: employees, shifts } = useData();
  const fd             = useDateFormat();
  const L = (np, en)   => language === 'np' ? np : en;

  const now     = getNepalNow();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(getNepalTodayISO());

  const urlYear  = parseInt(searchParams.get('year'));
  const urlMonth = parseInt(searchParams.get('month'));

  // Always default to current running month
  const initYM = () => ({
    year:  useNP ? (todayBS?.year  || now.getFullYear())  : now.getFullYear(),
    month: useNP ? (todayBS?.month || now.getMonth() + 1) : now.getMonth() + 1,
  });

  const init   = initYM();
  const currentFY = getCurrentFiscalYear(settings.fiscalYears || []);

  const { isEmployee, currentUser } = useAuth();
  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';

  const [year,        setYear]        = useState(init.year);
  const [month,       setMonth]       = useState(init.month);
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [search,      setSearch]      = useState('');
  const [showSearch,  setShowSearch]  = useState(false);
  const [filters,     setFilters]     = useState({ ...EMPTY_FILTERS, staffId: myEmpId });
  const [staffStatus, setStaffStatus] = useState('working'); // 'working' | 'notworking'

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let apiUrl;
      if (useNP) {
        const startAD = bsToAD(year, month, 1);
        const endAD   = bsToAD(year, month, getBSDays(year, month));
        if (startAD && endAD) {
          apiUrl = `/attendance/half-monthly?startDate=${isoDate(startAD)}&endDate=${isoDate(endAD)}`;
        }
      }
      if (!apiUrl) {
        const lastDay = new Date(year, month, 0).getDate();
        const pad = n => String(n).padStart(2,'0');
        const s = `${year}-${pad(month)}-01`;
        const e = `${year}-${pad(month)}-${pad(lastDay)}`;
        apiUrl = `/attendance/half-monthly?startDate=${s}&endDate=${e}`;
      }
      apiUrl += `&active=${staffStatus === 'notworking' ? 'false' : 'true'}`;
      setData(await api.get(apiUrl));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year, month, useNP, staffStatus]);

  useEffect(() => { load(); }, [load]);

  const period = data?.period;
  const stats  = data?.allStats || [];

  /* Branch short name lookup — camelCase shortName from settings */
  const branchShortMap = React.useMemo(() => {
    const m = {};
    (settings.branches||[]).forEach(b => {
      const sn = b.shortName || b.short_name;
      if (b.name && sn) m[b.name.toLowerCase().trim()] = sn;
    });
    return m;
  }, [settings.branches]);
  const resolveShort = r =>
    branchShortMap[(r.branch||'').toLowerCase().trim()]
    || (r.branchShort && r.branchShort !== '—' ? r.branchShort : null)
    || r.branch || '—';

  /* ── Client-side filtering ── */
  const q = search.toLowerCase();
  const rows = stats.filter(r => {
    if (filters.staffId && String(r.id) !== filters.staffId) return false;
    const emp = employees.find(e => String(e.id) === String(r.id));
    if (emp) {
      if (filters.branch     && emp.branch      !== filters.branch)      return false;
      if (filters.dept       && emp.department  !== filters.dept)        return false;
      if (filters.post       && emp.position    !== filters.post)        return false;
      if (filters.grade      && emp.grade       !== filters.grade)       return false;
      if (filters.mode       && emp.mode        !== filters.mode)        return false;
      if (filters.timingType && emp.timingType  !== filters.timingType)  return false;
      if (filters.shift      && emp.shift       !== filters.shift)       return false;
    }
    if (q && !(r.fullName||'').toLowerCase().includes(q) &&
             !(r.position||'').toLowerCase().includes(q) &&
             !(r.department||'').toLowerCase().includes(q)) return false;
    return true;
  });

  const activeFilterCount = Object.entries(filters).filter(([k,v]) => k !== '_status' && Boolean(v)).length;

  const periodLabel = () => {
    const mn     = useNP ? (BS_MONTHS_NP[month-1] || '') : MONTHS_EN[month-1];
    const yr     = settings.nepaliDigits ? toNepaliDigits(year) : String(year);
    const calStr = useNP ? ' BS' : '';
    return `${mn} ${yr}${calStr}`;
  };

  const Pill = ({ v, bg, color }) => v > 0
    ? <span style={{ background:bg, color, borderRadius:8, padding:'1px 9px', fontSize:12, fontWeight:800 }}>{v}</span>
    : <span style={{ color:'#d1d5db' }}>0</span>;

  const Rate = ({ v }) => {
    const bg    = v>=90?'#d1fae5':v>=75?'#fef3c7':'#fee2e2';
    const color = v>=90?'#065f46':v>=75?'#92400e':'#991b1b';
    return <span style={{ background:bg, color, borderRadius:8, padding:'1px 9px', fontSize:12, fontWeight:800 }}>{v}%</span>;
  };

  const rptTitle = 'Monthly Summary Report';
  const rptSub = () => periodLabel();

  const handlePrint = () => {
    if (!rows.length) return;
    const dataRows = rows.map((r, i) => `<tr>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${i+1}</td>
      <td style="padding:4px 6px;border:1px solid #dedede">${r.fullName}</td>
      <td style="padding:4px 6px;border:1px solid #dedede">${(settings.posts||[]).find(p=>p.name===r.position)?.shortName||r.postShort||abbrev(r.position)}</td>
      <td style="padding:4px 6px;border:1px solid #dedede">${(settings.departments||[]).find(d=>d.name===r.department)?.shortName||r.deptShort||abbrev(r.department)}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;color:#7c3aed;font-weight:700">${resolveShort(r)}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.totalWorkingDays}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.weekendDays||0}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.weekendPresent||0}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.holidayDays||0}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.holidayPresent||0}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.leaveDays}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.officialVisitDays||0}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;color:#065f46;font-weight:700">${r.presentDays}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;color:#991b1b;font-weight:700">${r.absentDays}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;font-family:monospace">${r.workedHrsFormatted||'0:00'}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;font-family:monospace">${r.lackHrsFormatted||'0:00'}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.lateCount}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.earlyCount}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.attendanceRate}%</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.otFormatted||''}</td>
    </tr>`).join('');
    const contentHtml = `<table style="border-collapse:collapse;width:100%;font-size:10px">
      <thead><tr>
        ${['SN','Staff','Post','Dept','Branch','Total','Wkd Day','Wkd Pres','Hol Day','Hol Pres','Leave','OV','Present','Absent','Worked Hr','Lack Hr','Late','Early','Att%','OT']
          .map(h=>`<th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">${h}</th>`).join('')}
      </tr></thead>
      <tbody>${dataRows}</tbody>
    </table>`;
    openPrintWindow(buildPrintDoc({ settings, language, reportTitle: rptTitle, reportSub: rptSub(), contentHtml, isLandscape: true }), true);
  };

  const exportCSV = () => {
    if (!rows.length) return;
    const headers = ['SN','Staff','Post','Department','Branch','Total',
      'Weekend Day','Weekend Present','Holiday Day','Holiday Present',
      'Leave','Official Visit','Present','Absent',
      'Worked Hr','Lack Hr','Late In','Early Out','Att. %','OT'];
    const dataRows = rows.map((r, i) => [
      i+1, r.fullName, r.position||'', r.department||'', resolveShort(r), r.totalWorkingDays,
      r.weekendDays||0, r.weekendPresent||0,
      r.holidayDays||0, r.holidayPresent||0,
      r.leaveDays, r.officialVisitDays||0,
      r.presentDays, r.absentDays,
      r.workedHrsFormatted||'0:00', r.lackHrsFormatted||'0:00',
      r.lateCount, r.earlyCount, `${r.attendanceRate}%`, r.otFormatted||'',
    ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    downloadCSV(getExcelHeaderRows(settings, language, rptTitle, rptSub()) + headers.join(',') + '\n' + dataRows,
      `MonthlySummary_${period?.startDate||''}_${period?.endDate||''}.csv`);
  };

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            📊 {L('मासिक सारांश रिपोर्ट','Monthly Summary Report')}
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
          <ViewMonthlyBtn year={year} month={month} useNP={useNP}
            currentPath="/attendance/reports/monthly/summary" />
        </div>
      </div>

      {/* ── Period selector + controls (right-aligned) ── */}
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

        {/* Working / Not Working toggle */}
        <div style={{ display:'flex',gap:0,border:'1px solid #d1d5db',borderRadius:8,overflow:'hidden' }}>
          {[['working',L('कार्यरत','Working')],['notworking',L('अवकाश','Not Working')]].map(([v,label])=>(
            <button key={v}
              onClick={() => { setStaffStatus(v); setFilters(p => ({ ...p, staffId:'' })); }}
              style={{ padding:'5px 14px',border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
                background:staffStatus===v?'#1a56db':'white',
                color:staffStatus===v?'white':'#374151',transition:'background .15s' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Staff selector */}
        <span style={{ fontSize:13,fontWeight:600,color:'#374151',whiteSpace:'nowrap' }}>
          {L('कर्मचारी','Staff')} :
        </span>
        <select className="form-control" style={{ width:220,height:36,fontSize:13 }}
          value={filters.staffId || ''}
          onChange={e => setFilters(p => ({ ...p, staffId: e.target.value }))}>
          <option value="">— {L('सबै कर्मचारी','All Staff')} —</option>
          {(data?.employees || []).map(e => (
            <option key={e.id} value={String(e.id)}>{e.fullName}</option>
          ))}
        </select>

        {/* Advance Search button */}
        <button onClick={() => setShowSearch(true)}
          style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'0 14px',height:36,
            background: activeFilterCount>0 ? '#ede9fe' : '#f5f3ff',
            border: `1.5px solid ${activeFilterCount>0 ? '#7c3aed' : '#c4b5fd'}`,
            color: activeFilterCount>0 ? '#5b21b6' : '#6d28d9',
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

      {/* ── Table ── */}
      {!loading && data && (
        <div style={{ overflowX:'auto', borderRadius:8,
          border:'1px solid #dedede', boxShadow:'0 1px 3px rgba(0,0,0,.07)' }}>
          <table style={{ borderCollapse:'collapse', width:'100%' }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', minWidth:34 }}>SN</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', textAlign:'left', minWidth:150 }}>
                  {L('कर्मचारी','Staff')}
                </th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede' }}>{L('पद','Post')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede' }}>{L('विभाग','Dept.')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', color:'#7c3aed' }}>{L('शाखा','Branch')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede' }}>{L('कार्य दिन','Total')}</th>
                <th colSpan={2} style={{ ...TH_WKD }}>{L('विकेन्ड','Weekend')}</th>
                <th colSpan={2} style={{ ...TH_HOL }}>{L('सार्वजनिक बिदा','Holiday')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', background:'#faf5ff', color:'#5b21b6' }}>{L('बिदा','Leave')}</th>
                <th rowSpan={2} style={{ ...TH_OV, borderBottom:'2px solid #dedede' }}>{L('कार्यालय भ्रमण','Official Visit')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', background:'#f0fdf4', color:'#065f46' }}>{L('उपस्थित','Present')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', background:'#fff5f5', color:'#991b1b' }}>{L('अनुपस्थित','Absent')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', color:'#0369a1' }}>{L('काम घण्टा','Worked Hr')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', color:'#dc2626' }}>{L('कम घण्टा','Lack Hr')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', color:'#dc2626' }}>{L('ढिला','Late In')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', color:'#d97706' }}>{L('चाँडो','Early Out')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede' }}>{L('हाजिरी %','Att. %')}</th>
                <th rowSpan={2} style={{ ...TH_BASE, borderBottom:'2px solid #dedede', color:'#059669' }}>OT</th>
              </tr>
              <tr>
                <th style={TH_SUB}>{L('दिन','Day')}</th>
                <th style={TH_SUB}>{L('उपस्थित','Present')}</th>
                <th style={TH_HOL_SUB}>{L('दिन','Day')}</th>
                <th style={TH_HOL_SUB}>{L('उपस्थित','Present')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={20} style={{ textAlign:'center',padding:'40px',color:'#9ca3af',fontSize:13 }}>
                    {search || activeFilterCount > 0
                      ? L('कुनै कर्मचारी भेटिएन','No staff found matching the filters')
                      : L('डेटा छैन','No data')}
                  </td>
                </tr>
              )}
              {rows.map((r, idx) => (
                <tr key={r.id}
                  style={{ background: idx%2===0 ? 'white' : '#f3f4f6' }}
                  onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
                  onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?'white':'#f3f4f6'}>
                  <td style={{ ...TD_BASE, background:'#efefef', fontWeight:700, color:'#6b7280', borderRight:'1px solid #dedede' }}>
                    {idx+1}
                  </td>
                  <td style={{ ...TD_BASE, textAlign:'left', color:'#1f2937' }}>{r.fullName}</td>
                  <td style={{ ...TD_BASE, color:'#1f2937', textAlign:'left' }} title={r.position}>
                    {(settings.posts||[]).find(p=>p.name===r.position)?.shortName || r.postShort || r.position || '—'}
                  </td>
                  <td style={{ ...TD_BASE, color:'#1f2937', textAlign:'left' }} title={r.department}>
                    {(settings.departments||[]).find(d=>d.name===r.department)?.shortName || r.deptShort || r.department || '—'}
                  </td>
                  <td style={{ ...TD_BASE, color:'#1f2937', textAlign:'left' }} title={r.branch}>
                    {resolveShort(r)}
                  </td>
                  <td style={{ ...TD_BASE, fontWeight:700 }}>{r.totalWorkingDays}</td>
                  <td style={{ ...TD_BASE, color:'#6b7280', fontWeight:700 }}>{r.weekendDays||0}</td>
                  <td style={TD_BASE}><Pill v={r.weekendPresent||0} bg="#f3f4f6" color="#374151" /></td>
                  <td style={{ ...TD_BASE, color:'#92400e', fontWeight:700 }}>{r.holidayDays||0}</td>
                  <td style={TD_BASE}><Pill v={r.holidayPresent||0} bg="#fef3c7" color="#92400e" /></td>
                  <td style={TD_BASE}><Pill v={r.leaveDays} bg="#ede9fe" color="#5b21b6" /></td>
                  <td style={TD_BASE}><Pill v={r.officialVisitDays||0} bg="#dbeafe" color="#1e40af" /></td>
                  <td style={{ ...TD_BASE, background:'#f0fdf4' }}><Pill v={r.presentDays} bg="#d1fae5" color="#065f46" /></td>
                  <td style={{ ...TD_BASE, background: r.absentDays>0?'#fff5f5':'inherit' }}><Pill v={r.absentDays} bg="#fee2e2" color="#991b1b" /></td>
                  <td style={TD_BASE}>
                    {r.workedHrsFormatted && r.workedHrsFormatted !== '0:00'
                      ? <span style={{ color:'#0369a1', fontWeight:700 }}>{r.workedHrsFormatted}</span>
                      : <span style={{ color:'#d1d5db' }}>0:00</span>}
                  </td>
                  <td style={TD_BASE}>
                    {r.lackHrsFormatted && r.lackHrsFormatted !== '0:00'
                      ? <span style={{ color:'#dc2626', fontWeight:700 }}>{r.lackHrsFormatted}</span>
                      : <span style={{ color:'#d1d5db' }}>0:00</span>}
                  </td>
                  <td style={TD_BASE}>
                    {r.lateCount > 0
                      ? <span style={{ color:'#dc2626', fontWeight:700 }}>{r.lateCount}</span>
                      : <span style={{ color:'#d1d5db' }}>0</span>}
                  </td>
                  <td style={TD_BASE}>
                    {r.earlyCount > 0
                      ? <span style={{ color:'#d97706', fontWeight:700 }}>{r.earlyCount}</span>
                      : <span style={{ color:'#d1d5db' }}>0</span>}
                  </td>
                  <td style={TD_BASE}><Rate v={r.attendanceRate} /></td>
                  <td style={TD_BASE}>
                    {r.otFormatted && r.otFormatted !== '—'
                      ? <span style={{ color:'#059669', fontWeight:700 }}>{r.otFormatted}</span>
                      : <span style={{ color:'#d1d5db' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ marginTop:8, fontSize:12, color:'#9ca3af', textAlign:'right' }}>
          {rows.length} {L('कर्मचारी देखाइएको','staff shown')}
          {(search || activeFilterCount > 0) && ` ${L('(फिल्टर गरिएको)','(filtered)')}`}
        </div>
      )}

      {/* ── Advance Search Modal ── */}
      {showSearch && (
        <AdvanceSearchModal
          filters={filters}
          onApply={f => { setFilters({ ...f, staffId: myEmpId || f.staffId }); setStaffStatus(f._status || 'working'); }}
          onClose={() => setShowSearch(false)}
          L={L}
          settings={settings}
          employees={employees}
          shifts={shifts}
        />
      )}
    </div>
  );
};

export default MonthlySummaryReport;
