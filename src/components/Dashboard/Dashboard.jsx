import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useChat }     from '../../context/ChatContext.jsx';
import api             from '../../api/client.js';
import { adToBS, BS_MONTHS_NP, toNepaliDigits } from '../../utils/dateUtils.js';

/** Per-employee recommend/approve assignments — same localStorage config LeaveApproval.jsx
 *  and OfficeVisitApproval.jsx already read, duplicated here (matches that existing pattern)
 *  so the dashboard can surface "items needing my action" without a new API. */
const loadRecoConfig = () => {
  try { return JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}'); } catch { return {}; }
};

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/* ─── tiny helpers ─────────────────────────────────────── */
/* Compact "dd MMM" date, but calendar-aware — shows BS (Nepali month name,
   optionally Nepali digits) when the user's default calendar setting is
   'np', otherwise the plain Gregorian short date. */
const fmtDate = (d, settings) => {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date)) return '';
  if (settings?.defaultCalendar === 'np') {
    const bs = adToBS(date);
    if (!bs) return '';
    const dd = String(bs.day).padStart(2, '0');
    return `${settings?.nepaliDigits ? toNepaliDigits(dd) : dd} ${BS_MONTHS_NP[bs.month - 1]}`;
  }
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const fmtTime = (d) =>
  d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

const greeting = (lang) => {
  const h = new Date().getHours();
  if (lang === 'np') {
    if (h < 12) return 'शुभ प्रभात';
    if (h < 17) return 'शुभ दिउँसो';
    return 'शुभ साँझ';
  }
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
  @keyframes dbShimmer {
    0%   { transform:translateX(-100%); }
    100% { transform:translateX(220%);  }
  }
  @keyframes dbPulseRing {
    0%   { box-shadow:0 0 0 0 rgba(59,130,246,.35); }
    100% { box-shadow:0 0 0 8px rgba(59,130,246,0);  }
  }

  .db-p { padding:20px 22px; background:#f1f5f9; min-height:100vh; min-height:100dvh; }

  /* Responsive grids */
  .db-stat-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:10px; margin-bottom:14px; }
  .db-bottom-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }

  @media(max-width:1200px){
    .db-stat-grid { grid-template-columns:repeat(4,1fr); }
  }
  @media(max-width:900px){
    .db-stat-grid { grid-template-columns:repeat(3,1fr); }
    .db-bottom-grid { grid-template-columns:1fr; }
    .db-p { padding:14px 16px; }
  }
  @media(max-width:600px){
    .db-stat-grid { grid-template-columns:repeat(2,1fr); }
    .db-p { padding:10px 12px; }
    .db-stat { padding:12px 10px; }
  }
  @media(max-width:360px){
    .db-stat-grid { grid-template-columns:1fr 1fr; gap:8px; }
  }

  .db-card {
    background:#fff; border:1px solid #e2e8f0;
    border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,.05);
    position:relative; overflow:hidden;
    transition:transform .2s ease, box-shadow .2s ease;
  }
  .db-card::before {
    content:''; position:absolute; top:0; left:0; right:0; height:3px;
    background:linear-gradient(90deg,#6366f1,#06b6d4,#10b981,#f59e0b,#ec4899);
    background-size:200% 100%;
    animation:headerShift 6s ease infinite;
  }
  .db-card:hover { transform:translateY(-2px); box-shadow:0 10px 24px rgba(30,41,59,.09); }
  /* Opt a specific card out of the gradient bar / hover-lift flourish */
  .db-card-plain::before { display:none; }
  .db-card-plain:hover { transform:none; box-shadow:0 1px 4px rgba(0,0,0,.05); }
  .db-stat {
    background:#fff; border:1px solid #e2e8f0; border-radius:12px;
    padding:16px 14px;
    transition:transform .18s, box-shadow .18s;
    cursor:default;
  }
  .db-stat:hover { transform:translateY(-2px); box-shadow:0 6px 18px rgba(0,0,0,.08); }

  /* Shimmering sheen sweeping across a filled progress bar */
  .db-progress-fill { position:relative; overflow:hidden; }
  .db-progress-fill::after {
    content:''; position:absolute; inset:0; width:40%;
    background:linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent);
    animation:dbShimmer 2.2s ease-in-out infinite;
  }

  .db-today-pulse { animation:dbPulseRing 1.8s ease-out infinite; }

  .db-icon-badge { transition:transform .2s ease; }
  .db-stat:hover .db-icon-badge { transform:scale(1.08) rotate(-4deg); }

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
const StatCard = ({ solidColor, lightColor, icon, label, value, male, female, other, idx }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  return (
    <div className={`db-stat db-a${idx + 1}`} style={{ borderLeft: `3px solid ${solidColor}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div className="db-icon-badge" style={{ width: 36, height: 36, borderRadius: 9,
          background: `linear-gradient(135deg, ${lightColor}, ${solidColor}26)`,
          boxShadow: `0 2px 8px ${solidColor}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
          {icon}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
          letterSpacing: '.6px', textAlign: 'right', lineHeight: 1.3, maxWidth: 80 }}>{label}</span>
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 800, color: '#1e293b',
        lineHeight: 1, letterSpacing: '-1px' }}>{value ?? 0}</p>
      {male !== undefined && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', background: '#eff6ff',
            padding: '1px 6px', borderRadius: 20, border: '1px solid #dbeafe' }}>
            {L('पुरुष','Male')} {male}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#db2777', background: '#fdf2f8',
            padding: '1px 6px', borderRadius: 20, border: '1px solid #fce7f3' }}>
            {L('महिला','Female')} {female}
          </span>
          {other > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', background: '#f5f3ff',
              padding: '1px 6px', borderRadius: 20, border: '1px solid #ddd6fe' }}>
              {L('अन्य','Other')} {other}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/** Small inline badge — used instead of a corner Ribbon on panels whose header already
 *  has an action button in the top-right corner (a rotated ribbon there would clip it). */
