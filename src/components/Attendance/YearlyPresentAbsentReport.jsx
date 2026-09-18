import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import api from '../../api/client.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import ViewYearlyBtn from './ViewYearlyBtn.jsx';
import LoadingIndicator from '../Common/LoadingIndicator.jsx';
import Avatar from '../Common/Avatar.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits, getNepalNow, getNepalTodayISO, getCurrentFiscalYear } from '../../utils/dateUtils.js';
import { staffRankCompare } from '../../utils/branchUtils.js';

const MONTHS_EN_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const BS_MONTHS_SHORT  = ['Baisakh','Jestha','Asadh','Shrawan','Bhadra','Ashwin',
                           'Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const abbrev = (name) => {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 5);
};

/* ── Status colors ── */
const STATUS = {
  P  : { bg:'#d1fae5', color:'#065f46', label:'P',  title:'Present' },
  P1 : { bg:'#d1fae5', color:'#0369a1', label:'P¹', title:'Present – single punch' },
  PP : { bg:'#fef08a', color:'#713f12', label:'H.P', title:'Present on Public Holiday' },
  PP1: { bg:'#fef08a', color:'#713f12', label:'H.P¹', title:'Present on Public Holiday – single punch' },
  WP : { bg:'#ccfbf1', color:'#0f766e', label:'W.P', title:'Present on Weekend' },
  WP1: { bg:'#ccfbf1', color:'#0f766e', label:'W.P¹', title:'Present on Weekend – single punch' },
  AB : { bg:'#fee2e2', color:'#991b1b', label:'AB', title:'Absent' },
  H  : { bg:'#f3f4f6', color:'#9ca3af', label:'W',  title:'Weekend' },
  DO : { bg:'#f3f4f6', color:'#6b7280', label:'DO', title:'Day Off' },
  NO : { bg:'#eef2ff', color:'#4338ca', label:'NO', title:'Night Off' },
  L  : { bg:'#ede9fe', color:'#5b21b6', label:'L',  title:'Leave' },
  OV : { bg:'#dbeafe', color:'#1e40af', label:'OV', title:'Office Visit' },
  PH : { bg:'#fef3c7', color:'#92400e', label:'PH', title:'Public Holiday' },
};

// STATUS's own `title` is display-only English (a hover tooltip + the legend
// text below) — the on-screen `label` short codes (P/AB/W/L/OV/PH/DO/NO)
// stay as universal abbreviations regardless of language, same convention as
// every other attendance report.
const STATUS_TITLE_NP = {
  P: 'उपस्थित', P1: 'उपस्थित – एकल पन्च', PP: 'सार्वजनिक बिदामा उपस्थित', PP1: 'सार्वजनिक बिदामा उपस्थित – एकल पन्च',
  WP: 'सप्ताहान्तमा उपस्थित', WP1: 'सप्ताहान्तमा उपस्थित – एकल पन्च', AB: 'अनुपस्थित', H: 'विकेन्ड',
  DO: 'डे अफ', NO: 'नाइट अफ', L: 'बिदा', OV: 'कार्यालय भ्रमण', PH: 'सार्वजनिक बिदा',
};
const statusTitle = (st, language) => {
  const s = STATUS[st] || STATUS.AB;
  return language === 'np' ? (STATUS_TITLE_NP[st] || s.title) : s.title;
};

const StatusCell = ({ st, dayKey, language }) => {
  if (!st) return <span style={{ color:'#e5e7eb', fontSize:9 }}>·</span>;
  const s = STATUS[st] || STATUS.AB;
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
      <div style={{
        background:s.bg, color:s.color,
        border: `1px solid ${s.color}33`,
        borderRadius:4, padding:'2px 5px', fontSize:12,
        fontWeight:800, textAlign:'center', minWidth:26,
      }} title={statusTitle(st, language)}>
        {s.label}
      </div>
      {dayKey && (
        <span style={{ fontSize:9, color:'#9ca3af', fontWeight:600, lineHeight:1 }}>
          {dayKey}
        </span>
      )}
    </div>
  );
};

