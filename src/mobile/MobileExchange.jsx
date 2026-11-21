import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import { Empty, Sheet, Spinner, useMT } from './kit.jsx';

/* Duty Exchange on the phone.
   ExchangeSheet : a staff member picks a colleague (same department) to swap one day of duty with → request goes to the
                   Department Head (recommend) and then the Admin (approve); the swap happens on approval.
   ExchangeTab   : my requests (and the ones asking me), plus the requests waiting for me to recommend / approve / reject. */

const CHIP = { pending: ['warn', 'Waiting for recommendation'], recommended: ['info', 'Recommended — waiting for approval'], approved: ['ok', 'Approved'], rejected: ['bad', 'Rejected'], cancelled: ['gray', 'Cancelled'] };

export function ExchangeSheet({ date, myDuty, onClose, onDone }) {
  const mt = useMT(); const fd = useDateFormat();
  const [list, setList] = useState(null); const [q, setQ] = useState('');
  const [pick, setPick] = useState(null); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { api.get(`/duty-exchange/candidates?date=${date}`).then(r => setList(Array.isArray(r) ? r : [])).catch(e => { setErr(e.message || 'Could not load'); setList([]); }); }, [date]);
  const rows = (list || []).filter(u => !q.trim() || `${u.fullName} ${u.position || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const send = async () => {
    if (!pick) return setErr(mt('Choose a colleague first.'));
    setBusy(true); setErr('');
    try { await api.post('/duty-exchange', { partnerId: pick, date, reason }); onDone(); }
    catch (e) { setErr(e?.message || mt('Failed')); setBusy(false); }
  };
  return (
    <Sheet title={`🔄 ${mt('Exchange duty')}`} onClose={() => !busy && onClose()}
      footer={<><button className="m-btn m-ghost" disabled={busy} onClick={onClose}>{mt('Cancel')}</button>
        <button className="m-btn" disabled={busy || !pick} onClick={send}>{busy ? '…' : mt('Send request')}</button></>}>
      {err && <div className="m-err">{err}</div>}
      <div className="m-locbox ready" style={{ marginBottom: 10 }}>📅 <b>{fd(date)}</b><div className="m-jsub">{mt('Your duty')}: {myDuty || '—'}</div></div>
      <div className="m-field"><label>{mt('Exchange with')} <span style={{ color: '#dc2626' }}>*</span></label>
        <input className="m-input" placeholder={`🔍 ${mt('Search')}`} value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 6 }} />
        {list === null && <div className="m-empty"><Spinner dark /></div>}
        {list && rows.length === 0 && <div className="m-muted" style={{ padding: 8 }}>{mt('No colleague with a duty on this day')}</div>}
        <div style={{ maxHeight: 260, overflowY: 'auto', border: rows.length ? '1px solid #e5e7eb' : 0, borderRadius: 10 }}>
          {rows.map(u => (
            <label key={u.id} className="m-check" style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
              <input type="radio" name="exchpartner" checked={pick === u.id} onChange={() => setPick(u.id)} />
              <span><b>{u.fullName}</b><small className="m-muted" style={{ display: 'block' }}>{mt('Duty')}: {u.duty?.label}</small></span>
            </label>
          ))}
        </div>
      </div>
      <div className="m-field"><label>{mt('Reason')}</label>
        <textarea className="m-input" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder={mt('Why do you need this exchange?')} /></div>
      <div className="m-jsub">{mt('Your Department Head recommends, then the Admin approves. The duty swaps only after approval.')}</div>
    </Sheet>
  );
}

export function ExchangeTab({ onChanged }) {
  const mt = useMT(); const fd = useDateFormat();
  const { currentUser } = useAuth();
  const [mine, setMine] = useState(null); const [wait, setWait] = useState([]);
  const [act, setAct] = useState(null);   // { r, kind }
  const [remark, setRemark] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const load = useCallback(() => {
    api.get('/duty-exchange/mine').then(r => setMine(Array.isArray(r) ? r : [])).catch(() => setMine([]));
    api.get('/duty-exchange/pending').then(r => setWait(Array.isArray(r) ? r : [])).catch(() => setWait([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const go = async () => {
    const { r, kind } = act;
    if (kind === 'reject' && !remark.trim()) return setErr(mt('Please write a reason.'));
    setBusy(true); setErr('');
    try { await api.post(`/duty-exchange/${r.id}/${kind}`, { comment: remark }); setAct(null); setRemark(''); load(); onChanged?.(); }
    catch (e) { setErr(e?.message || mt('Failed')); } finally { setBusy(false); }
  };
  const cancel = async (r) => {
    if (!window.confirm(mt('Cancel this exchange request?'))) return;
    try { await api.post(`/duty-exchange/${r.id}/cancel`, {}); load(); onChanged?.(); } catch (e) { window.alert(e?.message || 'Failed'); }
  };
  const Card = ({ r, actions }) => {
    const [c, l] = CHIP[r.status] || ['gray', r.status];
    const iAmRequester = String(r.requesterId) === String(currentUser?.id);
    return (
      <div className="m-roster m-z0" style={{ marginBottom: 8 }}>
        <div className="m-row" style={{ marginBottom: 4 }}><b className="m-grow">🔄 {fd(r.date)}</b><span className={`m-chip ${c}`}>{mt(l)}</span></div>
        <div style={{ fontSize: 14 }}><b>{r.requesterName}</b> <span className="m-muted">({r.requesterDuty})</span> ⇄ <b>{r.partnerName}</b> <span className="m-muted">({r.partnerDuty})</span></div>
        {r.reason && <div className="m-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{r.reason}</div>}
        {r.status === 'rejected' && r.rejectComment && <div className="m-err" style={{ marginTop: 6 }}>{r.rejectComment}</div>}
        {r.status !== 'pending' && r.recommendedByName && <div className="m-jsub">{mt('Recommended by')} {r.recommendedByName}</div>}
        {r.status === 'approved' && r.approvedByName && <div className="m-jsub">{mt('Approved by')} {r.approvedByName}</div>}
        {!iAmRequester && !actions && <div className="m-jsub">{mt('Requested by')} {r.requesterName}</div>}
        {actions}
      </div>
    );
  };
  return (<>
    {wait.length > 0 && (<>
      <div className="m-h2">{mt('Waiting for you')}</div>
      {wait.map(r => (
        <Card key={r.id} r={r} actions={
          <div className="m-row" style={{ gap: 8, marginTop: 8 }}>
            {r.canRecommend && <button className="m-btn m-grow" onClick={() => { setErr(''); setRemark(''); setAct({ r, kind: 'recommend' }); }}>{mt('Recommend')}</button>}
            {r.canApprove && <button className="m-btn m-grow" onClick={() => { setErr(''); setRemark(''); setAct({ r, kind: 'approve' }); }}>{mt('Approve')}</button>}
            {r.canReject && <button className="m-btn m-ghost m-grow" onClick={() => { setErr(''); setRemark(''); setAct({ r, kind: 'reject' }); }}>{mt('Reject')}</button>}
          </div>} />
      ))}
    </>)}
    <div className="m-h2">{mt('My exchange requests')}</div>
    {mine === null && <div className="m-empty"><Spinner dark /></div>}
    {mine && mine.length === 0 && <Empty icon="🔄" text={mt('No exchange requests yet. Open My Duty and tap Exchange on a day.')} />}
    {(mine || []).map(r => (
      <Card key={r.id} r={r} actions={['pending', 'recommended'].includes(r.status) && String(r.requesterId) === String(currentUser?.id)
        ? <button className="m-btn m-ghost m-block" style={{ marginTop: 8 }} onClick={() => cancel(r)}>{mt('Cancel request')}</button> : null} />
    ))}
    {act && (
      <Sheet title={mt(act.kind === 'recommend' ? 'Recommend' : act.kind === 'approve' ? 'Approve' : 'Reject')} onClose={() => !busy && setAct(null)}
        footer={<><button className="m-btn m-ghost" disabled={busy} onClick={() => setAct(null)}>{mt('Cancel')}</button>
          <button className={`m-btn${act.kind === 'reject' ? ' m-bad' : ''}`} disabled={busy} onClick={go}>{busy ? '…' : mt(act.kind === 'recommend' ? 'Recommend' : act.kind === 'approve' ? 'Approve' : 'Reject')}</button></>}>
        {err && <div className="m-err">{err}</div>}
        <div style={{ marginBottom: 10 }}><b>{act.r.requesterName}</b> ⇄ <b>{act.r.partnerName}</b> · {fd(act.r.date)}</div>
        <div className="m-field"><label>{mt('Remark')}{act.kind === 'reject' && <span style={{ color: '#dc2626' }}> *</span>}</label>
          <textarea className="m-input" rows={3} value={remark} onChange={e => setRemark(e.target.value)} /></div>
      </Sheet>
    )}
  </>);
}
