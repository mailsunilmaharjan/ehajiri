import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useLeaveApply } from '../context/LeaveApplyContext.jsx';
import { useOfficeVisitApply } from '../context/OfficeVisitApplyContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import { Empty, Sheet, StatusChip, useMT } from './kit.jsx';
import { useMyApprovals, useMyLeaveBalance, useExtraRequests } from './hooks.js';
import MobileExtra from './MobileExtra.jsx';
import { StaffScopeBar, useStaffScope, inScope, DEFAULT_SCOPE } from './MobileScope.jsx';

/* Leave and Office Visit on the phone: my requests, and (for approvers) the requests waiting for me.
   Applying uses the website's own apply form, so every rule (balance, holidays, approvers) is identical. */

export default function MobileLeave() {
  const mt = useMT();
  const fd = useDateFormat();
  const { currentUser } = useAuth();
  const { leaves, officeVisits, filteredLeaves, filteredVisits, employees, getLeaveTypeName, getLeaveTypeColor,
          recommendLeave, approveLeave, rejectLeave, recommendVisit, approveVisit, rejectVisit } = useData();
  const { open: openLeave } = useLeaveApply();
  const { open: openVisit } = useOfficeVisitApply();
  const approvals = useMyApprovals();
  const balances = useMyLeaveBalance();
  const extra = useExtraRequests();
  const [seg, setSeg] = useState('leave');
  const SS = useStaffScope();
  const [view, setView] = useState('mine');              // 'mine' | 'team' (managers: the staff they can see)
  const [scope, setScope] = useState({ ...DEFAULT_SCOPE, emp: 'all' });
  const [stat, setStat] = useState('all');
  const [showN, setShowN] = useState(60);
  const [sheet, setSheet] = useState(null);       // { kind, item, action }
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const me = String(currentUser.id);
  const nameOf = (id) => employees.find(e => String(e.id) === String(id))?.fullName || '';
  const mine = useMemo(() => {
    const src = seg === 'leave' ? leaves : officeVisits;
    return (src || []).filter(x => String(x.employeeId) === me).sort((a, b) => (b.id > a.id ? 1 : -1));
  }, [seg, leaves, officeVisits, me]);
  const toApprove = seg === 'leave' ? approvals.leaves : approvals.visits;
  const team = useMemo(() => {
    const src = (seg === 'leave' ? (filteredLeaves || leaves) : (filteredVisits || officeVisits)) || [];
    return src.filter(x => {
      const e = SS.byId[String(x.employeeId)];
      if (scope.emp === 'all') { if (!inScope(e, scope)) return false; } else if (String(x.employeeId) !== String(scope.emp === 'me' ? me : scope.emp)) return false;
      return stat === 'all' || x.status === stat;
    }).sort((a, b) => String(b.fromDate).localeCompare(String(a.fromDate)) || (b.id > a.id ? 1 : -1));
  }, [seg, filteredLeaves, filteredVisits, leaves, officeVisits, SS.byId, scope, stat, me]);

  const run = async () => {
    const { kind, item, action } = sheet;
    setBusy(true); setError('');
    try {
      const fn = kind === 'leave' ? { recommend: recommendLeave, approve: approveLeave, reject: rejectLeave }[action]
                                  : { recommend: recommendVisit, approve: approveVisit, reject: rejectVisit }[action];
      await fn(item.id, currentUser.id, comment);
      setSheet(null); setComment('');
    } catch (e) { setError(e?.message || 'Action failed'); } finally { setBusy(false); }
  };

  const title = (kind, x) => kind === 'leave' ? (getLeaveTypeName(x.leaveTypeCode) || x.leaveTypeCode) : (x.location || x.destination || mt('Office Visit'));
  const range = (x) => (x.fromDate === x.toDate ? fd(x.fromDate) : `${fd(x.fromDate)} → ${fd(x.toDate)}`);

  const Card = ({ kind, x, approver, team: teamRow }) => (
    <button className="m-list-item" data-st={x.status || 'pending'} onClick={() => !approver && setSheet({ kind, item: x, action: 'view' })}>
      <span className="m-list-ico" style={{ background: kind === 'leave' ? (getLeaveTypeColor(x.leaveTypeCode) || '#e8f0fe') + '33' : '#ccfbf1' }}>{kind === 'leave' ? '🏖️' : '🏢'}</span>
      <span className="m-grow">
        <b style={{ display: 'block' }}>{approver ? x.empName : teamRow ? (nameOf(x.employeeId) || `#${x.employeeId}`) : title(kind, x)}</b>
        <span className="m-muted m-ell" style={{ display: 'block' }}>{approver || teamRow ? `${title(kind, x)} · ` : ''}{range(x)}{kind === 'leave' && x.days ? ` · ${x.days} ${x.days === 1 ? mt('day') : mt('days')}` : ''}</span>
        {(x.reason || x.purpose) && <span className="m-muted m-ell" style={{ display: 'block', fontSize: 12 }}>{x.reason || x.purpose}</span>}
      </span>
      {!approver && <StatusChip status={x.status} />}
    </button>
  );

  const SEGS = [['leave', 'Leave', approvals.leaves.length], ['visit', 'Office Visit', approvals.visits.length], ['late', 'Late / Early', extra.manualToApprove.length], ['online', 'Online', extra.onlineToApprove.length]];
  if (seg === 'late' || seg === 'online') {
    return (<>
      <div className="m-seg m-seg4">{SEGS.map(([k, l, n]) => <button key={k} className={seg === k ? 'on' : ''} onClick={() => setSeg(k)}>{mt(l)}{n > 0 && <i className="m-seg-n">{n}</i>}</button>)}</div>
      <MobileExtra kind={seg} data={extra} />
    </>);
  }

  return (
    <>
      <div className="m-seg m-seg4">
        {SEGS.map(([k, l, n]) => <button key={k} className={seg === k ? 'on' : ''} onClick={() => setSeg(k)}>{mt(l)}{n > 0 && <i className="m-seg-n">{n}</i>}</button>)}
      </div>

      <button className="m-btn m-block" style={{ marginBottom: 14 }} onClick={() => (seg === 'leave' ? openLeave() : openVisit())}>
        ＋ {seg === 'leave' ? mt('Apply Leave') : mt('Office Visit')}
      </button>

      {SS.canPick && (
        <div className="m-seg" style={{ marginBottom: 10 }}>
          <button className={view === 'mine' ? 'on' : ''} onClick={() => setView('mine')}>{mt('My requests')}</button>
          <button className={view === 'team' ? 'on' : ''} onClick={() => setView('team')}>👥 {mt('Staff')}</button>
        </div>
      )}

      {view === 'team' && SS.canPick ? (<>
        <StaffScopeBar scope={scope} setScope={s => { setScope(s); setShowN(60); }} allowAll />
        <div className="m-chipbar">{[['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([k, l]) => <button key={k} className={stat === k ? 'on' : ''} onClick={() => { setStat(k); setShowN(60); }}>{mt(l)}</button>)}</div>
        <div className="m-h2">{mt('Staff')} ({team.length})</div>
        <div className="m-card m-flat">
          {team.length === 0 ? <Empty icon={seg === 'leave' ? '🏖️' : '🏢'} text={mt('Nothing here yet')} /> : team.slice(0, showN).map(x => <Card key={x.id} kind={seg} x={x} team />)}
        </div>
        {team.length > showN && <button className="m-btn m-block" onClick={() => setShowN(n => n + 60)}>{mt('Show more')} ({team.length - showN})</button>}
      </>) : (<>
      {seg === 'leave' && balances.length > 0 && (
        <div className="m-balances">
          {balances.map(b => (
            <div key={b.code} className="m-bal" style={{ borderTop: `4px solid ${b.color || '#1a56db'}` }}>
              <b>{Number.isInteger(b.balance) ? b.balance : b.balance.toFixed(1)}</b><span className="m-ell" style={{ display: 'block' }}>{b.name}</span>
            </div>
          ))}
        </div>
      )}

      {toApprove.length > 0 && (<>
        <div className="m-h2">{mt('To approve')} ({toApprove.length})</div>
        <div className="m-card m-flat">
          {toApprove.map(x => (
            <div key={x.id} style={{ borderBottom: '1px solid var(--m-line)' }}>
              <Card kind={seg} x={x} approver />
              <div className="m-row" style={{ padding: '0 16px 12px', gap: 8 }}>
                <button className="m-btn m-xs m-bad" style={{ flex: 1 }} onClick={() => { setComment(''); setError(''); setSheet({ kind: seg, item: x, action: 'reject' }); }}>{mt('Reject')}</button>
                {x.canRecommend && <button className="m-btn m-xs m-warn" style={{ flex: 1 }} onClick={() => { setComment(''); setError(''); setSheet({ kind: seg, item: x, action: 'recommend' }); }}>{mt('Recommend')}</button>}
                {x.canApprove && <button className="m-btn m-xs m-ok" style={{ flex: 1 }} onClick={() => { setComment(''); setError(''); setSheet({ kind: seg, item: x, action: 'approve' }); }}>{mt('Approve')}</button>}
              </div>
            </div>
          ))}
        </div>
      </>)}

      <div className="m-h2">{mt('My requests')}</div>
      <div className="m-card m-flat">
        {mine.length === 0 ? <Empty icon={seg === 'leave' ? '🏖️' : '🏢'} text={mt('Nothing here yet')} /> : mine.map(x => <Card key={x.id} kind={seg} x={x} />)}
      </div>
      </>)}

      {sheet && sheet.action === 'view' && (
        <Sheet title={title(sheet.kind, sheet.item)} onClose={() => setSheet(null)}>
          <div className="m-row" style={{ marginBottom: 10 }}><StatusChip status={sheet.item.status} /><span className="m-muted">{range(sheet.item)}</span></div>
          {sheet.kind === 'leave' && <p style={{ margin: '6px 0' }}><b>{sheet.item.days}</b> {sheet.item.days === 1 ? mt('day') : mt('days')}{sheet.item.halfDay ? ' · ½' : ''}</p>}
          {(sheet.item.reason || sheet.item.purpose) && <p style={{ margin: '6px 0' }}>{sheet.item.reason || sheet.item.purpose}</p>}
          {sheet.item.recommendedBy && <p className="m-muted" style={{ margin: '6px 0' }}>✔ {mt('Recommended')}: {nameOf(sheet.item.recommendedBy)}</p>}
          {sheet.item.approvedBy && <p className="m-muted" style={{ margin: '6px 0' }}>{sheet.item.status === 'rejected' ? '✖' : '✔'} {sheet.item.status === 'rejected' ? mt('Rejected') : mt('Approved')}: {nameOf(sheet.item.approvedBy)}</p>}
          {sheet.item.comment && <p className="m-muted" style={{ margin: '6px 0' }}>“{sheet.item.comment}”</p>}
        </Sheet>
      )}

      {sheet && sheet.action !== 'view' && (
        <Sheet title={`${mt({ approve: 'Approve', reject: 'Reject', recommend: 'Recommend' }[sheet.action])} · ${sheet.item.empName}`} onClose={() => setSheet(null)}
          footer={<><button className="m-btn m-ghost" onClick={() => setSheet(null)}>{mt('Cancel')}</button>
            <button className={`m-btn ${sheet.action === 'reject' ? 'm-bad' : sheet.action === 'approve' ? 'm-ok' : 'm-warn'}`} disabled={busy} onClick={run}>{busy ? '…' : mt('Confirm')}</button></>}>
          <p style={{ margin: '0 0 12px' }}>{title(sheet.kind, sheet.item)} · {range(sheet.item)}</p>
          <div className="m-field"><label>{mt('Comment (optional)')}</label><textarea className="m-input" value={comment} onChange={e => setComment(e.target.value)} /></div>
          {error && <div className="m-err">{error}</div>}
        </Sheet>
      )}
    </>
  );
}
