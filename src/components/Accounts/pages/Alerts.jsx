import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '../lib/router';
import { useApp } from '../context';
import DocView from '../components/DocView';
import { useGrid } from '../components/DataGrid';
import { api, fmtMoney, fmtStamp, waLink } from '../lib/api';
import { fmtDate, fmtDateShort } from '../lib/dates';

function Remind({ docId, kind, phone, email }) {
  const { notify, company, canEdit } = useApp();
  const [busy, setBusy] = useState('');
  if (!docId || !canEdit) return null;
  const send = async (channel) => {
    setBusy(channel);
    try { await api.post('/alerts/remind', { doc_id: docId, channel, kind }); notify('Reminder sent'); }
    catch (err) { notify(err.message, 'err'); }
    setBusy('');
  };
  const share = async () => {
    const r = await api.get('/alerts/remind-text', { doc_id: docId, kind });
    window.open(waLink(r.phone || phone, r.text), '_blank', 'noopener');
  };
  return (
    <span className="remind">
      {email && <button className="link" disabled={!!busy} onClick={() => send('email')}>✉ Email</button>}
      {company.wa_ready && phone && <button className="link" disabled={!!busy} onClick={() => send('whatsapp')}>🟢 WhatsApp</button>}
      {phone && <button className="link" onClick={share}>Share</button>}
    </span>
  );
}

