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
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, toNepaliDigits } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow } from '../../utils/printHelper.js';

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
      label: `${e.fullName||`Staff ${e.id}`}${e.position?` • ${abbrevPost(e.position)}`:''}${e.deviceId?` [${e.deviceId}]`:''}`,
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
        <div style={{ padding:'16px 22px 12px',background:'linear-gradient(135deg,#f0f4ff,#e8f4ff,#e6fffe,#edfff5,#fdf4ff,#fff0f8,#f0f4ff)',backgroundSize:'300% 300%',animation:'headerShift 8s ease infinite',borderBottom:'1px solid #f3f4f6',
          display:'flex',justifyContent:'space-between',alignItems:'center' }}>
          <span style={{ fontSize:16,fontWeight:700,color:'#166534' }}>{L('एडभान्स खोज','Advance Search')}</span>
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
                    background:(local._status||'working')===v?'#52b02c':'white',
                    color:(local._status||'working')===v?'white':'#374151',transition:'background .15s' }}>
                  {label}
                </button>
              ))}
            </div>
          </Field>

          {/* Row 1: Staff | Branch | Department */}
          <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14 }}>
            <Field label={L('कर्मचारी','Staff')}>
              <SearchableCheckSelect options={empOpts} value={local.staffId} onChange={v=>set('staffId',v)} allLabel={L('All Staff','All Staff')} />
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
            style={{ padding:'8px 22px',border:'none',borderRadius:8,background:'#52b02c',color:'white',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:'0 2px 8px rgba(82,176,44,.3)' }}>
            {L('खोज्नुस','Search')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Day cell ──────────────────────────────────────────────── */
const ROW_COLORS = { in:'#52b02c', out:'#059669', wh:'#374151', ot:'#7c3aed' };

const DayCell = ({ rowKey, day, isWeekend, isHoliday, holidayName, isLast }) => {
  const isWH  = rowKey === 'wh';
  const color = ROW_COLORS[rowKey] || '#374151';
  const bdBot = isLast ? '2px solid #cbd5e1' : '1px solid #f1f5f9';
  const bg    = isWeekend ? '#fafafa' : isHoliday ? '#fefce8' : 'white';
  const whBg  = isWeekend ? '#f5f5f5' : isHoliday ? '#fef9e7' : '#f8fafc';

  /* IN row — status badge when no punch */
  if (rowKey === 'in' && !day?.timeIn) {
    let badge = null;
    if (day?.leave)       badge = <span title={day.leave} style={{ background:'#ede9fe',color:'#5b21b6',borderRadius:4,padding:'1px 5px',fontSize:9,fontWeight:800,cursor:'help' }}>{leaveAbbrev(day.leave)}</span>;
    else if (isHoliday)   badge = <span title={holidayName||'Holiday'} style={{ background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 5px',fontSize:9,fontWeight:800,cursor:'help' }}>PH</span>;
    else if (day?.visit)  badge = <span title="Office Visit" style={{ background:'#dcfce7',color:'#166534',borderRadius:4,padding:'1px 5px',fontSize:9,fontWeight:800 }}>OV</span>;
    else if (isWeekend)   badge = <span style={{ background:'#e5e7eb',color:'#6b7280',borderRadius:4,padding:'1px 6px',fontSize:9,fontWeight:800 }}>W</span>;
    return (
      <td style={{ background:bg,borderRight:'1px solid #f1f5f9',borderBottom:bdBot,padding:'3px 2px',minWidth:52,textAlign:'center',verticalAlign:'middle' }}>
        {badge || <span style={{ color:'#d1d5db',fontSize:10 }}>—</span>}
      </td>
    );
  }

  let value = null;
  if (rowKey==='in')  value = fmtTime(day?.timeIn);
  if (rowKey==='out') value = fmtTime(day?.timeOut);
  if (rowKey==='wh')  value = day?.workedHrs;
  if (rowKey==='ot')  value = day?.otHrs;
  const warn = rowKey==='in' && day?.punches===1;

  return (
    <td style={{ background:isWH?whBg:bg, borderRight:isWH?'1px solid #cbd5e1':'1px solid #f1f5f9',
      borderBottom:bdBot, padding:'3px 2px', minWidth:52, textAlign:'center', verticalAlign:'middle' }}>
      {value
        ? <span style={{ fontFamily:'monospace',fontSize:11,fontWeight:isWH?800:600,
            color:warn?'#d97706':color,letterSpacing:isWH?'.3px':'normal' }}
            title={warn?'Single punch':''}>
            {value}{warn&&<span style={{ fontSize:8,marginLeft:1 }}>⚠</span>}
          </span>
        : <span style={{ color:isWH?'#cbd5e1':'#e5e7eb',fontSize:10 }}>—</span>
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

  const now     = new Date();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(now);
  const urlHalf = parseInt(searchParams.get('half'));

  const { isEmployee, currentUser } = useAuth();
  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';

  const [year,       setYear]       = useState(useNP?(todayBS?.year||now.getFullYear()):now.getFullYear());
  const [month,      setMonth]      = useState(useNP?(todayBS?.month||now.getMonth()+1):now.getMonth()+1);
  const [half,       setHalf]       = useState(urlHalf||(now.getDate()<=15?1:2));
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [showSearch, setShowSearch] = useState(false);
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
        if (sAD&&eAD) apiUrl=`/attendance/half-in-out?startDate=${isoDate(sAD)}&endDate=${isoDate(eAD)}&active=${activeParam}`;
      }
      if (!apiUrl) apiUrl=`/attendance/half-in-out?year=${year}&month=${month}&half=${half}&active=${activeParam}`;
      setData(await api.get(apiUrl));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year,month,half,useNP,staffStatus]);

  useEffect(() => { load(); }, [load]);

  const period  = data?.period;
  const dates   = data?.dates  || [];
  const allEmps = data?.employees || [];

  /* Client-side filtering */
  const employees = allEmps.filter(emp => {
    if (filters.staffId  && String(emp.id)!==filters.staffId)       return false;
    if (filters.branch   && emp.branch!==filters.branch)             return false;
    if (filters.dept     && emp.department!==filters.dept)           return false;
    if (filters.post     && emp.position!==filters.post)             return false;
    if (filters.grade    && emp.grade!==filters.grade)               return false;
    if (filters.mode     && emp.mode!==filters.mode)                 return false;
    if (filters.timingType && emp.timingType!==filters.timingType)   return false;
    if (filters.shift    && emp.shift!==filters.shift)               return false;
    return true;
  });

  const activeFilterCount = Object.entries(filters).filter(([k,v])=>k!=='_status'&&v!=='').length;
  const maxDays = Math.max(...dates.map((_,i)=>i+1), 31);

  const periodLabel = () => {
    const mn = useNP?(BS_MONTHS_NP[month-1]||''):MONTHS_EN[month-1];
    const yr = settings.nepaliDigits?toNepaliDigits(year):String(year);
    return `${mn} ${yr}${useNP?' BS':''} · ${half===1?L('पहिलो अर्ध (१–१५)','1st Half (1–15)'):L('दोस्रो अर्ध (१६–अन्त)','2nd Half (16–End)')}`;
  };

  /* Table header styles — minimal */
  const TH = { background:'#f8fafc',color:'#64748b',fontWeight:700,fontSize:11,
    padding:'5px 4px',borderRight:'1px solid #e2e8f0',borderBottom:'1px solid #e2e8f0',
    textAlign:'center',whiteSpace:'nowrap',userSelect:'none',position:'sticky',top:0,zIndex:3 };
  const thDay = (isWknd,isHol) => ({
    ...TH,
    background:isWknd?'#f1f5f9':isHol?'#fef9e7':'#f8fafc',
    color:isWknd?'#94a3b8':isHol?'#b45309':'#64748b',
    borderBottom:'none', paddingBottom:2,
  });
  const thDow = (isWknd,isHol) => ({
    ...TH,
    background:isWknd?'#f1f5f9':isHol?'#fef3c7':'#f8fafc',
    color:isWknd?'#cbd5e1':isHol?'#d97706':'#94a3b8',
    paddingTop:2, fontSize:10, fontWeight:600,
  });
  const TD_FIX = { padding:'0 8px',fontSize:11,fontWeight:600,borderRight:'1px solid #e2e8f0',
    verticalAlign:'middle',whiteSpace:'nowrap' };

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🔄 {L('IN & OUT रिपोर्ट','IN & OUT Report')}</h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY&&<span style={{ background:'#f0fdf4',color:'#52b02c',borderRadius:6,padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>{currentFY.name}</span>}
            {periodLabel()}
            {period&&<span style={{ marginLeft:8,fontSize:11,color:'#9ca3af' }}>{fd(period.startDate)} → {fd(period.endDate)}</span>}
          </p>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <button onClick={()=>window.print()}
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#f0fdf4',border:'1px solid #86efac',color:'#15803d',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            🖨️ Print
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
                background:half===h?'#52b02c':'white',color:half===h?'white':'#374151',transition:'background .15s' }}>
              {h===1?L('पहिलो अर्ध','1st Half'):L('दोस्रो अर्ध','2nd Half')}
            </button>
          ))}
        </div>

        {/* Status badge */}
        <span style={{ background:staffStatus==='working'?'#d1fae5':'#fee2e2',
          color:staffStatus==='working'?'#065f46':'#991b1b',
          border:`1px solid ${staffStatus==='working'?'#6ee7b7':'#fca5a5'}`,
          borderRadius:20, padding:'4px 12px', fontSize:12, fontWeight:700, flexShrink:0 }}>
          {staffStatus==='working'?L('कार्यरत','Working'):L('अवकाश','Not Working')}
        </span>

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
          {L('एडभान्स खोज','Advance Search')}
          {activeFilterCount>0&&<span style={{ background:'#52b02c',color:'white',borderRadius:'50%',width:18,height:18,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800 }}>{activeFilterCount}</span>}
        </button>

        <button className="btn btn-outline btn-sm" style={{ height:36 }} onClick={load} disabled={loading}>🔃</button>

        {/* Count */}
        {!loading&&employees.length>0&&(
          <span style={{ marginLeft:'auto',fontSize:12,color:'#6b7280' }}>
            {employees.length} {L('कर्मचारी','staff')}
          </span>
        )}
      </div>

      {error&&<div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#991b1b',fontWeight:600 }}>❌ {error}</div>}
      {loading&&<div style={{ textAlign:'center',padding:'60px',color:'#9ca3af' }}><div style={{ fontSize:36,marginBottom:8 }}>⏳</div><div style={{ fontWeight:600,fontSize:14 }}>Loading…</div></div>}

      {/* ── Matrix Table ── */}
      {!loading&&data&&(
        <div style={{ overflowX:'auto',borderRadius:10,border:'1px solid #e2e8f0',boxShadow:'0 1px 4px rgba(0,0,0,.05)' }}>
          <table style={{ borderCollapse:'collapse',width:'100%' }}>
            <thead>
              {/* Row 1 — day numbers */}
              <tr>
                <th style={{ ...TH,minWidth:34,position:'sticky',left:0,zIndex:4,background:'#f8fafc' }}>SN</th>
                <th style={{ ...TH,textAlign:'left',minWidth:120,position:'sticky',left:34,zIndex:4 }}>{L('कर्मचारी','Staff')}</th>
                <th style={{ ...TH,minWidth:44 }}>{L('पद','Post')}</th>
                <th style={{ ...TH,minWidth:44 }}>{L('विभाग','Dept.')}</th>
                <th style={{ ...TH,minWidth:42 }}>{L('शाखा','Branch')}</th>
                <th style={{ ...TH,minWidth:54 }}></th>
                {dates.map(({date,dayNum,isWeekend,isHoliday},dateIdx) => {
                  const dispNum = useNP ? (dateIdx+(half===1?1:16)) : dayNum;
                  return <th key={date} style={thDay(isWeekend,isHoliday)}>{settings.nepaliDigits?toNepaliDigits(dispNum):dispNum}</th>;
                })}
              </tr>
              {/* Row 2 — day abbreviations (always English) */}
              <tr>
                <th style={{ ...TH,background:'#f8fafc',left:0,position:'sticky',zIndex:4 }}></th>
                <th style={{ ...TH,left:34,position:'sticky',zIndex:4 }}></th>
                <th style={TH}></th><th style={TH}></th><th style={TH}></th><th style={TH}></th>
                {dates.map(({date,dayKey,isWeekend,isHoliday}) => (
                  <th key={date} style={thDow(isWeekend,isHoliday)}>
                    {dayKey.slice(0,3)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {employees.length===0&&(
                <tr><td colSpan={6+dates.length} style={{ textAlign:'center',padding:'40px',color:'#9ca3af',fontSize:13 }}>
                  {L('कुनै कर्मचारी भेटिएन','No staff found')}
                </td></tr>
              )}

              {employees.map((emp,idx) => (
                ['in','out','wh','ot'].map((rowKey,rIdx) => {
                  const isLast = rIdx===3;
                  const rowColor = ROW_COLORS[rowKey];
                  return (
                    <tr key={`${emp.id}-${rowKey}`}
                      style={{ background:rowKey==='wh'?'#fafafa':rowKey==='ot'?'#fdf4ff':'white' }}>

                      {rIdx===0&&(
                        <>
                          <td rowSpan={4} style={{ ...TD_FIX,background:'#f8fafc',color:'#94a3b8',
                            textAlign:'center',position:'sticky',left:0,zIndex:1,borderBottom:'2px solid #cbd5e1' }}>
                            {idx+1}
                          </td>
                          <td rowSpan={4} style={{ ...TD_FIX,color:'#1e293b',
                            position:'sticky',left:34,background:'white',zIndex:1,
                            borderBottom:'2px solid #cbd5e1',minWidth:120 }}>
                            {emp.fullName}
                          </td>
                          <td rowSpan={4} style={{ ...TD_FIX,color:'#0369a1',textAlign:'center',borderBottom:'2px solid #cbd5e1' }}
                            title={emp.position}>{emp.postShort||abbrevPost(emp.position)||'—'}</td>
                          <td rowSpan={4} style={{ ...TD_FIX,color:'#059669',textAlign:'center',borderBottom:'2px solid #cbd5e1' }}
                            title={emp.department}>{emp.deptShort||abbrevPost(emp.department)||'—'}</td>
                          <td rowSpan={4} style={{ ...TD_FIX,color:'#7c3aed',textAlign:'center',borderBottom:'2px solid #cbd5e1' }}
                            title={emp.branch}>{resolveShort(emp)}</td>
                        </>
                      )}

                      {/* Row label */}
                      <td style={{ background:'#fafafa',borderRight:'1px solid #e2e8f0',
                        borderBottom:isLast?'2px solid #cbd5e1':'1px solid #f1f5f9',
                        padding:'3px 8px',textAlign:'center',verticalAlign:'middle',width:52 }}>
                        <span style={{ background:rowColor,color:'white',borderRadius:5,
                          padding:'1px 8px',fontSize:10,fontWeight:800 }}>
                          {rowKey.toUpperCase()}
                        </span>
                      </td>

                      {/* Day cells */}
                      {dates.map(({date,isWeekend,isHoliday,holidayName}) => (
                        <DayCell key={date} rowKey={rowKey}
                          day={emp.days?.[date]} isWeekend={isWeekend}
                          isHoliday={isHoliday} holidayName={holidayName} isLast={isLast} />
                      ))}
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
          color:'#6b7280',padding:'7px 12px',background:'#f8fafc',
          borderRadius:8,border:'1px solid #e2e8f0',alignItems:'center' }}>
          <strong style={{ color:'#374151' }}>{L('व्याख्या','Legend')}:</strong>
          {[['IN','#52b02c','Time In'],['OUT','#059669','Time Out'],['WH','#374151','Worked Hrs'],['OT','#7c3aed','Overtime']].map(([l,c,d])=>(
            <span key={l} style={{ display:'inline-flex',alignItems:'center',gap:4 }}>
              <span style={{ background:c,color:'white',borderRadius:4,padding:'1px 7px',fontSize:10,fontWeight:800 }}>{l}</span>
              <span>= {d}</span>
            </span>
          ))}
          <span><span style={{ background:'#e5e7eb',color:'#6b7280',borderRadius:4,padding:'1px 6px',fontSize:10,fontWeight:800 }}>W</span> = Weekend</span>
          <span><span style={{ background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 6px',fontSize:10,fontWeight:800 }}>PH</span> = Public Holiday</span>
          <span><strong style={{ color:'#d97706' }}>⚠</strong> = Single punch</span>
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
