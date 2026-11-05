import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import useDateFormat from '../hooks/useDateFormat.js';
import { Empty, Sheet, Spinner, useMT } from './kit.jsx';

/* My Payslips on the phone: a card per finalised month, tap for the full breakdown. */
const rs = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function MobilePayslips() {
  const mt = useMT();
  const fd = useDateFormat();
  const [list, setList] = useState(null);
  const [slip, setSlip] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/payroll/my-payslips').then(setList).catch(e => { setErr(e.message || 'Could not load'); setList([]); }); }, []);
  const open = async (id) => {
    setBusy(true); setErr('');
    try { setSlip(await api.get(`/payroll/my-payslips/${id}`)); } catch (e) { setErr(e.message || 'Could not open'); } finally { setBusy(false); }
  };

  const earn = (slip?.lines || []).filter(l => l.kind === 'earning');
  const ded = (slip?.lines || []).filter(l => l.kind === 'deduction');
  const Row = ({ l }) => <div className="m-kv"><span>{l.name}</span><b>{rs(l.amount)}</b></div>;

  return (
    <div className="m-page">
      {list === null && <div className="m-empty"><Spinner dark /></div>}
      {err && <div className="m-err">{err}</div>}
      {list && list.length === 0 && !err && (
        <div className="m-card"><Empty icon="🧾" text="No payslips yet. They appear here once your office finalises a month's payroll." /></div>
      )}
      {list && list.map(p => (
        <button key={p.id} className="m-pay" onClick={() => open(p.id)} disabled={busy}>
          <div className="m-row"><b className="m-grow" style={{ fontSize: 16 }}>{p.label}</b><span className="m-chip ok">{mt('Approved')}</span></div>
          <div className="m-muted" style={{ marginTop: 2 }}>{fd(p.period_start)} → {fd(p.period_end)}</div>
          <div className="m-row" style={{ marginTop: 12 }}>
            <div className="m-grow"><div className="m-muted" style={{ fontSize: 12 }}>Net pay</div><b style={{ fontSize: 22, color: 'var(--m-ok)' }}>Rs {rs(p.net)}</b></div>
            <div style={{ textAlign: 'right' }}><div className="m-muted" style={{ fontSize: 12 }}>Gross {rs(p.gross)}</div><div className="m-muted" style={{ fontSize: 12 }}>Deductions {rs(p.total_deductions)}</div></div>
          </div>
        </button>
      ))}

      {slip && (
        <Sheet title={slip.run.label} onClose={() => setSlip(null)}>
          <div className="m-net"><span>Net pay</span><b>Rs {rs(slip.net)}</b></div>
          <div className="m-muted" style={{ margin: '8px 2px 14px', fontSize: 12.5 }}>
            {fd(slip.run.periodStart)} → {fd(slip.run.periodEnd)} · {slip.days.payable} / {slip.days.base} days{slip.days.absent ? ` · ${slip.days.absent} absent` : ''}
          </div>
          <div className="m-h2" style={{ marginTop: 4 }}>Earnings</div>
          <div className="m-card m-flat" style={{ padding: '4px 14px' }}>{earn.map((l, i) => <Row key={i} l={l} />)}<div className="m-kv m-total"><span>Gross</span><b>{rs(slip.gross)}</b></div></div>
          <div className="m-h2">Deductions</div>
          <div className="m-card m-flat" style={{ padding: '4px 14px' }}>{ded.map((l, i) => <Row key={i} l={l} />)}<div className="m-kv m-total"><span>Total deductions</span><b>{rs(slip.totalDeductions)}</b></div></div>
          {slip.employee?.bankAccount && <div className="m-muted" style={{ fontSize: 12, textAlign: 'center' }}>Paid to {slip.employee.bankName || 'bank'} · {slip.employee.bankAccount}</div>}
        </Sheet>
      )}
    </div>
  );
}
