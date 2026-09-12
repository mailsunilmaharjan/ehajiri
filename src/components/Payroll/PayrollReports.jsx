import React from 'react';
import { useNavigate } from 'react-router-dom';

/* Payroll → Reports (top-right of the Payroll Dashboard) — placeholder
   until payroll runs/payslips actually exist to report on. Payroll Items
   and Payroll Tax Slab (Settings) are real, working setup lists already;
   this page is just the reserved destination for whatever reports get
   built once a payslip-generation engine exists. */
const PayrollReports = () => {
  const navigate = useNavigate();
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button onClick={() => navigate('/payroll/dashboard')} title="Back to Payroll"
          style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 15 }}>
          ←
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>📊 Payroll Reports</h1>
      </div>
      <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center', background: '#fffbeb',
        border: '1px solid #fde68a', borderRadius: 12, padding: '32px 28px' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📊</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>Coming soon</div>
        <div style={{ fontSize: 13, color: '#92400e', marginTop: 8, lineHeight: 1.5 }}>
          Payroll reports will be available once payroll runs (payslip generation) are built.
          Configure Payroll Items and Payroll Tax Slab under Settings to get started.
        </div>
      </div>
    </div>
  );
};

export default PayrollReports;
