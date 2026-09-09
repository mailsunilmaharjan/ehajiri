import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import api             from '../../api/client.js';
import useDateFormat   from '../../hooks/useDateFormat.js';
import { adToBS, bsToAD, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits, getNepalNow, getNepalTodayISO, getCurrentFiscalYear } from '../../utils/dateUtils.js';
import LoadingIndicator from '../Common/LoadingIndicator.jsx';
import ReportIcon from './ReportIcon.jsx';

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];
const MONTHS_NP = ['बैशाख','जेठ','असार','श्रावण','भाद्र','आश्विन',
                   'कार्तिक','मंसिर','पुष','माघ','फागुन','चैत्र'];

/* ── Tiny atoms ──────────────────────────────────────────────── */
const Avatar = ({ name, size=36 }) => {
  const colors = ['#1a56db','#059669','#7c3aed','#dc2626','#d97706','#0369a1'];
  const color  = colors[(name||'?').charCodeAt(0) % colors.length];
  return (
    <div style={{ width:size,height:size,borderRadius:'50%',background:color,
      color:'white',fontWeight:700,fontSize:size*0.38,display:'flex',
      alignItems:'center',justifyContent:'center',flexShrink:0 }}>
      {(name||'?')[0].toUpperCase()}
    </div>
  );
};

const ScoreBadge = ({ value, suffix='%', good=true, size='md' }) => {
  const bg = good
    ? value>=90?'#d1fae5':value>=75?'#fef3c7':'#fee2e2'
    : value<=2?'#d1fae5':value<=5?'#fef3c7':'#fee2e2';
  const color = good
    ? value>=90?'#065f46':value>=75?'#92400e':'#991b1b'
    : value<=2?'#065f46':value<=5?'#92400e':'#991b1b';
  return (
    <span style={{ background:bg,color,borderRadius:8,padding:size==='sm'?'2px 8px':'4px 12px',
      fontSize:size==='sm'?12:14,fontWeight:800 }}>
      {value}{suffix}
    </span>
  );
};

const RankCard = ({ icon, title, color, bg, border, items, valueKey, valueSuffix='', valueGood=true, emptyMsg }) => (
  <div style={{ background:'white',borderRadius:12,border:`1px solid ${border}`,
    overflow:'hidden',boxShadow:'0 1px 6px rgba(0,0,0,.06)' }}>
    <div style={{ background:bg,borderBottom:`1px solid ${border}`,
      padding:'12px 16px',display:'flex',alignItems:'center',gap:8 }}>
      <span style={{ fontSize:22 }}>{icon}</span>
      <span style={{ fontWeight:700,fontSize:14,color }}>{title}</span>
    </div>
    {items.length===0 ? (
      <div style={{ padding:'20px',textAlign:'center',color:'#9ca3af',fontSize:13 }}>{emptyMsg||'No data'}</div>
    ) : (
      <div>
        {items.map((item,i)=>(
          <div key={item.id} style={{ display:'flex',alignItems:'center',gap:10,
            padding:'10px 14px',borderBottom:i<items.length-1?'1px solid #f3f4f6':'none',
            background:i===0?`${bg}44`:'white' }}>
            <div style={{ width:22,height:22,borderRadius:'50%',
              background:i===0?color:'#f3f4f6',color:i===0?'white':'#9ca3af',
              fontWeight:800,fontSize:11,display:'flex',alignItems:'center',
              justifyContent:'center',flexShrink:0 }}>{i+1}</div>
            <Avatar name={item.fullName} size={30} />
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ fontWeight:600,fontSize:13,color:'#1f2937',
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{item.fullName}</div>
              <div style={{ fontSize:11,color:'#9ca3af' }}>{item.department}</div>
            </div>
            <ScoreBadge value={item[valueKey]} suffix={valueSuffix} good={valueGood} size="sm" />
          </div>
        ))}
      </div>
    )}
  </div>
);

const InsightCard = ({ icon, text, type }) => {
  const styles = {
    positive : { bg:'#f0fdf4', border:'#86efac', color:'#065f46' },
    neutral  : { bg:'#eff6ff', border:'#93c5fd', color:'#1e40af' },
    warning  : { bg:'#fff7ed', border:'#fed7aa', color:'#c2410c' },
  };
  const s = styles[type] || styles.neutral;
  return (
    <div style={{ background:s.bg,border:`1px solid ${s.border}`,borderRadius:10,
      padding:'12px 16px',display:'flex',gap:12,alignItems:'flex-start' }}>
      <span style={{ fontSize:22,flexShrink:0 }}>{icon}</span>
      <p style={{ margin:0,fontSize:13,color:s.color,fontWeight:500,lineHeight:1.5 }}>{text}</p>
    </div>
  );
};

