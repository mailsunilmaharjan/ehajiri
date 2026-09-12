import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';

/* Payroll module landing page (Payroll menu, next to Attendance in the top
   nav — see TopMenu.jsx). Top-right has Settings (Payroll Items / Payroll
   Tax Slab, a small dropdown same interaction as Task's gear menu — see
   TaskList.jsx's gearOpen/gearRef) and Reports (placeholder — see
   PayrollReports.jsx). Body shows real counts of what's actually configured
   so far (Payroll Items, Tax Slabs) — there's no payslip/calculation engine
   yet, so anything beyond "what's configured" stays an honest placeholder
   rather than fabricated numbers. */

const StatTile = ({ label, value, icon, iconBg }) => (
  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px',
    boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</span>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: iconBg, display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{icon}</div>
    </div>
    <span style={{ fontSize: 24, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>{value}</span>
  </div>
);

const PayrollDashboard = () => {
  const navigate = useNavigate();
  const [itemCount, setItemCount] = useState(null);
  const [slabCount, setSlabCount] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    api.get('/settings/payrollItems').then(rows => setItemCount(Array.isArray(rows) ? rows.length : 0)).catch(() => setItemCount(0));
    api.get('/settings/payrollTaxSlabs').then(rows => setSlabCount(Array.isArray(rows) ? rows.length : 0)).catch(() => setSlabCount(0));
  }, []);

  useEffect(() => {
    const handler = (e) => { if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <h1 className="page-title">💰 Payroll Dashboard</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate('/payroll/reports')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', height: 36,
              background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            📊 Reports
          </button>

          <div ref={settingsRef} style={{ position: 'relative' }}>
            <button onClick={() => setSettingsOpen(p => !p)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', height: 36,
                background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ⚙️ Settings
            </button>
            {settingsOpen && (
              <div style={{ position: 'absolute', right: 0, top: 42, background: '#fff', border: '1px solid #e5e7eb',
                borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 190, zIndex: 20, overflow: 'hidden' }}>
                <div onClick={() => { setSettingsOpen(false); navigate('/payroll/items'); }}
                  style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  Payroll Items
                </div>
                <div onClick={() => { setSettingsOpen(false); navigate('/payroll/tax-slab'); }}
                  style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #f1f5f9' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  Payroll Tax Slab
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        <StatTile label="Payroll Items Configured" value={itemCount ?? '…'} icon="🧾" iconBg="#2563eb" />
        <StatTile label="Tax Slabs Configured"      value={slabCount ?? '…'} icon="📐" iconBg="#7c3aed" />
        <StatTile label="Employees on Payroll"      value="—" icon="👥" iconBg="#059669" />
        <StatTile label="This Month's Payroll"      value="—" icon="💵" iconBg="#d97706" />
      </div>

      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '16px 20px',
        display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ fontSize: 20 }}>📋</span>
        <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.6 }}>
          Payslip generation and payroll runs aren't built yet — this is the navigation and configuration
          layer only. Use <strong>Settings → Payroll Items</strong> and <strong>Settings → Payroll Tax Slab</strong> to
          define the salary components and tax brackets a future payroll run will be computed from.
        </div>
      </div>
    </div>
  );
};

export default PayrollDashboard;
