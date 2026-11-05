import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { money } from './payrollUi.jsx';

/* Payroll landing page. Payroll staff (admin / super admin) see the workflow cards and live figures;
   every other user only sees a link to their own payslips. */

const StatTile = ({ label, value, icon, iconBg, sub }) => (
  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</span>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{icon}</div>
    </div>
    <span style={{ fontSize: 24, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>{value}</span>
    {sub && <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 6 }}>{sub}</div>}
  </div>
);

const Card = ({ icon, title, text, to, navigate }) => (
  <div onClick={() => navigate(to)} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = '#93c5fd'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; }}>
    <div style={{ fontSize: 22 }}>{icon}</div>
    <div style={{ fontWeight: 800, fontSize: 14, color: '#111827', marginTop: 6 }}>{title}</div>
    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3, lineHeight: 1.45 }}>{text}</div>
  </div>
);

const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', height: 36, background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };

const PayrollDashboard = () => {
  const navigate = useNavigate();
  const fd = useDateFormat();
  const { currentUser } = useAuth();
  const staff = ['admin', 'superAdmin'].includes(currentUser?.role);
  const [stats, setStats] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    if (!staff) return;
    Promise.all([api.get('/payroll/salary'), api.get('/payroll/advances?status=running'), api.get('/payroll/runs')]).then(([sal, adv, runs]) => {
      const last = runs.find(r => r.status === 'locked');
      setStats({
        onPayroll: sal.filter(s => s.hasSalary).length, total: sal.length, due: sal.filter(s => s.incrementDue).length,
        advCount: adv.length, advBalance: adv.reduce((s, a) => s + a.balance, 0), last,
        drafts: runs.filter(r => r.status !== 'locked').length,
      });
    }).catch(() => setStats({}));
  }, [staff]);

  useEffect(() => {
    const h = (e) => { if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const menuItem = (label, to) => (
    <div onClick={() => { setSettingsOpen(false); navigate(to); }} style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>{label}</div>
  );

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <h1 className="page-title">💰 Payroll</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={btn} onClick={() => navigate('/payroll/my')}>🧾 My Payslips</button>
          {staff && <button style={btn} onClick={() => navigate('/payroll/reports')}>📊 Reports</button>}
          {staff && (
            <div ref={settingsRef} style={{ position: 'relative' }}>
              <button style={btn} onClick={() => setSettingsOpen(p => !p)}>⚙️ Settings</button>
              {settingsOpen && (
                <div style={{ position: 'absolute', right: 0, top: 42, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 210, zIndex: 20, overflow: 'hidden' }}>
                  {menuItem('Payroll Items (allowances, bonus)', '/payroll/items')}
                  {menuItem('Payroll Tax Slab', '/payroll/tax-slab')}
                  {menuItem('Rates & Limits (SSF, PF, policy)', '/payroll/rates')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!staff ? (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '18px 20px', color: '#1e40af', fontSize: 14 }}>
          Payroll processing is handled by your administrator. Use <b>My Payslips</b> to view your own payslips.
        </div>
      ) : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
          <StatTile label="Employees on payroll" value={stats ? `${stats.onPayroll ?? '—'}` : '…'} icon="👥" iconBg="#059669" sub={stats?.total != null ? `of ${stats.total} active staff` : ''} />
          <StatTile label="Increments due (30 days)" value={stats ? stats.due ?? '—' : '…'} icon="📈" iconBg={stats?.due ? '#dc2626' : '#2563eb'} />
          <StatTile label="Advances being repaid" value={stats ? stats.advCount ?? '—' : '…'} icon="💳" iconBg="#7c3aed" sub={stats?.advBalance ? `Balance ${money(stats.advBalance)}` : ''} />
          <StatTile label="Last finalised payroll" value={stats?.last ? money(stats.last.net) : '—'} icon="💵" iconBg="#d97706" sub={stats?.last ? `${stats.last.label} · ${fd(stats.last.period_end)}` : 'No locked run yet'} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
          <Card navigate={navigate} to="/payroll/salary" icon="👥" title="Salary Setup" text="Salary, grade, SSF / PF / CIT, bank details, increment dates and case allowances (e.g. maternity)." />
          <Card navigate={navigate} to="/payroll/scales" icon="🏛️" title="Pay Scales" text="Government-style grades: starting salary, grade rate and yearly grade increments, applied to staff when the scale is revised." />
          <Card navigate={navigate} to="/payroll/run" icon="🧾" title="Payroll Runs" text={stats?.drafts ? `${stats.drafts} run(s) in progress. Calculate, review, approve and lock the monthly payroll.` : 'Calculate, review, approve and lock the monthly payroll, including the yearly festival bonus.'} />
          <Card navigate={navigate} to="/payroll/advances" icon="💳" title="Advances" text="Advance policies, advances and their instalments, recovered automatically from salary." />
          <Card navigate={navigate} to="/payroll/ledger" icon="📒" title="Fund Ledger" text="SSF, PF, CIT and insurance contributions per employee, with opening balances and withdrawals." />
          <Card navigate={navigate} to="/payroll/reports" icon="📊" title="Reports" text="Payroll register, bank advice, income-tax statement and SSF / PF statements in Excel." />
          <Card navigate={navigate} to="/payroll/rates" icon="⚙️" title="Rates & Limits" text="SSF / PF rates, tax-deduction limits and the pay-day policy — all editable, with history." />
        </div>
      </>)}
    </div>
  );
};

export default PayrollDashboard;