const StatPill = ({ label, value, color, bg }) => (
  <div style={{ background:bg,borderRadius:10,padding:'10px 16px',
    border:`1px solid ${color}22`,textAlign:'center',minWidth:90 }}>
    <div style={{ fontSize:22,fontWeight:800,color }}>{value}</div>
    <div style={{ fontSize:11,color:'#6b7280',marginTop:2 }}>{label}</div>
  </div>
);

/* ── Sub-report menu ─────────────────────────────────────────── */
const SUB_REPORTS = (L) => [
  { icon:'bookOpen',    label:L('मासिक स्टाफ लेजर','Monthly Staff Ledger'),      path:'/attendance/reports/monthly/ledger' },
  { icon:'checkCircle', label:L('उपस्थित/अनुपस्थित रिपोर्ट','Present Absent Report'), path:'/attendance/reports/monthly/present-absent' },
  { icon:'barChart',    label:L('सारांश रिपोर्ट','Summary Report'),             path:'/attendance/reports/monthly/summary' },
  { icon:'repeat',      label:L('IN & OUT रिपोर्ट','IN & OUT Report'),          path:'/attendance/reports/monthly/in-out' },
  { icon:'calendar',    label:L('अनुपस्थित रिपोर्ट','Absent Report'),           path:'/attendance/reports/monthly/absent' },
  { icon:'clock',       label:L('ढिला/चाँडो रिपोर्ट','Late In Early Out Report'), path:'/attendance/reports/monthly/late-early' },
  { icon:'zap',         label:L('ओभरटाइम रिपोर्ट','Over Time Report'),         path:'/attendance/reports/monthly/overtime' },
];

