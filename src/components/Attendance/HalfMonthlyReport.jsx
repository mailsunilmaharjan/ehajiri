import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api             from '../../api/client.js';
import ViewHalfMonthlyBtn from './ViewHalfMonthlyBtn.jsx';
import useDateFormat   from '../../hooks/useDateFormat.js';
import { adToBS, bsToAD, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits } from '../../utils/dateUtils.js';

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];
const MONTHS_NP = ['बैशाख','जेठ','असार','श्रावण','भाद्र','आश्विन',
                   'कार्तिक','मंसिर','पुष','माघ','फागुन','चैत्र'];

/** Get current fiscal year from settings.fiscalYears (by today's date) */
function getCurrentFiscalYear(fiscalYears = []) {
  const today = new Date().toISOString().split('T')[0];
  return fiscalYears.find(fy => fy.startDate <= today && fy.endDate >= today)
      || fiscalYears.find(fy => fy.isDefault)
      || fiscalYears[fiscalYears.length - 1]
      || null;
}

/** Show month+year in correct calendar format */
function formatPeriodLabel(year, month, half, settings, language) {
  const useNP = settings.defaultCalendar === 'np';
  const useNPDigits = settings.nepaliDigits;
  const fmt = (n) => useNPDigits ? toNepaliDigits(n) : String(n);

  if (useNP) {
    // In NP mode `year`/`month` already hold the selected BS values — use directly
    const mnLabel = language === 'np' ? BS_MONTHS_NP[month - 1] : BS_MONTHS_EN[month - 1];
    return `${mnLabel} ${fmt(year)} BS · ${half === 1 ? '१–१५' : '१६–अन्त'}`;
  }
  const mnLabel = language === 'np' ? MONTHS_NP[month - 1] : MONTHS_EN[month - 1];
  return `${mnLabel} ${year} · ${half === 1 ? '1–15' : '16–End'}`;
}

