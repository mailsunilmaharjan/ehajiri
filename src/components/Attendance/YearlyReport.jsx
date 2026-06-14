import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import api             from '../../api/client.js';
import useDateFormat   from '../../hooks/useDateFormat.js';
import ViewYearlyBtn   from './ViewYearlyBtn.jsx';
import { adToBS, toNepaliDigits } from '../../utils/dateUtils.js';

const BS_MONTHS  = ['Bai','Jes','Asa','Shr','Bha','Ash','Kar','Man','Pou','Mag','Fal','Cha'];
const AD_MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getCurrentFiscalYear(fiscalYears = []) {
  const today = new Date().toISOString().split('T')[0];
  return fiscalYears.find(fy => fy.startDate <= today && fy.endDate >= today)
      || fiscalYears.find(fy => fy.isDefault)
      || fiscalYears[fiscalYears.length - 1] || null;
}

const minsToHHMM = (m) => {
  const h = Math.floor(Math.abs(m) / 60), min = Math.abs(m) % 60;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
};

/* ── Medal colours ── */
const MEDAL = ['🥇','🥈','🥉','4️⃣','5️⃣'];

/* ── Rank row inside a card ── */
const RankRow = ({ rank, name, dept, value, valueLabel, sub, color, bg }) => (
  <div style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0',
    borderBottom:'1px solid #f3f4f6' }}>
    <span style={{ fontSize:16, width:22, textAlign:'center', flexShrink:0 }}>{MEDAL[rank]}</span>
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ fontWeight:700, fontSize:13, color:'#111827',
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
      {dept && <div style={{ fontSize:11, color:'#9ca3af' }}>{dept}</div>}
      {sub  && <div style={{ fontSize:11, color:'#6b7280' }}>{sub}</div>}
    </div>
    <div style={{ background:bg, color, borderRadius:8, padding:'3px 10px',
      fontSize:12, fontWeight:800, flexShrink:0, border:`1px solid ${color}33` }}>
      {value}<span style={{ fontSize:10, fontWeight:600, marginLeft:2 }}>{valueLabel}</span>
    </div>
  </div>
);

/* ── Analytics card with ranked list ── */
const AnalyticsCard = ({ icon, title, color, bg, border, items, emptyMsg, valueKey, valueSuffix='', subFn, rank0badge }) => (
  <div style={{ background:'#fff', border:`1px solid ${border||'#e5e7eb'}`, borderRadius:12,
    overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.06)', display:'flex', flexDirection:'column' }}>
    <div style={{ background:bg, borderBottom:`1px solid ${border||'#e5e7eb'}`,
      padding:'12px 16px', display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:20 }}>{icon}</span>
      <span style={{ fontWeight:700, fontSize:13, color }}>{title}</span>
      {rank0badge && items[0] && (
        <span style={{ marginLeft:'auto', background:color+'22', color, borderRadius:6,
          padding:'1px 8px', fontSize:11, fontWeight:700, maxWidth:130,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {items[0].fullName}
        </span>
      )}
    </div>
    <div style={{ padding:'8px 14px', flex:1 }}>
      {items.length === 0
        ? <div style={{ color:'#9ca3af', fontSize:12, padding:'16px 0', textAlign:'center' }}>{emptyMsg}</div>
        : items.slice(0,5).map((s, i) => (
            <RankRow key={s.id||i} rank={i}
              name={s.fullName} dept={s.department}
              value={typeof s[valueKey] === 'number' && valueKey.includes('Mins')
                ? minsToHHMM(s[valueKey]) : s[valueKey]}
              valueSuffix={valueSuffix}
              valueLabel={valueSuffix}
              sub={subFn ? subFn(s) : null}
              color={color} bg={bg} />
          ))
      }
    </div>
  </div>
);

/* ── Compact stat chip ── */
const Chip = ({ label, value, color, bg }) => (
  <div style={{ background:bg, border:`1px solid ${color}33`, borderRadius:10,
    padding:'12px 18px', textAlign:'center', flex:1, minWidth:100 }}>
    <div style={{ fontSize:22, fontWeight:800, color, lineHeight:1.2 }}>{value}</div>
    <div style={{ fontSize:11, color:'#6b7280', marginTop:3, fontWeight:500 }}>{label}</div>
  </div>
);

/* ── Trend bar chart (monthly) ── */
const TrendChart = ({ trend, useNP }) => {
  const MAX_H = 70;
  const months = useNP ? BS_MONTHS : AD_MONTHS;
  const maxVal = trend.reduce((mx,m) => Math.max(mx, m.present + m.absent + m.leave), 1);
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:6, overflowX:'auto', paddingBottom:4 }}>
      {trend.map((m, i) => {
        const tot  = m.present + m.absent + m.leave || 1;
        const pH   = Math.round((m.present / maxVal) * MAX_H);
        const aH   = Math.round((m.absent  / maxVal) * MAX_H);
        const lH   = Math.round((m.leave   / maxVal) * MAX_H);
        return (
          <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, flex:1, minWidth:28 }}>
            <div style={{ display:'flex', alignItems:'flex-end', gap:1, height:MAX_H }}>
              <div title={`Present: ${m.present}`} style={{ width:7, height:pH||1, background:'#059669', borderRadius:'2px 2px 0 0', transition:'height .4s' }} />
              <div title={`Absent: ${m.absent}`}   style={{ width:7, height:aH||1, background:'#dc2626', borderRadius:'2px 2px 0 0', transition:'height .4s' }} />
              <div title={`Leave: ${m.leave}`}     style={{ width:7, height:lH||1, background:'#7c3aed', borderRadius:'2px 2px 0 0', transition:'height .4s' }} />
            </div>
            <span style={{ fontSize:9, color:'#9ca3af', fontWeight:600 }}>{months[i]}</span>
          </div>
        );
      })}
    </div>
  );
};

