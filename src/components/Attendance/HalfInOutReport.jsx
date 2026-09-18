import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import ViewHalfMonthlyBtn from './ViewHalfMonthlyBtn.jsx';
import SearchableCheckSelect from '../Common/SearchableCheckSelect.jsx';
import Avatar from '../Common/Avatar.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, toNepaliDigits, getNepalNow, getNepalTodayISO, getCurrentFiscalYear } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, downloadBlob } from '../../utils/printHelper.js';
import LoadingIndicator from '../Common/LoadingIndicator.jsx';
import ExcelJS from 'exceljs';

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const abbrevPost = (name) => {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words.map(w => w[0].toUpperCase()).join('') : name.slice(0, 5);
};

const fmtTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const leaveAbbrev = (name) => {
  if (!name) return 'L';
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words.map(w => w[0].toUpperCase()).join('') : name.slice(0,2).toUpperCase();
};

/* ── Advance Search Filters ──────────────────────────────── */
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

  const Lbl  = ({ text }) => <div style={{ fontSize:13,fontWeight:600,color:'#111827',marginBottom:6 }}>{text}</div>;
  const Field = ({ label, children }) => <div style={{ position:'relative',overflow:'visible' }}><Lbl text={label}/>{children}</div>;

  return (
    <div className="modal-overlay">
      <div style={{ background:'white',borderRadius:16,width:'min(960px,96vw)',
        boxShadow:'0 20px 60px rgba(0,0,0,.18)',overflow:'visible',position:'relative' }}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'16px 22px 12px',background:'#ffffff',borderBottom:'1px solid #f3f4f6',
          display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <span style={{ fontSize:16,fontWeight:700,color:'#1e40af' }}>{L('विस्तृत खोज','Advance Search')}</span>
          <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:'#6b7280',fontSize:20,lineHeight:1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding:'16px 22px',display:'flex',flexDirection:'column',gap:14 }}>

          {/* Row 0: Status */}
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

          {/* Row 1: Staff | Branch | Department */}
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14 }}>
            <Field label={L('कर्मचारी','Staff')}>
              <SearchableCheckSelect options={empOpts} value={local.staffId} showAvatar onChange={v=>set('staffId',v)} allLabel={L('All Staff','All Staff')} />
            </Field>
            <Field label={L('शाखा','Branch')}>
              <SearchableCheckSelect options={branches} value={local.branch} onChange={v=>set('branch',v)} allLabel={L('All Branches','All Branches')} />
            </Field>
            <Field label={L('विभाग','Dept.')}>
              <SearchableCheckSelect options={depts} value={local.dept} onChange={v=>set('dept',v)} allLabel={L('All Depts','All Depts')} />
            </Field>
          </div>

          {/* Row 2: Post | Grade | Mode */}
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14 }}>
            <Field label={L('पद','Post')}>
              <SearchableCheckSelect options={posts} value={local.post} onChange={v=>set('post',v)} allLabel={L('All Posts','All Posts')} />
            </Field>
            <Field label={L('ग्रेड','Grade')}>
              <SearchableCheckSelect options={grades} value={local.grade} onChange={v=>set('grade',v)} allLabel={L('All Grades','All Grades')} />
            </Field>
            <Field label={L('नियुक्ति','Mode')}>
              <SearchableCheckSelect options={modes} value={local.mode} onChange={v=>set('mode',v)} allLabel={L('All Modes','All Modes')} />
            </Field>
          </div>

          {/* Row 3: Timing | Shift */}
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14 }}>
            <Field label={L('टाइमिङ','Timing Type')}>
              <SearchableCheckSelect options={timingTypes} value={local.timingType} onChange={v=>set('timingType',v)} allLabel={L('All Types','All Types')} />
            </Field>
            <Field label={L('सिफ्ट','Shift')}>
              <SearchableCheckSelect options={shiftOpts} value={local.shift} onChange={v=>set('shift',v)} allLabel={L('All Shifts','All Shifts')} />
            </Field>
            <div />
          </div>
        </div>

        {/* Footer */}
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

/* ── Day cell ──────────────────────────────────────────────── */
const ROW_COLORS = { in:'#1a56db', out:'#059669', wh:'#374151', ot:'#7c3aed' };
const ROW_LABEL_NP = { in:'आउने', out:'जाने', wh:'घण्टा', ot:'ओभरटाइम' };