/* ── Staff Searchable Select ─────────────────────────────────── */
const StaffSelect = ({ employees, value, onChange, L }) => {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
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
    (e.position||'').toLowerCase().includes(search.toLowerCase()) ||
    (e.deviceId ? String(e.deviceId).includes(search) : false)
  );

  const selected = employees.find(e => String(e.id) === String(value));

  return (
    <div ref={ref} style={{ minWidth:300, position:'relative' }}>
      {/* Trigger */}
      <div onClick={() => setOpen(p => !p)}
        style={{ display:'flex',alignItems:'center',justifyContent:'space-between',
          height:36, padding:'0 10px',
          border:`1.5px solid ${open?'#1a56db':'#d1d5db'}`,
          borderRadius:8, background:'white', cursor:'pointer',
          boxShadow:open?'0 0 0 2px rgba(26,86,219,.1)':'none', transition:'all .15s' }}>
        <span style={{ display:'flex', alignItems:'center', gap:6, overflow:'hidden', flex:1 }}>
          {selected && <Avatar photo={selected.profilePhoto} name={selected.fullName} size={22} style={{ flexShrink:0 }} />}
          <span style={{ fontSize:13, color:selected?'#1f2937':'#9ca3af',
            fontWeight:selected?600:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {selected
              ? `${selected.fullName}${selected.position ? ` • ${abbrev(selected.position)}` : ''}`
              : `— ${L('कर्मचारी छान्नुस','Select Staff Member')} —`}
          </span>
        </span>
        <svg viewBox="0 0 20 20" fill={open?'#1a56db':'#9ca3af'} width="13" height="13"
          style={{ flexShrink:0, marginLeft:6, transform:open?'rotate(180deg)':'none', transition:'transform .2s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{ position:'absolute',top:'calc(100% + 4px)',left:0,right:0,zIndex:600,
          background:'white',border:'1px solid #d1d5db',borderRadius:8,
          boxShadow:'0 8px 28px rgba(0,0,0,.13)',overflow:'hidden' }}>
          {/* Search */}
          <div style={{ padding:'8px 10px',background:'#f9fafb',borderBottom:'1px solid #f3f4f6' }}>
            <div style={{ display:'flex',alignItems:'center',gap:6,background:'white',
              border:'1px solid #e5e7eb',borderRadius:6,padding:'5px 8px' }}>
              <svg viewBox="0 0 20 20" fill="#9ca3af" width="13" height="13">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
              </svg>
              <input ref={inpRef} value={search} onChange={e=>setSearch(e.target.value)}
                onClick={e=>e.stopPropagation()}
                placeholder={L('नाम, पद, वा Device ID खोज्नुस...','Search name, post, or device ID...')}
                style={{ border:'none',outline:'none',fontSize:12,flex:1,background:'transparent' }} />
              {search && (
                <button onMouseDown={e=>{e.preventDefault();setSearch('');}}
                  style={{ background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:13,padding:0 }}>✕</button>
              )}
            </div>
          </div>
          {/* Options */}
          <div style={{ maxHeight:260, overflowY:'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding:'12px',textAlign:'center',color:'#9ca3af',fontSize:12 }}>No staff found</div>
            )}
            {filtered.map((e, idx) => {
              const active   = String(e.id) === String(value);
              const stripeBg = idx % 2 === 0 ? '#fff' : '#fafafa';
              const sub      = [e.employeeId, e.position].filter(Boolean).join(' - ');
              return (
                <div key={e.id}
                  onMouseDown={ev=>{ ev.preventDefault(); onChange(String(e.id)); setOpen(false); setSearch(''); }}
                  style={{ display:'flex',alignItems:'center',gap:10,padding:'6px 14px',
                    cursor:'pointer',background:active?'#eff6ff':stripeBg,
                    borderBottom:'1px solid #eef0f3',transition:'background .1s' }}
                  onMouseEnter={ev=>{ if(!active) ev.currentTarget.style.background='#f5f8ff'; }}
                  onMouseLeave={ev=>{ ev.currentTarget.style.background=active?'#eff6ff':stripeBg; }}>
                  <Avatar photo={e.profilePhoto} name={e.fullName} size={26} style={{ flexShrink:0 }} />
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:13,fontWeight:active?700:600,color:active?'#1e40af':'#1f2937',
                      overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                      {e.fullName}
                    </div>
                    {sub && (
                      <div style={{ fontSize:10.5,color:'#9ca3af',fontWeight:400 }}>{sub}</div>
                    )}
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

/* ═══════════════════════════════════════════════════════════════
   Yearly Present Absent Report
═══════════════════════════════════════════════════════════════ */
const YearlyPresentAbsentReport = () => {
  const [searchParams] = useSearchParams();
  const { language }   = useLanguage();
  const { settings }   = useSettings();
  const { employees, rosterVersion } = useData();
  const fd             = useDateFormat();
  const L = (np, en)   => language === 'np' ? np : en;

  const now     = getNepalNow();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(getNepalTodayISO());

  const urlYear = parseInt(searchParams.get('year'));
  const [year,        setYear]        = useState(urlYear || (useNP ? (todayBS?.year || now.getFullYear()) : now.getFullYear()));
  const [selectedId,  setSelectedId]  = useState('');
  const [data,        setData]        = useState(null);
  const [yearStats,   setYearStats]   = useState(null);  // late/early from half-monthly
  const [leaveData,   setLeaveData]   = useState(null);  // {types, balances, taken}
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [staffStatus, setStaffStatus] = useState('working'); // 'working' | 'notworking'

  const currentFY = getCurrentFiscalYear(settings.fiscalYears || []);

  // Sorted employees filtered by staffStatus
  const sortedEmps = useMemo(() =>
    [...employees]
      .filter(e => staffStatus === 'notworking' ? e.active === false : e.active !== false)
      .sort((a,b) => staffRankCompare(a, b, settings)),
    [employees, staffStatus, settings.branches]
  );

  // Auto-select first employee on mount or when staffStatus changes
  useEffect(() => {
    if (sortedEmps.length > 0) setSelectedId(String(sortedEmps[0].id));
    else setSelectedId('');
  }, [staffStatus, sortedEmps.length]);

  const load = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError(null);
    try {
      let startDate, endDate;
      if (useNP) {
        const sAD = bsToAD(year, 1,  1);
        const eAD = bsToAD(year, 12, getBSDays(year, 12));
        if (sAD && eAD) { startDate = isoDate(sAD); endDate = isoDate(eAD); }
      }
      if (!startDate) { startDate = `${year}-01-01`; endDate = `${year}-12-31`; }

      // Parallel: present-absent + half-monthly (late/early) + leave data.
      // employeeId narrows both endpoints down to just this one staff member
      // server-side instead of computing/returning the whole company's
      // day-by-day matrix for a full year just to read one row of it here.
      const activeParam = staffStatus === 'notworking' ? 'false' : 'true';
      const [paRes, hmRes, leavesRes, balRes, ltRes] = await Promise.allSettled([
        api.get(`/attendance/present-absent?startDate=${startDate}&endDate=${endDate}&active=${activeParam}&employeeId=${selectedId}`),
        api.get(`/attendance/half-monthly?startDate=${startDate}&endDate=${endDate}&half=1&active=${activeParam}&employeeId=${selectedId}`),
        api.get('/leave'),
        api.get('/leave/balances'),
        api.get('/leave/types'),
      ]);

      setData(paRes.status==='fulfilled' ? paRes.value : null);

      if (hmRes.status==='fulfilled' && hmRes.value?.allStats) {
        setYearStats(hmRes.value.allStats.find(s => String(s.id)===selectedId) || null);
      }

      if (leavesRes.status==='fulfilled' && balRes.status==='fulfilled' && ltRes.status==='fulfilled') {
        const adYear = startDate.split('-')[0];
        const empLeaves = (leavesRes.value||[]).filter(l =>
          String(l.employeeId)===selectedId && l.status==='approved' &&
          ((l.fromDate||'').startsWith(adYear) || (l.toDate||'').startsWith(adYear))
        );
        const takenByType = {};
        empLeaves.forEach(l => {
          takenByType[l.leaveTypeCode] = (takenByType[l.leaveTypeCode]||0) + (l.days||0);
        });
        const empBal = (balRes.value||[]).find(b => String(b.employeeId)===selectedId) || {};
        setLeaveData({ types: ltRes.value||[], takenByType, empBal });
      }

    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year, selectedId, useNP, staffStatus]);

  useEffect(() => { load(); }, [load, rosterVersion]);

  /* ── Build month-×-day matrix for selected staff ── */
  const matrix = useMemo(() => {
    if (!data || !selectedId) return [];
    const emp = (data.employees || []).find(e => String(e.id) === selectedId);
    if (!emp) return [];

    const months = useNP
      ? Array.from({length:12}, (_,i) => ({ idx:i, label:BS_MONTHS_SHORT[i], daysCount: getBSDays(year, i+1) }))
      : Array.from({length:12}, (_,i) => {
          const lastDay = new Date(data.period?.startDate ? parseInt(data.period.startDate.split('-')[0]) : year, i+1, 0).getDate();
          return { idx:i, label:MONTHS_EN_SHORT[i], daysCount: lastDay };
        });

    const adYear = useNP ? parseInt(data.period?.startDate?.split('-')[0] || year) : year;

    return months.map(({ idx, label, daysCount }) => {
      const days = Array.from({length: daysCount}, (_, di) => {
        const dayNum = di + 1;
        let dateStr;
        if (useNP) {
          const adDate = bsToAD(year, idx+1, dayNum);
          dateStr = adDate ? isoDate(adDate) : null;
        } else {
          dateStr = `${adYear}-${String(idx+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
        }
        const st = dateStr ? (emp.days[dateStr] || null) : null;
        const dayKey = dateStr ? DOW_SHORT[new Date(dateStr + 'T00:00:00').getDay()] : null;
        return { dayNum, dateStr, st, dayKey };
      });
      // counts for totals
      const P  = days.filter(d=>d.st==='P'||d.st==='P1'||d.st==='PP'||d.st==='PP1'||d.st==='WP'||d.st==='WP1').length;
      const AB = days.filter(d=>d.st==='AB').length;
      const L2 = days.filter(d=>d.st==='L').length;
      const PH = days.filter(d=>d.st==='PH').length;
      const W  = days.filter(d=>d.st==='H').length;
      return { label, days, P, AB, L:L2, PH, W };
    });
  }, [data, selectedId, year, useNP]);

  const maxDays = useMemo(() => Math.max(...matrix.map(m => m.days.length), 31), [matrix]);

  const grandP  = matrix.reduce((s,m) => s+m.P,  0);
  const grandAB = matrix.reduce((s,m) => s+m.AB, 0);
  const grandL  = matrix.reduce((s,m) => s+m.L,  0);

  const selectedEmp = sortedEmps.find(e => String(e.id) === selectedId);

  /* ── Year summary from matrix ── */
  const yearSummary = useMemo(() => {
    let total=0, present=0, absent=0, leave=0, ov=0, ph=0, weekend=0;
    matrix.forEach(m => m.days.forEach(d => {
      if (!d.dateStr) return;
      total++;
      if (d.st==='P'||d.st==='P1'||d.st==='PP'||d.st==='PP1'||d.st==='WP'||d.st==='WP1') present++;
      else if (d.st==='AB') absent++;
      else if (d.st==='L')  leave++;
      else if (d.st==='OV') ov++;
      else if (d.st==='PH') ph++;
      else if (d.st==='H')  weekend++;
    }));
    return { total, present, absent, leave, ov, ph, weekend,
      lateIn:  yearStats?.lateCount  || 0,
      earlyOut: yearStats?.earlyCount || 0,
    };
  }, [matrix, yearStats]);

  /* ── Table header/cell styles ── */
  const TH = {
    background:'#efefef', color:'#374151', fontWeight:700, fontSize:12.5,
    padding:'4px 5px', borderRight:'1px solid #dedede', borderBottom:'2px solid #dedede',
    textAlign:'center', whiteSpace:'nowrap', userSelect:'none',
  };
  const TD = {
    padding:'3px 3px', fontSize:12.5,
    borderRight:'1px solid #e5e7eb', borderBottom:'1px solid #f3f4f6',
    textAlign:'center', verticalAlign:'middle', minHeight:38,
  };

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            ✅ {L('वार्षिक उपस्थित/अनुपस्थित रिपोर्ट','Yearly Present Absent Report')}
          </h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY && (
              <span style={{ background:'#eff6ff',color:'#1a56db',borderRadius:6,
                padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>
                {currentFY.name}
              </span>
            )}
            {useNP ? `${settings.nepaliDigits?toNepaliDigits(year):year} BS` : String(year)}
            {selectedEmp && (
              <span style={{ marginLeft:8,fontWeight:600,color:'#1f2937' }}>
                — {selectedEmp.fullName}
              </span>
            )}
          </p>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <button
            onClick={() => {
              if (!matrix.length || !selectedEmp) return;
              const ST = { P:'#065f46,#d1fae5', P1:'#0369a1,#d1fae5', PP:'#713f12,#fef08a', PP1:'#713f12,#fef08a',
                           WP:'#0f766e,#ccfbf1', WP1:'#0f766e,#ccfbf1', AB:'#991b1b,#fee2e2',
                           H:'#9ca3af,#f3f4f6', L:'#5b21b6,#ede9fe', OV:'#1e40af,#dbeafe',
                           PH:'#92400e,#fef3c7' };
              const cellStyle = (st) => {
                if (!st) return 'color:#e5e7eb;';
                const [c,bg] = (ST[st]||ST.AB).split(',');
                return `background:${bg};color:${c};font-weight:800;border-radius:3px;`;
              };
              const cellLabel = (st) => ({ P:'P',P1:'P¹',PP:'H.P',PP1:'H.P¹',WP:'W.P',WP1:'W.P¹',AB:'AB',H:'W',L:'L',OV:'OV',PH:'PH' }[st]||'');

              // Build matrix rows HTML
              let matrixRows = matrix.map((row, ri) => {
                const days = Array.from({length: maxDays}, (_, i) => {
                  const d = row.days[i];
                  if (!d) return `<td style="padding:2px;border:1px solid #e5e7eb;font-size:8px;text-align:center;">·</td>`;
                  const label = cellLabel(d.st);
                  const dow = d.dayKey || '';
                  return `<td style="padding:2px;border:1px solid #e5e7eb;text-align:center;min-width:28px;">
                    <div style="font-size:9px;${cellStyle(d.st)}padding:1px 2px;">${label||'·'}</div>
                    <div style="font-size:7px;color:#9ca3af;">${dow}</div>
                  </td>`;
                }).join('');
                return `<tr>
                  <td style="padding:3px 5px;border:1px solid #dedede;font-weight:700;background:#efefef;font-size:9px;">${ri+1}</td>
                  <td style="padding:3px 6px;border:1px solid #dedede;font-weight:700;white-space:nowrap;font-size:10px;">${row.label}</td>
                  ${days}
                  <td style="padding:3px 6px;border:1px solid #dedede;background:#d1fae5;color:#065f46;font-weight:800;text-align:center;font-size:11px;">${row.P}</td>
                  <td style="padding:3px 6px;border:1px solid #dedede;background:#fee2e2;color:#991b1b;font-weight:800;text-align:center;font-size:11px;">${row.AB}</td>
                  <td style="padding:3px 6px;border:1px solid #dedede;color:#5b21b6;font-weight:800;text-align:center;font-size:11px;">${row.L}</td>
                </tr>`;
              }).join('');

              const dayHeaders = Array.from({length: maxDays}, (_, i) =>
                `<th style="background:#efefef;padding:4px 2px;border:1px solid #dedede;font-size:9px;min-width:28px;text-align:center;">${i+1}</th>`
              ).join('');

              // Summary text
              const sumItems = [
                [L('कुल दिन','Total Days'),yearSummary.total,'#374151'],[L('उपस्थित','Present'),yearSummary.present,'#065f46'],
                [L('अनुपस्थित','Absent'),yearSummary.absent,'#991b1b'],[L('बिदा','Leave'),yearSummary.leave,'#5b21b6'],
                [L('कार्यालय भ्रमण','Office Visit'),yearSummary.ov,'#1e40af'],[L('सार्वजनिक बिदा','Holiday'),yearSummary.ph,'#92400e'],
                [L('विकेन्ड','Weekend'),yearSummary.weekend,'#6b7280'],[L('ढिलो आएको','Late In'),yearSummary.lateIn,'#dc2626'],
                [L('चाँडो गएको','Early Out'),yearSummary.earlyOut,'#d97706'],
              ].map(([l,v,c])=>`<span>${l}: <strong style="color:${c}">${v}</strong></span>`).join(' &nbsp;·&nbsp; ');

              // Leave Details — transposed (rows = Opening/Current Year/Taken/Available, cols = leave types)
              let leaveHtml = '';
              if (leaveData && leaveData.types.length > 0) {
                const vis = leaveData.types.filter(lt => {
                  const t = leaveData.takenByType[lt.code]||0;
                  const b = leaveData.empBal[lt.code]??null;
                  return t>0||(b!==null&&b>0)||(lt.totalDays||0)>0;
                });
                if (vis.length > 0) {
                  const cols = vis.map(lt => {
                    const taken  = leaveData.takenByType[lt.code]||0;
                    const bal    = leaveData.empBal[lt.code]??null;
                    const annual = lt.totalDays||0;
                    const opening = bal!==null ? Math.max(0, bal+taken-annual) : 0;
                    return { name: lt.nameEn||lt.name, opening, annual, taken, avail: bal!==null?bal:annual-taken };
                  });
                  const TH2 = (t,align='center') => `<th style="background:#efefef;padding:6px 12px;border:1px solid #dedede;text-align:${align};font-weight:700;font-size:11px;white-space:nowrap;">${t}</th>`;
                  const TD2 = (v,bold=false,color='#374151') => `<td style="padding:6px 12px;border:1px solid #e5e7eb;text-align:center;${bold?'font-weight:800;':''}color:${color};">${v}</td>`;
                  leaveHtml = `
<div style="margin-top:14px;">
  <div style="font-weight:700;font-size:12px;color:#1e40af;padding-bottom:5px;margin-bottom:8px;border-bottom:2px solid #e2e8f0;">Leave Details</div>
  <table style="border-collapse:collapse;font-size:11px;">
    <thead><tr>
      ${TH2('',   'left')}
      ${cols.map(c=>TH2(c.name)).join('')}
    </tr></thead>
    <tbody>
      <tr>
        <td style="padding:6px 12px;border:1px solid #e5e7eb;font-weight:600;white-space:nowrap;">Opening</td>
        ${cols.map(c=>TD2(c.opening)).join('')}
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:6px 12px;border:1px solid #e5e7eb;font-weight:600;white-space:nowrap;">Current Year</td>
        ${cols.map(c=>TD2(c.annual)).join('')}
      </tr>
      <tr>
        <td style="padding:6px 12px;border:1px solid #e5e7eb;font-weight:600;white-space:nowrap;">Taken</td>
        ${cols.map(c=>TD2(c.taken, c.taken>0, c.taken>0?'#dc2626':'#374151')).join('')}
      </tr>
      <tr style="background:#f0fdf4;">
        <td style="padding:6px 12px;border:1px solid #e5e7eb;font-weight:800;text-align:right;white-space:nowrap;">Available</td>
        ${cols.map(c=>TD2(c.avail, true, c.avail>0?'#065f46':'#dc2626')).join('')}
      </tr>
    </tbody>
  </table>
</div>`;
                }
              }

              // Footer — signature section
              const footerHtml = `
<div style="margin-top:48px;">
  <div style="display:flex;justify-content:space-between;gap:24px;">
    ${['Prepared by','Recommended by','Approved By'].map(label=>`
      <div style="flex:1;text-align:center;">
        <div style="border-bottom:1.5px dotted #374151;margin-bottom:8px;height:32px;"></div>
        <div style="font-size:11px;font-weight:700;color:#374151;">${label}</div>
        <div style="font-size:10px;color:#6b7280;margin-top:5px;">Date : _______________</div>
      </div>`).join('')}
  </div>
</div>`;

              const logoHtml = settings.companyLogo
                ? `<img src="${settings.companyLogo}" style="height:52px;object-fit:contain;" />`
                : `<div style="width:52px;height:52px;background:#e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:22px;">🏢</div>`;

              const companyName = language==='np'?(settings.companyNameNp||settings.companyNameEn):(settings.companyNameEn||settings.companyNameNp);
              const companyAddr = language==='np'?(settings.companyAddressNp||settings.companyAddressEn):(settings.companyAddressEn||settings.companyAddressNp);

              const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>Yearly Present Absent Report</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; margin: 0; padding: 0; }
  .header       { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 8px; }
  .company-name { font-size: 15px; font-weight: 800; color: #1f2937; margin-bottom: 2px; }
  .company-sub  { font-size: 10px; color: #6b7280; margin-bottom: 6px; }
  .report-row   { display: flex; gap: 12px; align-items: center; font-size: 11px; font-weight: 700; color: #1a56db; }
  .hr-line      { border: none; border-top: 2px solid #374151; margin: 7px 0; }
  .staff-row    { display: flex; gap: 18px; font-size: 11px; flex-wrap: wrap; margin-bottom: 6px; }
  .staff-row span strong { color: #9ca3af; font-weight: 500; }
  .detail-row   { display: flex; gap: 8px; flex-wrap: wrap; font-size: 10px; padding: 5px 8px; background: #f9fafb; border: 1px solid #e5e7eb; margin-bottom: 6px; border-radius: 4px; align-items: center; }
  .detail-label { font-weight: 800; font-size: 11px; color: #374151; }
  table { border-collapse: collapse; width: 100%; }
</style>
</head><body>
<!-- Company header -->
<div class="header">
  ${logoHtml}
  <div style="flex:1;">
    <div class="company-name">${companyName||''}</div>
    <div class="company-sub">${companyAddr||''}${settings.companyPhone?' · Tel: '+settings.companyPhone:''}${settings.companyEmail?' · '+settings.companyEmail:''}</div>
    <div class="report-row">
      ${currentFY?`<span>Fiscal Year : ${currentFY.name}</span><span style="color:#d1d5db">|</span>`:''}
      <span>✅ Yearly Present Absent Report</span>
    </div>
  </div>
</div>
<!-- Separator above staff info -->
<hr class="hr-line">
<!-- Staff info row (plain text) -->
<div class="staff-row">
  <span><strong>Staff : </strong><b style="color:#1f2937;font-weight:800;">${selectedEmp.fullName||'—'}</b></span>
  <span><strong>Post : </strong><span style="color:#0369a1;font-weight:700;">${selectedEmp.position||'—'}</span></span>
  <span><strong>Grade : </strong><span style="color:#374151;font-weight:700;">${selectedEmp.grade||'—'}</span></span>
  <span><strong>Department : </strong><span style="color:#059669;font-weight:700;">${selectedEmp.department||'—'}</span></span>
  <span><strong>Branch : </strong><span style="color:#7c3aed;font-weight:700;">${selectedEmp.branch||'—'}</span></span>
</div>
<!-- Detail | Summary bar -->
<div class="detail-row">
  <span class="detail-label">Detail</span>
  <span style="color:#d1d5db;">|</span>
  ${sumItems}
</div>
<!-- Matrix table -->
<table>
  <thead>
    <tr>
      <th style="background:#efefef;padding:4px 5px;border:1px solid #dedede;font-size:9px;width:24px;">SN</th>
      <th style="background:#efefef;padding:4px 6px;border:1px solid #dedede;font-size:10px;text-align:left;white-space:nowrap;">Month</th>
      ${dayHeaders}
      <th style="background:#d1fae5;padding:4px 5px;border:1px solid #dedede;font-size:9px;color:#065f46;width:24px;">P</th>
      <th style="background:#fee2e2;padding:4px 5px;border:1px solid #dedede;font-size:9px;color:#991b1b;width:26px;">AB</th>
      <th style="background:#ede9fe;padding:4px 5px;border:1px solid #dedede;font-size:9px;color:#5b21b6;width:24px;">L</th>
    </tr>
  </thead>
  <tbody>${matrixRows}</tbody>
</table>
${leaveHtml}
${footerHtml}
<script>window.onload=function(){window.focus();window.print();setTimeout(()=>window.close(),1000);}</script>
</body></html>`;

              const w = window.open('','_blank','width=1400,height=900,scrollbars=yes');
              if (w) { w.document.write(html); w.document.close(); }
            }}
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#eff6ff',border:'1px solid #93c5fd',color:'#1d4ed8',
              borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            🖨️ Print
          </button>
          <ViewYearlyBtn year={year} useNP={useNP} currentPath="/attendance/reports/yearly/present-absent" />
        </div>
      </div>

      {/* ── Controls: Year + Staff Search ── */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap' }}>
        <select className="form-control" style={{ width:useNP?115:85,height:36,fontSize:13 }}
          value={year} onChange={e=>setYear(+e.target.value)}>
          {useNP
            ? [todayBS?.year-2,todayBS?.year-1,todayBS?.year,todayBS?.year+1].filter(Boolean).map(y=>(
                <option key={y} value={y}>{settings.nepaliDigits?toNepaliDigits(y):y} BS</option>))
            : [now.getFullYear()-2,now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1].map(y=>(
                <option key={y} value={y}>{y}</option>))
          }
        </select>

        {/* Status toggle */}
        <div style={{ display:'flex', gap:0, border:'1px solid #d1d5db', borderRadius:8, overflow:'hidden' }}>
          {[['working', L('कार्यरत','Working')], ['notworking', L('अवकाश','Not Working')]].map(([v, label]) => (
            <button key={v}
              onClick={() => { setStaffStatus(v); setSelectedId(''); }}
              style={{ padding:'5px 14px', border:'none', cursor:'pointer',
                fontSize:13, fontWeight:600, transition:'background .15s',
                background: staffStatus === v ? '#1a56db' : 'white',
                color: staffStatus === v ? 'white' : '#374151' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Staff selector */}
        <div style={{ display:'flex',alignItems:'center',gap:6 }}>
          <span style={{ fontSize:13,fontWeight:600,color:'#374151',flexShrink:0 }}>
            {L('कर्मचारी','Staff')} :
          </span>
          <StaffSelect employees={sortedEmps} value={selectedId} onChange={setSelectedId} L={L} />
        </div>

        <button className="btn btn-outline btn-sm" style={{ height:36 }} onClick={load} disabled={loading||!selectedId}>🔃</button>

        {/* Summary badges */}
        {matrix.length > 0 && !loading && (
          <div style={{ display:'flex',gap:6,marginLeft:'auto',flexWrap:'wrap',alignItems:'center' }}>
            <span style={{ background:'#d1fae5',color:'#065f46',borderRadius:20,
              padding:'3px 12px',fontSize:12,fontWeight:700,border:'1px solid #6ee7b7' }}>
              {grandP} P
            </span>
            <span style={{ background:'#fee2e2',color:'#991b1b',borderRadius:20,
              padding:'3px 12px',fontSize:12,fontWeight:700,border:'1px solid #fca5a5' }}>
              {grandAB} AB
            </span>
            <span style={{ background:'#ede9fe',color:'#5b21b6',borderRadius:20,
              padding:'3px 12px',fontSize:12,fontWeight:700,border:'1px solid #c4b5fd' }}>
              {grandL} L
            </span>
          </div>
        )}
      </div>

      {error && (
        <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,
          padding:'10px 16px',marginBottom:12,color:'#991b1b',fontWeight:600 }}>❌ {error}</div>
      )}

      {/* ── Staff info — plain text with bottom underline, above Total Days ── */}
      {selectedEmp && (
        <div style={{ display:'flex',gap:16,flexWrap:'wrap',
          paddingBottom:8, marginBottom:10,
          borderBottom:'2px solid #374151',
          alignItems:'center' }}>
          <strong style={{ fontSize:14,fontWeight:800,color:'#1f2937' }}>{selectedEmp.fullName}</strong>
          {selectedEmp.employeeId && (
            <span style={{ fontSize:12,color:'#6b7280',fontWeight:500 }}>{selectedEmp.employeeId}</span>
          )}
          {[
            { label:L('पद','Post'),       value: selectedEmp.position,   color:'#0369a1' },
            { label:L('विभाग','Department'), value: selectedEmp.department,  color:'#059669' },
            { label:L('मोड','Mode'),       value: selectedEmp.mode,        color:'#374151' },
            { label:L('ग्रेड','Grade'),      value: selectedEmp.grade,       color:'#374151' },
          ].filter(f => f.value).map(f => (
            <span key={f.label} style={{ fontSize:12 }}>
              <span style={{ color:'#9ca3af', fontWeight:500 }}>{f.label}: </span>
              <strong style={{ color:f.color }}>{f.value}</strong>
            </span>
          ))}
        </div>
      )}

      {!selectedId && (
        <div style={{ textAlign:'center',padding:'60px 20px',color:'#9ca3af' }}>
          <div style={{ fontSize:36,marginBottom:8 }}>👤</div>
          <div style={{ fontWeight:600,fontSize:14,color:'#374151' }}>
            {L('माथिबाट कर्मचारी छान्नुस','Select a staff member above')}
          </div>
        </div>
      )}

      {loading && <LoadingIndicator />}

      {/* ── Detail Matrix ── */}
      {!loading && matrix.length > 0 && (
        <div className="yearly-print-area">
          {/* Company header — visible on print only */}
          <div className="yearly-print-only" style={{ display:'none', marginBottom:14,
            borderBottom:'2px solid #374151', paddingBottom:12 }}>
            {/* Row 1: Logo left + Company info right */}
            <div style={{ display:'flex', alignItems:'flex-start', gap:16 }}>
              {/* Logo */}
              {settings.companyLogo ? (
                <img src={settings.companyLogo} alt="logo"
                  style={{ height:64, width:'auto', flexShrink:0, objectFit:'contain' }} />
              ) : (
                <div style={{ width:64, height:64, flexShrink:0,
                  background:'#e5e7eb', borderRadius:8, display:'flex',
                  alignItems:'center', justifyContent:'center', fontSize:22 }}>🏢</div>
              )}

              {/* Right side */}
              <div style={{ flex:1, minWidth:0 }}>
                {/* Company name */}
                <div style={{ fontSize:15, fontWeight:800, color:'#1f2937', marginBottom:2 }}>
                  {language==='np' ? (settings.companyNameNp||settings.companyNameEn) : (settings.companyNameEn||settings.companyNameNp)}
                </div>
                {/* Address / contact */}
                {(settings.companyAddressEn||settings.companyAddressNp) && (
                  <div style={{ fontSize:11, color:'#6b7280', marginBottom:6 }}>
                    {language==='np' ? (settings.companyAddressNp||settings.companyAddressEn) : (settings.companyAddressEn||settings.companyAddressNp)}
                    {settings.companyPhone ? ` · Tel: ${settings.companyPhone}` : ''}
                    {settings.companyEmail ? ` · ${settings.companyEmail}` : ''}
                  </div>
                )}

                {/* FY + Report Title row */}
                <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
                  {currentFY && (
                    <span style={{ fontSize:12, fontWeight:700, color:'#1a56db' }}>
                      Fiscal Year : {currentFY.name}
                    </span>
                  )}
                  <span style={{ color:'#d1d5db' }}>|</span>
                  <span style={{ fontSize:13, fontWeight:800, color:'#1f2937' }}>
                    ✅ Yearly Present Absent Report
                  </span>
                </div>

                {/* Staff details row — left aligned with solid black underline */}
                <div style={{ display:'flex', gap:20, flexWrap:'wrap', fontSize:12,
                  textAlign:'left', paddingBottom:6,
                  borderBottom:'2px solid #000' }}>
                  <span>
                    <strong style={{ color:'#6b7280' }}>Staff : </strong>
                    <strong style={{ color:'#1f2937' }}>{selectedEmp?.fullName || '—'}</strong>
                  </span>
                  <span>
                    <strong style={{ color:'#6b7280' }}>Post : </strong>
                    <span style={{ color:'#0369a1' }}>{selectedEmp?.position || '—'}</span>
                  </span>
                  <span>
                    <strong style={{ color:'#6b7280' }}>Grade : </strong>
                    <span style={{ color:'#374151' }}>{selectedEmp?.grade || '—'}</span>
                  </span>
                  <span>
                    <strong style={{ color:'#6b7280' }}>Department : </strong>
                    <span style={{ color:'#059669' }}>{selectedEmp?.department || '—'}</span>
                  </span>
                  <span>
                    <strong style={{ color:'#6b7280' }}>Branch : </strong>
                    <span style={{ color:'#7c3aed' }}>{selectedEmp?.branch || '—'}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <>
          {/* Detail heading + inline text summary */}
          <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:8,
            flexWrap:'wrap', padding:'8px 12px', background:'#f9fafb',
            borderRadius:8, border:'1px solid #e5e7eb' }}>
            <span style={{ fontSize:13, fontWeight:800, color:'#374151', flexShrink:0 }}>
              {L('विवरण','Detail')}
            </span>
            <span style={{ color:'#d1d5db', flexShrink:0 }}>|</span>
            {[
              { label:L('कुल दिन','Total Days'),      value:yearSummary.total,    color:'#374151'  },
              { label:L('उपस्थित','Present'),         value:yearSummary.present,  color:'#065f46'  },
              { label:L('अनुपस्थित','Absent'),        value:yearSummary.absent,   color:'#991b1b'  },
              { label:L('बिदा','Leave'),              value:yearSummary.leave,    color:'#5b21b6'  },
              { label:L('कार्यालय भ्रमण','Office Visit'), value:yearSummary.ov,   color:'#1e40af'  },
              { label:L('सार्वजनिक बिदा','Holiday'),  value:yearSummary.ph,       color:'#92400e'  },
              { label:L('विकेन्ड','Weekend'),         value:yearSummary.weekend,  color:'#6b7280'  },
              { label:L('ढिलो आएको','Late In'),       value:yearSummary.lateIn,   color:'#dc2626'  },
              { label:L('चाँडो गएको','Early Out'),    value:yearSummary.earlyOut, color:'#d97706'  },
            ].map((s, i, arr) => (
              <React.Fragment key={s.label}>
                <span style={{ fontSize:12, whiteSpace:'nowrap' }}>
                  <span style={{ color:'#6b7280', fontWeight:500 }}>{s.label}: </span>
                  <strong style={{ color:s.color, fontSize:13 }}>{s.value}</strong>
                </span>
                {i < arr.length - 1 && <span style={{ color:'#e5e7eb', flexShrink:0 }}>·</span>}
              </React.Fragment>
            ))}
          </div>
          <div style={{ overflowX:'auto', borderRadius:8,
            border:'1px solid #dedede', boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
            <table style={{ borderCollapse:'collapse', width:'100%' }}>
              <thead>
                <tr>
                  {/* SN column */}
                  <th style={{ ...TH, minWidth:36, width:36, position:'sticky', left:0, zIndex:3 }}>SN</th>
                  {/* Month label column — auto-width */}
                  <th style={{ ...TH, width:'1%', minWidth:0, textAlign:'left', position:'sticky', left:36, zIndex:3, whiteSpace:'nowrap' }}>
                    Month
                  </th>
                  {/* Day number columns */}
                  {Array.from({length: maxDays}, (_, i) => (
                    <th key={i+1} style={{ ...TH, minWidth:36, width:36 }}>{i+1}</th>
                  ))}
                  {/* Totals */}
                  <th style={{ ...TH, minWidth:34, background:'#d1fae5', color:'#065f46' }}>P</th>
                  <th style={{ ...TH, minWidth:34, background:'#fee2e2', color:'#991b1b' }}>AB</th>
                  <th style={{ ...TH, minWidth:34, background:'#ede9fe', color:'#5b21b6' }}>L</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, ri) => (
                  <tr key={ri}
                    style={{ background: ri%2===0?'white':'#f3f4f6' }}
                    onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
                    onMouseLeave={e=>e.currentTarget.style.background=ri%2===0?'white':'#f3f4f6'}>
                    {/* SN */}
                    <td style={{ ...TD, background:'#efefef', fontWeight:700, color:'#6b7280',
                      position:'sticky', left:0, zIndex:1, borderRight:'1px solid #dedede', width:36 }}>
                      {ri+1}
                    </td>
                    {/* Month name */}
                    <td style={{ ...TD, fontWeight:700, color:'#374151', textAlign:'left',
                      padding:'4px 10px', position:'sticky', left:36, background:'inherit', zIndex:1,
                      borderRight:'2px solid #dedede', minWidth:76 }}>
                      {row.label}
                    </td>
                    {/* Status cells with day abbreviation */}
                    {Array.from({length: maxDays}, (_, i) => {
                      const dayData = row.days[i];
                      return (
                        <td key={i} style={{ ...TD, padding:'3px 2px', width:36, minWidth:36 }}
                          title={dayData?.dateStr ? fd(dayData.dateStr) : ''}>
                          {dayData
                            ? <StatusCell st={dayData.st} dayKey={dayData.dayKey} language={language} />
                            : <span style={{ color:'#f0f0f0', fontSize:9 }}>·</span>
                          }
                        </td>
                      );
                    })}
                    {/* Month totals */}
                    <td style={{ ...TD, background:'#f0fdf4', fontWeight:800, color:'#065f46' }}>{row.P}</td>
                    <td style={{ ...TD, background: row.AB>0?'#fff5f5':'white', fontWeight:800,
                      color:row.AB>0?'#991b1b':'#d1d5db' }}>{row.AB}</td>
                    <td style={{ ...TD, fontWeight:800, color:row.L>0?'#5b21b6':'#d1d5db' }}>{row.L}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Leave Balance ── */}
          {leaveData && leaveData.types.length > 0 && (() => {
            // Only show leave types with non-zero values
            const visibleTypes = leaveData.types.filter(lt => {
              const taken   = leaveData.takenByType[lt.code] || 0;
              const balance = leaveData.empBal[lt.code] ?? null;
              const annual  = lt.totalDays || 0;
              return taken > 0 || (balance !== null && balance > 0) || annual > 0;
            });
            if (visibleTypes.length === 0) return null;

            /* Compute per-column data */
            const cols = visibleTypes.map(lt => {
              const taken   = leaveData.takenByType[lt.code] || 0;
              const balance = leaveData.empBal[lt.code] ?? null;
              const annual  = lt.totalDays || 0;
              const opening = balance !== null ? Math.max(0, balance + taken - annual) : 0;
              const avail   = balance !== null ? balance : Math.max(0, annual - taken);
              return { name: lt.nameEn || lt.name, opening, annual, taken, avail };
            });

            /* Shared cell styles */
            const TH3 = ({ children, align='center' }) => (
              <th style={{ background:'#efefef', color:'#374151', fontWeight:700, fontSize:12.5,
                padding:'4px 8px', borderRight:'1px solid #dedede', borderBottom:'2px solid #dedede',
                textAlign:align, whiteSpace:'nowrap' }}>
                {children}
              </th>
            );
            const TD3 = ({ children, bold, color, bg='white', align='center' }) => (
              <td style={{ padding:'3px 8px', borderRight:'1px solid #e5e7eb',
                borderBottom:'1px solid #f3f4f6', textAlign:align, background:bg,
                fontWeight:bold?800:400, color:color||'#374151', fontSize:12.5 }}>
                {children}
              </td>
            );

            const rows = [
              { label:'Opening',      key:'opening', rowBg:'white'  },
              { label:'Current Year', key:'annual',  rowBg:'#f9fafb' },
              { label:'Taken',        key:'taken',   rowBg:'white'  },
              { label:'Available',    key:'avail',   rowBg:'#f0fdf4', bold:true },
            ];

            return (
              <div style={{ marginTop:14, borderRadius:10, border:'1px solid #e5e7eb',
                overflow:'auto', boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
                {/* Header */}
                <div style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0',
                  padding:'10px 16px', fontWeight:700, fontSize:13, color:'#1e40af' }}>
                  {L('बिदा विवरण','Leave Details')}
                </div>
                <table style={{ borderCollapse:'collapse' }}>
                  <thead>
                    <tr>
                      <TH3 align="left"></TH3>
                      {cols.map(c => <TH3 key={c.name}>{c.name}</TH3>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.key} style={{ background:row.rowBg }}>
                        <TD3 align="left" bold={row.bold} bg={row.rowBg}
                          color={row.bold?'#1f2937':'#374151'}>
                          {row.label}
                        </TD3>
                        {cols.map(c => {
                          const v = c[row.key];
                          let color = row.bold
                            ? (v > 0 ? '#065f46' : '#dc2626')
                            : row.key==='taken' && v > 0 ? '#dc2626' : '#374151';
                          return (
                            <TD3 key={c.name} bold={row.bold} color={color} bg={row.rowBg}>
                              {v}
                            </TD3>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          <div style={{ marginTop:10,display:'flex',gap:12,flexWrap:'wrap',fontSize:11,
            color:'#6b7280',padding:'8px 12px',background:'#f9fafb',
            borderRadius:8,border:'1px solid #e5e7eb',alignItems:'center' }}>
            <strong style={{ color:'#374151' }}>{L('व्याख्या','Legend')}:</strong>
            {Object.entries(STATUS).map(([k,s])=>(
              <span key={k} style={{ display:'inline-flex',alignItems:'center',gap:4 }}>
                <span style={{ background:s.bg,color:s.color,border:`1px solid ${s.color}44`,
                  borderRadius:3,padding:'1px 5px',fontSize:10,fontWeight:800 }}>{s.label}</span>
                <span>= {statusTitle(k, language)}</span>
              </span>
            ))}
          </div>
          </>
        </div>
      )}
    </div>
  );
};

export default YearlyPresentAbsentReport;
