import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── helpers ── */
function analyzeRosters(rosters, employees) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in30  = new Date(today); in30.setDate(today.getDate() + 30);

  const active   = rosters.filter(r => r.active !== false);
  const expired  = active.filter(r => r.dateTo  && new Date(r.dateTo)   < today);
  const current  = active.filter(r =>
    (!r.dateFrom || new Date(r.dateFrom) <= today) &&
    (!r.dateTo   || new Date(r.dateTo)   >= today));
  const expiring = active.filter(r =>
    r.dateTo && new Date(r.dateTo) >= today && new Date(r.dateTo) <= in30);
  const future   = active.filter(r => r.dateFrom && new Date(r.dateFrom) > today);

  /* shift distribution */
  const shiftMap = {};
  active.forEach(r => { if (r.shiftName) shiftMap[r.shiftName] = (shiftMap[r.shiftName] || 0) + 1; });
  const shifts = Object.entries(shiftMap).sort((a, b) => b[1] - a[1]);

  /* department distribution */
  const deptMap = {};
  active.forEach(r => { if (r.department) deptMap[r.department] = (deptMap[r.department] || 0) + 1; });
  const depts = Object.entries(deptMap).sort((a, b) => b[1] - a[1]);

  /* off-day counts */
  const dayCount = {};
  DAYS.forEach(d => { dayCount[d] = 0; });
  active.forEach(r => (r.offDays || []).forEach(d => { if (d in dayCount) dayCount[d]++; }));

  /* staff without roster */
  const assigned = new Set(active.map(r => String(r.employeeId || r.staffId || r.employeeName)));
  const unassigned = employees.filter(e =>
    e.active && !assigned.has(String(e.id)) && !assigned.has(e.fullName));

  /* duplicates */
  const byEmp = {};
  active.forEach(r => {
    const k = r.employeeName || r.staffId;
    if (k) (byEmp[k] = byEmp[k] || []).push(r);
  });
  const duplicates = Object.entries(byEmp).filter(([, l]) => l.length > 1)
    .map(([name, list]) => ({ name, count: list.length }));

  return { active, expired, current, expiring, future, shifts, depts, dayCount, unassigned, duplicates };
}

const SHIFT_COLORS = ['#52b02c','#059669','#7e3af2','#d97706','#dc2626','#0891b2','#be185d'];

