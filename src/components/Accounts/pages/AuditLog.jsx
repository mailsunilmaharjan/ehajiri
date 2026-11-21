import { useEffect, useState } from 'react';
import { api, fmtStamp } from '../lib/api';
import { RemarksRow, useGrid } from '../components/DataGrid';
import { PeriodBar } from '../components/inputs';
import { useApp } from '../context';

const ENTITIES = ['', 'doc', 'voucher', 'item', 'customer', 'supplier', 'account', 'company', 'user', 'category', 'backup'];

function Detail({ text }) {
  if (!text) return null;
  let d;
  try { d = JSON.parse(text); } catch { return <span>{text}</span>; }
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const entries = Object.entries(d).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    return (
      <span className="audit-detail">
        {entries.slice(0, 8).map(([k, v]) => (
          <span key={k}><b>{k}</b>: {Array.isArray(v) && v.length === 2 && typeof v[0] !== 'object'
            ? <>{String(v[0] ?? '—')} → <b>{String(v[1] ?? '—')}</b></> : typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        ))}
        {entries.length > 8 && <span className="muted">+{entries.length - 8} more</span>}
      </span>
    );
  }
  return <span>{text}</span>;
}

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const { fy, today } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  const [to, setTo] = useState(today);
  const [f, setF] = useState({ username: '', entity: '', q: '' });
  useEffect(() => {
    const t = setTimeout(() => {
      const p = Object.fromEntries(Object.entries({ ...f, date_from: from, date_to: to }).filter(([, v]) => v));
      api.get('/audit-log', p).then(setRows).catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(t);
  }, [f, from, to]);
  const users = [...new Map(rows.map((r) => [r.username, r.user_name || r.username])).entries()];
  const g = useGrid({ rows });
  const COLS = 8;
  return (
    <>
      <header className="page-head"><h1>Audit Trail</h1><span className="muted">Every sign-in, change, cancel, print and send — who, when, from which computer</span></header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(a, b) => { setFrom(a); setTo(b); }}>
        <select value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })}>
          <option value="">All users</option>{users.map(([u, name]) => <option key={u} value={u}>{name}</option>)}
        </select>
        <select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
          {ENTITIES.map((x) => <option key={x} value={x}>{x || 'All records'}</option>)}
        </select>
        <input data-find title="Ctrl+F" placeholder="Search detail (e.g. SI/2083-84/0001)…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      </PeriodBar>
      <section className="card">
        <table ref={g.gridRef} className="grid dg-soft">
          <thead><tr>{g.tickTh}<th className="sn">SN</th><th>When</th><th>User</th><th>Action</th><th>Record</th><th>IP</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.id} {...g.rowProps(r)}>
                {g.tickTd(r)}
                <td className="sn">{idx + 1}</td>
                <td className="nowrap">{fmtStamp(r.at)}</td><td title={r.username}>{r.user_name || r.username}</td>
                <td><span className={`tag ${/fail|cancel|delete/.test(r.action) ? 'st-cancelled' : ''}`}>{r.action}</span></td>
                <td className="nowrap">{r.entity}{r.entity_id ? ` #${r.entity_id}` : ''}</td>
                <td className="small mono">{r.ip}</td>
                <td className="small"><Detail text={r.detail} /></td>
              </tr>
            ))}
            {g.blankRows(COLS)}
            <RemarksRow g={g} cols={COLS} empty="Click a row to see the full detail.">
              {g.curRow && <>
                <div><b>{g.curRow.action}</b> · {g.curRow.entity}{g.curRow.entity_id ? ` #${g.curRow.entity_id}` : ''} · by <b>{g.curRow.user_name || g.curRow.username}</b> ({g.curRow.username}) · {fmtStamp(g.curRow.at)} · IP {g.curRow.ip || '—'}</div>
                <div className="rm-pay small" style={{ wordBreak: 'break-word' }}>{g.curRow.detail || <span className="muted">no detail</span>}</div>
              </>}
            </RemarksRow>
          </tbody>
        </table>
      </section>
    </>
  );
}
