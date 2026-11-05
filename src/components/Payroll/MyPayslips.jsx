import React, { useState, useEffect } from 'react';
import api from '../../api/client.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import PayslipView, { printPayslip } from './PayslipView.jsx';
import { PageHeader, Modal, GhostBtn, useToast, money } from './payrollUi.jsx';

/* Payroll → My Payslips: an employee's own locked payslips (server returns only the signed-in user's). */
export default function MyPayslips() {
  const fd = useDateFormat();
  const [list, setList] = useState(null);
  const [slip, setSlip] = useState(null);
  const [toast, node] = useToast();
  useEffect(() => { api.get('/payroll/my-payslips').then(setList).catch(e => { toast(e.message, 'error'); setList([]); }); }, [toast]);
  const open = (id) => api.get(`/payroll/my-payslips/${id}`).then(setSlip).catch(e => toast(e.message, 'error'));

  return (
    <div style={{ padding: '20px 24px', maxWidth: 820 }}>
      <PageHeader title="🧾 My Payslips" back="/dashboard" />
      {list === null ? <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>
        : list.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>No payslips yet. They appear here once payroll for a month is finalised.</div>
        : (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
            {list.map(p => (
              <div key={p.id} onClick={() => open(p.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                <div><b>{p.label}</b><div style={{ fontSize: 12, color: '#6b7280' }}>{fd(p.period_start)} → {fd(p.period_end)}</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontSize: 12, color: '#6b7280' }}>Net pay</div><b style={{ color: '#065f46' }}>{money(p.net)}</b></div>
              </div>))}
          </div>)}
      {slip && (
        <Modal wide title={`Payslip — ${slip.run.label}`} onClose={() => setSlip(null)} footer={<><GhostBtn onClick={() => printPayslip(slip)}>🖨 Print</GhostBtn><GhostBtn onClick={() => setSlip(null)}>Close</GhostBtn></>}>
          <PayslipView slip={slip} />
        </Modal>
      )}
      {node}
    </div>
  );
}
