import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { useLeaveApply } from '../context/LeaveApplyContext.jsx';
import { useOfficeVisitApply } from '../context/OfficeVisitApplyContext.jsx';
import { useManualPostingApply } from '../context/ManualPostingApplyContext.jsx';
import { useMissingAttendanceApply } from '../context/MissingAttendanceApplyContext.jsx';
import useRecoApproval from '../hooks/useRecoApproval.js';
import { getNepalTodayISO } from '../utils/dateUtils.js';
import { countLeaveDays } from '../utils/holidayScope.js';
import useDateFormat from '../hooks/useDateFormat.js';
import { Sheet, Spinner, useMT } from './kit.jsx';
import { useMyLeaveBalance } from './hooks.js';
import { DateField, PersonPick, TimeText, validTime } from './fields.jsx';

/* The four apply forms, built for the phone: no "Staff Information" block (you are applying for yourself), the approvers are
   picked for you (one person) or chosen with a single tap (several), a full-width calendar, big fields. They send exactly the
   same requests as the website's forms, so every rule - balances, holidays, who may approve - is unchanged. */

/** Recommender + approver for an employee; a single person is chosen automatically. */
function useApprovers(employeeId) {
  const { employees } = useData();
  const { getRecoIds, getApprovalIds, assignments, refresh } = useRecoApproval();
  const [reco, setReco] = useState('');
  const [appr, setAppr] = useState('');
  useEffect(() => { refresh?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const recoIds = getRecoIds(employeeId).map(String);
  const apprIds = getApprovalIds(employeeId).map(String);
  // (re)choose whenever the configured people arrive or change: exactly one -> that person
  useEffect(() => {
    setReco(r => (recoIds.length === 1 ? recoIds[0] : recoIds.includes(r) ? r : ''));
    setAppr(a => (apprIds.length === 1 ? apprIds[0] : apprIds.includes(a) ? a : ''));
  }, [assignments]); // eslint-disable-line react-hooks/exhaustive-deps
  const getEmp = useCallback((id) => (employees || []).find(e => String(e.id) === String(id)), [employees]);
  const nameOf = (id) => getEmp(id)?.fullName || `#${id}`;
  return { recoIds, apprIds, reco, setReco, appr, setAppr, getEmp, nameOf };
}

function Done({ title, lines, onClose, onView, viewLabel }) {
  const mt = useMT();
  return (
    <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
      <div style={{ fontSize: 54 }}>✅</div>
      <h3 style={{ margin: '6px 0 10px' }}>{title}</h3>
      {lines.filter(Boolean).map((l, i) => <p key={i} className="m-muted" style={{ margin: '4px 0' }}>{l}</p>)}
      <div className="m-row" style={{ gap: 10, marginTop: 18 }}>
        <button className="m-btn m-ghost" style={{ flex: 1 }} onClick={onClose}>{mt('Close')}</button>
        {onView && <button className="m-btn" style={{ flex: 1 }} onClick={onView}>{viewLabel}</button>}
      </div>
    </div>
  );
}

const Footer = ({ onCancel, onSubmit, busy, label }) => {
  const mt = useMT();
  return (<><button className="m-btn m-ghost" onClick={onCancel}>{mt('Cancel')}</button>
    <button className="m-btn" disabled={busy} onClick={onSubmit}>{busy ? '…' : label}</button></>);
};

/* ───────────── Leave ───────────── */
function LeaveInner({ close, prefill }) {
  const mt = useMT(); const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { settings, refreshSettings } = useSettings();
  const { addLeave, refreshLeaveBalances, leaves } = useData();
  const balances = useMyLeaveBalance();
  const today = getNepalTodayISO();
  const ap = useApprovers(currentUser.id);
  const [f, setF] = useState({ type: '', half: false, from: prefill?.fromDate || today, to: prefill?.toDate || prefill?.fromDate || today, reason: '' });
  const [err, setErr] = useState({}); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [top, setTop] = useState('');
  useEffect(() => { refreshSettings?.(); refreshLeaveBalances?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lts = settings.leaveTypeConfigs || [];
  const ltc = lts.find(l => l.shortName === f.type);
  const bal = (code) => balances.find(b => b.code === code)?.balance ?? 0;
  const days = f.half ? 0.5 : (f.type && f.from && f.to ? countLeaveDays(settings, ltc, f.from, f.to, currentUser) : 0);
  const minDate = settings.leaveBackdateEnabled === false ? today : undefined;
  const set = (k, v) => { setF(p => { const n = { ...p, [k]: v }; if (k === 'from') n.to = v; if (k === 'half' && v) { n.from = today; n.to = today; } return n; }); setErr(e => ({ ...e, [k]: '' })); };

  const submit = async () => {
    const e = {};
    if (!f.type) e.type = mt('Required field');
    if (!f.half && f.to < f.from) e.to = mt('To Date must be after From Date');
    if (f.reason.trim().length < 5) e.reason = mt('Minimum 5 characters required');
    if (ap.recoIds.length > 1 && !ap.reco) e.reco = mt('Please choose one');
    if (ap.apprIds.length === 0) e.appr = mt('No Approval Authority is set for you — ask Admin (Staff Detail → Set Recommendator & Approval).');
    else if (ap.apprIds.length > 1 && !ap.appr) e.appr = mt('Please choose one');
    if (f.type && days > 0) {
      if (ltc?.provideOnlyOnBalance && days > bal(f.type)) e.days = `${mt('Insufficient balance')} (${bal(f.type)})`;
      if (ltc?.isServicePeriod && ltc?.timesPerService) {
        const taken = (leaves || []).filter(l => String(l.employeeId) === String(currentUser.id) && l.leaveTypeCode === f.type && l.status === 'approved').length;
        if (taken >= ltc.timesPerService) e.days = `This leave can only be taken ${ltc.timesPerService} time(s). Already used: ${taken}`;
      }
    }
    setErr(e); if (Object.keys(e).length) return;
    setBusy(true); setTop('');
    try {
      await addLeave({ employeeId: currentUser.id, leaveTypeCode: f.type, fromDate: f.from, toDate: f.to, halfDay: f.half, days, reason: f.reason,
        reco: ap.reco ? [ap.reco] : [], approval: ap.appr ? [ap.appr] : [] }, { throwOnReject: true });
      setDone({ name: ltc?.name || f.type, days });
    } catch (x) { setTop(x?.message || mt('Could not submit')); } finally { setBusy(false); }
  };

  return (
    <Sheet title={mt('Apply Leave')} onClose={close} footer={done ? null : <Footer onCancel={close} onSubmit={submit} busy={busy} label={mt('Submit')} />}>
      {done ? <Done title={mt('Leave application submitted')} lines={[`${done.name} · ${done.days} ${done.days === 1 ? mt('day') : mt('days')}`,
          ap.reco && `${mt('Recommend')}: ${ap.nameOf(ap.reco)}`, ap.appr && `${mt('Approve')}: ${ap.nameOf(ap.appr)}`]}
        onClose={close} onView={() => { close(); navigate('/m/leave'); }} viewLabel={mt('My requests')} /> : (<>
        {top && <div className="m-err">{top}</div>}
        <div className="m-field"><label>{mt('Leave')} <span style={{ color: '#dc2626' }}>*</span></label>
          <select className={`m-input${err.type ? ' err' : ''}`} value={f.type} onChange={e => set('type', e.target.value)}>
            <option value="">— {mt('Select Leave Type')} —</option>
            {lts.map(l => <option key={l.shortName} value={l.shortName}>{l.name} — {bal(l.shortName)} {mt('days remaining')}</option>)}
          </select>{err.type && <div className="m-ferr">{err.type}</div>}</div>
        <label className="m-check"><input type="checkbox" checked={f.half} onChange={e => set('half', e.target.checked)} /><span>{mt('Half Day')}</span></label>
        {f.half
          ? <DateField label={mt('Date')} required value={f.from} min={minDate} onChange={v => set('from', v)} />
          : <><DateField label={mt('From Date')} required value={f.from} min={minDate} onChange={v => set('from', v)} />
              <DateField label={mt('To Date')} required value={f.to} min={f.from} onChange={v => set('to', v)} error={err.to} /></>}
        {f.type && <div className="m-sumrow"><div><span>{mt('No. of Days')}</span><b>{days}</b></div>
          <div className={bal(f.type) - days < 0 ? 'neg' : ''}><span>{mt('Balance After')}</span><b>{bal(f.type) - days}</b></div></div>}
        {err.days && <div className="m-err">{err.days}</div>}
        <PersonPick label={mt('Recommendator')} ids={ap.recoIds} getEmp={ap.getEmp} value={ap.reco} onChange={ap.setReco} required={ap.recoIds.length > 1} error={err.reco} />
        <PersonPick label={mt('Approval Authority')} ids={ap.apprIds} getEmp={ap.getEmp} value={ap.appr} onChange={ap.setAppr} required error={err.appr} />
        <div className="m-field"><label>{mt('Remarks')} <span style={{ color: '#dc2626' }}>*</span></label>
          <textarea className={`m-input${err.reason ? ' err' : ''}`} rows={3} placeholder={mt('Enter reason for leave...')} value={f.reason} onChange={e => set('reason', e.target.value)} />
          {err.reason && <div className="m-ferr">{err.reason}</div>}</div>
      </>)}
    </Sheet>
  );
}

/* ───────────── Office Visit ───────────── */
function VisitInner({ close, prefill }) {
  const mt = useMT(); const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { settings, refreshSettings } = useSettings();
  const { addVisit } = useData();
  const today = getNepalTodayISO();
  const ap = useApprovers(currentUser.id);
  const types = useMemo(() => (settings.officeVisitTypes || []).map(v => v.name || v).filter(Boolean), [settings.officeVisitTypes]);
  const [f, setF] = useState({ visit: '', vtype: 'National', country: '', address: '', desc: '', from: prefill?.fromDate || today, to: prefill?.toDate || prefill?.fromDate || today });
  const [err, setErr] = useState({}); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [top, setTop] = useState('');
  useEffect(() => { refreshSettings?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const minDate = settings.leaveBackdateEnabled === false ? today : undefined;
  const set = (k, v) => { setF(p => ({ ...p, [k]: v, ...(k === 'from' ? { to: v } : {}) })); setErr(e => ({ ...e, [k]: '' })); };

  const submit = async () => {
    const e = {};
    if (!f.visit.trim()) e.visit = mt('Required field');
    if (!f.address.trim()) e.address = mt('Required field');
    if (!f.desc.trim()) e.desc = mt('Required field');
    if (f.vtype === 'International' && !f.country.trim()) e.country = mt('Required field');
    if (f.to < f.from) e.to = mt('To Date must be on or after From Date');
    if (ap.recoIds.length > 1 && !ap.reco) e.reco = mt('Please choose one');
    if (ap.apprIds.length === 0) e.appr = mt('No Approval Authority is set for you — ask Admin (Staff Detail → Set Recommendator & Approval).');
    else if (ap.apprIds.length > 1 && !ap.appr) e.appr = mt('Please choose one');
    setErr(e); if (Object.keys(e).length) return;
    setBusy(true); setTop('');
    try {
      await addVisit({ employeeId: currentUser.id, purpose: f.visit, officialVisit: f.visit, visitType: f.vtype, country: f.vtype === 'International' ? f.country : '',
        address: f.address, location: f.address, description: f.desc, reason: f.desc, fromDate: f.from, toDate: f.to,
        reco: ap.reco ? [ap.reco] : [], approval: ap.appr ? [ap.appr] : [] }, { throwOnReject: true });
      setDone(true);
    } catch (x) { setTop(x?.message || mt('Could not submit')); } finally { setBusy(false); }
  };

  return (
    <Sheet title={mt('Office Visit')} onClose={close} footer={done ? null : <Footer onCancel={close} onSubmit={submit} busy={busy} label={mt('Submit')} />}>
      {done ? <Done title={mt('Office visit application submitted')} lines={[ap.reco && `${mt('Recommend')}: ${ap.nameOf(ap.reco)}`, ap.appr && `${mt('Approve')}: ${ap.nameOf(ap.appr)}`]}
        onClose={close} onView={() => { close(); navigate('/m/leave'); }} viewLabel={mt('My requests')} /> : (<>
        {top && <div className="m-err">{top}</div>}
        <div className="m-field"><label>{mt('Official Visit')} <span style={{ color: '#dc2626' }}>*</span></label>
          {types.length > 0
            ? <select autoFocus className={`m-input${err.visit ? ' err' : ''}`} value={f.visit} onChange={e => set('visit', e.target.value)}>
                <option value="">— {mt('Select Official Visit Type')} —</option>{types.map(t => <option key={t} value={t}>{t}</option>)}</select>
            : <input autoFocus className={`m-input${err.visit ? ' err' : ''}`} value={f.visit} onChange={e => set('visit', e.target.value)} placeholder={mt('Enter official visit name')} />}
          {err.visit && <div className="m-ferr">{err.visit}</div>}</div>
        <div className="m-field"><label>{mt('Visit Type')}</label>
          <div className="m-seg" style={{ marginBottom: 0 }}>{['National', 'International'].map(v => <button type="button" key={v} className={f.vtype === v ? 'on' : ''} onClick={() => set('vtype', v)}>{v === 'National' ? '🇳🇵 ' : '🌍 '}{mt(v)}</button>)}</div></div>
        {f.vtype === 'International' && <div className="m-field"><label>{mt('Country')} *</label>
          <input className={`m-input${err.country ? ' err' : ''}`} value={f.country} onChange={e => set('country', e.target.value)} />{err.country && <div className="m-ferr">{err.country}</div>}</div>}
        <div className="m-field"><label>{mt('Address')} *</label>
          <input className={`m-input${err.address ? ' err' : ''}`} value={f.address} onChange={e => set('address', e.target.value)} placeholder={mt('Visit address / location')} />{err.address && <div className="m-ferr">{err.address}</div>}</div>
        <div className="m-field"><label>{mt('Description')} *</label>
          <textarea className={`m-input${err.desc ? ' err' : ''}`} rows={3} value={f.desc} onChange={e => set('desc', e.target.value)} placeholder={mt('Description / purpose of the visit')} />{err.desc && <div className="m-ferr">{err.desc}</div>}</div>
        <DateField label={mt('From Date')} required value={f.from} min={minDate} onChange={v => set('from', v)} />
        <DateField label={mt('To Date')} required value={f.to} min={f.from} onChange={v => set('to', v)} error={err.to} />
        <PersonPick label={mt('Recommendator')} ids={ap.recoIds} getEmp={ap.getEmp} value={ap.reco} onChange={ap.setReco} required={ap.recoIds.length > 1} error={err.reco} />
        <PersonPick label={mt('Approval Authority')} ids={ap.apprIds} getEmp={ap.getEmp} value={ap.appr} onChange={ap.setAppr} required error={err.appr} />
      </>)}
    </Sheet>
  );
}

/* ───────────── Late In / Early Out ───────────── */
function LateInner({ close, prefillDate }) {
  const mt = useMT(); const navigate = useNavigate();
  const { currentUser } = useAuth();
  const today = getNepalTodayISO();
  const ap = useApprovers(currentUser.id);
  const [f, setF] = useState({ date: prefillDate || today, inT: '', outT: '', remark: '' });
  const [err, setErr] = useState({}); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [top, setTop] = useState('');
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setErr(e => ({ ...e, [k]: '' })); };

  const submit = async () => {
    const e = {};
    if (!f.date) e.date = mt('Required field');
    if (!f.inT && !f.outT) e.inT = mt('Enter the late-in time or the early-out time');
    if (f.inT && !validTime(f.inT)) e.inT = mt('Use HH:MM, e.g. 10:30');
    if (f.outT && !validTime(f.outT)) e.outT = mt('Use HH:MM, e.g. 15:30');
    if (ap.recoIds.length > 1 && !ap.reco) e.reco = mt('Please choose one');
    if (ap.apprIds.length > 1 && !ap.appr) e.appr = mt('Please choose one');
    setErr(e); if (Object.keys(e).length) return;
    setBusy(true); setTop('');
    try {
      await api.post('/attendance/manual-postings', { employeeId: Number(currentUser.id), date: f.date, checkIn: f.inT || null, checkOut: f.outT || null,
        remark: f.remark || null, recommendedBy: ap.reco ? Number(ap.reco) : null, approvedBy: ap.appr ? Number(ap.appr) : null });
      setDone(true);
    } catch (x) { setTop(x?.message || mt('Could not submit')); } finally { setBusy(false); }
  };

  return (
    <Sheet title={mt('Late In / Early Out')} onClose={close} footer={done ? null : <Footer onCancel={close} onSubmit={submit} busy={busy} label={mt('Submit')} />}>
      {done ? <Done title={mt('Request submitted — pending approval')} lines={[mt('Your approver has been notified'), ap.appr && `${mt('Approve')}: ${ap.nameOf(ap.appr)}`]}
        onClose={close} onView={() => { close(); navigate('/m/leave'); }} viewLabel={mt('My requests')} /> : (<>
        {top && <div className="m-err">{top}</div>}
        <DateField label={mt('Date')} required value={f.date} onChange={v => set('date', v)} error={err.date} />
        <div className="m-two">
          <TimeText label={mt('Late In time')} value={f.inT} onChange={v => set('inT', v)} error={err.inT} />
          <TimeText label={mt('Early Out time')} value={f.outT} onChange={v => set('outT', v)} error={err.outT} />
        </div>
        <div className="m-muted" style={{ fontSize: 12, margin: '-4px 0 12px' }}>{mt('Type the time like 1030 → 10:30 (24 hour)')}</div>
        <PersonPick label={mt('Recommendator')} ids={ap.recoIds} getEmp={ap.getEmp} value={ap.reco} onChange={ap.setReco} error={err.reco} />
        <PersonPick label={mt('Approval Authority')} ids={ap.apprIds} getEmp={ap.getEmp} value={ap.appr} onChange={ap.setAppr} error={err.appr} />
        <div className="m-field"><label>{mt('Remark / Reason')}</label>
          <textarea className="m-input" rows={3} value={f.remark} onChange={e => set('remark', e.target.value)} placeholder={mt('Reason')} /></div>
      </>)}
    </Sheet>
  );
}

/* ───────────── Missing attendance ───────────── */
const serverNow = async () => {
  try {
    const h = await api.get('/health');
    if (h?.time) return new Date(h.time).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit' });
  } catch { /* fall back to the phone clock */ }
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit' });
};
const tmOf = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v).slice(0, 5) : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };

function MissingInner({ close, targetDate }) {
  const mt = useMT(); const navigate = useNavigate(); const fd = useDateFormat();
  const { currentUser } = useAuth();
  const today = getNepalTodayISO();
  const ap = useApprovers(currentUser.id);
  const [f, setF] = useState({ date: targetDate || today, inT: '', outT: '', reason: '' });
  const [rec, setRec] = useState(null);                // what is already recorded that day: { inT, outT } or null while loading
  const [err, setErr] = useState({}); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [top, setTop] = useState('');
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setErr(e => ({ ...e, [k]: '' })); };

  // look at what the office already has for that day
  useEffect(() => {
    let live = true; setRec(null); setF(p => ({ ...p, inT: '', outT: '' }));
    api.get(`/attendance/staff-ledger?employeeId=${currentUser.id}&startDate=${f.date}&endDate=${f.date}`)
      .then(r => { const d = r?.days?.[0]; if (live) setRec({ inT: tmOf(d?.timeIn), outT: d?.timeOut ? tmOf(d.timeOut) : '' }); })
      .catch(() => { if (live) setRec({ inT: '', outT: '' }); });
    return () => { live = false; };
  }, [f.date, currentUser.id]);

  const addNow = async (k) => set(k, await serverNow());

  const Row = ({ label, have, k }) => (
    <div className="m-field"><label>{label}</label>
      {have ? <div className="m-rec ok">✔ {mt('Recorded')}: <b>{have}</b></div>
        : f[k] ? <TimeText value={f[k]} onChange={v => set(k, v)} error={err[k]} right={<button type="button" onClick={() => set(k, '')}>{mt('Remove')}</button>} />
        : <button type="button" className="m-btn m-block m-ghost" disabled={!rec} onClick={() => addNow(k)}>＋ {label} · {mt('now')}</button>}
    </div>
  );

  const submit = async () => {
    const e = {};
    if (!f.date) e.date = mt('Required field'); else if (f.date > today) e.date = mt('Date cannot be in the future');
    if (!f.inT && !f.outT) e.inT = mt('Add the missing check in or check out');
    if (f.inT && !validTime(f.inT)) e.inT = mt('Use HH:MM');
    if (f.outT && !validTime(f.outT)) e.outT = mt('Use HH:MM');
    if (f.reason.trim().length < 5) e.reason = mt('Minimum 5 characters required');
    if (ap.recoIds.length > 1 && !ap.reco) e.reco = mt('Please choose one');
    if (ap.apprIds.length > 1 && !ap.appr) e.appr = mt('Please choose one');
    setErr(e); if (Object.keys(e).length) return;
    setBusy(true); setTop('');
    try {
      await api.post('/attendance/missing-requests', { date: f.date, checkIn: f.inT || null, checkOut: f.outT || null, reason: f.reason.trim(),
        recommendedBy: ap.reco || null, approvedBy: ap.appr || null });
      setDone(true);
    } catch (x) { setTop(x?.message || mt('Could not submit')); } finally { setBusy(false); }
  };

  return (
    <Sheet title={mt('Missing punch')} onClose={close} footer={done ? null : <Footer onCancel={close} onSubmit={submit} busy={busy} label={mt('Submit')} />}>
      {done ? <Done title={mt('Request submitted')} lines={[`${mt('Missing punch')} · ${fd(f.date)}`, ap.appr && `${mt('Approve')}: ${ap.nameOf(ap.appr)}`]} onClose={close} /> : (<>
        {top && <div className="m-err">{top}</div>}
        <DateField label={mt('Date')} required value={f.date} max={today} onChange={v => set('date', v)} error={err.date} />
        {!rec ? <div className="m-empty" style={{ padding: 10 }}><Spinner dark /></div> : (<>
          <Row label={mt('Check In')} have={rec.inT} k="inT" />
          <Row label={mt('Check Out')} have={rec.outT} k="outT" />
          {err.inT && <div className="m-ferr" style={{ marginTop: -6 }}>{err.inT}</div>}
        </>)}
        <PersonPick label={mt('Recommendator')} ids={ap.recoIds} getEmp={ap.getEmp} value={ap.reco} onChange={ap.setReco} error={err.reco} />
        <PersonPick label={mt('Approval Authority')} ids={ap.apprIds} getEmp={ap.getEmp} value={ap.appr} onChange={ap.setAppr} error={err.appr} />
        <div className="m-field"><label>{mt('Reason')} *</label>
          <textarea className={`m-input${err.reason ? ' err' : ''}`} rows={3} value={f.reason} onChange={e => set('reason', e.target.value)} placeholder={mt('Explain why attendance is missing for this date')} />
          {err.reason && <div className="m-ferr">{err.reason}</div>}</div>
      </>)}
    </Sheet>
  );
}

/** Mounted once in the phone layout, in place of the website's four popup forms. */
export default function MobileForms() {
  const leave = useLeaveApply(); const visit = useOfficeVisitApply(); const late = useManualPostingApply(); const miss = useMissingAttendanceApply();
  const { currentUser } = useAuth();
  if (!currentUser) return null;
  return (<>
    {leave.isOpen && <LeaveInner close={leave.close} prefill={leave.prefillDates} />}
    {visit.isOpen && <VisitInner close={visit.close} prefill={visit.prefillDates} />}
    {late.isOpen && <LateInner close={late.close} prefillDate={late.prefillDate} />}
    {miss.isOpen && <MissingInner close={miss.close} targetDate={miss.targetDate} />}
  </>);
}