/* ── Stat Card ── */
const StatCard = ({ icon, label, value, sub, accent, bg, border }) => (
  <div style={{
    background: bg, border: `1px solid ${border}`, borderRadius: 14,
    padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14,
  }}>
    <div style={{
      width: 44, height: 44, borderRadius: 12, background: accent + '20',
      border: `1.5px solid ${accent}40`, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 20, flexShrink: 0,
    }}>{icon}</div>
    <div>
      <div style={{ fontSize: 26, fontWeight: 900, color: accent, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  </div>
);

/* ── Roster Menu dropdown ── */
const ROSTER_SUB_MENU = [
  { key: 'dashboard',  icon: '📊', label: 'Roster Dashboard' },
  { key: 'staff',      icon: '👤', label: 'Create Roster Staff Wise' },
  { key: 'department', icon: '🏢', label: 'Create Roster Department Wise' },
  { key: 'view',       icon: '📋', label: 'View Duty Roster Report' },
];

const RosterMenuBtn = ({ active, onSelect }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(p => !p)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 16px',
          height: 36, background: open ? '#166534' : '#52b02c', color: 'white', border: 'none',
          borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(82,176,44,.3)', transition: 'background .15s' }}>
        <svg viewBox="0 0 20 20" fill="white" width="14" height="14">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
        </svg>
        Roster Menu
        <svg viewBox="0 0 20 20" fill="white" width="12" height="12"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 500,
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,.13)', overflow: 'hidden', minWidth: 260 }}>
          <div style={{ padding: '8px 14px', background: '#f9fafb', borderBottom: '1px solid #f3f4f6',
            fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            Roster Menu
          </div>
          {ROSTER_SUB_MENU.map((item, i) => {
            const isActive = active === item.key;
            return (
              <button key={item.key} onClick={() => { onSelect(item.key); setOpen(false); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                  padding: '8px 14px', border: 'none',
                  borderBottom: i < ROSTER_SUB_MENU.length - 1 ? '1px solid #f0f0f0' : 'none',
                  textAlign: 'left', cursor: 'pointer', fontSize: 13,
                  background: isActive ? '#f0fdf4' : 'white', color: isActive ? '#166534' : '#374151',
                  fontWeight: isActive ? 700 : 500 }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f9fafb'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'white'; }}>
                <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {isActive
                  ? <svg viewBox="0 0 20 20" fill="#52b02c" width="13" height="13"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                  : <svg viewBox="0 0 20 20" fill="#d1d5db" width="12" height="12"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
                }
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ── Bar row ── */
const BarRow = ({ label, value, total, color, max }) => {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: '#374151', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '72%' }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: '#6b7280', flexShrink: 0 }}>
          {value} ({total ? Math.round((value / total) * 100) : 0}%)
        </span>
      </div>
      <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4, background: color,
          width: `${pct}%`, transition: 'width .7s ease',
        }} />
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   Roster Dashboard Page
══════════════════════════════════════════ */
const RosterDashboard = () => {
  const navigate        = useNavigate();
  const { settings }    = useSettings();
  const { filteredEmployees: employees } = useData();

  const [rosters,   setRosters]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.get('/duty-roster')
      .then(ros => { setRosters(ros); setLastRefresh(new Date()); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const data = useMemo(() =>
    rosters.length || employees.length ? analyzeRosters(rosters, employees) : null,
    [rosters, employees]);

  const totalShifts = data ? data.shifts.reduce((s, [, n]) => s + n, 0) : 0;
  const totalDepts  = data ? data.depts.reduce((s,  [, n]) => s + n, 0) : 0;
  const maxDay      = data ? Math.max(...Object.values(data.dayCount)) : 1;

  const today   = new Date();
  const timeStr = today.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const dateStr = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  /* ─────────── RENDER ─────────── */
  return (
    <div className="page-container">

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            📊 Roster Analysis Dashboard
            <span style={{ fontSize:14, fontWeight:600, color:'#6b7280', marginLeft:10 }}>
              [ {dateStr} &nbsp;·&nbsp; {timeStr} &nbsp;·&nbsp; {loading ? 'Loading…' : `${rosters.length} total entries`} ]
            </span>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={load}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 36,
              padding: '0 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: '#f8fafc', border: '1px solid #d1d5db', color: '#374151',
              borderRadius: 8 }}>
            🔄 Refresh
          </button>
          <RosterMenuBtn active="dashboard" onSelect={key => {
            if (key === 'staff')           navigate('/attendance/duty-roster');
            else if (key === 'department') navigate('/attendance/duty-roster/dept');
            else if (key === 'view')       navigate('/attendance/roster-report');
          }} />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <div style={{ width: 44, height: 44, border: '4px solid #e5e7eb', borderTopColor: '#52b02c',
            borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto 16px' }} />
          <div style={{ fontSize: 14, color: '#9ca3af', fontWeight: 600 }}>Loading roster data…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : error ? (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '16px 20px', color: '#991b1b', fontWeight: 600 }}>❌ {error}</div>
      ) : !data ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Row 1: Stat cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>
            <StatCard icon="🗓️" label="Total Entries"    value={rosters.length}       sub="all records"
              accent="#52b02c" bg="#f0fdf4" border="#bbf7d0" />
            <StatCard icon="✅" label="Currently Active" value={data.current.length}  sub="in date range"
              accent="#059669" bg="#f0fdf4" border="#86efac" />
            <StatCard icon="⏳" label="Expiring in 30d"  value={data.expiring.length} sub={data.expiring.length ? 'needs review' : 'none due'}
              accent={data.expiring.length ? '#d97706' : '#6b7280'} bg={data.expiring.length ? '#fffbeb' : '#f9fafb'} border={data.expiring.length ? '#fcd34d' : '#e5e7eb'} />
            <StatCard icon="🔮" label="Future Rosters"   value={data.future.length}   sub="not yet started"
              accent="#7e3af2" bg="#f5f3ff" border="#ddd6fe" />
            <StatCard icon="🗃️" label="Expired"          value={data.expired.length}  sub={data.expired.length > 5 ? 'cleanup needed' : 'under control'}
              accent={data.expired.length > 5 ? '#dc2626' : '#6b7280'} bg={data.expired.length > 5 ? '#fff5f5' : '#f9fafb'} border={data.expired.length > 5 ? '#fca5a5' : '#e5e7eb'} />
          </div>

          {/* ── Row 2: Shift + Dept distribution ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Shift Distribution */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 18 }}>🔄</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>Shift Distribution</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>{data.shifts.length} shifts</span>
              </div>
              {data.shifts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#9ca3af', fontSize: 13 }}>No shift data</div>
              ) : (
                <>
                  {data.shifts.slice(0, 7).map(([name, count], i) => (
                    <BarRow key={name} label={name} value={count} total={totalShifts}
                      color={SHIFT_COLORS[i % SHIFT_COLORS.length]}
                      max={data.shifts[0][1]} />
                  ))}
                  {/* Legend dots */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 10 }}>
                    {data.shifts.slice(0, 7).map(([name], i) => (
                      <span key={name} style={{ display: 'flex', alignItems: 'center', gap: 5,
                        fontSize: 11, color: '#6b7280' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%',
                          background: SHIFT_COLORS[i % SHIFT_COLORS.length], display: 'inline-block' }} />
                        {name}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Department Coverage */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 18 }}>🏢</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>Department Coverage</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>{data.depts.length} depts</span>
              </div>
              {data.depts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#9ca3af', fontSize: 13 }}>No department data</div>
              ) : (
                data.depts.slice(0, 7).map(([name, count]) => (
                  <BarRow key={name} label={name} value={count} total={totalDepts}
                    color="#7e3af2" max={data.depts[0][1]} />
                ))
              )}
            </div>
          </div>

          {/* ── Row 3: Off-day pattern ── */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <span style={{ fontSize: 18 }}>📅</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>Off-Day Pattern</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>
                How often each day is assigned as a day off
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', height: 100 }}>
              {DAYS.map(day => {
                const count = data.dayCount[day];
                const pct   = maxDay ? Math.round((count / maxDay) * 100) : 0;
                const color = pct > 60 ? '#52b02c' : pct > 30 ? '#7dd3fc' : '#bbf7d0';
                return (
                  <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>{count}</div>
                    <div style={{ width: '100%', borderRadius: 6, background: color,
                      height: `${Math.max(pct, 4)}%`, transition: 'height .7s ease',
                      minHeight: 4 }} />
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>{day}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Row 4: Staff without roster + Expiring soon ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Staff without roster */}
            <div style={{
              background: data.unassigned.length ? '#fffbeb' : '#f0fdf4',
              border: `1px solid ${data.unassigned.length ? '#fcd34d' : '#86efac'}`,
              borderRadius: 14, padding: '20px 22px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>{data.unassigned.length ? '⚠️' : '✅'}</span>
                <span style={{ fontSize: 14, fontWeight: 800,
                  color: data.unassigned.length ? '#92400e' : '#065f46' }}>
                  Staff Without Roster
                </span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                  background: data.unassigned.length ? '#d97706' : '#059669',
                  color: '#fff', borderRadius: 10, padding: '2px 8px',
                }}>{data.unassigned.length}</span>
              </div>
              {data.unassigned.length === 0 ? (
                <div style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>
                  All active staff have roster assignments.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 200, overflowY: 'auto' }}>
                  {data.unassigned.map((e, i) => (
                    <div key={i} style={{
                      fontSize: 12, background: '#fff', border: '1px solid #fcd34d',
                      borderRadius: 6, padding: '6px 10px', color: '#92400e', fontWeight: 500,
                    }}>
                      {e.fullName}
                      {e.department && <span style={{ color: '#b45309', marginLeft: 6 }}>· {e.department}</span>}
                    </div>
                  ))}
                  {data.unassigned.length > 8 && (
                    <div style={{ fontSize: 11, color: '#9ca3af', padding: '2px 4px' }}>
                      …and {data.unassigned.length - 8} more
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Expiring rosters */}
            <div style={{
              background: data.expiring.length ? '#fff5f5' : '#f0fdf4',
              border: `1px solid ${data.expiring.length ? '#fca5a5' : '#86efac'}`,
              borderRadius: 14, padding: '20px 22px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>{data.expiring.length ? '⏰' : '✅'}</span>
                <span style={{ fontSize: 14, fontWeight: 800,
                  color: data.expiring.length ? '#991b1b' : '#065f46' }}>
                  Expiring in 30 Days
                </span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                  background: data.expiring.length ? '#dc2626' : '#059669',
                  color: '#fff', borderRadius: 10, padding: '2px 8px',
                }}>{data.expiring.length}</span>
              </div>
              {data.expiring.length === 0 ? (
                <div style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>
                  No rosters expiring within 30 days.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 200, overflowY: 'auto' }}>
                  {data.expiring.map((r, i) => {
                    const d    = new Date(r.dateTo);
                    const days = Math.ceil((d - new Date()) / 86400000);
                    return (
                      <div key={i} style={{
                        fontSize: 12, background: '#fff', border: '1px solid #fca5a5',
                        borderRadius: 6, padding: '6px 10px',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                        <div>
                          <span style={{ fontWeight: 700, color: '#1f2937' }}>{r.employeeName}</span>
                          {r.shiftName && <span style={{ color: '#6b7280', marginLeft: 6 }}>· {r.shiftName}</span>}
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700,
                          color: days <= 7 ? '#dc2626' : '#d97706',
                          background: days <= 7 ? '#fee2e2' : '#fef3c7',
                          borderRadius: 6, padding: '2px 7px', flexShrink: 0 }}>
                          {days}d left
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Row 5: Duplicates (if any) ── */}
          {data.duplicates.length > 0 && (
            <div style={{ background: '#f0f9ff', border: '1px solid #7dd3fc',
              borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>ℹ️</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#0369a1' }}>
                  Multiple Roster Entries Per Staff
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                  background: '#0369a1', color: '#fff', borderRadius: 10, padding: '2px 8px' }}>
                  {data.duplicates.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {data.duplicates.map((d, i) => (
                  <div key={i} style={{ fontSize: 12, background: '#fff', border: '1px solid #bae6fd',
                    borderRadius: 6, padding: '5px 12px', color: '#0369a1', fontWeight: 600 }}>
                    {d.name} — {d.count} entries
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Footer note ── */}
          <div style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', paddingBottom: 8 }}>
            Last refreshed: {lastRefresh.toLocaleTimeString()} &nbsp;·&nbsp; {rosters.length} roster entries analysed
          </div>

        </div>
      )}
    </div>
  );
};

export default RosterDashboard;