/* ── Department table ── */
const DeptTable = ({ depts }) => (
  <div style={{ overflowX:'auto', borderRadius:8, border:'1px solid #e5e7eb' }}>
    <table style={{ borderCollapse:'collapse', width:'100%', fontSize:12 }}>
      <thead>
        <tr>
          {['Department','Staff','Present','Absent','Leave','Late','Att. %'].map(h => (
            <th key={h} style={{ background:'#efefef', color:'#374151', fontWeight:700, fontSize:11,
              padding:'7px 10px', borderRight:'1px solid #dedede', borderBottom:'2px solid #dedede',
              textAlign:'center', whiteSpace:'nowrap' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {depts.map((d, i) => {
          const attBg = d.attRate>=90?'#d1fae5':d.attRate>=75?'#fef3c7':'#fee2e2';
          const attC  = d.attRate>=90?'#065f46':d.attRate>=75?'#92400e':'#991b1b';
          return (
            <tr key={d.dept} style={{ background:i%2===0?'#fff':'#f9fafb' }}>
              <td style={{ padding:'6px 10px', borderRight:'1px solid #e5e7eb', fontWeight:700, color:'#374151' }}>{d.dept}</td>
              <td style={{ padding:'6px 10px', borderRight:'1px solid #e5e7eb', textAlign:'center', color:'#6b7280' }}>{d.staff}</td>
              <td style={{ padding:'6px 10px', borderRight:'1px solid #e5e7eb', textAlign:'center' }}>
                <span style={{ background:'#d1fae5', color:'#065f46', borderRadius:5, padding:'1px 7px', fontWeight:700 }}>{d.present}</span>
              </td>
              <td style={{ padding:'6px 10px', borderRight:'1px solid #e5e7eb', textAlign:'center' }}>
                {d.absent>0 ? <span style={{ background:'#fee2e2', color:'#991b1b', borderRadius:5, padding:'1px 7px', fontWeight:700 }}>{d.absent}</span> : <span style={{ color:'#d1d5db' }}>0</span>}
              </td>
              <td style={{ padding:'6px 10px', borderRight:'1px solid #e5e7eb', textAlign:'center' }}>
                {d.leave>0 ? <span style={{ background:'#ede9fe', color:'#5b21b6', borderRadius:5, padding:'1px 7px', fontWeight:700 }}>{d.leave}</span> : <span style={{ color:'#d1d5db' }}>0</span>}
              </td>
              <td style={{ padding:'6px 10px', borderRight:'1px solid #e5e7eb', textAlign:'center' }}>
                {d.late>0 ? <span style={{ color:'#dc2626', fontWeight:700 }}>{d.late}</span> : <span style={{ color:'#d1d5db' }}>0</span>}
              </td>
              <td style={{ padding:'6px 10px', textAlign:'center' }}>
                <span style={{ background:attBg, color:attC, borderRadius:5, padding:'1px 7px', fontWeight:800 }}>{d.attRate}%</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

/* ════════════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════════════ */
const YearlyReport = () => {
  const { language } = useLanguage();
  const { settings } = useSettings();
  const L  = (np, en) => language === 'np' ? np : en;
  const fd = useDateFormat();

  const now    = new Date();
  const useNP  = settings.defaultCalendar === 'np';
  const todayBS = adToBS(now);
  const initYear = useNP ? (todayBS?.year || now.getFullYear()) : now.getFullYear();

  const [year,    setYear]    = useState(initYear);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const currentFY = getCurrentFiscalYear(settings.fiscalYears || []);
  const fmt = v => settings.nepaliDigits ? toNepaliDigits(v) : String(v);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = useNP
        ? `bsYear=${year}`
        : `year=${year}`;
      const res = await api.get(`/attendance/yearly-analytics?${params}`);
      setData(res);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [year, useNP]);

  useEffect(() => { load(); }, [load]);

  const s   = data?.summary   || {};
  const r   = data?.rankings  || {};
  const dep = data?.deptStats || [];
  const trend = data?.monthlyTrend || [];

  const yearLabel = useNP ? `${fmt(year)} BS` : String(year);

  return (
    <div className="page-container">

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">📊 {L('वार्षिक विश्लेषण','Yearly Staff Analytics')}</h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY && (
              <span style={{ background:'#eff6ff', color:'#1a56db', borderRadius:6,
                padding:'1px 8px', fontSize:12, fontWeight:600, marginRight:8 }}>
                {currentFY.name}
              </span>
            )}
            {yearLabel} — {L('वार्षिक कर्मचारी प्रदर्शन विश्लेषण','Annual Staff Performance Analysis')}
          </p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <ViewYearlyBtn year={year} useNP={useNP} currentPath="/attendance/reports/yearly" />
        </div>
      </div>

      {/* ── Year selector ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20, flexWrap:'wrap' }}>
        <select className="form-control" style={{ width: useNP?115:85, height:36, fontSize:13 }}
          value={year} onChange={e => setYear(+e.target.value)}>
          {useNP
            ? [todayBS?.year-2, todayBS?.year-1, todayBS?.year, todayBS?.year+1].filter(Boolean).map(y => (
                <option key={y} value={y}>{settings.nepaliDigits ? toNepaliDigits(y) : y} BS</option>))
            : [now.getFullYear()-2, now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1].map(y => (
                <option key={y} value={y}>{y}</option>))
          }
        </select>
        <button className="btn btn-outline btn-sm" style={{ height:36 }} onClick={load} disabled={loading}>🔃</button>
        {loading && <span style={{ fontSize:13, color:'#9ca3af' }}>Analysing year…</span>}
      </div>

      {error && (
        <div style={{ background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:8,
          padding:'10px 16px', marginBottom:16, color:'#991b1b', fontWeight:600 }}>❌ {error}</div>
      )}

      {loading && (
        <div style={{ textAlign:'center', padding:'70px 0', color:'#9ca3af' }}>
          <div style={{ fontSize:44, marginBottom:14 }}>📊</div>
          <div style={{ fontWeight:600, fontSize:15 }}>Analysing {yearLabel} data…</div>
        </div>
      )}

      {data && !loading && (
        <>

          {/* ── 6 ranking cards ── */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',
            gap:14, marginBottom:20 }}>

            {/* 1 Most Punctual */}
            <AnalyticsCard
              icon="🏆" title={L('सबैभन्दा समयनिष्ठ','Most Punctual Staff')}
              color="#065f46" bg="#f0fdf4" border="#86efac"
              items={r.mostPunctual||[]} emptyMsg="No punctuality data"
              valueKey="punctualScore" valueSuffix="%"
              subFn={s => `${s.presentDays}P · ${s.lateCount}L · ${s.totalWorkingDays}wd${s.joinDate > `${data?.year || year}-01-01` ? ` · joined ${s.joinDate}` : ''}`} />

            {/* 2 Most Unpunctual */}
            <AnalyticsCard
              icon="📉" title={L('कम हाजिरी दर','Most Unpunctual Staff')}
              color="#991b1b" bg="#fff5f5" border="#fca5a5"
              items={r.leastPunctual||[]} emptyMsg="No data"
              valueKey="attRate" valueSuffix="%"
              subFn={s => `${s.absentDays}A · ${s.lateCount}L · ${s.totalWorkingDays}wd${s.joinDate > `${data?.year || year}-01-01` ? ` · joined ${s.joinDate}` : ''}`} />

            {/* 3 Most Late Arrivals */}
            <AnalyticsCard
              icon="⏰" title={L('सबैभन्दा बढी ढिला','Most Late Arrivals')}
              color="#92400e" bg="#fffbeb" border="#fde68a"
              items={r.mostLate||[]} emptyMsg="No late arrivals this year 🎉"
              valueKey="lateCount" valueSuffix=" times"
              subFn={s => `Avg late: ${s.avgLateMins>0?minsToHHMM(s.avgLateMins):'—'}${s.joinDate > `${data?.year || year}-01-01` ? ` · joined ${s.joinDate}` : ''}`} />

            {/* 4 Most Early Out */}
            <AnalyticsCard
              icon="🚪" title={L('सबैभन्दा बढी अगाडि बाहिर','Most Early Departures')}
              color="#7c3aed" bg="#faf5ff" border="#c4b5fd"
              items={r.mostEarlyOut||[]} emptyMsg="No early departures this year"
              valueKey="earlyCount" valueSuffix=" times"
              subFn={s => `Avg early out: ${s.avgEarlyMins>0?minsToHHMM(s.avgEarlyMins):'—'}${s.joinDate > `${data?.year || year}-01-01` ? ` · joined ${s.joinDate}` : ''}`} />

            {/* 5 Most Leave Taking */}
            <AnalyticsCard
              icon="📅" title={L('सबैभन्दा बढी बिदा','Most Leave Taking')}
              color="#5b21b6" bg="#f5f3ff" border="#ddd6fe"
              items={r.mostLeave||[]} emptyMsg="No leave taken this year"
              valueKey="leaveDays" valueSuffix=" days"
              subFn={s => `${s.presentDays}P · ${s.totalWorkingDays}wd${s.joinDate > `${data?.year || year}-01-01` ? ` · joined ${s.joinDate}` : ''}`} />

            {/* 6 Most Absences */}
            <AnalyticsCard
              icon="❌" title={L('सबैभन्दा बढी अनुपस्थित','Most Absences')}
              color="#dc2626" bg="#fef2f2" border="#fca5a5"
              items={r.mostAbsent||[]} emptyMsg="No absences this year 🎉"
              valueKey="absentDays" valueSuffix=" days"
              subFn={s => `Att: ${s.attRate}% · ${s.totalWorkingDays}wd${s.joinDate > `${data?.year || year}-01-01` ? ` · joined ${s.joinDate}` : ''}`} />


            {/* 8 Perfect Attendance */}
            <div style={{ background:'#fff', border:'1px solid #86efac', borderRadius:12,
              overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.06)' }}>
              <div style={{ background:'#f0fdf4', borderBottom:'1px solid #86efac',
                padding:'12px 16px', display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:20 }}>🌟</span>
                <span style={{ fontWeight:700, fontSize:13, color:'#065f46' }}>
                  {L('परफेक्ट हाजिरी','Perfect Attendance')}
                </span>
                <span style={{ marginLeft:'auto', background:'#065f4622', color:'#065f46',
                  borderRadius:6, padding:'1px 8px', fontSize:11, fontWeight:700 }}>
                  {(r.perfectAtt||[]).length} {L('कर्मचारी','staff')}
                </span>
              </div>
              <div style={{ padding:'8px 14px' }}>
                {(r.perfectAtt||[]).length === 0
                  ? <div style={{ color:'#9ca3af', fontSize:12, padding:'16px 0', textAlign:'center' }}>
                      No staff with perfect attendance this year
                    </div>
                  : (r.perfectAtt||[]).slice(0,6).map((s, i) => (
                      <div key={s.id} style={{ display:'flex', alignItems:'center', gap:8,
                        padding:'5px 0', borderBottom:'1px solid #f3f4f6' }}>
                        <span style={{ fontSize:14 }}>{MEDAL[i]||'⭐'}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:12, color:'#111827',
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.fullName}</div>
                          <div style={{ fontSize:10, color:'#9ca3af' }}>{s.department}</div>
                        </div>
                        <span style={{ background:'#d1fae5', color:'#065f46', borderRadius:6,
                          padding:'2px 8px', fontSize:11, fontWeight:800 }}>
                          {s.presentDays}d ✓
                        </span>
                      </div>
                    ))
                }
              </div>
            </div>
          </div>

          {/* ── Monthly trend + dept analysis side by side ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:20 }}>

            {/* Monthly trend */}
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12,
              padding:'18px 20px', boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
              <div style={{ fontWeight:700, fontSize:13, color:'#1f2937', marginBottom:14 }}>
                📈 {L('मासिक प्रवृत्ति','Monthly Attendance Trend')}
              </div>
              {trend.length > 0
                ? <>
                    <TrendChart trend={trend} useNP={useNP} />
                    <div style={{ display:'flex', gap:14, marginTop:10, fontSize:10, color:'#6b7280' }}>
                      <span><span style={{ display:'inline-block', width:8, height:8, background:'#059669', borderRadius:2, marginRight:4 }}/>{L('उपस्थित','Present')}</span>
                      <span><span style={{ display:'inline-block', width:8, height:8, background:'#dc2626', borderRadius:2, marginRight:4 }}/>{L('अनुपस्थित','Absent')}</span>
                      <span><span style={{ display:'inline-block', width:8, height:8, background:'#7c3aed', borderRadius:2, marginRight:4 }}/>{L('बिदा','Leave')}</span>
                    </div>
                  </>
                : <div style={{ color:'#9ca3af', fontSize:12, textAlign:'center', padding:'24px 0' }}>No trend data</div>
              }
            </div>

            {/* Summary stats panel — replaces the old insight boxes */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, alignContent:'start' }}>
              <Chip label={L('कुल कर्मचारी','Total Staff')}       value={fmt(s.totalStaff||0)}       color="#1a56db" bg="#eff6ff" />
              <Chip label={L('कार्य दिन','Working Days')}          value={fmt(s.totalWorkingDays||0)}  color="#374151" bg="#f9fafb" />
              <Chip label={L('कुल उपस्थित','Total Present')}       value={fmt(s.grandPresent||0)}      color="#065f46" bg="#d1fae5" />
              <Chip label={L('कुल अनुपस्थित','Total Absent')}      value={fmt(s.grandAbsent||0)}       color="#991b1b" bg="#fee2e2" />
              <Chip label={L('कुल बिदा','Total Leave')}            value={fmt(s.grandLeave||0)}        color="#5b21b6" bg="#ede9fe" />
              <Chip label={L('कुल ढिला','Total Late')}             value={fmt(s.grandLate||0)}         color="#92400e" bg="#fef3c7" />
              <Chip label={L('परफेक्ट हाजिरी','Perfect Att.')}
                value={`${fmt(s.perfectCount||0)} / ${fmt(s.totalStaff||0)}`}
                color="#059669" bg="#f0fdf4" />
              {/* Avg att rate — full width */}
              <div style={{ gridColumn:'1 / -1',
                background: s.avgAttRate>=90?'#d1fae5':s.avgAttRate>=75?'#fef3c7':'#fee2e2',
                border:`1px solid ${s.avgAttRate>=90?'#059669':s.avgAttRate>=75?'#d97706':'#dc2626'}44`,
                borderRadius:10, padding:'14px 18px', textAlign:'center' }}>
                <div style={{ fontSize:28, fontWeight:800, lineHeight:1.1,
                  color: s.avgAttRate>=90?'#065f46':s.avgAttRate>=75?'#92400e':'#991b1b' }}>
                  {fmt(s.avgAttRate||0)}%
                </div>
                <div style={{ fontSize:11, color:'#6b7280', marginTop:3, fontWeight:500 }}>
                  {L('वार्षिक औसत हाजिरी दर','Annual Avg. Attendance Rate')}
                </div>
              </div>
            </div>
          </div>

          {/* ── Department-wise breakdown ── */}
          {dep.length > 0 && (
            <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12,
              padding:'18px 20px', boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
              <div style={{ fontWeight:700, fontSize:13, color:'#1f2937', marginBottom:14 }}>
                🏢 {L('विभागअनुसार विश्लेषण','Department-wise Analysis')}
              </div>
              <DeptTable depts={dep} />
            </div>
          )}

          {/* Empty state */}
          {(data?.allStats||[]).length === 0 && (
            <div style={{ textAlign:'center', padding:'60px', color:'#9ca3af' }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📊</div>
              <div style={{ fontWeight:600, fontSize:15, color:'#374151' }}>
                {L('यस वर्षको डेटा उपलब्ध छैन','No attendance data found for this year')}
              </div>
              <div style={{ fontSize:13, marginTop:6 }}>Punch logs from ZKTeco devices will appear here.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default YearlyReport;
