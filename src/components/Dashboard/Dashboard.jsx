import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import api             from '../../api/client.js';

/* ─── tiny helpers ─────────────────────────────────────── */
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
};

/* ─── inline styles ─────────────────────────────────────── */
const STYLES = `
  @keyframes dbFade {
    from { opacity:0; transform:translateY(10px); }
    to   { opacity:1; transform:translateY(0);    }
  }

  .db-p { padding:20px 22px; background:#f1f5f9; min-height:100vh; }

  .db-card {
    background:#fff; border:1px solid #e2e8f0;
    border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,.05);
  }
  .db-stat {
    background:#fff; border:1px solid #e2e8f0; border-radius:12px;
    padding:16px 14px;
    transition:transform .18s, box-shadow .18s;
    cursor:default;
  }
  .db-stat:hover { transform:translateY(-2px); box-shadow:0 6px 18px rgba(0,0,0,.08); }

  .db-tr:hover td { background:#f8fafc !important; }

  .db-seg { display:flex; background:#f1f5f9; border-radius:8px; padding:3px; gap:2px; }
  .db-seg-btn {
    flex:1; padding:6px 10px; border-radius:6px; border:none;
    cursor:pointer; font-size:12px; font-weight:600; font-family:inherit;
    transition:all .18s;
  }
  .db-seg-btn.on  { background:#fff; color:#3b82f6; box-shadow:0 1px 4px rgba(0,0,0,.10); }
  .db-seg-btn.off { background:transparent; color:#94a3b8; }
  .db-seg-btn.off:hover { color:#64748b; }

  .db-view-btn {
    font-size:12px; font-weight:600; color:#3b82f6;
    background:#eff6ff; border:1px solid #bfdbfe;
    border-radius:7px; padding:5px 13px; cursor:pointer; transition:all .18s;
  }
  .db-view-btn:hover { background:#dbeafe; }

  .db-a0  { animation:dbFade .3s ease both 0s; }
  .db-a1  { animation:dbFade .3s ease both .05s; }
  .db-a2  { animation:dbFade .3s ease both .10s; }
  .db-a3  { animation:dbFade .3s ease both .15s; }
  .db-a4  { animation:dbFade .3s ease both .20s; }
  .db-a5  { animation:dbFade .3s ease both .25s; }
  .db-a6  { animation:dbFade .3s ease both .30s; }
  .db-a7  { animation:dbFade .3s ease both .35s; }
  .db-a8  { animation:dbFade .3s ease both .40s; }
`;

/* ─── sub-components ─────────────────────────────────────── */
const StatCard = ({ solidColor, lightColor, icon, label, value, male, female, idx }) => (
  <div className={`db-stat db-a${idx + 1}`} style={{ borderLeft: `3px solid ${solidColor}` }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: lightColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
        {icon}
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
        letterSpacing: '.6px', textAlign: 'right', lineHeight: 1.3, maxWidth: 70 }}>{label}</span>
    </div>
    <p style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 800, color: '#1e293b',
      lineHeight: 1, letterSpacing: '-1px' }}>{value ?? 0}</p>
    {male !== undefined && (
      <div style={{ display: 'flex', gap: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', background: '#eff6ff',
          padding: '1px 7px', borderRadius: 20, border: '1px solid #dbeafe' }}>♂ {male}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#db2777', background: '#fdf2f8',
          padding: '1px 7px', borderRadius: 20, border: '1px solid #fce7f3' }}>♀ {female}</span>
      </div>
    )}
  </div>
);

const PanelHead = ({ title, sub, action }) => (
  <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <div>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{title}</p>
      {sub && <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>{sub}</p>}
    </div>
    {action}
  </div>
);

const Seg = ({ tabs, active, onChange }) => (
  <div className="db-seg" style={{ margin: '12px 16px 0' }}>
    {tabs.map(t => (
      <button key={t.key}
        className={`db-seg-btn ${active === t.key ? 'on' : 'off'}`}
        onClick={() => onChange(t.key)}>{t.label}</button>
    ))}
  </div>
);

