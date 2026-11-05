import React, { useState } from 'react';
import api from '../api/client.js';
import { useManualPostingApply } from '../context/ManualPostingApplyContext.jsx';
import { useOnlineAttendanceApply } from '../context/OnlineAttendanceApplyContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import { Empty, Sheet, StatusChip, useMT } from './kit.jsx';

/* The "Late / Early" and "Online" tabs of the Requests page: my own applications with their status, and (for approvers) the
   ones waiting for me. Applying a Late In / Early Out opens the same form as the website, so every rule is identical. */

const hm = (v) => String(v || '').slice(0, 5);
const tm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const mapUrl = (lat, lng) => (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null);

export default function MobileExtra({ kind, data }) {
  const mt = useMT();
  const fd = useDateFormat();
  const { open: openManual } = useManualPostingApply();
  const { open: openOnline } = useOnlineAttendanceApply();
  const [sheet, setSheet] = useState(null);       // { item, action }
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isLate = kind === 'late';
  const mine = (isLate ? data.manualMine : data.onlineMine).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 40);
  const toApprove = isLate ? data.manualToApprove : data.onlineToApprove;
  const base = isLate ? '/attendance/manual-postings' : '/online-attendance';

  const run = async () => {
    setBusy(true); setError('');
    try {
      await api.patch(`${base}/${sheet.item.id}/${sheet.action}`, { comment });
      setSheet(null); setComment(''); data.reload();
    } catch (e) { setError(e?.message || 'Action failed'); } finally { setBusy(false); }
  };

  const Row = ({ x, approver }) => (
    <button className="m-list-item" data-st={x.status || 'pending'} onClick={() => !approver && setSheet({ item: x, action: 'view' })}>
      <span className="m-list-ico" style={{ background: isLate ? '#fef3c7' : '#dcfce7' }}>{isLate ? '⏱️' : '📍'}</span>
      <span className="m-grow">
        <b style={{ display: 'block' }}>{approver ? x.empName || '—' : fd(String(x.date).slice(0, 10))}</b>
        <span className="m-muted m-ell" style={{ display: 'block' }}>
          {approver ? `${fd(String(x.date).slice(0, 10))} · ` : ''}
          {isLate ? [x.check_in && `${mt('In')} ${hm(x.check_in)}`, x.check_out && `${mt('Out')} ${hm(x.check_out)}`].filter(Boolean).join(' · ') || x.remark
                  : [x.checkInAt && `${mt('In')} ${tm(x.checkInAt)}`, x.checkOutAt && `${mt('Out')} ${tm(x.checkOutAt)}`].filter(Boolean).join(' · ')}
        </span>
        {isLate && x.remark && (x.check_in || x.check_out) && <span className="m-muted m-ell" style={{ display: 'block', fontSize: 12 }}>{x.remark}</span>}
        {!isLate && (x.checkInPlace || x.checkOutPlace) && <span className="m-muted m-ell" style={{ display: 'block', fontSize: 12 }}>📍 {x.checkInPlace || x.checkOutPlace}</span>}
      </span>
      {!approver && <StatusChip status={x.status} />}
    </button>
  );

  const act = (x, action) => { setComment(''); setError(''); setSheet({ item: x, action }); };

  return (
    <>
      {isLate
        ? <button className="m-btn m-block" style={{ marginBottom: 14 }} onClick={() => openManual()}>＋ {mt('Late In / Early Out')}</button>
        : <button className="m-btn m-block" style={{ marginBottom: 14 }} onClick={() => openOnline()}>📍 {mt('Check In / Check Out')}</button>}

      {toApprove.length > 0 && (<>
        <div className="m-h2">{mt('To approve')} ({toApprove.length})</div>
        <div className="m-card m-flat">
          {toApprove.map(x => (
            <div key={x.id} style={{ borderBottom: '1px solid var(--m-line)' }}>
              <Row x={x} approver />
              {!isLate && mapUrl(x.checkInLat, x.checkInLng) && (
                <div style={{ padding: '0 16px 8px', fontSize: 12 }}>
                  <a href={mapUrl(x.checkInLat, x.checkInLng)} target="_blank" rel="noreferrer" style={{ color: 'var(--m-primary)', fontWeight: 700 }}>🗺️ {mt('Open map')}</a>
                </div>
              )}
              <div className="m-row" style={{ padding: '0 16px 12px', gap: 8 }}>
                <button className="m-btn m-xs m-bad" style={{ flex: 1 }} onClick={() => act(x, 'reject')}>{mt('Reject')}</button>
                {x.canRecommend && <button className="m-btn m-xs m-warn" style={{ flex: 1 }} onClick={() => act(x, 'recommend')}>{mt('Recommend')}</button>}
                {x.canApprove && <button className="m-btn m-xs m-ok" style={{ flex: 1 }} onClick={() => act(x, 'approve')}>{mt('Approve')}</button>}
              </div>
            </div>
          ))}
        </div>
      </>)}

      <div className="m-h2">{mt('My requests')}</div>
      <div className="m-card m-flat">
        {mine.length === 0 ? <Empty icon={isLate ? '⏱️' : '📍'} text={mt('Nothing here yet')} /> : mine.map(x => <Row key={x.id} x={x} />)}
      </div>

      {sheet && sheet.action === 'view' && (
        <Sheet title={isLate ? mt('Late In / Early Out') : mt('Online Attendance')} onClose={() => setSheet(null)}>
          <div className="m-row" style={{ marginBottom: 10 }}><StatusChip status={sheet.item.status} /><span className="m-muted">{fd(String(sheet.item.date).slice(0, 10))}</span></div>
          {isLate ? (<>
            {sheet.item.check_in && <p style={{ margin: '6px 0' }}>{mt('Late in')}: <b>{hm(sheet.item.check_in)}</b></p>}
            {sheet.item.check_out && <p style={{ margin: '6px 0' }}>{mt('Early out')}: <b>{hm(sheet.item.check_out)}</b></p>}
            {sheet.item.remark && <p style={{ margin: '6px 0' }}>{sheet.item.remark}</p>}
          </>) : (<>
            {sheet.item.checkInAt && <p style={{ margin: '6px 0' }}>{mt('Checked in')}: <b>{tm(sheet.item.checkInAt)}</b>{sheet.item.checkInPlace && <small className="m-place">{sheet.item.checkInPlace}</small>}</p>}
            {sheet.item.checkOutAt && <p style={{ margin: '6px 0' }}>{mt('Checked out')}: <b>{tm(sheet.item.checkOutAt)}</b>{sheet.item.checkOutPlace && <small className="m-place">{sheet.item.checkOutPlace}</small>}</p>}
          </>)}
          {sheet.item.comment && <p className="m-muted" style={{ margin: '6px 0' }}>“{sheet.item.comment}”</p>}
        </Sheet>
      )}

      {sheet && sheet.action !== 'view' && (
        <Sheet title={`${mt({ approve: 'Approve', reject: 'Reject', recommend: 'Recommend' }[sheet.action])} · ${sheet.item.empName}`} onClose={() => setSheet(null)}
          footer={<><button className="m-btn m-ghost" onClick={() => setSheet(null)}>{mt('Cancel')}</button>
            <button className={`m-btn ${sheet.action === 'reject' ? 'm-bad' : sheet.action === 'approve' ? 'm-ok' : 'm-warn'}`} disabled={busy} onClick={run}>{busy ? '…' : mt('Confirm')}</button></>}>
          <p style={{ margin: '0 0 12px' }}>{fd(String(sheet.item.date).slice(0, 10))}</p>
          <div className="m-field"><label>{mt('Comment (optional)')}</label><textarea className="m-input" value={comment} onChange={e => setComment(e.target.value)} /></div>
          {error && <div className="m-err">{error}</div>}
        </Sheet>
      )}
    </>
  );
}