const Badge = ({ text, from = '#f59e0b', to = '#d97706' }) => (
  <span style={{ background: `linear-gradient(135deg, ${from}, ${to})`, color: '#fff', fontSize: 9.5,
    fontWeight: 800, padding: '2px 8px', borderRadius: 20, letterSpacing: '.3px', textTransform: 'uppercase',
    boxShadow: `0 2px 6px ${from}55`, whiteSpace: 'nowrap' }}>
    {text}
  </span>
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

const Av = ({ name, photo }) => (
  photo ? (
    <div style={{ width: 29, height: 29, borderRadius: '50%', flexShrink: 0,
      overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f1f5f9' }}>
      <img src={photo} alt={name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  ) : (
    <div style={{ width: 29, height: 29, borderRadius: '50%', flexShrink: 0,
      background: '#f1f5f9', color: '#64748b',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700, border: '1px solid #e2e8f0' }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  )
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

/** One labeled sub-table inside the "This Month Attendance" card — Date/Day plus
 *  whatever extra columns the section needs (time-in/out, remarks, etc). */
const LedgerSection = ({ title, rows, columns, emptyMsg, scroll, bg }) => (
  <div style={{ padding: '12px 18px', background: bg, borderRadius: 10 }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
      {title} <span style={{ color: '#94a3b8', fontWeight: 600 }}>({rows.length})</span>
    </div>
    {rows.length === 0 ? (
      <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>{emptyMsg}</p>
    ) : (
      <div style={scroll ? { maxHeight: 190, overflowY: 'auto' } : undefined}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{columns.map(c => <TH key={c.key}>{c.label}</TH>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="db-tr">
                {columns.map(c => <TD key={c.key}>{c.render(r)}</TD>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════ */
export default function Dashboard() {
  const { currentUser, isAdmin, isEmployee, canApprove } = useAuth();
  const { language }     = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const {
    stats, filteredLeaves: leaves, filteredVisits: officeVisits,
    getEmployeeName, getEmployeeById, getLeaveTypeName, filteredEmployees: employees,
    employees: allEmployees,
  } = useData();
  const { settings, getCompanyName } = useSettings();
  const { conversations: chatConversations } = useChat();
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

  /* ── Personal sections (Staff / Branch Manager / Department Head only) ── */
  const [myMonthly,     setMyMonthly]     = useState(null);
  const [myAnalysisBusy,setMyAnalysisBusy]= useState(true);
  const [rosterRows,    setRosterRows]    = useState([]);
  const [broadcastMsg,  setBroadcastMsg]  = useState(null);

  useEffect(() => {
    if (isAdmin) return;
    setMyAnalysisBusy(true);
    const now2 = new Date();
    api.get(`/attendance/monthly?year=${now2.getFullYear()}&month=${now2.getMonth() + 1}`)
      .then(setMyMonthly)
      .catch(() => setMyMonthly(null))
      .finally(() => setMyAnalysisBusy(false));
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) return;
    api.get('/duty-roster').then(rows => setRosterRows(Array.isArray(rows) ? rows : [])).catch(() => setRosterRows([]));
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) return;
    api.get('/messages').then(rows => { if (Array.isArray(rows) && rows.length) setBroadcastMsg(rows[0]); }).catch(() => {});
  }, [isAdmin]);

  /* /attendance/monthly only auto-scopes down to "just me" for the plain "employee"
   * role (server-side, by JWT role) — a branchManager/deptHead gets the full
   * team/company dataset back instead (that's what their other report pages need).
   * So for those two roles, "My Analysis" derives its own personal stats/rank
   * client-side from the full `allStats` list already present in the response,
   * rather than showing the whole-team aggregate mislabeled as personal. */
  const myOwnAnalysis = useMemo(() => {
    if (!myMonthly) return null;
    if (myMonthly.myRanks) return { summary: myMonthly.summary, ranks: myMonthly.myRanks };
    const all = myMonthly.allStats || [];
    const mine = all.find(s => String(s.id) === String(currentUser?.id));
    if (!mine) return null;
    const rankOf = (key) => {
      const sorted = [...all].sort((a, b) => b[key] - a[key]);
      const idx = sorted.findIndex(s => String(s.id) === String(currentUser?.id));
      return idx === -1 ? null : idx + 1;
    };
    return {
      summary: { totalPresent: mine.presentDays, totalAbsent: mine.absentDays, totalLate: mine.lateCount, avgAttRate: mine.attendanceRate },
      ranks: {
        total: all.length,
        punctuality: rankOf('punctualityScore'), lateArrivals: rankOf('lateCount'),
        earlyOut: rankOf('earlyCount'), absences: rankOf('absentDays'), attendance: rankOf('presentDays'),
      },
    };
  }, [myMonthly, currentUser?.id]);

  /* This week's duty roster — narrowed to the logged-in user's own assignment */
  const myRoster = useMemo(() =>
    rosterRows.filter(r => String(r.employeeDbId) === String(currentUser?.id)), [rosterRows, currentUser?.id]);

  const weekDays = useMemo(() => {
    const now3 = new Date();
    const startOfWeek = new Date(now3);
    startOfWeek.setDate(now3.getDate() - now3.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dayKey  = DOW[d.getDay()];
      const entry   = myRoster.find(r => r.dateFrom <= dateStr && r.dateTo >= dateStr);
      const off     = (entry?.offDays || []).includes(dayKey);
      return { dateStr, dayKey, isToday: dateStr === today, off, shiftName: entry?.shiftName || null };
    });
  }, [myRoster, today]);

  /* This Month Attendance (plain "employee" role only) — reuses the same day-by-day
   * ledger endpoint the admin Staff Ledger report uses (already auto-scoped to "just
   * me" for this role), then splits it into the 4 sub-views below. */
  const [ledger,     setLedger]     = useState(null);
  const [ledgerBusy, setLedgerBusy] = useState(true);
  useEffect(() => {
    if (!isEmployee) return;
    setLedgerBusy(true);
    const now4 = new Date();
    api.get(`/attendance/staff-ledger?year=${now4.getFullYear()}&month=${now4.getMonth() + 1}`)
      .then(setLedger)
      .catch(() => setLedger(null))
      .finally(() => setLedgerBusy(false));
  }, [isEmployee]);

  const ledgerRows = useMemo(() => {
    const daysTillToday = (ledger?.days || []).filter(d => d.dateStr <= today);
    const present     = daysTillToday.filter(d => d.status === 'Present');
    const missedPunch = present.filter(d => d.punches === 1);
    const lateEarly   = [];
    daysTillToday.forEach(d => {
      if (d.lateFormatted?.startsWith('Late By'))        lateEarly.push({ ...d, time: d.timeIn,  remark: `⏰ ${d.lateFormatted}` });
      if (d.earlyFormatted?.startsWith('Early Out'))     lateEarly.push({ ...d, time: d.timeOut, remark: `🏃 ${d.earlyFormatted}` });
    });
    const absent = daysTillToday.filter(d => d.status === 'Absent');
    return { present, missedPunch, lateEarly, absent };
  }, [ledger, today]);

  /* Latest message — whichever of the newest chat / newest broadcast message is more recent */
  const latestChat = chatConversations?.[0];
  const latestMsg = useMemo(() => {
    const chatAt = latestChat?.lastAt ? new Date(latestChat.lastAt).getTime() : 0;
    const bAt    = broadcastMsg?.created_at ? new Date(broadcastMsg.created_at).getTime() : 0;
    if (!chatAt && !bAt) return null;
    return chatAt >= bAt
      ? { type: 'chat', sender: latestChat.name, preview: latestChat.lastMessage, at: latestChat.lastAt }
      : { type: 'broadcast', sender: broadcastMsg.sender_name, preview: broadcastMsg.body, at: broadcastMsg.created_at };
  }, [latestChat, broadcastMsg]);

  /* Pending approvals — leave/visit requests specifically assigned to ME as recommender/approver */
  const recoConfig = useMemo(() => loadRecoConfig(), []);
  const isRecoCompulsory = recoConfig._settings?.isRecoCompulsory || false;
  const isRecommenderFor = (empId) => {
    const r = recoConfig[String(empId)]?.reco;
    return (Array.isArray(r) ? r : (r ? [r] : [])).map(String).includes(String(currentUser?.id));
  };
  const isApproverFor = (empId) => {
    const a = recoConfig[String(empId)]?.approval;
    return (Array.isArray(a) ? a : (a ? [a] : [])).map(String).includes(String(currentUser?.id));
  };
  const canApproveItem = (item) => !isRecoCompulsory || !!item.recommendedBy;

  const pendingApprovals = useMemo(() => {
    if (!canApprove) return [];
    const mine = (list, kind) => list.filter(item => item.status === 'pending' &&
      ((isRecommenderFor(item.employeeId) && !item.recommendedBy) ||
       (isApproverFor(item.employeeId) && canApproveItem(item))))
      .map(item => ({ ...item, kind, needsRecommend: isRecommenderFor(item.employeeId) && !item.recommendedBy }));
    return [...mine(leaves, 'leave'), ...mine(officeVisits, 'visit')]
      .sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate));
  }, [leaves, officeVisits, canApprove, recoConfig, currentUser?.id]);

  /* gender map */
  const gMap = {};
  employees.forEach(e => { gMap[e.id] = e.gender; });
  const mf = (rows, sex) => rows.filter(r => gMap[r.id] === sex).length;
  const mo = (rows) => rows.filter(r => gMap[r.id] !== 'male' && gMap[r.id] !== 'female' && gMap[r.id]).length;

  const active = employees.filter(e => e.active);
  const totM   = active.filter(e => e.gender === 'male').length;
  const totF   = active.filter(e => e.gender === 'female').length;
  const totO   = active.filter(e => e.gender && e.gender !== 'male' && e.gender !== 'female').length;

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
  // Birthdays are a social/celebratory feature, not a reporting concern — show
  // everyone's, not just the reporting-scoped `filteredEmployees` (which would
  // otherwise leave a plain "employee" role seeing only their own birthday).
  const upBirthdays = (allEmployees || []).filter(e => e.active).filter(e => e.dob).map(e => {
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
    { key:'total',  color:'#7c3aed', light:'#f5f3ff', icon:'👥', label:L('कुल कर्मचारी','Total Staff'),     value:stats.totalEmployees, male:totM,                female:totF,                other:totO },
    { key:'pres',   color:'#0d9488', light:'#f0fdfa', icon:'✅', label:L('उपस्थित','Present'),              value:presentR.length,      male:mf(presentR,'male'), female:mf(presentR,'female'), other:mo(presentR) },
    { key:'abs',    color:'#ef4444', light:'#fef2f2', icon:'❌', label:L('अनुपस्थित','Absent'),             value:absentR.length,       male:mf(absentR,'male'),  female:mf(absentR,'female'),  other:mo(absentR) },
    { key:'late',   color:'#f59e0b', light:'#fffbeb', icon:'⏰', label:L('ढिलो आगमन','Late Arrival'),      value:lateR.length,         male:mf(lateR,'male'),    female:mf(lateR,'female'),    other:mo(lateR) },
    { key:'early',  color:'#3b82f6', light:'#eff6ff', icon:'🚶', label:L('चाँडो प्रस्थान','Early Departure'), value:earlyR.length,      male:mf(earlyR,'male'),   female:mf(earlyR,'female'),   other:mo(earlyR) },
    { key:'leave',  color:'#6366f1', light:'#eef2ff', icon:'🌴', label:L('बिदामा','On Leave'),              value:leaveR.length,        male:mf(leaveR,'male'),   female:mf(leaveR,'female'),   other:mo(leaveR) },
    { key:'visit',  color:'#0ea5e9', light:'#f0f9ff', icon:'🚗', label:L('कार्यालय भ्रमण','Office Visit'),  value:visitR.length,        male:mf(visitR,'male'),   female:mf(visitR,'female'),   other:mo(visitR) },
  ];

  return (
    <div className="db-p">
      <style>{STYLES}</style>

      {/* ── HEADER ── */}
      <div className="db-card db-a0" style={{ marginBottom: 14, padding: '18px 22px' }}>
        {Array.from({ length: 6 }).map((_, i) => <span key={i} className="modal-header-bubble" />)}
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>

          {/* greeting */}
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 11, color: '#94a3b8',
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.8px' }}>
              {dateLabel}
            </p>
            <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: '#1e293b' }}>
              {greeting(language)},{' '}
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
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{L('आजको हाजिरी',"Today's Attendance")}</span>
                <span style={{ fontSize: 12, color: '#1e293b', fontWeight: 700 }}>{pct}%</span>
              </div>
              <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                <div className="db-progress-fill" style={{ height: '100%', width: `${pct}%`, borderRadius: 3,
                  background: pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444',
                  transition: 'width .8s ease' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
                {[
                  { dot: '#10b981', text: `${presentR.length} ${L('उपस्थित','Present')}` },
                  { dot: '#ef4444', text: `${absentR.length} ${L('अनुपस्थित','Absent')}` },
                  { dot: '#818cf8', text: `${leaveR.length} ${L('बिदा','Leave')}` },
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
                { label: L('जम्मा','Total'),  val: stats.totalEmployees, bg: '#f8fafc', border: '#e2e8f0', c: '#1e293b' },
                { label: L('ढिलो','Late'),   val: lateR.length,         bg: '#fffbeb', border: '#fde68a', c: '#b45309' },
                { label: L('भ्रमण','Visit'),  val: visitR.length,        bg: '#f0f9ff', border: '#bae6fd', c: '#0369a1' },
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

      {/* ── STAT CARDS — a plain Staff login sees "This Month Attendance" instead ── */}
      {isEmployee ? (
        <div className="db-card db-card-plain db-a0" style={{ marginBottom: 14 }}>
          <PanelHead
            title={L('यस महिनाको हाजिरी','This Month Attendance')}
            sub={L('आजसम्म','Till today')}
            action={
              <button className="db-view-btn" onClick={() => navigate('/attendance/reports/daily')}>
                {L('पूर्ण लेजर →','Full Ledger →')}
              </button>
            }
          />
          {ledgerBusy ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              {L('लोड हुँदैछ…','Loading…')}
            </div>
          ) : (
            <div style={{ padding: '12px 18px', display: 'grid', gap: 14 }}>
              {/* Row 1 — Attendance Log + Missed Punch */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <LedgerSection
                  bg="#f0fdf4"
                  title={`📋 ${L('हाजिरी लग','Attendance Log')}`}
                  rows={ledgerRows.present}
                  scroll
                  columns={[
                    { key: 'date', label: L('मिति','Date'),     render: r => fmtDate(r.dateStr, settings) },
                    { key: 'day',  label: L('दिन','Day'),       render: r => r.dayKey },
                    { key: 'in',   label: L('समय इन','Time In'),  render: r => fmtTime(r.timeIn) },
                    { key: 'out',  label: L('समय आउट','Time Out'), render: r => fmtTime(r.timeOut) },
                    { key: 'tot',  label: L('जम्मा','Total'),    render: r => r.totalFormatted || '—' },
                  ]}
                  emptyMsg={L('अहिलेसम्म हाजिरी छैन','No attendance recorded yet')}
                />
                <LedgerSection
                  bg="#fffbeb"
                  title={`⚠️ ${L('१ पन्च छुटेको','Missed 1 Punch')}`}
                  rows={ledgerRows.missedPunch}
                  columns={[
                    { key: 'date', label: L('मिति','Date'),      render: r => fmtDate(r.dateStr, settings) },
                    { key: 'day',  label: L('दिन','Day'),        render: r => r.dayKey },
                    { key: 'in',   label: L('समय इन','Time In'),   render: r => fmtTime(r.timeIn) },
                    { key: 'out',  label: L('समय आउट','Time Out'), render: () => '—' },
                  ]}
                  emptyMsg={L('यस महिना कुनै पन्च छुटेको छैन','No missed punches this month')}
                />
              </div>

              {/* Row 2 — Late In & Early Out + Absent Days */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <LedgerSection
                  bg="#eff6ff"
                  title={`⏰ ${L('ढिलो र चाँडो','Late In & Early Out')}`}
                  rows={ledgerRows.lateEarly}
                  scroll
                  columns={[
                    { key: 'date',   label: L('मिति','Date'),   render: r => fmtDate(r.dateStr, settings) },
                    { key: 'day',    label: L('दिन','Day'),     render: r => r.dayKey },
                    { key: 'time',   label: L('समय','Time'),    render: r => fmtTime(r.time) },
                    { key: 'remark', label: L('कैफियत','Remarks'), render: r => r.remark },
                  ]}
                  emptyMsg={L('यस महिना ढिलो वा चाँडो छैन','No late arrivals or early departures this month')}
                />
                <div style={{ background: '#fff5f5', borderRadius: 10, padding: '12px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                    ❌ {L('अहिलेसम्म अनुपस्थित दिन','Absent Days Till Now')}
                  </span>
                  <span style={{ fontSize: 28, fontWeight: 800, color: ledgerRows.absent.length > 0 ? '#991b1b' : '#0d9488' }}>
                    {ledgerRows.absent.length}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="db-stat-grid">
          {CARDS.map((c, i) => (
            <StatCard key={c.key} idx={i}
              solidColor={c.color} lightColor={c.light}
              icon={c.icon} label={c.label} value={c.value}
              male={c.male} female={c.female} other={c.other} />
          ))}
        </div>
      )}

      {/* ── BOTTOM 2-COL ── */}
      <div className="db-bottom-grid">

        {/* Applications */}
        <div className="db-card db-a7">
          <PanelHead
            title={L('दरखास्त','Applications')}
            sub={mainTab === 'leave' ? L('हालका बिदा दरखास्त','Recent leave requests') : L('हालका कार्यालय भ्रमण दरखास्त','Recent office visit requests')}
            action={
              <button className="db-view-btn"
                onClick={() => navigate(mainTab === 'leave' ? '/leave' : '/office-visit')}>
                {L('सबै हेर्नुहोस् →','View All →')}
              </button>
            }
          />
          <Seg active={mainTab} onChange={setMainTab}
            tabs={[{ key: 'leave', label: `📅 ${L('बिदा','Leave')}` }, { key: 'visit', label: `🏢 ${L('कार्यालय भ्रमण','Office Visit')}` }]} />
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            {mainTab === 'leave' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><TH>{L('कर्मचारी','Employee')}</TH><TH>{L('प्रकार','Type')}</TH><TH>{L('दिन','Days')}</TH><TH>{L('स्थिति','Status')}</TH></tr></thead>
                <tbody>
                  {recentLeaves.length === 0
                    ? <tr><td colSpan={4}><Empty msg={L('बिदा दरखास्त छैन','No leave applications')} /></td></tr>
                    : recentLeaves.map(l => (
                      <tr key={l.id} className="db-tr">
                        <TD>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Av name={getEmployeeName(l.employeeId)} photo={getEmployeeById(l.employeeId)?.profilePhoto} />
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
                <thead><tr><TH>{L('कर्मचारी','Employee')}</TH><TH>{L('उद्देश्य','Purpose')}</TH><TH>{L('स्थान','Location')}</TH><TH>{L('स्थिति','Status')}</TH></tr></thead>
                <tbody>
                  {recentVisits.length === 0
                    ? <tr><td colSpan={4}><Empty msg={L('भ्रमण दरखास्त छैन','No visit applications')} /></td></tr>
                    : recentVisits.map(v => (
                      <tr key={v.id} className="db-tr">
                        <TD>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Av name={getEmployeeName(v.employeeId)} photo={getEmployeeById(v.employeeId)?.profilePhoto} />
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
            title={infoTab === 'holiday' ? L('आउँदो सार्वजनिक बिदा','Upcoming Holidays') : L('आउँदो जन्मदिन','Upcoming Birthdays')}
            sub={L('अर्को ३० दिन','Next 30 days')}
          />
          <Seg active={infoTab} onChange={setInfoTab}
            tabs={[{ key: 'holiday', label: `🎌 ${L('बिदा','Holidays')}` }, { key: 'birthday', label: `🎂 ${L('जन्मदिन','Birthdays')}` }]} />

          <div style={{ marginTop: 6 }}>
            {infoTab === 'holiday' && (
              upHolidays.length === 0
                ? <Empty msg={L('आउँदो बिदा छैन','No upcoming holidays')} />
                : upHolidays.map((h, i) => (
                  <div key={i} className="db-tr"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 18px', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7,
                        padding: '4px 9px', fontSize: 11, fontWeight: 700, color: '#92400e', whiteSpace: 'nowrap' }}>
                        {fmtDate(h.startDate, settings)}
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{h.name}</p>
                        {h.endDate && h.endDate !== h.startDate && (
                          <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>
                            {L('सम्म','Until')} {fmtDate(h.endDate, settings)}
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
                ? <Empty msg={L('अर्को ३० दिनमा जन्मदिन छैन','No birthdays in next 30 days')} />
                : upBirthdays.map(e => (
                  <div key={e.id} className="db-tr"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 18px', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {e.profilePhoto ? (
                        <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          overflow: 'hidden', border: '1px solid #c7d2fe', background: '#eef2ff' }}>
                          <img src={e.profilePhoto} alt={e.fullName || ''}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        </div>
                      ) : (
                        <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: '#eef2ff', color: '#6366f1', border: '1px solid #c7d2fe',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 13, fontWeight: 800 }}>
                          {(e.fullName?.[0] || '?').toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{e.fullName}</p>
                        <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>{fmtDate(e.dob, settings)}</p>
                      </div>
                    </div>
                    <span style={{
                      background: e.daysUntil === 0 ? '#fef2f2' : '#f0fdf4',
                      color:      e.daysUntil === 0 ? '#991b1b' : '#166534',
                      border:     `1px solid ${e.daysUntil === 0 ? '#fecaca' : '#bbf7d0'}`,
                      borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700,
                    }}>
                      {e.daysUntil === 0 ? `🎂 ${L('आज!','Today!')}` : `${L('मा','In')} ${e.daysUntil}${L('दिन','d')}`}
                    </span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* ── PERSONAL SECTIONS — Staff / Branch Manager / Department Head ── */}
      {!isAdmin && (
        <>
          {/* My Analysis · This Week Duty Roster — same row */}
          <div className="db-a8" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>

            {/* My Analysis — this month's stats + ranking status among peers */}
            <div className="db-card" style={{ background: '#f5f3ff' }}>
              <PanelHead
                title={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    {L('मेरो विश्लेषण','My Analysis')}
                    {myOwnAnalysis?.ranks && ['punctuality','lateArrivals','earlyOut','absences','attendance']
                      .some(k => myOwnAnalysis.ranks[k] === 1) && (
                      <Badge text={L('🏆 उत्कृष्ट','🏆 Top')} />
                    )}
                  </span>
                }
                sub={L('यस महिना — आजसम्म','This month — till today')}
                action={
                  <button className="db-view-btn" onClick={() => navigate('/attendance/reports/monthly')}>
                    {L('पूर्ण रिपोर्ट →','Full Report →')}
                  </button>
                }
              />
              {myAnalysisBusy ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  {L('लोड हुँदैछ…','Loading…')}
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, padding: '14px 18px' }}>
                    {[
                      { label: L('उपस्थित','Present'),        value: myOwnAnalysis?.summary?.totalPresent ?? 0, color: '#0d9488' },
                      { label: L('अनुपस्थित','Absent'),        value: myOwnAnalysis?.summary?.totalAbsent  ?? 0, color: '#ef4444' },
                      { label: L('ढिलो','Late'),               value: myOwnAnalysis?.summary?.totalLate    ?? 0, color: '#f59e0b' },
                      { label: L('उपस्थिति दर','Att. Rate'),   value: `${myOwnAnalysis?.summary?.avgAttRate ?? 0}%`, color: '#3b82f6' },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign: 'center' }}>
                        <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
                        <p style={{ margin: '2px 0 0', fontSize: 10.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>{s.label}</p>
                      </div>
                    ))}
                  </div>

                  <div style={{ padding: '0 18px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      { key: 'punctuality',  icon: '⭐', label: L('सबैभन्दा नियमित','Most Punctual'),        bg: '#fefce8', border: '#fef08a' },
                      { key: 'lateArrivals', icon: '⏰', label: L('सबैभन्दा ढिलो','Most Late-In'),           bg: '#fef2f2', border: '#fecaca' },
                      { key: 'earlyOut',     icon: '🏃', label: L('सबैभन्दा चाँडो प्रस्थान','Most Early-Out'), bg: '#fff7ed', border: '#fed7aa' },
                      { key: 'absences',     icon: '📅', label: L('सबैभन्दा अनुपस्थित','Most Absent'),       bg: '#fdf2f8', border: '#fbcfe8' },
                      { key: 'attendance',   icon: '🎯', label: L('उच्च उपस्थिति','Highest Attendance'),     bg: '#f0fdf4', border: '#bbf7d0' },
                    ].map(r => {
                      const rank  = myOwnAnalysis?.ranks?.[r.key];
                      const total = myOwnAnalysis?.ranks?.total;
                      return (
                        <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: r.bg, border: `1px solid ${r.border}`, borderRadius: 8, padding: '7px 12px' }}>
                          <span style={{ fontSize: 12.5, color: '#334155', fontWeight: 600 }}>{r.icon} {r.label}</span>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: rank && rank <= 3 ? '#0d9488' : '#64748b' }}>
                            {rank ? L(`तपाईंको स्थान ${rank}औं ${total} मध्ये`, `Your Rank ${ordinal(rank)} of ${total}`) : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* This Week Duty Roster */}
            <div className="db-card" style={{ background: '#ecfeff' }}>
              <PanelHead title={L('यो हप्ताको ड्युटी रोस्टर','This Week Duty Roster')} />
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', gap: 4 }}>
                {weekDays.map(d => (
                  <div key={d.dateStr} style={{ flex: 1, textAlign: 'center', borderRadius: 8, padding: '6px 2px',
                    background: d.isToday ? '#eff6ff' : 'transparent' }}>
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: d.isToday ? '#1d4ed8' : '#94a3b8' }}>{d.dayKey}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 10, fontWeight: 600, color: d.off ? '#ef4444' : '#1e293b' }}>
                      {d.off ? L('बिदा','Off') : (d.shiftName || '—')}
                    </p>
                  </div>
                ))}
              </div>
              {myRoster.length === 0 && <Empty msg={L('रोस्टर तोकिएको छैन','No roster assigned')} />}
            </div>
          </div>

          {/* Latest Message · Pending Approvals */}
          <div className="db-a8" style={{ display: 'grid',
            gridTemplateColumns: canApprove ? '1fr 1fr' : '1fr', gap: 14, marginTop: 14 }}>

            {/* Latest Message */}
            <div className="db-card">
              <PanelHead title={L('पछिल्लो सन्देश','Latest Message')}
                action={
                  <button className="db-view-btn" onClick={() => navigate(latestMsg?.type === 'chat' ? '/chat' : '/staff/message')}>
                    {L('हेर्नुहोस् →','View →')}
                  </button>
                } />
              {latestMsg ? (
                <div style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Av name={latestMsg.sender} />
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{latestMsg.sender}</p>
                      <p style={{ margin: 0, fontSize: 10.5, color: '#94a3b8' }}>
                        {latestMsg.type === 'chat' ? '💬 Chat' : '✉ Broadcast'} · {fmtDate(latestMsg.at, settings)}
                      </p>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {latestMsg.preview}
                  </p>
                </div>
              ) : <Empty msg={L('कुनै सन्देश छैन','No messages yet')} />}
            </div>

            {/* Pending Approvals — only shown to a recommender/approver */}
            {canApprove && (
              <div className="db-card">
                <PanelHead title={L('मेरो कारबाही आवश्यक','Pending My Action')}
                  sub={`${pendingApprovals.length} ${L('कारबाही आवश्यक','need action')}`}
                  action={
                    <button className="db-view-btn" onClick={() => navigate('/leave/approval')}>
                      {L('हेर्नुहोस् →','View →')}
                    </button>
                  } />
                {pendingApprovals.length === 0 ? <Empty msg={L('कुनै स्वीकृति बाँकी छैन','Nothing pending')} /> : (
                  <div>
                    {pendingApprovals.slice(0, 5).map(item => (
                      <div key={`${item.kind}-${item.id}`} className="db-tr" style={{ display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', padding: '9px 18px', borderBottom: '1px solid #f8fafc' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Av name={getEmployeeName(item.employeeId)} photo={getEmployeeById(item.employeeId)?.profilePhoto} />
                          <div>
                            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: '#1e293b' }}>{getEmployeeName(item.employeeId)}</p>
                            <p style={{ margin: 0, fontSize: 10.5, color: '#94a3b8' }}>{item.kind === 'leave' ? '📅 Leave' : '🏢 Visit'}</p>
                          </div>
                        </div>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#b45309', background: '#fffbeb',
                          border: '1px solid #fde68a', borderRadius: 20, padding: '2px 9px' }}>
                          {item.needsRecommend ? L('सिफारिस','Recommend') : L('स्वीकृत','Approve')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

    </div>
  );
}