/* ── Tiny atoms ──────────────────────────────────────────────── */
const Avatar = ({ name, size=36 }) => {
  const colors = ['#52b02c','#059669','#7c3aed','#dc2626','#d97706','#0369a1'];
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

/* ── Ranking Card ─────────────────────────────────────────────── */
const RankCard = ({ icon, title, color, bg, border, items, valueKey, valueSuffix='',
  valueLabel, valueGood=true, emptyMsg }) => (
  <div style={{ background:'white',borderRadius:12,border:`1px solid ${border}`,
    overflow:'hidden',boxShadow:'0 1px 6px rgba(0,0,0,.06)' }}>
    {/* Header */}
    <div style={{ background:bg,borderBottom:`1px solid ${border}`,
      padding:'12px 16px',display:'flex',alignItems:'center',gap:8 }}>
      <span style={{ fontSize:22 }}>{icon}</span>
      <span style={{ fontWeight:700,fontSize:14,color }}>{title}</span>
    </div>
    {/* Items */}
    {items.length===0 ? (
      <div style={{ padding:'20px',textAlign:'center',color:'#9ca3af',fontSize:13 }}>
        {emptyMsg||'No data'}
      </div>
    ) : (
      <div>
        {items.map((item,i)=>(
          <div key={item.id} style={{ display:'flex',alignItems:'center',gap:10,
            padding:'10px 14px',borderBottom:i<items.length-1?`1px solid #f3f4f6`:'none',
            background:i===0?`${bg}44`:'white' }}>
            {/* Rank */}
            <div style={{ width:22,height:22,borderRadius:'50%',
              background:i===0?color:'#f3f4f6',color:i===0?'white':'#9ca3af',
              fontWeight:800,fontSize:11,display:'flex',alignItems:'center',
              justifyContent:'center',flexShrink:0 }}>
              {i+1}
            </div>
            <Avatar name={item.fullName} size={30} />
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ fontWeight:600,fontSize:13,color:'#1f2937',
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                {item.fullName}
              </div>
              <div style={{ fontSize:11,color:'#9ca3af' }}>{item.department}</div>
            </div>
            <ScoreBadge value={item[valueKey]} suffix={valueSuffix}
              good={valueGood} size="sm" />
          </div>
        ))}
      </div>
    )}
  </div>
);

/* ── Insight Card ─────────────────────────────────────────────── */
const InsightCard = ({ icon, text, type }) => {
  const styles = {
    positive : { bg:'#f0fdf4', border:'#86efac', color:'#065f46' },
    neutral  : { bg:'#f0fdf4', border:'#86efac', color:'#166534' },
    warning  : { bg:'#fff7ed', border:'#fed7aa', color:'#c2410c' },
  };
  const s = styles[type] || styles.neutral;
  return (
    <div style={{ background:s.bg,border:`1px solid ${s.border}`,borderRadius:10,
      padding:'12px 16px',display:'flex',gap:12,alignItems:'flex-start' }}>
      <span style={{ fontSize:22,flexShrink:0 }}>{icon}</span>
      <p style={{ margin:0,fontSize:13,color:s.color,fontWeight:500,lineHeight:1.5 }}>
        {text}
      </p>
    </div>
  );
};

/* ── Stat Pill ────────────────────────────────────────────────── */
const StatPill = ({ label, value, color, bg }) => (
  <div style={{ background:bg,borderRadius:10,padding:'10px 16px',
    border:`1px solid ${color}22`,textAlign:'center',minWidth:90 }}>
    <div style={{ fontSize:22,fontWeight:800,color }}>{value}</div>
    <div style={{ fontSize:11,color:'#6b7280',marginTop:2 }}>{label}</div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Half Monthly Report Page
═══════════════════════════════════════════════════════════════ */

const HalfMonthlyReport = () => {
  const { language } = useLanguage();
  const { settings } = useSettings();
  const { currentUser, isEmployee } = useAuth();
  const fd = useDateFormat();
  const L = (np,en) => language==='np' ? np : en;

  const now     = new Date();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(now);  // { year:2083, month:2, day:16 } etc.

  // When Nepali calendar: state holds BS year/month so dropdown is in BS order
  // When AD calendar:     state holds AD year/month
  const initYear  = useNP ? (todayBS?.year  || now.getFullYear())  : now.getFullYear();
  const initMonth = useNP ? (todayBS?.month || now.getMonth()+1)   : now.getMonth()+1;

  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';

  const [year,  setYear]  = useState(initYear);
  const [month, setMonth] = useState(initMonth);
  const [half,  setHalf]  = useState(now.getDate()<=15 ? 1 : 2);
  const [data,  setData]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const currentFY = getCurrentFiscalYear(settings.fiscalYears || []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // When Nepali calendar: year/month are BS → convert to AD for backend API
      let apiYear = year, apiMonth = month;
      if (useNP) {
        const adDate = bsToAD(year, month, 15);
        if (adDate) { apiYear = adDate.getFullYear(); apiMonth = adDate.getMonth() + 1; }
      }
      const query = `/attendance/half-monthly?year=${apiYear}&month=${apiMonth}&half=${half}${myEmpId ? `&employeeId=${myEmpId}` : ''}`;
      setData(await api.get(query));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year, month, half]);

  useEffect(() => { load(); }, [load]);

  const periodLabel = formatPeriodLabel(year, month, half, settings, language);
  const halfLabel   = half===1
    ? L('पहिलो अर्धमहिना','First Half')
    : L('दोस्रो अर्धमहिना','Second Half');

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
            🤖 {L('अर्धमासिक रिपोर्ट','Half Monthly Report')}
            <span style={{ fontSize:14, fontWeight:600, color:'#6b7280', marginLeft:10 }}>
              {currentFY && (
                <span style={{ background:'#f0fdf4',color:'#52b02c',borderRadius:6,
                  padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>
                  {currentFY.name}
                </span>
              )}
              [ {periodLabel}
              {period && (
                <span style={{ marginLeft:8,fontSize:12,color:'#9ca3af' }}>
                  ({period.startDate} → {period.endDate} · {period.totalWorkingDays} {L('कार्य दिन','working days')})
                </span>
              )} ]
            </span>
          </h1>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={()=>window.print()} style={{ display:'inline-flex',alignItems:'center',gap:5,
            padding:'6px 14px',height:36,background:'#f0fdf4',border:'1px solid #86efac',
            color:'#15803d',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            🖨️ Print
          </button>
          <ViewHalfMonthlyBtn year={year} month={month} half={half} useNP={useNP}
            currentPath="/attendance/reports/half-monthly" />
        </div>
      </div>

      {/* ── Period selector ── */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:18,flexWrap:'wrap' }}>
        {/* ── Year dropdown ── */}
        <select className="form-control" style={{ width: useNP ? 115 : 85, height:34, fontSize:13 }}
          value={year} onChange={e=>setYear(+e.target.value)}>
          {useNP
            // Nepali calendar: show BS years (current ±1)
            ? [todayBS?.year-1, todayBS?.year, todayBS?.year+1].filter(Boolean).map(bsY => (
                <option key={bsY} value={bsY}>
                  {settings.nepaliDigits ? toNepaliDigits(bsY) : bsY} BS
                </option>
              ))
            // AD calendar: show AD years
            : [now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))
          }
        </select>

        {/* ── Month dropdown — BS months in correct order when useNP ── */}
        <select className="form-control" style={{ width: useNP ? 120 : 140, height:34, fontSize:13 }}
          value={month} onChange={e=>setMonth(+e.target.value)}>
          {useNP
            // Nepali calendar: list 12 BS months in order (Baisakh=1 … Chaitra=12)
            ? BS_MONTHS_NP.map((bsName, i) => (
                <option key={i+1} value={i+1}>
                  {settings.nepaliDigits ? toNepaliDigits(bsName) : bsName}
                </option>
              ))
            // AD calendar: list 12 Gregorian months in order
            : MONTHS_EN.map((m, i) => (
                <option key={i+1} value={i+1}>{m}</option>
              ))
          }
        </select>
        <div style={{ display:'flex',gap:0,border:'1px solid #d1d5db',borderRadius:8,overflow:'hidden' }}>
          {[1,2].map(h=>(
            <button key={h} onClick={()=>setHalf(h)}
              style={{ padding:'6px 18px',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,
                background:half===h?'#52b02c':'white',color:half===h?'white':'#374151' }}>
              {h===1?L('पहिलो','1st Half'):L('दोस्रो','2nd Half')}
            </button>
          ))}
        </div>
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

      {loading && (
        <div style={{ textAlign:'center',padding:'60px 20px',color:'#9ca3af' }}>
          <div style={{ fontSize:40,marginBottom:12 }}>🤖</div>
          <div style={{ fontWeight:600,fontSize:15 }}>Analysing attendance data…</div>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── Period calendar stats row ── */}
          <div style={{ display:'flex',gap:10,marginBottom:20,flexWrap:'wrap',alignItems:'stretch' }}>
            <StatPill label={L('जम्मा दिन','Total Days')}           value={period.totalDays ?? '—'}        color="#52b02c" bg="#f0fdf4" />
            <StatPill label={L('कार्य दिन','No. of Working Days')} value={period.totalWorkingDays ?? '—'} color="#059669" bg="#d1fae5" />
            <StatPill label={L('सप्ताहन्त','Weekend')}               value={period.weekendDays ?? '—'}      color="#6b7280" bg="#f3f4f6" />
            <StatPill label={L('सार्वजनिक बिदा','Public Holiday')}   value={period.holidayDays ?? '—'}      color="#d97706" bg="#fef3c7" />
          </div>

          {/* ── AI Insights ── */}
          <div style={{ marginBottom:20 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:10 }}>
              <span style={{ fontSize:20 }}>🤖</span>
              <h2 style={{ margin:0,fontSize:16,fontWeight:700,color:'#1f2937' }}>
                eHajiri TMS Analysis
              </h2>
              <span style={{ fontSize:11,color:'#9ca3af',fontWeight:400 }}>
                — auto-generated from {period.totalWorkingDays} working days of data
              </span>
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:10 }}>
              {ins.map((insight,i)=>(
                <InsightCard key={i} icon={insight.icon} text={insight.text} type={insight.type} />
              ))}
              {/* Static insights from data */}
              {sum.perfectAtt > 0 && (
                <InsightCard type="positive" icon="✅"
                  text={`${sum.perfectAtt} staff had perfect attendance — zero absences and zero late arrivals for the entire half-month.`} />
              )}
              {rank.mostAbsent.length > 0 && rank.mostAbsent[0].absentDays >= 3 && (
                <InsightCard type="warning" icon="📋"
                  text={`${rank.mostAbsent[0].fullName} was absent ${rank.mostAbsent[0].absentDays} days — follow up recommended.`} />
              )}
            </div>
          </div>

          {/* ── Rankings Grid ── */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:14 }}>

            <RankCard
              icon="⭐" title={L('सबैभन्दा पाबन्द','Most Punctual Staff')}
              color="#065f46" bg="#f0fdf4" border="#bbf7d0"
              items={rank.topPunctual}
              valueKey="punctualityScore" valueSuffix="%" valueGood={true}
              emptyMsg="No punctuality data"
            />

            <RankCard
              icon="⏰" title={L('सबैभन्दा ढिला आउने','Most Late-In Staff')}
              color="#dc2626" bg="#fff1f2" border="#fecdd3"
              items={rank.mostLate}
              valueKey="lateCount" valueSuffix=" days" valueGood={false}
              emptyMsg="No late arrivals — great!"
            />

            <RankCard
              icon="🏃" title={L('सबैभन्दा चाँडो जाने','Most Early-Out Staff')}
              color="#d97706" bg="#fffbeb" border="#fde68a"
              items={rank.mostEarlyOut}
              valueKey="earlyCount" valueSuffix=" days" valueGood={false}
              emptyMsg="No early departures — great!"
            />

            <RankCard
              icon="📅" title={L('सबैभन्दा बढी अनुपस्थित','Most Absent Staff')}
              color="#991b1b" bg="#fff5f5" border="#fca5a5"
              items={rank.mostAbsent}
              valueKey="absentDays" valueSuffix=" days" valueGood={false}
              emptyMsg="No absences — perfect!"
            />

            <RankCard
              icon="🎯" title={L('सबैभन्दा बढी उपस्थित','Highest Attendance Days')}
              color="#7c3aed" bg="#faf5ff" border="#ddd6fe"
              items={rank.mostPresent}
              valueKey="presentDays" valueSuffix=" days" valueGood={true}
              emptyMsg="No attendance data"
            />

          </div>

          {/* ── Average late time insight ── */}
          {rank.mostLate.length > 0 && (
            <div style={{ marginTop:16,background:'#fff7ed',border:'1px solid #fed7aa',
              borderRadius:10,padding:'14px 18px' }}>
              <div style={{ fontWeight:700,fontSize:13,color:'#c2410c',marginBottom:8 }}>
                ⏱️ {L('ढिला आउने विस्तृत विश्लेषण','Late Arrival Breakdown')}
              </div>
              <div style={{ display:'flex',gap:14,flexWrap:'wrap' }}>
                {rank.mostLate.map(s=>(
                  <div key={s.id} style={{ display:'flex',alignItems:'center',gap:8,
                    background:'white',borderRadius:8,padding:'7px 12px',border:'1px solid #fde68a' }}>
                    <Avatar name={s.fullName} size={28} />
                    <div>
                      <div style={{ fontWeight:600,fontSize:12 }}>{s.fullName}</div>
                      <div style={{ fontSize:11,color:'#d97706' }}>
                        {s.lateCount}× late · avg {s.avgLateFormatted}
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

export default HalfMonthlyReport;