const Pill = ({ status }) => {
  const m = {
    pending:  { bg: '#fef9c3', c: '#854d0e', border: '#fde68a' },
    approved: { bg: '#dcfce7', c: '#166534', border: '#bbf7d0' },
    rejected: { bg: '#fee2e2', c: '#991b1b', border: '#fecaca' },
  };
  const s = m[status] || { bg: '#f1f5f9', c: '#475569', border: '#e2e8f0' };
  return (
    <span style={{ background: s.bg, color: s.c, border: `1px solid ${s.border}`,
      borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
};

const Av = ({ name }) => (
  <div style={{ width: 29, height: 29, borderRadius: '50%', flexShrink: 0,
    background: '#f1f5f9', color: '#64748b',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, border: '1px solid #e2e8f0' }}>
    {(name || '?')[0].toUpperCase()}
  </div>
);

const TH = ({ children }) => (
  <th style={{ padding: '9px 14px', textAlign: 'left', fontWeight: 700,
    color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.6px',
    background: '#f8fafc', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
    {children}
  </th>
);
const TD = ({ children, style }) => (
  <td style={{ padding: '9px 14px', fontSize: 13, color: '#334155',
    borderBottom: '1px solid #f8fafc', ...style }}>{children}</td>
);

const Empty = ({ msg }) => (
  <div style={{ padding: '28px 16px', textAlign: 'center' }}>
    <div style={{ fontSize: 26, marginBottom: 6, opacity: .35 }}>📭</div>
    <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>{msg}</p>
  </div>
);

/* ═══════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════ */
export default function Dashboard() {
  const { currentUser }  = useAuth();
  const { language }     = useLanguage();
  const {
    stats, filteredLeaves: leaves, filteredVisits: officeVisits,
    getEmployeeName, getLeaveTypeName, filteredEmployees: employees,
  } = useData();
  const { settings, getCompanyName } = useSettings();
  const navigate = useNavigate();

  const [todayAttn, setTodayAttn] = useState([]);
  const [mainTab,   setMainTab]   = useState('leave');
  const [infoTab,   setInfoTab]   = useState('holiday');

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    api.get(`/attendance/daily?date=${today}`)
      .then(d => setTodayAttn(d.rows || []))
      .catch(() => setTodayAttn([]));
  }, [today]);

  /* gender map */
  const gMap = {};
  employees.forEach(e => { gMap[e.id] = e.gender; });
  const mf = (rows, sex) => rows.filter(r => gMap[r.id] === sex).length;

  const active = employees.filter(e => e.active);
  const totM   = active.filter(e => e.gender === 'male').length;
  const totF   = active.filter(e => e.gender === 'female').length;

  const presentR = todayAttn.filter(r => r.status === 'Present');
  const absentR  = todayAttn.filter(r => r.status === 'Absent');
  const lateR    = todayAttn.filter(r => r.lateIn   && r.lateIn.startsWith('Late By'));
  const earlyR   = todayAttn.filter(r => r.earlyOut && r.earlyOut.startsWith('Early Out'));
  const leaveR   = todayAttn.filter(r => r.hasLeave);
  const visitR   = todayAttn.filter(r => r.hasVisit);

  const total = stats.totalEmployees || 1;
  const pct   = Math.round((presentR.length / total) * 100);

  const recentLeaves = [...leaves]
    .sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate)).slice(0, 6);
  const recentVisits = [...officeVisits]
    .sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate)).slice(0, 6);

  const upHolidays = (settings.publicHolidays || [])
    .filter(h => h.startDate && h.startDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 8);

  const now = new Date();
  const upBirthdays = active.filter(e => e.dob).map(e => {
    const dob  = new Date(e.dob);
    const next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
    if (next < now) next.setFullYear(now.getFullYear() + 1);
    return { ...e, daysUntil: Math.round((next - now) / 86400000) };
  }).filter(e => e.daysUntil <= 30).sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 8);

  const companyName = (getCompanyName
    ? getCompanyName(language)
    : (settings.companyNameEn || 'eHajiri TMS'));

  const dateLabel = new Date().toLocaleDateString('en-GB',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const CARDS = [
    { color: '#7c3aed', light: '#f5f3ff', icon: '👥', label: 'Total Staff',     value: stats.totalEmployees, male: totM,               female: totF },
    { color: '#0d9488', light: '#f0fdfa', icon: '✅', label: 'Present',         value: presentR.length,      male: mf(presentR,'male'), female: mf(presentR,'female') },
    { color: '#ef4444', light: '#fef2f2', icon: '❌', label: 'Absent',          value: absentR.length,       male: mf(absentR,'male'),  female: mf(absentR,'female') },
    { color: '#f59e0b', light: '#fffbeb', icon: '⏰', label: 'Late Arrival',    value: lateR.length,         male: mf(lateR,'male'),    female: mf(lateR,'female') },
    { color: '#3b82f6', light: '#eff6ff', icon: '🚶', label: 'Early Departure', value: earlyR.length,        male: mf(earlyR,'male'),   female: mf(earlyR,'female') },
    { color: '#6366f1', light: '#eef2ff', icon: '🌴', label: 'On Leave',        value: leaveR.length,        male: mf(leaveR,'male'),   female: mf(leaveR,'female') },
    { color: '#0ea5e9', light: '#f0f9ff', icon: '🚗', label: 'Office Visit',    value: visitR.length,        male: mf(visitR,'male'),   female: mf(visitR,'female') },
  ];

  return (
    <div className="db-p">
      <style>{STYLES}</style>

      {/* ── HEADER ── */}
      <div className="db-card db-a0" style={{ marginBottom: 14, padding: '18px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>

          {/* greeting */}
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: '#94a3b8',
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.8px' }}>
              {dateLabel}
            </p>
            <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: '#1e293b' }}>
              {greeting()},{' '}
              <span style={{ color: '#3b82f6' }}>
                {currentUser?.fullName?.split(' ')[0] || 'Admin'}
              </span>
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              🏢 {companyName}
            </p>
          </div>

          {/* right: attendance bar + mini chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 210 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Today's Attendance</span>
                <span style={{ fontSize: 12, color: '#1e293b', fontWeight: 700 }}>{pct}%</span>
              </div>
              <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3,
                  background: pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444',
                  transition: 'width .8s ease' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
                {[
                  { dot: '#10b981', text: `${presentR.length} Present` },
                  { dot: '#ef4444', text: `${absentR.length} Absent` },
                  { dot: '#818cf8', text: `${leaveR.length} Leave` },
                ].map(s => (
                  <span key={s.text} style={{ fontSize: 11, color: '#64748b', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%',
                      background: s.dot, display: 'inline-block' }} />
                    {s.text}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: 'Total',  val: stats.totalEmployees, bg: '#f8fafc', border: '#e2e8f0', c: '#1e293b' },
                { label: 'Late',   val: lateR.length,         bg: '#fffbeb', border: '#fde68a', c: '#b45309' },
                { label: 'Visit',  val: visitR.length,        bg: '#f0f9ff', border: '#bae6fd', c: '#0369a1' },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`,
                  borderRadius: 9, padding: '7px 13px', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: s.c, lineHeight: 1 }}>{s.val}</p>
                  <p style={{ margin: '3px 0 0', fontSize: 10, color: '#94a3b8',
                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── STAT CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 10, marginBottom: 14 }}>
        {CARDS.map((c, i) => (
          <StatCard key={c.label} idx={i}
            solidColor={c.color} lightColor={c.light}
            icon={c.icon} label={c.label} value={c.value}
            male={c.male} female={c.female} />
        ))}
      </div>

      {/* ── BOTTOM 2-COL ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

        {/* Applications */}
        <div className="db-card db-a7">
          <PanelHead
            title="Applications"
            sub={mainTab === 'leave' ? 'Recent leave requests' : 'Recent office visit requests'}
            action={
              <button className="db-view-btn"
                onClick={() => navigate(mainTab === 'leave' ? '/leave' : '/office-visit')}>
                View All →
              </button>
            }
          />
          <Seg active={mainTab} onChange={setMainTab}
            tabs={[{ key: 'leave', label: '📅 Leave' }, { key: 'visit', label: '🏢 Office Visit' }]} />
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            {mainTab === 'leave' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><TH>Employee</TH><TH>Type</TH><TH>Days</TH><TH>Status</TH></tr></thead>
                <tbody>
                  {recentLeaves.length === 0
                    ? <tr><td colSpan={4}><Empty msg="No leave applications" /></td></tr>
                    : recentLeaves.map(l => (
                      <tr key={l.id} className="db-tr">
                        <TD>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Av name={getEmployeeName(l.employeeId)} />
                            <span style={{ fontWeight: 600, color: '#1e293b' }}>
                              {getEmployeeName(l.employeeId)}
                            </span>
                          </div>
                        </TD>
                        <TD style={{ color: '#64748b' }}>{getLeaveTypeName(l.leaveTypeCode)}</TD>
                        <TD style={{ fontWeight: 700, textAlign: 'center' }}>{l.days}</TD>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid #f8fafc' }}>
                          <Pill status={l.status} />
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><TH>Employee</TH><TH>Purpose</TH><TH>Location</TH><TH>Status</TH></tr></thead>
                <tbody>
                  {recentVisits.length === 0
                    ? <tr><td colSpan={4}><Empty msg="No visit applications" /></td></tr>
                    : recentVisits.map(v => (
                      <tr key={v.id} className="db-tr">
                        <TD>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Av name={getEmployeeName(v.employeeId)} />
                            <span style={{ fontWeight: 600, color: '#1e293b' }}>
                              {getEmployeeName(v.employeeId)}
                            </span>
                          </div>
                        </TD>
                        <TD style={{ color: '#64748b' }}>{v.purpose}</TD>
                        <TD style={{ color: '#64748b' }}>{v.location}</TD>
                        <td style={{ padding: '9px 14px', borderBottom: '1px solid #f8fafc' }}>
                          <Pill status={v.status} />
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Holidays & Birthdays */}
        <div className="db-card db-a8">
          <PanelHead
            title={infoTab === 'holiday' ? 'Upcoming Holidays' : 'Upcoming Birthdays'}
            sub="Next 30 days"
          />
          <Seg active={infoTab} onChange={setInfoTab}
            tabs={[{ key: 'holiday', label: '🎌 Holidays' }, { key: 'birthday', label: '🎂 Birthdays' }]} />

          <div style={{ marginTop: 6 }}>
            {infoTab === 'holiday' && (
              upHolidays.length === 0
                ? <Empty msg="No upcoming holidays" />
                : upHolidays.map((h, i) => (
                  <div key={i} className="db-tr"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 18px', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7,
                        padding: '4px 9px', fontSize: 11, fontWeight: 700, color: '#92400e', whiteSpace: 'nowrap' }}>
                        {fmtDate(h.startDate)}
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{h.name}</p>
                        {h.endDate && h.endDate !== h.startDate && (
                          <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>
                            Until {fmtDate(h.endDate)}
                          </p>
                        )}
                      </div>
                    </div>
                    <span style={{ fontSize: 15, opacity: .5 }}>🏖️</span>
                  </div>
                ))
            )}

            {infoTab === 'birthday' && (
              upBirthdays.length === 0
                ? <Empty msg="No birthdays in next 30 days" />
                : upBirthdays.map(e => (
                  <div key={e.id} className="db-tr"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 18px', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        background: '#eef2ff', color: '#6366f1', border: '1px solid #c7d2fe',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 800 }}>
                        {(e.fullName?.[0] || '?').toUpperCase()}
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{e.fullName}</p>
                        <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>{fmtDate(e.dob)}</p>
                      </div>
                    </div>
                    <span style={{
                      background: e.daysUntil === 0 ? '#fef2f2' : '#f0fdf4',
                      color:      e.daysUntil === 0 ? '#991b1b' : '#166534',
                      border:     `1px solid ${e.daysUntil === 0 ? '#fecaca' : '#bbf7d0'}`,
                      borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700,
                    }}>
                      {e.daysUntil === 0 ? '🎂 Today!' : `In ${e.daysUntil}d`}
                    </span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
