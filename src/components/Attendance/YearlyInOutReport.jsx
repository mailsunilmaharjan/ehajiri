import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import api from '../../api/client.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import ViewYearlyBtn from './ViewYearlyBtn.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, toNepaliDigits, getNepalNow, getNepalTodayISO, getCurrentFiscalYear } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow } from '../../utils/printHelper.js';
import { staffRankCompare } from '../../utils/branchUtils.js';

const MONTHS_EN_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAYS_SHORT  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const BS_MONTHS_SHORT  = ['Baisakh','Jestha','Asadh','Shrawan','Bhadra','Ashwin',
                           'Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const abbrev = (name) => {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 5);
};

const fmtTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

/* Row configs */
const ROWS = [
  { key:'in',  label:'In',         color:'#1a56db' },
  { key:'out', label:'Out',        color:'#059669' },
  { key:'wh',  label:'WorkedHour', color:'#374151' },
  { key:'ot',  label:'OT',         color:'#7c3aed' },
];

/* ── Staff Select dropdown ── */
const StaffSelect = ({ employees, value, onChange, L }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(); const inpRef = useRef();
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { if (open && inpRef.current) inpRef.current.focus(); }, [open]);
  const filtered = employees.filter(e =>
    !search || (e.fullName||'').toLowerCase().includes(search.toLowerCase()) ||
    (e.position||'').toLowerCase().includes(search.toLowerCase()) ||
    (e.deviceId ? String(e.deviceId).includes(search) : false)
  );
  const selected = employees.find(e => String(e.id) === String(value));
  return (
    <div ref={ref} style={{ minWidth:300, position:'relative' }}>
      <div onClick={() => setOpen(p=>!p)}
        style={{ display:'flex',alignItems:'center',justifyContent:'space-between',
          height:36,padding:'0 10px',border:`1.5px solid ${open?'#1a56db':'#d1d5db'}`,
          borderRadius:8,background:'white',cursor:'pointer',
          boxShadow:open?'0 0 0 2px rgba(26,86,219,.1)':'none',transition:'all .15s' }}>
        <span style={{ fontSize:13,color:selected?'#1f2937':'#9ca3af',
          fontWeight:selected?600:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1 }}>
          {selected
            ? `${selected.fullName}${selected.position?` • ${abbrev(selected.position)}`:''}${selected.deviceId?` [${selected.deviceId}]`:''}`
            : `— ${L('कर्मचारी छान्नुस','Select Staff Member')} —`}
        </span>
        <svg viewBox="0 0 20 20" fill={open?'#1a56db':'#9ca3af'} width="13" height="13"
          style={{ flexShrink:0,marginLeft:6,transform:open?'rotate(180deg)':'none',transition:'transform .2s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </div>
      {open && (
        <div style={{ position:'absolute',top:'calc(100% + 4px)',left:0,right:0,zIndex:600,
          background:'white',border:'1px solid #d1d5db',borderRadius:8,
          boxShadow:'0 8px 28px rgba(0,0,0,.13)',overflow:'hidden' }}>
          <div style={{ padding:'8px 10px',background:'#f9fafb',borderBottom:'1px solid #f3f4f6' }}>
            <div style={{ display:'flex',alignItems:'center',gap:6,background:'white',
              border:'1px solid #e5e7eb',borderRadius:6,padding:'5px 8px' }}>
              <svg viewBox="0 0 20 20" fill="#9ca3af" width="13" height="13">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              <input ref={inpRef} value={search} onChange={e=>setSearch(e.target.value)}
                onClick={e=>e.stopPropagation()}
                placeholder={L('नाम, पद, Device ID...','Name, post, or device ID...')}
                style={{ border:'none',outline:'none',fontSize:12,flex:1,background:'transparent' }} />
              {search && <button onMouseDown={e=>{e.preventDefault();setSearch('');}}
                style={{ background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:13,padding:0 }}>✕</button>}
            </div>
          </div>
          <div style={{ maxHeight:260,overflowY:'auto' }}>
            {filtered.length===0 && <div style={{ padding:'12px',textAlign:'center',color:'#9ca3af',fontSize:12 }}>No staff found</div>}
            {filtered.map((e,idx) => {
              const active = String(e.id)===String(value);
              return (
                <div key={e.id}
                  onMouseDown={ev=>{ ev.preventDefault(); onChange(String(e.id)); setOpen(false); setSearch(''); }}
                  style={{ display:'flex',alignItems:'center',gap:10,padding:'8px 14px',cursor:'pointer',
                    background:active?'#eff6ff':'white',borderBottom:'1px solid #f3f4f6',transition:'background .1s' }}
                  onMouseEnter={ev=>{ if(!active) ev.currentTarget.style.background='#f5f8ff'; }}
                  onMouseLeave={ev=>{ ev.currentTarget.style.background=active?'#eff6ff':'white'; }}>
                  <div style={{ width:22,height:22,borderRadius:'50%',background:active?'#1a56db':'#f3f4f6',
                    color:active?'white':'#9ca3af',fontSize:10,fontWeight:700,flexShrink:0,
                    display:'flex',alignItems:'center',justifyContent:'center' }}>{idx+1}</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:13,fontWeight:active?700:600,color:active?'#1e40af':'#1f2937',
                      overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{e.fullName}</div>
                    <div style={{ fontSize:11,color:'#9ca3af',display:'flex',gap:8 }}>
                      {e.position && <span style={{ color:'#0369a1',fontWeight:600 }}>{abbrev(e.position)}</span>}
                      {e.deviceId && <span style={{ fontFamily:'monospace' }}>[{e.deviceId}]</span>}
                    </div>
                  </div>
                  {active && <svg viewBox="0 0 20 20" fill="#1a56db" width="14" height="14"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════ */
const YearlyInOutReport = () => {
  const [searchParams] = useSearchParams();
  const { language }   = useLanguage();
  const { settings }   = useSettings();
  const { employees }  = useData();
  const fd             = useDateFormat();
  const L = (np, en)   => language==='np'?np:en;

  const now     = getNepalNow();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(getNepalTodayISO());
  const urlYear = parseInt(searchParams.get('year'));

  const [year,       setYear]       = useState(urlYear || (useNP?(todayBS?.year||now.getFullYear()):now.getFullYear()));
  const [selectedId, setSelectedId] = useState('');
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);

  const currentFY = getCurrentFiscalYear(settings.fiscalYears||[]);

  const sortedEmps = useMemo(() =>
    [...employees].filter(e=>e.active!==false).sort((a,b) => staffRankCompare(a, b, settings)),
    [employees, settings.branches]);

  useEffect(() => { if (!selectedId && sortedEmps.length>0) setSelectedId(String(sortedEmps[0].id)); }, [sortedEmps.length]);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError(null);
    try {
      let startDate, endDate;
      if (useNP) {
        const sAD = bsToAD(year,1,1), eAD = bsToAD(year,12,getBSDays(year,12));
        if (sAD&&eAD) { startDate=isoDate(sAD); endDate=isoDate(eAD); }
      }
      if (!startDate) { startDate=`${year}-01-01`; endDate=`${year}-12-31`; }
      setData(await api.get(`/attendance/half-in-out?startDate=${startDate}&endDate=${endDate}`));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year, selectedId, useNP]);

  useEffect(() => { load(); }, [load]);

  /* Build month × day matrix */
  const matrix = useMemo(() => {
    if (!data||!selectedId) return [];
    const emp = (data.employees||[]).find(e=>String(e.id)===selectedId);
    if (!emp) return [];

    const dateMeta = {};
    (data.dates||[]).forEach(d => { dateMeta[d.date]=d; });
    const adYear = data.period?.startDate ? parseInt(data.period.startDate.split('-')[0]) : year;

    return Array.from({length:12}, (_,mi) => {
      const bsMonth = mi+1;
      const daysCount = useNP ? getBSDays(year,bsMonth) : new Date(adYear,mi+1,0).getDate();
      const monthLabel = useNP ? BS_MONTHS_SHORT[mi] : MONTHS_EN_SHORT[mi];
      const days = Array.from({length:daysCount}, (_,di) => {
        const dayNum = di+1;
        let dateStr;
        if (useNP) {
          const adDate = bsToAD(year,bsMonth,dayNum);
          dateStr = adDate ? isoDate(adDate) : null;
        } else {
          dateStr = `${adYear}-${String(mi+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
        }
        if (!dateStr) return {dayNum,dateStr:null,timeIn:null,timeOut:null,workedHrs:null,otHrs:null,isWeekend:false,isHoliday:false,holidayName:null};
        const meta = dateMeta[dateStr]||{};
        const d2   = emp.days?.[dateStr]||{};
        return {
          dayNum, dateStr,
          timeIn:    fmtTime(d2.timeIn),
          timeOut:   fmtTime(d2.timeOut),
          workedHrs: d2.workedHrs||null,
          otHrs:     d2.otHrs||null,
          punches:   d2.punches||0,
          isWeekend: meta.isWeekend||false,
          isHoliday: meta.isHoliday||false,
          holidayName: meta.holidayName||null,
        };
      });
      return { label:monthLabel, days };
    });
  }, [data, selectedId, year, useNP]);

  const maxDays = useMemo(()=>Math.max(...matrix.map(m=>m.days.length),31),[matrix]);
  const selectedEmp = sortedEmps.find(e=>String(e.id)===selectedId);
  const currentIdx  = sortedEmps.findIndex(e=>String(e.id)===selectedId);
  const navTo = (idx) => { if (idx>=0 && idx<sortedEmps.length) setSelectedId(String(sortedEmps[idx].id)); };

  /* Cell value */
  const getCellValue = (d, rowKey) => {
    if (!d.dateStr) return null;
    if (d.isWeekend) {
      if (rowKey==='ot') return { text:'—', color:'#e5e7eb', bg:'#faf5ff', mono:false };
      return { text:'W', color:'#9ca3af', bg:'#f3f4f6', mono:false };
    }
    if (d.isHoliday && !d.timeIn) {
      if (rowKey==='in') return { text:(d.holidayName||'PH').slice(0,8), color:'#92400e', bg:'#fef3c7', mono:false, small:true };
      return { text:'—', color:'#e5e7eb', bg:rowKey==='wh'?'#fafafa':rowKey==='ot'?'#faf5ff':'#fef9e7', mono:false };
    }
    if (rowKey==='in')  return d.timeIn    ? {text:d.timeIn,    color:'#1a56db',bg:'white',   mono:true} : {text:'—',color:'#e5e7eb',bg:'white',   mono:false};
    if (rowKey==='out') return d.timeOut   ? {text:d.timeOut,   color:'#059669',bg:'white',   mono:true} : {text:'—',color:'#e5e7eb',bg:'white',   mono:false};
    if (rowKey==='wh')  return d.workedHrs ? {text:d.workedHrs, color:'#374151',bg:'#fafafa', mono:true} : {text:'—',color:'#e5e7eb',bg:'#fafafa', mono:false};
    if (rowKey==='ot')  return d.otHrs     ? {text:d.otHrs,     color:'#7c3aed',bg:'#faf5ff', mono:true} : {text:'—',color:'#e5e7eb',bg:'#faf5ff', mono:false};
    return {text:'—',color:'#e5e7eb',bg:'white',mono:false};
  };

  /* Styles */
  const TH = {
    background:'#efefef',color:'#374151',fontWeight:700,fontSize:12.5,
    padding:'4px 5px',borderRight:'1px solid #dedede',borderBottom:'2px solid #dedede',
    textAlign:'center',whiteSpace:'nowrap',userSelect:'none',position:'sticky',top:0,zIndex:3,
  };
  const TD = {
    padding:'4px 3px',fontSize:12.5,
    borderRight:'1px solid #e5e7eb',borderBottom:'1px solid #f3f4f6',
    textAlign:'center',verticalAlign:'middle',whiteSpace:'nowrap',
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">🔄 {L('वार्षिक IN & OUT लग रिपोर्ट','Yearly IN & OUT Log Report')}</h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY && <span style={{ background:'#eff6ff',color:'#1a56db',borderRadius:6,padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>{currentFY.name}</span>}
            {useNP ? `${settings.nepaliDigits?toNepaliDigits(year):year} BS` : String(year)}
            {selectedEmp && <span style={{ marginLeft:8,fontWeight:600,color:'#1f2937' }}>— {selectedEmp.fullName}</span>}
          </p>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <button onClick={()=>{
              if (!matrix.length||!selectedEmp) return;
              const rptTitle = 'Yearly IN & OUT Log Report';
              const empInfo = [selectedEmp.branch, selectedEmp.position, selectedEmp.department].filter(Boolean).join(' | ');
              const rptSub = `${selectedEmp.fullName}${empInfo?` | ${empInfo}`:''} | ${useNP?`${settings.nepaliDigits?toNepaliDigits(year):year} BS`:String(year)}`;
              const maxD = maxDays;
              const dayHeaders = Array.from({length:maxD},(_,i)=>`<th style="padding:3px 2px;border:1px solid #dedede;background:#efefef;font-size:9px;min-width:32px">${i+1}</th>`).join('');
              const rowKeys = ['in','out','wh','ot'];
              const rowLabels = {in:'IN',out:'OUT',wh:'WH',ot:'OT'};
              const dataRows = matrix.flatMap(m => {
                const empty = Array.from({length:maxD-m.days.length},()=>`<td style="border:1px solid #ebebeb"></td>`);
                const wdCells = m.days.map(d => {
                  const wd = d.dateStr ? WEEKDAYS_SHORT[new Date(d.dateStr).getDay()] : '';
                  return `<td style="padding:2px 2px;border:1px solid #ebebeb;text-align:center;font-size:8px;font-weight:700;background:#f8fafc;color:${d.isWeekend?'#dc2626':'#6b7280'}">${wd}</td>`;
                });
                const wdRow = `<tr>
                  <td rowspan="5" style="padding:3px 5px;border:1px solid #dedede;font-weight:700;vertical-align:middle">${m.label}</td>
                  <td style="padding:2px 5px;border:1px solid #dedede;text-align:center;font-size:8px;font-weight:700;color:#9ca3af;background:#f8fafc">Day</td>
                  ${wdCells.join('')}${empty.join('')}
                </tr>`;
                const rows = rowKeys.map(rk => {
                  const cells = m.days.map(d => {
                    const v = getCellValue(d, rk);
                    return `<td style="padding:2px 2px;border:1px solid #ebebeb;text-align:center;font-size:9px">${v?v.text:''}</td>`;
                  });
                  return `<tr>
                    <td style="padding:2px 5px;border:1px solid #dedede;text-align:center;font-size:10px;font-weight:700">${rowLabels[rk]}</td>
                    ${cells.join('')}${empty.join('')}
                  </tr>`;
                });
                return [wdRow, ...rows];
              }).join('');
              const contentHtml = `<table style="border-collapse:collapse;width:100%;font-size:10px">
                <thead><tr>
                  <th style="padding:4px 6px;border:1px solid #dedede;background:#efefef">Month</th>
                  <th style="padding:4px 6px;border:1px solid #dedede;background:#efefef">Row</th>
                  ${dayHeaders}
                </tr></thead>
                <tbody>${dataRows}</tbody>
              </table>`;
              openPrintWindow(buildPrintDoc({ settings, language, reportTitle: rptTitle, reportSub: rptSub, contentHtml, isLandscape: true }), true);
            }} style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,background:'#eff6ff',border:'1px solid #93c5fd',color:'#1d4ed8',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>🖨️ Print</button>
          <ViewYearlyBtn year={year} useNP={useNP} currentPath="/attendance/reports/yearly/in-out" />
        </div>
      </div>

      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap' }}>
        <select className="form-control" style={{ width:useNP?115:85,height:36,fontSize:13 }}
          value={year} onChange={e=>setYear(+e.target.value)}>
          {useNP
            ? [todayBS?.year-2,todayBS?.year-1,todayBS?.year,todayBS?.year+1].filter(Boolean).map(y=>(
                <option key={y} value={y}>{settings.nepaliDigits?toNepaliDigits(y):y} BS</option>))
            : [now.getFullYear()-2,now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1].map(y=>(
                <option key={y} value={y}>{y}</option>))}
        </select>
        <div style={{ display:'flex',alignItems:'center',gap:6 }}>
          <span style={{ fontSize:13,fontWeight:600,color:'#374151',flexShrink:0 }}>{L('कर्मचारी','Staff')} :</span>
          <StaffSelect employees={sortedEmps} value={selectedId} onChange={setSelectedId} L={L} />
        </div>
        <button className="btn btn-outline btn-sm" style={{ height:36 }} onClick={load} disabled={loading||!selectedId}>🔃</button>
      </div>

      {/* Staff info + Back/Next navigation */}
      {selectedEmp && (
        <div style={{ display:'flex',gap:12,marginBottom:14,alignItems:'stretch',flexWrap:'wrap' }}>
          <div style={{ display:'flex',gap:12,flexWrap:'wrap',flex:1,minWidth:280,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:10,padding:'10px 16px',alignItems:'center',borderLeft:'4px solid #1a56db' }}>
            <span style={{ fontSize:14,fontWeight:800,color:'#1f2937' }}>{selectedEmp.fullName}</span>
            {selectedEmp.employeeId && <span style={{ background:'#eff6ff',color:'#1a56db',borderRadius:6,padding:'1px 8px',fontSize:11,fontWeight:700 }}>{selectedEmp.employeeId}</span>}
            {[{icon:'🏢',v:selectedEmp.branch},{icon:'🎖️',v:selectedEmp.position},{icon:'🏗️',v:selectedEmp.department}].filter(f=>f.v).map((f,i,arr)=>(
              <React.Fragment key={i}>
                <span style={{ display:'inline-flex',alignItems:'center',gap:4,fontSize:12,color:'#374151' }}><span>{f.icon}</span><strong>{f.v}</strong></span>
                {i<arr.length-1 && <span style={{ color:'#cbd5e1',fontWeight:700 }}>|</span>}
              </React.Fragment>
            ))}
          </div>
          {sortedEmps.length > 1 && (
            <div style={{ display:'flex',flexDirection:'row',alignItems:'center',justifyContent:'center',
              gap:8,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:10,
              padding:'10px 16px',flexShrink:0 }}>
              <button
                disabled={currentIdx <= 0}
                onClick={() => navTo(currentIdx - 1)}
                style={{ display:'inline-flex',alignItems:'center',gap:4,
                  padding:'6px 14px',border:'1px solid #bae6fd',borderRadius:8,
                  background: currentIdx <= 0 ? '#f1f5f9' : '#e0f2fe',
                  color: currentIdx <= 0 ? '#cbd5e1' : '#0369a1',
                  cursor: currentIdx <= 0 ? 'not-allowed' : 'pointer',
                  fontSize:13,fontWeight:700,whiteSpace:'nowrap' }}>
                ← {L('पछाडि','Back')}
              </button>
              <span style={{ fontSize:12,fontWeight:700,color:'#374151',
                background:'white',borderRadius:7,padding:'5px 14px',
                border:'1px solid #e2e8f0',whiteSpace:'nowrap' }}>
                Staff: {currentIdx >= 0 ? currentIdx + 1 : '—'} / {sortedEmps.length}
              </span>
              <button
                disabled={currentIdx < 0 || currentIdx >= sortedEmps.length - 1}
                onClick={() => navTo(currentIdx + 1)}
                style={{ display:'inline-flex',alignItems:'center',gap:4,
                  padding:'6px 14px',border:'1px solid #86efac',borderRadius:8,
                  background: (currentIdx < 0 || currentIdx >= sortedEmps.length-1) ? '#f1f5f9' : '#dcfce7',
                  color: (currentIdx < 0 || currentIdx >= sortedEmps.length-1) ? '#cbd5e1' : '#15803d',
                  cursor: (currentIdx < 0 || currentIdx >= sortedEmps.length-1) ? 'not-allowed' : 'pointer',
                  fontSize:13,fontWeight:700,whiteSpace:'nowrap' }}>
                {L('अर्को','Next')} →
              </button>
            </div>
          )}
        </div>
      )}

      {error && <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#991b1b',fontWeight:600 }}>❌ {error}</div>}

      {!selectedId && <div style={{ textAlign:'center',padding:'60px',color:'#9ca3af' }}><div style={{ fontSize:36,marginBottom:8 }}>👤</div><div style={{ fontWeight:600,fontSize:14,color:'#374151' }}>{L('माथिबाट कर्मचारी छान्नुस','Select a staff member above')}</div></div>}

      {loading && <div style={{ textAlign:'center',padding:'60px',color:'#9ca3af' }}><div style={{ fontSize:36,marginBottom:8 }}>⏳</div><div style={{ fontWeight:600,fontSize:14 }}>Loading year data…</div></div>}

      {/* Matrix */}
      {!loading && matrix.length>0 && (
        <>
          <div style={{ fontSize:13,fontWeight:700,color:'#374151',marginBottom:8 }}>Detail</div>
          <div style={{ overflowX:'auto',borderRadius:8,border:'1px solid #dedede',boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
            <table style={{ borderCollapse:'collapse',width:'100%' }}>
              <thead>
                <tr>
                  <th style={{ ...TH,minWidth:78,textAlign:'left',left:0,zIndex:4 }}>Month</th>
                  <th style={{ ...TH,minWidth:82,left:78,zIndex:4,background:'#f5f5f5',textAlign:'left',paddingLeft:8 }}></th>
                  {Array.from({length:maxDays},(_,i)=>(
                    <th key={i+1} style={{ ...TH,minWidth:52,width:52 }}>{i+1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((month, mi) => (
                  <React.Fragment key={mi}>
                    {/* Weekday row — Sun/Mon/Tue under each date, per calendar */}
                    <tr style={{ background:'#f8fafc' }}>
                      {/* Month name — rowspan 5 (weekday + 4 data rows) */}
                      <td rowSpan={5} style={{ ...TD,fontWeight:700,color:'#374151',textAlign:'left',
                        padding:'0 10px',verticalAlign:'middle',
                        position:'sticky',left:0,background:'white',zIndex:1,
                        borderRight:'1px solid #dedede',minWidth:78,
                        borderBottom:'2px solid #d1d5db' }}>
                        {month.label}
                      </td>
                      <td style={{ ...TD,fontSize:10,color:'#9ca3af',fontWeight:600,
                        textAlign:'left',paddingLeft:8,background:'#f8fafc',
                        position:'sticky',left:78,zIndex:1,
                        borderLeft:'3px solid #e5e7eb',
                        borderBottom:'1px solid #e5e7eb',minWidth:82 }}>
                        Day
                      </td>
                      {Array.from({length:maxDays},(_,di)=>{
                        const dayData = month.days[di];
                        const wd = dayData?.dateStr ? WEEKDAYS_SHORT[new Date(dayData.dateStr).getDay()] : '';
                        return (
                          <td key={di} style={{ ...TD,fontSize:10,fontWeight:700,
                            color:dayData?.isWeekend?'#dc2626':'#6b7280',
                            background:'#f8fafc',borderBottom:'1px solid #e5e7eb',
                            width:52,minWidth:52 }}
                            title={dayData?.dateStr?fd(dayData.dateStr):''}>
                            {wd}
                          </td>
                        );
                      })}
                    </tr>
                  {ROWS.map((row, ri) => {
                    const isLastRow = ri===ROWS.length-1;
                    const rowBorder = isLastRow ? '2px solid #d1d5db'
                                    : (row.key==='wh' || row.key==='out') ? '2px solid #b8c0cc'
                                    : '1px solid #f3f4f6';
                    return (
                      <tr key={`${mi}-${ri}`}
                        style={{ background:row.key==='wh'?'#fafafa':row.key==='ot'?'#faf5ff':'white' }}>

                        {/* Row label */}
                        <td style={{ ...TD,fontSize:11,color:row.color,fontWeight:600,
                          textAlign:'left',paddingLeft:8,background:'#fafafa',
                          position:'sticky',left:78,zIndex:1,
                          borderLeft:`3px solid ${row.color}33`,
                          borderBottom:rowBorder,
                          minWidth:82 }}>
                          {row.label}
                        </td>

                        {/* Day cells */}
                        {Array.from({length:maxDays},(_,di)=>{
                          const dayData = month.days[di];
                          const cell = dayData ? getCellValue(dayData, row.key) : null;
                          const bg = row.key==='wh'?'#fafafa':row.key==='ot'?'#faf5ff':'white';
                          return (
                            <td key={di} style={{ ...TD,
                              background:cell?.bg||bg,
                              borderBottom:rowBorder,
                              width:52,minWidth:52 }}
                              title={dayData?.dateStr?fd(dayData.dateStr):''}>
                              {!cell ? <span style={{ color:'#f0f0f0',fontSize:9 }}>·</span>
                                : cell.text==='—'||cell.text==='W'
                                  ? <span style={{ color:cell.color,fontSize:cell.text==='W'?11:10,fontWeight:600 }}>{cell.text}</span>
                                  : <span style={{ fontFamily:cell.mono?'monospace':'inherit',
                                      fontSize:cell.small?9:12,fontWeight:700,color:cell.color }}>
                                      {cell.text}
                                    </span>
                              }
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div style={{ marginTop:10,display:'flex',gap:14,flexWrap:'wrap',fontSize:11,
            color:'#6b7280',padding:'8px 12px',background:'#f9fafb',
            borderRadius:8,border:'1px solid #e5e7eb',alignItems:'center' }}>
            <strong style={{ color:'#374151' }}>{L('व्याख्या','Legend')}:</strong>
            {ROWS.map(r=><span key={r.key}><strong style={{ color:r.color,fontFamily:'monospace' }}>HH:MM</strong> = {r.label}</span>)}
            <span style={{ background:'#f3f4f6',border:'1px solid #e5e7eb',borderRadius:4,padding:'1px 7px',color:'#9ca3af',fontWeight:700 }}>W</span>= Weekend
            <span style={{ background:'#fef3c7',border:'1px solid #fde68a',borderRadius:4,padding:'1px 7px',color:'#92400e',fontWeight:700 }}>PH</span>= Public Holiday
          </div>
        </>
      )}
    </div>
  );
};

export default YearlyInOutReport;