const DayCell = ({ rowKey, day, isWeekend, isHoliday, holidayName, isLast, language }) => {
  const LL = (np, en) => (language === 'np' ? np : en);
  const isWH  = rowKey === 'wh';
  const color = ROW_COLORS[rowKey] || '#374151';
  const cellBg   = isWeekend ? '#f9fafb' : isHoliday ? '#fefce8' : 'white';
  const whBg     = isWeekend ? '#f3f4f6' : isHoliday ? '#fef9e7' : '#f8fafc';
  const bdBottom = isLast ? '2px solid #c5cdd8' : (isWH ? '1px solid #c9d1db' : '1px solid #ebebeb');
  const bdRight  = isWH ? '1px solid #c9d1db' : '1px solid #e5e7eb';
  const bg       = isWH ? whBg : cellBg;
  const offType = day?.offType || null;

  /* IN row — status badge when no punch */
  if (rowKey === 'in' && !day?.timeIn) {
    let badge = null;
    // Public Holiday takes priority over a same-day Leave record — see
    // attendance.js's identical status precedence reasoning.
    if (isHoliday)        badge = <span title={holidayName||LL('सार्वजनिक बिदा','Public Holiday')} style={{ background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 5px',fontSize:10,fontWeight:800,cursor:'help' }}>{LL('साबि','PH')}</span>;
    else if (day?.leave)  badge = <span title={day.leave.name} style={{ background:'#ede9fe',color:'#5b21b6',borderRadius:4,padding:'1px 5px',fontSize:10,fontWeight:800,cursor:'help' }}>{leaveAbbrev(day.leave.name)}</span>;
    else if (day?.visit)  badge = <span title={LL('कार्यालय भ्रमण','Office Visit')} style={{ background:'#dbeafe',color:'#1e40af',borderRadius:4,padding:'1px 5px',fontSize:10,fontWeight:800,cursor:'help' }}>{LL('भ्रमण','OV')}</span>;
    else if (offType)     badge = <span title={LL(offType==='Night Off'?'नाइट अफ':'डे अफ', offType)} style={{ background: offType==='Night Off' ? '#e0e7ff' : '#e5e7eb', color: offType==='Night Off' ? '#4338ca' : '#6b7280', borderRadius:4,padding:'1px 5px',fontSize:10,fontWeight:800,cursor:'help' }}>{offType==='Night Off'?LL('रा.अ','NO'):LL('दि.अ','DO')}</span>;
    else if (isWeekend)   badge = <span title={LL('विकेन्ड','Weekend')} style={{ background:'#e5e7eb',color:'#6b7280',borderRadius:4,padding:'1px 5px',fontSize:10,fontWeight:800,cursor:'help' }}>{LL('ब','W')}</span>;
    return (
      <td style={{ background:bg,borderRight:bdRight,borderBottom:bdBottom,padding:'3px 4px',minWidth:54,textAlign:'center',verticalAlign:'middle' }}>
        {badge || <span style={{ color:'#d1d5db',fontSize:11 }}>—</span>}
      </td>
    );
  }

  let value = null;
  if (rowKey==='in')  value = fmtTime(day?.timeIn);
  if (rowKey==='out') value = fmtTime(day?.timeOut);
  if (rowKey==='wh')  value = day?.workedHrs;
  if (rowKey==='ot')  value = day?.otHrs;
  const warn = rowKey==='in' && day?.punches===1;
  // A half-day leave still has a real punch (the other half was worked) —
  // show the time as usual, with the leave type + "1/2" underneath instead
  // of no indication at all that leave was taken that day.
  const halfLeave = rowKey === 'in' && day?.leave?.halfDay ? day.leave : null;

  return (
    <td style={{ background:bg, borderRight:bdRight, borderBottom:bdBottom,
      padding:'3px 4px', minWidth:54, textAlign:'center', verticalAlign:'middle' }}>
      {value
        ? <div style={{ display:'flex', flexDirection:'column', alignItems:'center', lineHeight:1.15 }}>
            <span style={{
              fontSize:13,
              fontWeight: (rowKey==='in' || rowKey==='wh') ? 700 : 400,
              color: warn ? '#d97706' : (isWH ? '#374151' : color),
            }} title={warn?LL('एकल पन्च मात्र','Single punch only'):''}>
              {value}{warn && <span style={{ fontSize:9, marginLeft:1 }}>⚠</span>}
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

/* ═══════════════════════════════════════════════════════════════ */
const HalfInOutReport = () => {
  const [searchParams] = useSearchParams();
  const { language }   = useLanguage();
  const { settings }   = useSettings();
  const { filteredEmployees: allEmployees, shifts } = useData();
  const fd             = useDateFormat();
  const L = (np, en)   => language === 'np' ? np : en;

  const now     = getNepalNow();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(getNepalTodayISO());
  const urlHalf = parseInt(searchParams.get('half'));

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

  const [year,       setYear]       = useState(useNP?(todayBS?.year||now.getFullYear()):now.getFullYear());
  const [month,      setMonth]      = useState(useNP?(todayBS?.month||now.getMonth()+1):now.getMonth()+1);
  const [half,       setHalf]       = useState(urlHalf||(now.getDate()<=15?1:2));
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [search,     setSearch]     = useState('');
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
  const [filters,    setFilters]    = useState({ ...EMPTY_FILTERS, staffId: myEmpId });

  const currentFY = getCurrentFiscalYear(settings.fiscalYears||[]);

  /* Branch short-name from settings */
  const branchShortMap = useMemo(() => {
    const m = {};
    (settings.branches||[]).forEach(b => { if (b.name&&b.short_name) m[b.name.toLowerCase().trim()]=b.short_name; });
    return m;
  }, [settings.branches]);

  const resolveShort = (emp) =>
    branchShortMap[(emp.branch||'').toLowerCase().trim()] || emp.branchShort || emp.branch || '—';

  const staffStatus = filters._status || 'working';

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const activeParam = staffStatus === 'notworking' ? 'false' : 'true';
      let apiUrl;
      if (useNP) {
        const s=half===1?1:16, e=half===1?15:getBSDays(year,month);
        const sAD=bsToAD(year,month,s), eAD=bsToAD(year,month,e);
        if (sAD&&eAD) apiUrl=`/attendance/half-in-out?startDate=${isoDate(sAD)}&endDate=${isoDate(eAD)}&active=${activeParam}&orgScope=1`;
      }
      if (!apiUrl) apiUrl=`/attendance/half-in-out?year=${year}&month=${month}&half=${half}&active=${activeParam}&orgScope=1`;
      setData(await api.get(apiUrl));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year,month,half,useNP,staffStatus]);

  useEffect(() => { load(); }, [load]);

  const period  = data?.period;
  const dates   = data?.dates  || [];
  const allEmps = data?.employees || [];

  /* Client-side filtering */
  const q = search.toLowerCase();
  const employees = allEmps.filter(emp => {
    if (filters.staffId  && String(emp.id)!==filters.staffId)       return false;
    if (filters.branch   && emp.branch!==filters.branch)             return false;
    if (filters.dept     && emp.department!==filters.dept)           return false;
    if (filters.post     && emp.position!==filters.post)             return false;
    if (filters.grade    && emp.grade!==filters.grade)               return false;
    if (filters.mode     && emp.mode!==filters.mode)                 return false;
    if (filters.timingType && emp.timingType!==filters.timingType)   return false;
    if (filters.shift    && emp.shift!==filters.shift)               return false;
    if (q && !(emp.fullName||'').toLowerCase().includes(q) &&
             !(emp.postShort||'').toLowerCase().includes(q) &&
             !(emp.deptShort||'').toLowerCase().includes(q)) return false;
    return true;
  });

  const activeFilterCount = Object.entries(filters).filter(([k,v])=>k!=='_status'&&v!=='').length;
  const maxDays = Math.max(...dates.map((_,i)=>i+1), 31);

  const periodLabel = () => {
    const mn = useNP?(BS_MONTHS_NP[month-1]||''):MONTHS_EN[month-1];
    const yr = settings.nepaliDigits?toNepaliDigits(year):String(year);
    return `${mn} ${yr}${useNP?' BS':''} · ${half===1?L('पहिलो अर्ध (१–१५)','1st Half (1–15)'):L('दोस्रो अर्ध (१६–अन्त)','2nd Half (16–End)')}`;
  };

  const rptTitle = 'Half Monthly IN & OUT Report';
  const rptSub = () => periodLabel();

  /* Mirrors the on-screen 4-stacked-row-per-employee matrix exactly (one
     column per day, SN/Staff merged vertically across IN/OUT/WH/OT rows,
     Total OT only populated on its own row) — same structure as
     exportExcel below, just as an HTML table. WH values are bold throughout
     (day cells and the Total WH... — Half has no Total WH column, only
     per-day WH), matching the on-screen bold WH weight. */
  const handlePrint = () => {
    if (!employees.length) return;
    const dayHeaders = dates.map(({ dayNum, dayKey, isWeekend, isHoliday }, idx) => {
      const n = useNP ? (idx + (half===1?1:16)) : dayNum;
      const bg = isWeekend ? '#f1f5f9' : isHoliday ? '#fef3c7' : '#efefef';
      return `<th style="padding:2px 3px;border:1px solid #dedede;background:${bg};font-size:8px">${n}<br/>${dayKey.slice(0,3)}</th>`;
    }).join('');
    const printRows = [
      { key:'in',  label:'IN',  color:'#1a56db' }, { key:'out', label:'OUT', color:'#059669' },
      { key:'wh',  label:'WH',  color:'#374151' }, { key:'ot',  label:'OT',  color:'#7c3aed' },
    ];
    const dataRows = employees.map((e,i) => {
      const post = e.postShort || abbrevPost(e.position) || '—';
      const dept = e.deptShort || abbrevPost(e.department) || '—';
      const staffCellHtml = `
        <div style="font-weight:700">${e.fullName}</div>
        <div style="font-size:7px;color:#6b7280">${post} | ${dept}</div>
        <div style="font-size:7px;color:#6b7280">Branch : ${resolveShort(e)}</div>`;
      return printRows.map((rowDef, rIdx) => {
        const isFirst = rIdx === 0;
        const isLast  = rIdx === printRows.length - 1;
        const bdBottom = isLast ? '2px solid #cbd5e1' : '1px solid #f1f5f9';
        const dayCells = dates.map(d => {
          const day = e.days?.[d.date];
          let value = '';
          if (rowDef.key === 'in')  value = fmtTime(day?.timeIn)  || '';
          if (rowDef.key === 'out') value = fmtTime(day?.timeOut) || '';
          if (rowDef.key === 'wh')  value = day?.workedHrs || '';
          if (rowDef.key === 'ot')  value = day?.otHrs || '';
          const bold = rowDef.key === 'wh' ? 'font-weight:700;' : '';
          return `<td style="padding:1px 2px;border-right:1px solid #f1f5f9;border-bottom:${bdBottom};text-align:center;font-size:8px;${bold}">${value}</td>`;
        }).join('');
        return `<tr>
          ${isFirst ? `<td rowspan="4" style="padding:2px 4px;border:1px solid #dedede;border-bottom:2px solid #cbd5e1;text-align:center;vertical-align:middle">${i+1}</td>
          <td rowspan="4" style="padding:2px 5px;border:1px solid #dedede;border-bottom:2px solid #cbd5e1;vertical-align:middle">${staffCellHtml}</td>` : ''}
          <td style="padding:1px 5px;border:1px solid #dedede;border-bottom:${bdBottom};text-align:center;color:${rowDef.color};font-weight:700;font-size:8px">${L(ROW_LABEL_NP[rowDef.key], rowDef.label)}</td>
          ${dayCells}
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
        <th style="padding:3px 4px;border:1px solid #dedede;background:#f0fdf4;color:#059669">Total OT</th>
      </tr></thead>
      <tbody>${dataRows}</tbody>
    </table>`;
    openPrintWindow(buildPrintDoc({ settings, language, reportTitle: rptTitle, reportSub: rptSub(), contentHtml, isLandscape: true, branch: printBranch }), true);
  };

  /* Mirrors the on-screen 4-row-per-employee matrix, same as
     MonthlyInOutReport's exportExcel — one column per day, IN/OUT/WH/OT
     stacked, Staff cell carries Name/Post·Dept/Branch on 3 wrapped lines. */
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
    const dayCols = dates.map((d, idx) => useNP ? (idx + (half===1?1:16)) : d.dayNum);
    const dayDows = dates.map(d => d.dayKey.slice(0, 3));
    const nCols = FIXED_COLS.length + dayCols.length + 1;
    const lastCol = nCols;
    const ROWS_ = [
      { key:'in',  label:'IN'  }, { key:'out', label:'OUT' },
      { key:'wh',  label:'WH'  }, { key:'ot',  label:'OT'  },
    ];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Half Monthly IN-OUT');

    const thin  = { style: 'thin',   color: { argb: 'FFDEDEDE' } };
    const light = { style: 'thin',   color: { argb: 'FFEBEBEB' } };
    const heavy = { style: 'medium', color: { argb: 'FFC5CDD8' } };

    [companyName, [companyAddr, companyPhone].filter(Boolean).join('  |  '), rptTitle,
      rptSub() + (period ? `   (${period.startDate} to ${period.endDate})` : ''), ''
    ].forEach((text, i) => {
      const row = ws.addRow([text]);
      ws.mergeCells(row.number, 1, row.number, lastCol);
      row.getCell(1).font = i === 0 ? { bold: true, size: 13 } : i === 2 ? { bold: true, size: 12 } : { size: 10, color: { argb: 'FF6B7280' } };
    });
    const headerOffset = ws.rowCount;

    const hdr1 = ws.addRow([...FIXED_COLS, ...dayCols, 'Total OT']);
    const hdr2 = ws.addRow([...FIXED_COLS.map(() => ''), ...dayDows, '']);
    [1, 2, 3, lastCol].forEach(c => {
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

    employees.forEach((e, i) => {
      const post   = e.postShort || abbrevPost(e.position) || '—';
      const dept   = e.deptShort || abbrevPost(e.department) || '—';
      const branch = resolveShort(e);
      const staffCell = `${e.fullName}\n${post} | ${dept}\nBranch : ${branch}`;
      const blockStartRow = ws.rowCount + 1;
      const addedRows = [];

      ROWS_.forEach((rowDef, rIdx) => {
        const cells = [
          rIdx === 0 ? i + 1 : '', rIdx === 0 ? staffCell : '', rowDef.label,
          ...dates.map(d => {
            const day = e.days?.[d.date];
            if (rowDef.key === 'in')  return fmtTime(day?.timeIn)  || '';
            if (rowDef.key === 'out') return fmtTime(day?.timeOut) || '';
            if (rowDef.key === 'wh')  return day?.workedHrs || '';
            if (rowDef.key === 'ot')  return day?.otHrs || '';
            return '';
          }),
          rowDef.key === 'ot' ? (e.eligibleForOt ? (e.totalApprovedOTFormatted || '') : '') : '',
        ];
        addedRows.push(ws.addRow(cells));
      });

      [1, 2].forEach(c => ws.mergeCells(blockStartRow, c, blockStartRow + ROWS_.length - 1, c));
      ws.getCell(blockStartRow, 2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

      addedRows.forEach((row, rIdx) => {
        const isLast = rIdx === ROWS_.length - 1;
        const isWH   = ROWS_[rIdx].key === 'wh';
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          if (colNum === 2) return;
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = { right: colNum <= 3 ? thin : { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: isLast ? heavy : light };
          // Worked Hours row — day values bold, matching the on-screen matrix.
          if (isWH && colNum > 3) cell.font = { bold: true, size: 9 };
        });
        row.getCell(2).border = { right: thin, bottom: isLast ? heavy : light };
        row.getCell(3).font = { bold: true, size: 9.5,
          color: { in: 'FF1A56DB', out: 'FF059669', wh: 'FF374151', ot: 'FF7C3AED' }[ROWS_[rIdx].key] };
      });
    });

    ws.columns = [
      { width: 5 }, { width: 28 }, { width: 6 },
      ...dayCols.map(() => ({ width: 7 })),
      { width: 9 },
    ];
    ws.views = [{ state: 'frozen', ySplit: headerOffset + 2 }];

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `HalfMonthlyInOut_${period?.startDate || ''}.xlsx`);
  };

  /* Table header styles — same palette as Monthly's (CLAUDE.md DataGrid
     Standard: #efefef/#374151/#dedede), not the earlier slate-blue one-off */
  const TH = { background:'#efefef',color:'#374151',fontWeight:700,fontSize:12.5,
    padding:'4px 8px',borderRight:'1px solid #dedede',borderBottom:'1px solid #dedede',
    textAlign:'center',whiteSpace:'nowrap',userSelect:'none',position:'sticky',top:0,zIndex:3 };
  const thDay = (isWknd,isHol) => ({
    ...TH,
    background:isWknd?'#e5e7eb':isHol?'#fef3c7':'#efefef',
    color:isWknd?'#9ca3af':isHol?'#92400e':'#374151',
    borderBottom:'none', paddingBottom:2,
  });
  const thDow = (isWknd,isHol) => ({
    ...TH,
    background:isWknd?'#f3f4f6':isHol?'#fef9e7':'#f5f5f5',
    color:isWknd?'#d1d5db':isHol?'#b45309':'#4b5563',
    paddingTop:2, fontSize:10, fontWeight:600,
  });
  const TD_FIX = { padding:'0 8px',fontSize:12.5,fontWeight:400,borderRight:'1px solid #dedede',
    verticalAlign:'middle',whiteSpace:'nowrap' };

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🔄 {L('अर्ध-मासिक IN & OUT रिपोर्ट','Half Monthly IN & OUT Report')}</h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY&&<span style={{ background:'#eff6ff',color:'#1a56db',borderRadius:6,padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>{currentFY.name}</span>}
            {periodLabel()}
            {period&&<span style={{ marginLeft:8,fontSize:11,color:'#9ca3af' }}>{fd(period.startDate)} → {fd(period.endDate)}</span>}
          </p>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <button onClick={handlePrint}
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#eff6ff',border:'1px solid #93c5fd',color:'#1d4ed8',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            🖨️ Print
          </button>
          <button onClick={exportExcel}
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#f0fdf4',border:'1px solid #86efac',color:'#15803d',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            📥 Export
          </button>
          <ViewHalfMonthlyBtn year={year} month={month} half={half} useNP={useNP} currentPath="/attendance/reports/half-monthly/in-out" />
        </div>
      </div>

      {/* ── Controls bar ── */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap' }}>
        <select className="form-control" style={{ width:useNP?115:85,height:36,fontSize:13 }}
          value={year} onChange={e=>setYear(+e.target.value)}>
          {useNP
            ?[todayBS?.year-1,todayBS?.year,todayBS?.year+1].filter(Boolean).map(y=>(
                <option key={y} value={y}>{settings.nepaliDigits?toNepaliDigits(y):y} BS</option>))
            :[now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1].map(y=>(
                <option key={y} value={y}>{y}</option>))}
        </select>
        <select className="form-control" style={{ width:useNP?120:140,height:36,fontSize:13 }}
          value={month} onChange={e=>setMonth(+e.target.value)}>
          {useNP?BS_MONTHS_NP.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
                :MONTHS_EN.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
        </select>
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

        {/* Advance Search */}
        <button onClick={()=>setShowSearch(true)}
          style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'0 14px',height:36,
            background:activeFilterCount>0?'#ede9fe':'#f5f3ff',
            border:`1.5px solid ${activeFilterCount>0?'#7c3aed':'#c4b5fd'}`,
            color:activeFilterCount>0?'#5b21b6':'#6d28d9',
            borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
          </svg>
          {L('विस्तृत खोज','Advance Search')}
          {activeFilterCount>0&&<span style={{ background:'#1a56db',color:'white',borderRadius:'50%',width:18,height:18,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800 }}>{activeFilterCount}</span>}
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

      {error&&<div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#991b1b',fontWeight:600 }}>❌ {error}</div>}
      {loading && <LoadingIndicator />}

      {/* ── Matrix Table ── */}
      {!loading&&data&&(
        <div style={{ overflowX:'auto',borderRadius:8,border:'1px solid #dedede',boxShadow:'0 1px 3px rgba(0,0,0,.07)' }}>
          <table style={{ borderCollapse:'collapse',width:'100%' }}>
            <thead>
              {/* Row 1 — day numbers */}
              <tr>
                <th style={{ ...TH,minWidth:34,position:'sticky',left:0,zIndex:4 }}>SN</th>
                <th style={{ ...TH,textAlign:'left',minWidth:160,position:'sticky',left:34,zIndex:4 }}>{L('कर्मचारी','Staff')}</th>
                <th style={{ ...TH,minWidth:54 }}></th>
                {dates.map(({date,dayNum,isWeekend,isHoliday},dateIdx) => {
                  const dispNum = useNP ? (dateIdx+(half===1?1:16)) : dayNum;
                  return <th key={date} style={thDay(isWeekend,isHoliday)}>{settings.nepaliDigits?toNepaliDigits(dispNum):dispNum}</th>;
                })}
                <th rowSpan={2} style={{ ...TH, background:'#f0fdf4', color:'#059669', borderLeft:'2px solid #c9d1db', minWidth:64 }}>
                  {L('कुल OT','Total OT')}
                </th>
              </tr>
              {/* Row 2 — day abbreviations (always English) */}
              <tr>
                <th style={{ ...TH,left:0,position:'sticky',zIndex:4 }}></th>
                <th style={{ ...TH,left:34,position:'sticky',zIndex:4 }}></th>
                <th style={TH}></th>
                {dates.map(({date,dayKey,isWeekend,isHoliday}) => (
                  <th key={date} style={thDow(isWeekend,isHoliday)}>
                    {dayKey.slice(0,3)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {employees.length===0&&(
                <tr><td colSpan={4+dates.length} style={{ textAlign:'center',padding:'40px',color:'#9ca3af',fontSize:13 }}>
                  {L('कुनै कर्मचारी भेटिएन','No staff found')}
                </td></tr>
              )}

              {employees.map((emp,idx) => (
                ['in','out','wh','ot'].map((rowKey,rIdx) => {
                  const isLast = rIdx===3;
                  const rowColor = ROW_COLORS[rowKey];
                  return (
                    <tr key={`${emp.id}-${rowKey}`}
                      style={{ background:rowKey==='wh'?'#fafafa':rowKey==='ot'?'#fdfcff':'white' }}>

                      {rIdx===0&&(
                        <>
                          <td rowSpan={4} style={{ ...TD_FIX,background:'#efefef',color:'#6b7280',
                            textAlign:'center',position:'sticky',left:0,zIndex:1,borderBottom:'2px solid #c5cdd8' }}>
                            {idx+1}
                          </td>
                          <td rowSpan={4} style={{ ...TD_FIX,color:'#1f2937',
                            position:'sticky',left:34,background:'white',zIndex:1,
                            borderBottom:'2px solid #c5cdd8',minWidth:160,whiteSpace:'normal',padding:'6px 8px' }}>
                            <span style={{ display:'flex', alignItems:'flex-start', gap:6 }}>
                              <Avatar photo={emp.profilePhoto} name={emp.fullName} size={20} />
                              <span>
                                <div style={{ fontWeight:600 }}>{emp.fullName}</div>
                                <div style={{ fontSize:11, color:'#6b7280' }}>
                                  {emp.postShort||abbrevPost(emp.position)||'—'} | {emp.deptShort||abbrevPost(emp.department)||'—'}
                                </div>
                                <div style={{ fontSize:11, color:'#6b7280' }}>{L('शाखा','Branch')} : {resolveShort(emp)}</div>
                              </span>
                            </span>
                          </td>
                        </>
                      )}

                      {/* Row label — same plain colored-text style as Monthly's LabelCell, no pill background */}
                      <td style={{ background:'#f9fafb',borderRight:'1px solid #dedede',
                        borderBottom:isLast?'2px solid #c5cdd8':'1px solid #ebebeb',
                        padding:'3px 8px',textAlign:'center',verticalAlign:'middle',width:52 }}>
                        <span style={{ color:rowColor, fontSize:12, fontWeight:700 }}>
                          {L(ROW_LABEL_NP[rowKey], rowKey.toUpperCase())}
                        </span>
                      </td>

                      {/* Day cells — isWeekend prefers this employee's own
                          roster-aware flag (set once a roster entry covers
                          the date); dates[].isWeekend is just the flat
                          company-wide pattern shared by everyone, used only
                          as a fallback for a day with no per-employee data. */}
                      {dates.map(({date,isWeekend,isHoliday,holidayName}) => (
                        <DayCell key={date} rowKey={rowKey}
                          day={emp.days?.[date]}
                          isWeekend={emp.days?.[date]?.isWeekend ?? isWeekend}
                          isHoliday={emp.days?.[date]?.isHoliday ?? isHoliday}
                          holidayName={emp.days?.[date]?.holidayName ?? holidayName} isLast={isLast} language={language} />
                      ))}

                      {/* Total OT — only shown in the OT row */}
                      {rowKey === 'ot' ? (
                        <td style={{ background:'#f0fdf4', borderLeft:'2px solid #c9d1db',
                          borderRight:'1px solid #dedede', borderBottom:isLast?'2px solid #c5cdd8':'1px solid #ebebeb',
                          padding:'3px 8px', minWidth:64, textAlign:'center', verticalAlign:'middle' }}>
                          {emp.eligibleForOt && emp.totalApprovedOTFormatted && emp.totalApprovedOTFormatted !== '—'
                            ? <strong style={{ fontFamily:'monospace', fontSize:12, fontWeight:900, color:'#059669' }}>
                                {emp.totalApprovedOTFormatted}
                              </strong>
                            : <span style={{ color:'#d1d5db' }}>—</span>}
                        </td>
                      ) : (
                        <td style={{ background:'#f8fafc', borderLeft:'2px solid #c9d1db',
                          borderRight:'1px solid #dedede', borderBottom:isLast?'2px solid #c5cdd8':'1px solid #ebebeb',
                          padding:'3px 4px', minWidth:54, textAlign:'center' }}>
                          <span style={{ color:'#d1d5db', fontSize:11 }}>—</span>
                        </td>
                      )}
                    </tr>
                  );
                })
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Legend ── */}
      {!loading&&employees.length>0&&(
        <div style={{ marginTop:10,display:'flex',gap:12,flexWrap:'wrap',fontSize:11,
          color:'#6b7280',padding:'8px 14px',background:'#f9fafb',
          borderRadius:8,border:'1px solid #e5e7eb',alignItems:'center' }}>
          <strong style={{ color:'#374151' }}>{L('व्याख्या','Legend')}:</strong>
          {[['IN','in','#1a56db',L('आउने समय','Time In')],['OUT','out','#059669',L('जाने समय','Time Out')],['WH','wh','#374151',L('काम भएको घण्टा','Worked Hrs')],['OT','ot','#7c3aed',L('ओभरटाइम','Overtime')]].map(([l,key,c,d])=>(
            <span key={l} style={{ display:'inline-flex',alignItems:'center',gap:4 }}>
              <span style={{ background:c,color:'white',borderRadius:4,padding:'1px 7px',fontSize:10,fontWeight:800 }}>{L(ROW_LABEL_NP[key], l)}</span>
              <span>= {d}</span>
            </span>
          ))}
          <span><span style={{ background:'#e5e7eb',color:'#6b7280',borderRadius:4,padding:'1px 6px',fontSize:10,fontWeight:800 }}>{L('ब','W')}</span> = {L('विकेन्ड','Weekend')}</span>
          <span><span style={{ background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 6px',fontSize:10,fontWeight:800 }}>{L('साबि','PH')}</span> = {L('सार्वजनिक बिदा','Public Holiday')}</span>
          <span><strong style={{ color:'#d97706' }}>⚠</strong> = {L('एकल पन्च','Single punch')}</span>
          <span style={{ marginLeft:'auto' }}>{employees.length} {L('कर्मचारी','staff')}</span>
        </div>
      )}

      {/* ── Advance Search Modal ── */}
      {showSearch&&(
        <AdvanceSearchModal
          filters={filters}
          onApply={f => { setFilters({ ...f, staffId: myEmpId || f.staffId }); }}
          onClose={()=>setShowSearch(false)}
          L={L} settings={settings}
          employees={allEmployees} shifts={shifts}
        />
      )}
    </div>
  );
};

export default HalfInOutReport;
