import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import Avatar from '../components/Common/Avatar.jsx';
import { getNepalTodayISO } from '../utils/dateUtils.js';
import { Empty, Sheet, Spinner, useMT } from './kit.jsx';
import { useExtraRequests, useMyApprovals, useApprovalRules } from './hooks.js';

/* One place for everyone who recommends or approves: Leave, Office Visit, Overtime, Late In / Early Out, Missing Attendance and
   Online Attendance. Each list has a "For recommendation" part (you are the recommender) and a "For approval" part (you are the
   approver); either way you can Reject. Every decision takes a remark (required for a rejection). Same rules and the same server
   calls as the website's approval pages. */

const KINDS = [
  ['leave', 'Leave', '🏖️'], ['visit', 'Office Visit', '🏢'], ['ot', 'Overtime', '⏰'],
  ['late', 'Late / Early', '⏱️'], ['missing', 'Missing punch', '🧾'], ['online', 'Online', '📍'],
];
const hm = (v) => String(v || '').slice(0, 5);
const tm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const d10 = (v) => String(v || '').slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

export default function MobileApprovals() {
  const mt = useMT(); const fd = useDateFormat();
  const { currentUser } = useAuth();
  const { employees, getLeaveTypeName, recommendLeave, approveLeave, rejectLeave, recommendVisit, approveVisit, rejectVisit } = useData();
  const mine = useMyApprovals();
  const extra = useExtraRequests();
  const rules = useApprovalRules();
  const [ot, setOt] = useState(null);                    // null while loading
  const [seg, setSeg] = useState(null);
  const [act, setAct] = useState(null);                  // { kind, item, action }
  const [remark, setRemark] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const loadOt = useCallback(() => {
    const today = getNepalTodayISO();
    api.get(`/overtime?startDate=${addDays(today, -31)}&endDate=${today}&status=pending`)
      .then(r => setOt((r?.records || []).filter(x => x.status === 'pending' && x.otMinutes > 0)))
      .catch(() => setOt([]));
  }, []);
  useEffect(() => { loadOt(); }, [loadOt]);

  const otItems = useMemo(() => (ot || []).map(x => ({ ...x, empName: x.fullName, ...rules(x.employeeId, !!x.recommendedBy) }))
    .filter(x => x.visible && (x.canRecommend || x.canApprove)), [ot, rules]);

  const lists = {
    leave: mine.leaves, visit: mine.visits, ot: otItems,
    late: extra.manualToApprove, missing: extra.missingToApprove, online: extra.onlineToApprove,
  };
  const count = (k) => (lists[k] || []).filter(x => x.canRecommend || x.canApprove).length;
  const current = seg || (KINDS.find(([k]) => count(k) > 0)?.[0]) || 'leave';
  const items = lists[current] || [];
  const toReco = items.filter(x => x.canRecommend);
  const toAppr = items.filter(x => x.canApprove);
  const empOf = (id) => employees.find(e => String(e.id) === String(id));

  const perform = async () => {
    const { kind, item, action } = act;
    if (action === 'reject' && !remark.trim()) { setErr(mt('Please write the reason for rejecting')); return; }
    setBusy(true); setErr('');
    const body = { comment: remark.trim() };
    try {
      if (kind === 'leave') await ({ recommend: recommendLeave, approve: approveLeave, reject: rejectLeave }[action])(item.id, currentUser.id, remark.trim());
      else if (kind === 'visit') await ({ recommend: recommendVisit, approve: approveVisit, reject: rejectVisit }[action])(item.id, currentUser.id, remark.trim());
      else if (kind === 'late') await api.patch(`/attendance/manual-postings/${item.id}/${action}`, body);
      else if (kind === 'missing') await api.patch(`/attendance/missing-requests/${item.id}/${action}`, body);
      else if (kind === 'online') await api.patch(`/online-attendance/${item.id}/${action}`, body);
      else if (kind === 'ot') {
        if (item.approvalId) await api.patch(`/overtime/${item.approvalId}/${action}`, action === 'approve' ? { ...body, approvedOTMins: item.otMinutes } : body);
        else if (action === 'recommend') await api.post('/overtime/recommend-inline', { employeeId: item.employeeId, date: item.date, otMinutes: item.otMinutes, comment: remark.trim() });
        else await api.post('/overtime/approve-inline', { employeeId: item.employeeId, date: item.date, otMinutes: item.otMinutes, action, comment: remark.trim() });
      }
      setDone({ recommend: mt('Recommended'), approve: mt('Approved'), reject: mt('Rejected') }[action]);
      setTimeout(() => setDone(''), 2500);
      setAct(null); setRemark('');
      extra.reload(); loadOt();
    } catch (e) { setErr(e?.message || mt('Action failed')); } finally { setBusy(false); }
  };

  const range = (x) => (x.fromDate === x.toDate ? fd(d10(x.fromDate)) : `${fd(d10(x.fromDate))} → ${fd(d10(x.toDate))}`);
  const summary = (k, x) => {
    if (k === 'leave') return [getLeaveTypeName(x.leaveTypeCode) || x.leaveTypeCode, range(x), x.days ? `${x.days} ${mt(x.days === 1 ? 'day' : 'days')}` : '', x.reason];
    if (k === 'visit') return [x.officialVisit || x.purpose, x.address || x.location, range(x), x.description || x.reason];
    if (k === 'ot') return [fd(d10(x.date)), `${mt('Overtime')} ${x.otFormatted}`, x.timeIn && `${x.timeIn} – ${x.timeOut}`, x.shiftName];
    if (k === 'late') return [fd(d10(x.date)), [x.check_in && `${mt('Late in')} ${hm(x.check_in)}`, x.check_out && `${mt('Early out')} ${hm(x.check_out)}`].filter(Boolean).join(' · '), x.remark];
    if (k === 'missing') return [fd(d10(x.date)), [x.checkIn && `${mt('In')} ${hm(x.checkIn)}`, x.checkOut && `${mt('Out')} ${hm(x.checkOut)}`].filter(Boolean).join(' · '), x.reason];
    return [fd(d10(x.date)), [x.checkInAt && `${mt('In')} ${tm(x.checkInAt)}`, x.checkOutAt && `${mt('Out')} ${tm(x.checkOutAt)}`].filter(Boolean).join(' · ')];
  };
  const mapUrl = (lat, lng) => (lat == null || lng == null || lat === '' || lng === '' ? null : `https://www.google.com/maps?q=${lat},${lng}`);
  /* Online attendance: tappable location chips (check-in / check-out) that open the map */
  const Locs = ({ x }) => {
    const pts = [[mt('Check in'), x.checkInLat, x.checkInLng, x.checkInPlace], [mt('Check out'), x.checkOutLat, x.checkOutLng, x.checkOutPlace]]
      .map(([l, la, ln, pl]) => ({ l, url: mapUrl(la, ln), pl })).filter(p => p.url);
    if (!pts.length) return null;
    return <div>{pts.map(p => <a key={p.l} className="m-apc-loc" href={p.url} target="_blank" rel="noopener noreferrer"><span>📍</span><span className="m-ell">{p.l}{p.pl ? ` · ${p.pl}` : ''}</span></a>)}</div>;
  };

  const open = (k, x, action) => { setRemark(''); setErr(''); setAct({ kind: k, item: x, action }); };
  const Card = ({ k, x, mode }) => {
    const e = empOf(x.employeeId);
    const [first, ...rest] = summary(k, x).filter(Boolean);
    const reco = (k === 'leave' || k === 'visit' || k === 'ot') && x.recommendedBy ? empOf(x.recommendedBy)?.fullName : '';
    return (
      <div className="m-apcard m-apc">
        <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
          <Avatar photo={e?.profilePhoto} name={x.empName || e?.fullName || '?'} size={30} preview={false} />
          <div className="m-grow" style={{ minWidth: 0 }}>
            <b className="m-ell" style={{ display: 'block' }}>{x.empName || e?.fullName || `#${x.employeeId}`}</b>
            <span className="m-muted m-ell" style={{ display: 'block', fontSize: 12 }}>{[e?.position, e?.department].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className="m-apc-sum"><b>{first}</b>{rest.length > 0 && <span className="m-muted"> · {rest.join(' · ')}</span>}</div>
        {k === 'online' && <Locs x={x} />}
        {(reco || (k === 'missing' && x.status === 'recommended')) && <div className="m-pill ok" style={{ marginTop: 6 }}>✔ {mt('Recommended')}{reco ? `: ${reco}` : ''}</div>}
        <div className="m-row" style={{ gap: 8, marginTop: 6 }}>
          <button className="m-btn m-xs m-bad" style={{ flex: 1 }} onClick={() => open(k, x, 'reject')}>{mt('Reject')}</button>
          {mode === 'reco'
            ? <button className="m-btn m-xs m-warn" style={{ flex: 2 }} onClick={() => open(k, x, 'recommend')}>👍 {mt('Recommend')}</button>
            : <button className="m-btn m-xs m-ok" style={{ flex: 2 }} onClick={() => open(k, x, 'approve')}>✔ {mt('Approve')}</button>}
        </div>
      </div>
    );
  };

  const total = KINDS.reduce((s, [k]) => s + count(k), 0);
  const keyOf = (x) => x.id ?? `${x.employeeId}-${x.date}`;

  return (
    <div style={{ padding: 14, paddingBottom: 30 }}>
      {done && <div className="m-okbox" style={{ marginBottom: 10 }}>✔ {done}</div>}
      <div className="m-chipbar">
        {KINDS.map(([k, l, ic]) => <button key={k} className={current === k ? 'on' : ''} onClick={() => setSeg(k)}>{ic} {mt(l)}{count(k) > 0 && <i className="m-seg-n">{count(k)}</i>}</button>)}
      </div>
      {(!extra.loaded || (current === 'ot' && ot === null)) && <div className="m-empty"><Spinner dark /></div>}

      {toReco.length > 0 && (<>
        <div className="m-h2">👍 {mt('For recommendation')} ({toReco.length})</div>
        {toReco.map(x => <Card key={`r${keyOf(x)}`} k={current} x={x} mode="reco" />)}
      </>)}
      {toAppr.length > 0 && (<>
        <div className="m-h2">✔ {mt('For approval')} ({toAppr.length})</div>
        {toAppr.map(x => <Card key={`a${keyOf(x)}`} k={current} x={x} mode="appr" />)}
      </>)}
      {extra.loaded && toReco.length === 0 && toAppr.length === 0 && (
        <div className="m-card"><Empty icon="🎉" text={total === 0 ? mt('All caught up — nothing waiting for you') : mt('Nothing waiting here')} /></div>)}

      {act && (
        <Sheet title={`${mt({ recommend: 'Recommend', approve: 'Approve', reject: 'Reject' }[act.action])} · ${act.item.empName || ''}`} onClose={() => setAct(null)}
          footer={<><button className="m-btn m-ghost" onClick={() => setAct(null)}>{mt('Cancel')}</button>
            <button className={`m-btn ${act.action === 'reject' ? 'm-bad' : act.action === 'approve' ? 'm-ok' : 'm-warn'}`} disabled={busy} onClick={perform}>{busy ? '…' : mt('Confirm')}</button></>}>
          <div className="m-card m-flat" style={{ padding: 12, marginBottom: 12 }}>{summary(act.kind, act.item).filter(Boolean).map((r, i) => <div key={i} style={i === 0 ? { fontWeight: 700 } : { fontSize: 13, color: 'var(--m-sub)' }}>{r}</div>)}{act.kind === 'online' && <Locs x={act.item} />}</div>
          <div className="m-field"><label>{mt('Remarks')}{act.action === 'reject' ? ' *' : ` (${mt('optional')})`}</label>
            <textarea className={`m-input${err && act.action === 'reject' && !remark.trim() ? ' err' : ''}`} rows={4} autoFocus value={remark} onChange={e => { setRemark(e.target.value); setErr(''); }}
              placeholder={act.action === 'reject' ? mt('Why is it being rejected?') : mt('Add a remark for the applicant')} /></div>
          {err && <div className="m-err">{err}</div>}
        </Sheet>
      )}
    </div>
  );
}