function Section({ title, tone, rows, empty, head, row, onOpen }) {
  // several grids on this page: none is pre-selected; the arrow keys go to the grid clicked last
  const keyed = useMemo(() => rows.map((r, i) => ({ ...r, _k: i })), [rows]);
  const g = useGrid({ rows: keyed, getId: (r) => r._k, onOpen, autoPick: false });
  return (
    <section className="card">
      <div className="card-head"><h2>{title} <span className={`tag ${tone}`}>{rows.length}</span></h2></div>
      {rows.length === 0 ? <p className="muted small">{empty}</p> : (
        <table ref={g.gridRef} className="grid dg-soft"><thead><tr>{g.tickTh}<th className="sn">SN</th>{head}</tr></thead>
          <tbody>{keyed.map((r, i) => <tr key={r._k} {...g.rowProps(r)}>{g.tickTd(r)}<td className="sn">{i + 1}</td>{row(r)}</tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

function Approvals({ rows, reload }) {
  const { notify } = useApp();
  const g = useGrid({ rows, autoPick: false });
  if (!rows.length) return null;
  const approve = async (r) => {
    const password = prompt(`Approve deleting ${r.entity_no}?\nRequested by ${r.requested_by}: ${r.reason}\n\nType your admin password:`);
    if (!password) return;
    try { await api.post(`/approvals/${r.id}/approve`, { password }); notify(`${r.entity_no} deleted`); reload(); }
    catch (err) { notify(err.message, 'err'); }
  };
  const reject = async (r) => {
    const note = prompt(`Reject the request to delete ${r.entity_no}? Note for ${r.requested_by}:`, '');
    if (note === null) return;
    try { await api.post(`/approvals/${r.id}/reject`, { note }); notify('Request rejected'); reload(); }
    catch (err) { notify(err.message, 'err'); }
  };
  return (
    <section className="card approvals">
      <div className="card-head"><h2>🛡 Delete requests waiting for you <span className="tag st-cancelled">{rows.length}</span></h2></div>
      <table ref={g.gridRef} className="grid dg-soft"><thead><tr>{g.tickTh}<th className="sn">SN</th><th>Record</th><th>Requested by</th><th>When</th><th>Reason</th><th>Decision</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id} {...g.rowProps(r)}>
            {g.tickTd(r)}<td className="sn">{i + 1}</td><td><b>{r.entity_no}</b> <small className="muted">{r.entity}</small></td>
            <td>{r.requested_by}</td><td>{fmtStamp(r.requested_at)}</td><td>{r.reason}</td>
            <td className="nowrap"><button className="danger btn-sm" onClick={() => approve(r)}>Approve delete</button>{' '}
              <button className="ghost btn-sm" onClick={() => reject(r)}>Reject</button></td>
          </tr>))}</tbody>
      </table>
    </section>
  );
}

export default function Alerts() {
  const [a, setA] = useState(null);
  const [open, setOpen] = useState(null);
  const nav = useNavigate();
  const load = () => api.get('/alerts').then(setA);
  useEffect(() => { load(); }, []);
  if (!a) return <div className="muted">Loading…</div>;
  const view = async (id) => id && setOpen(await api.get(`/docs/${id}`));
  const billHead = <><th>Party</th><th>Bill</th><th>Bill miti</th><th>Due</th><th className="num">Days</th><th className="num">Outstanding</th><th>Remind</th></>;
  const billRow = (late) => (r) => (
    <>
      <td>{r.party}</td><td>{r.id ? <a onClick={() => view(r.id)}>{r.doc_no}</a> : r.doc_no}</td>
      <td>{fmtDateShort(r.doc_date)}</td><td>{fmtDateShort(r.due_date)}</td>
      <td className={`num ${late ? 'neg' : ''}`}>{late ? `${r.days_overdue} late` : r.days_overdue === 0 ? 'today' : `in ${-r.days_overdue}`}</td>
      <td className="num">{fmtMoney(r.outstanding)}</td>
      <td><Remind docId={r.id} kind="due" phone={r.phone} email={r.email} /></td>
    </>
  );
  const payRow = (late) => (r) => (
    <>
      <td>{r.party}</td><td>{r.id ? <a onClick={() => view(r.id)}>{r.doc_no}</a> : r.doc_no}</td>
      <td>{fmtDateShort(r.doc_date)}</td><td>{fmtDateShort(r.due_date)}</td>
      <td className={`num ${late ? 'neg' : ''}`}>{late ? `${r.days_overdue} late` : r.days_overdue === 0 ? 'today' : `in ${-r.days_overdue}`}</td>
      <td className="num">{fmtMoney(r.outstanding)}</td><td />
    </>
  );
  const svcHead = <><th>Party</th><th>Service</th><th>Bill</th><th>Expires</th><th className="num">Days left</th><th>Remind</th></>;
  const svcRow = (remind) => (s) => (
    <>
      <td>{s.party}</td><td>{s.item}</td><td><a onClick={() => view(s.doc_id)}>{s.doc_no}</a></td><td>{fmtDateShort(s.service_to)}</td>
      <td className={`num ${s.days_left < 0 ? 'neg' : ''}`}>{s.days_left < 0 ? `expired ${-s.days_left} d ago` : s.days_left}</td>
      <td>{remind && <Remind docId={s.doc_id} kind="service" phone={s.phone} email={s.email} />}</td>
    </>
  );

  return (
    <>
      <header className="page-head"><h1>🔔 Alerts</h1><span className="muted">Due within {a.alert_days} days (change in Company Setup) · bill-wise, oldest bills treated as paid first</span></header>
      <Approvals rows={a.approvals || []} reload={load} />
      <Section title="⏰ Cheque reminders & follow-up tasks" tone="st-open" rows={a.reminders || []} empty="No cheque reminders or follow-up tasks due." onOpen={(r) => view(r.doc_id)}
        head={<><th>When</th><th>Type</th><th>Task</th><th>Bill</th><th>Assigned to</th><th>Done</th></>}
        row={(r) => (
          <>
            <td className={`nowrap ${r.days < 0 ? 'neg' : ''}`}>{fmtDateShort(r.remind_on)}<br /><small className="muted">
              {r.days < 0 ? `${-r.days} day(s) ago` : 'today'}</small></td>
            <td>{r.kind === 'cheque' ? '🧾 Cheque' : '📞 Follow-up'}
              {r.kind === 'followup' && r.priority && r.priority !== 'normal' && <span className={`tag prio-${r.priority}`}>{r.priority}</span>}</td>
            <td>{r.title}{r.note && <div className="muted small">📝 {r.note}</div>}</td>
            <td><a onClick={() => view(r.doc_id)}>{r.doc_no}</a></td>
            <td>{r.assigned_to || '—'}</td>
            <td><button className="ghost btn-sm" onClick={async () => {
              try { await api.post(`/reminders/${r.id}/done`, {}); load(); window.dispatchEvent(new Event('ehl:acc-alerts')); } catch (err) { alert(err.message); }
            }}>✔ Done</button></td>
          </>
        )} />
      <Section title="Customer bills overdue" tone="st-cancelled" rows={a.receivable_overdue} empty="No overdue customer bills." head={billHead} row={billRow(true)} onOpen={(r) => view(r.id)} />
      <Section title="Customer bills due soon" tone="st-open" rows={a.receivable_due_soon} empty="Nothing due soon." head={billHead} row={billRow(false)} onOpen={(r) => view(r.id)} />
      <Section title="Services expiring — customers to renew" tone="st-open" rows={a.services_sales} empty="No customer services expiring soon." head={svcHead} row={svcRow(true)} onOpen={(s) => view(s.doc_id)} />
      <Section title="Supplier bills overdue" tone="st-cancelled" rows={a.payable_overdue} empty="No overdue supplier bills." head={billHead} row={payRow(true)} onOpen={(r) => view(r.id)} />
      <Section title="Supplier bills due soon" tone="st-open" rows={a.payable_due_soon} empty="Nothing to pay soon." head={billHead} row={payRow(false)} onOpen={(r) => view(r.id)} />
      <Section title="Our services expiring (purchased)" tone="st-open" rows={a.services_purchase} empty="None of our subscriptions/AMCs expire soon." head={svcHead} row={svcRow(false)} onOpen={(s) => view(s.doc_id)} />
      <Section title="Low stock (re-order)" tone="st-open" rows={a.low_stock} empty="Stock is above re-order levels." onOpen={(r) => nav(`/stock-ledger?item=${r.id}`)}
        head={<><th>Product</th><th className="num">Stock</th><th className="num">Re-order level</th></>}
        row={(r) => <><td><Link to={`/stock-ledger?item=${r.id}`}>{r.name}</Link></td><td className="num neg">{r.stock} {r.unit}</td><td className="num">{r.reorder_level}</td></>} />
      <Section title="Customers over credit limit" tone="st-cancelled" rows={a.over_limit} empty="Everyone is within their limit." onOpen={(r) => nav(`/ledger?account=${r.id}`)}
        head={<><th>Customer</th><th className="num">Balance</th><th className="num">Limit</th></>}
        row={(r) => <><td>{r.name}</td><td className="num neg">{fmtMoney(r.balance)}</td><td className="num">{fmtMoney(r.credit_limit)}</td></>} />
      {open && <DocView doc={open} onClose={() => setOpen(null)} />}
    </>
  );
}