const ViewReportsBtn = ({ year, month, useNP }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const subReports = SUB_REPORTS(L);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const go = (path) => {
    let adYear = year, adMonth = month;
    if (useNP) {
      const adDate = bsToAD(year, month, 15);
      if (adDate) { adYear = adDate.getFullYear(); adMonth = adDate.getMonth() + 1; }
    }
    // Default half based on today's date
    const todayDay = getNepalNow().getDate();
    const half = todayDay <= 15 ? 1 : 2;
    navigate(`${path}?year=${adYear}&month=${adMonth}&half=${half}`);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button onClick={() => setOpen(p => !p)}
        style={{ display:'inline-flex',alignItems:'center',gap:7,padding:'7px 16px',height:36,
          background:open?'#1e40af':'#1a56db',color:'white',border:'none',borderRadius:8,
          fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:'0 2px 8px rgba(26,86,219,.3)' }}>
        <svg viewBox="0 0 20 20" fill="white" width="14" height="14">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
        </svg>
        {L('मासिक रिपोर्टहरू हेर्नुहोस्','View Monthly Reports')}
        <svg viewBox="0 0 20 20" fill="white" width="12" height="12"
          style={{ transform:open?'rotate(180deg)':'none',transition:'transform .2s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>

      {open && (
        <div style={{ position:'absolute',top:'calc(100% + 6px)',right:0,zIndex:500,
          background:'white',border:'1px solid #e5e7eb',borderRadius:10,
          boxShadow:'0 8px 28px rgba(0,0,0,.13)',overflow:'hidden',minWidth:240 }}>
          <div style={{ padding:'8px 14px',background:'#f9fafb',borderBottom:'1px solid #f3f4f6',
            fontSize:11,fontWeight:700,color:'#6b7280',textTransform:'uppercase',letterSpacing:'.5px' }}>
            {L('मासिक रिपोर्टहरू','Monthly Reports')}
          </div>
          {subReports.map((r, i) => (
            <button key={r.path} onClick={() => go(r.path)}
              style={{ width:'100%',display:'flex',alignItems:'center',gap:9,
                padding:'7px 14px',background:'white',border:'none',
                borderBottom:i<subReports.length-1?'1px solid #f0f0f0':'none',
                textAlign:'left',cursor:'pointer',fontSize:13,color:'#374151' }}
              onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
              onMouseLeave={e=>e.currentTarget.style.background='white'}>
              <ReportIcon name={r.icon} />
              <span style={{ fontWeight:500 }}>{r.label}</span>
              <svg viewBox="0 0 20 20" fill="#d1d5db" width="12" height="12" style={{ marginLeft:'auto',flexShrink:0 }}>
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Monthly Report Page
═══════════════════════════════════════════════════════════════ */
const MonthlyReport = () => {
  const { language } = useLanguage();
  const { settings } = useSettings();
  const { currentUser, isEmployee } = useAuth();
  const { rosterVersion } = useData();
  const L = (np,en) => language==='np' ? np : en;

  const now     = getNepalNow();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(getNepalTodayISO());

  const initYear  = useNP ? (todayBS?.year  || now.getFullYear())  : now.getFullYear();
  const initMonth = useNP ? (todayBS?.month || now.getMonth()+1)   : now.getMonth()+1;

  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';

  const [year,    setYear]    = useState(initYear);
  const [month,   setMonth]   = useState(initMonth);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const currentFY = getCurrentFiscalYear(settings.fiscalYears || []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let apiYear = year, apiMonth = month;
      if (useNP) {
        const adDate = bsToAD(year, month, 15);
        if (adDate) { apiYear = adDate.getFullYear(); apiMonth = adDate.getMonth() + 1; }
      }
      const query = `/attendance/monthly?year=${apiYear}&month=${apiMonth}&orgScope=1${myEmpId ? `&employeeId=${myEmpId}` : ''}`;
      setData(await api.get(query));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year, month, useNP]);

  useEffect(() => { load(); }, [load, rosterVersion]);

  // Period label
  const periodLabel = (() => {
    if (useNP) {
      const mnLabel = language==='np' ? BS_MONTHS_NP[month-1] : BS_MONTHS_EN[month-1];
      return `${mnLabel} ${settings.nepaliDigits ? toNepaliDigits(year) : year} BS`;
    }
    return `${MONTHS_EN[month-1]} ${year}`;
  })();

  const period = data?.period;
  const sum    = data?.summary;
  const rank   = data?.rankings;
  const ins    = data?.insights || [];

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            📅 {L('मासिक रिपोर्ट','Monthly Report')}
          </h1>
          <p className="page-subtitle">
            {currentFY && (
              <span style={{ background:'#eff6ff',color:'#1a56db',borderRadius:6,
                padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>
                {currentFY.name}
              </span>
            )}
            {periodLabel}
            {period && (
              <span style={{ marginLeft:8,fontSize:12,color:'#9ca3af' }}>
                ({period.startDate} → {period.endDate} · {period.totalWorkingDays} {L('कार्य दिन','working days')})
              </span>
            )}
          </p>
        </div>
        <div style={{ display:'flex',gap:8,alignItems:'center' }}>
          <button onClick={()=>window.print()} style={{ display:'inline-flex',alignItems:'center',gap:5,
            padding:'6px 14px',height:36,background:'#eff6ff',border:'1px solid #93c5fd',
            color:'#1d4ed8',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            🖨️ Print
          </button>
          <ViewReportsBtn year={year} month={month} useNP={useNP} />
        </div>
      </div>

      {/* ── Period selector ── */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:18,flexWrap:'wrap' }}>
        <select className="form-control" style={{ width:useNP?115:85,height:34,fontSize:13 }}
          value={year} onChange={e=>setYear(+e.target.value)}>
          {useNP
            ? [todayBS?.year-1,todayBS?.year,todayBS?.year+1].filter(Boolean).map(bsY=>(
                <option key={bsY} value={bsY}>{settings.nepaliDigits?toNepaliDigits(bsY):bsY} BS</option>
              ))
            : [now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1].map(y=>(
                <option key={y} value={y}>{y}</option>
              ))
          }
        </select>

        <select className="form-control" style={{ width:useNP?120:140,height:34,fontSize:13 }}
          value={month} onChange={e=>setMonth(+e.target.value)}>
          {useNP
            ? BS_MONTHS_NP.map((bsName,i)=>(
                <option key={i+1} value={i+1}>{settings.nepaliDigits?toNepaliDigits(bsName):bsName}</option>
              ))
            : MONTHS_EN.map((m,i)=>(
                <option key={i+1} value={i+1}>{m}</option>
              ))
          }
        </select>

        <button className="btn btn-outline btn-sm" style={{ height:34 }} onClick={load}>
          🔃 {L('रिफ्रेस','Refresh')}
        </button>
      </div>

      {error && (
        <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,
          padding:'10px 16px',marginBottom:14,color:'#991b1b',fontWeight:600 }}>
          ❌ {error}
        </div>
      )}

      {loading && <LoadingIndicator label="Analysing monthly attendance data…" />}

      {!loading && data && (
        <>
          {/* ── Month calendar stats row ── */}
          <div style={{ display:'flex',gap:10,marginBottom:20,flexWrap:'wrap',alignItems:'stretch' }}>
            <StatPill label={L('जम्मा दिन','Total Days')}            value={period.totalDays ?? '—'}        color="#1a56db" bg="#eff6ff" />
            <StatPill label={L('कार्य दिन','No. of Working Days')}  value={period.totalWorkingDays ?? '—'} color="#059669" bg="#d1fae5" />
            <StatPill label={L('सप्ताहन्त','Weekend')}                value={period.weekendDays ?? '—'}      color="#6b7280" bg="#f3f4f6" />
            <StatPill label={L('सार्वजनिक बिदा','Public Holiday')}    value={period.holidayDays ?? '—'}      color="#d97706" bg="#fef3c7" />
          </div>

          {/* ── AI Insights ── */}
          <div style={{ marginBottom:20 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:10 }}>
              <span style={{ fontSize:20 }}>🤖</span>
              <h2 style={{ margin:0,fontSize:16,fontWeight:700,color:'#1f2937' }}>eHajiri TMS Analysis</h2>
              <span style={{ fontSize:11,color:'#9ca3af',fontWeight:400 }}>
                — auto-generated from {period.totalWorkingDays} working days of data
              </span>
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:10 }}>
              {ins.map((insight,i) => (
                <InsightCard key={i} icon={insight.icon} text={insight.text} type={insight.type} />
              ))}
              {sum.perfectAtt > 0 && (
                <InsightCard type="positive" icon="✅"
                  text={`${sum.perfectAtt} staff had perfect attendance for the entire month — zero absences and zero late arrivals!`} />
              )}
              {rank.mostAbsent.length > 0 && rank.mostAbsent[0].absentDays >= 3 && (
                <InsightCard type="warning" icon="📋"
                  text={`${rank.mostAbsent[0].fullName} absent ${rank.mostAbsent[0].absentDays} days this month — follow up recommended.`} />
              )}
            </div>
          </div>

          {/* ── Rankings Grid ── */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:14 }}>
            <RankCard icon="⭐" title={L('सबैभन्दा पाबन्द','Most Punctual')}
              color="#065f46" bg="#f0fdf4" border="#bbf7d0"
              items={rank.topPunctual} valueKey="punctualityScore" valueSuffix="%" valueGood={true} />
            <RankCard icon="⏰" title={L('सबैभन्दा ढिला','Most Late-In')}
              color="#dc2626" bg="#fff1f2" border="#fecdd3"
              items={rank.mostLate} valueKey="lateCount" valueSuffix=" days" valueGood={false}
              emptyMsg="No late arrivals — great!" />
            <RankCard icon="🏃" title={L('सबैभन्दा चाँडो जाने','Most Early-Out')}
              color="#d97706" bg="#fffbeb" border="#fde68a"
              items={rank.mostEarlyOut} valueKey="earlyCount" valueSuffix=" days" valueGood={false}
              emptyMsg="No early departures — great!" />
            <RankCard icon="📅" title={L('सबैभन्दा अनुपस्थित','Most Absent')}
              color="#991b1b" bg="#fff5f5" border="#fca5a5"
              items={rank.mostAbsent} valueKey="absentDays" valueSuffix=" days" valueGood={false}
              emptyMsg="No absences — perfect!" />
            <RankCard icon="🎯" title={L('सबैभन्दा उपस्थित','Highest Attendance')}
              color="#7c3aed" bg="#faf5ff" border="#ddd6fe"
              items={rank.mostPresent} valueKey="presentDays" valueSuffix=" days" valueGood={true}
              emptyMsg="No attendance data" />
          </div>

          {/* ── Late breakdown ── */}
          {rank.mostLate.length > 0 && (
            <div style={{ marginTop:16,background:'#fff7ed',border:'1px solid #fed7aa',
              borderRadius:10,padding:'14px 18px' }}>
              <div style={{ fontWeight:700,fontSize:13,color:'#c2410c',marginBottom:8 }}>
                ⏱️ {L('ढिला आउने विवरण','Late Arrival Breakdown')}
              </div>
              <div style={{ display:'flex',gap:14,flexWrap:'wrap' }}>
                {rank.mostLate.map(s=>(
                  <div key={s.id} style={{ display:'flex',alignItems:'center',gap:8,
                    background:'white',borderRadius:8,padding:'7px 12px',border:'1px solid #fde68a' }}>
                    <Avatar name={s.fullName} size={28} />
                    <div>
                      <div style={{ fontWeight:600,fontSize:12,color:'#1f2937' }}>{s.fullName}</div>
                      <div style={{ fontSize:11,color:'#9ca3af' }}>
                        {s.lateCount} {L('पटक','times')} · avg {s.avgLateFormatted}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MonthlyReport;
