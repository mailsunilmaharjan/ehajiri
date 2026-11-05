import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { Empty, Sheet, Spinner, useMT } from './kit.jsx';
import { DateField } from './fields.jsx';

/* Admin tools on the phone: add a new staff member, enrol a person on an attendance device (send to device, fingerprint, face,
   card) and manage the devices themselves (More → Device Management). Everything here uses the same API as the website, and the
   server only lets Admin / Super Admin through, so the buttons are simply hidden for everyone else. */

export const useIsAdmin = () => { const { currentUser } = useAuth(); return ['admin', 'superAdmin'].includes(currentUser?.role); };

const optList = (arr) => (Array.isArray(arr) ? arr : []).map(x => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
const ROLES = [['employee', 'Employee'], ['departmentHead', 'Department Head'], ['branchManager', 'Branch Manager']];

/* defined at module level on purpose: a component declared inside AddStaffSheet is a NEW type on every keystroke, which remounts the input and drops the keyboard */
function FSel({ f, err, set, k, label, opts, required }) {
  return (
    <div className="m-field"><label>{label}{required && <span style={{ color: '#dc2626' }}> *</span>}</label>
      <select className={'m-input' + (err[k] ? ' err' : '')} value={f[k]} onChange={e => set(k, e.target.value)}>
        <option value="">—</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select>{err[k] && <div className="m-ferr">{err[k]}</div>}</div>
  );
}
function FTxt({ f, err, set, k, label, required, type = 'text', hint }) {
  return (
    <div className="m-field"><label>{label}{required && <span style={{ color: '#dc2626' }}> *</span>}</label>
      <input className={'m-input' + (err[k] ? ' err' : '')} type={type} value={f[k]} onChange={e => set(k, e.target.value)} inputMode={type === 'tel' ? 'tel' : undefined} />
      {hint && <div className="m-jsub">{hint}</div>}{err[k] && <div className="m-ferr">{err[k]}</div>}</div>
  );
}
function FSection({ icon, title, children }) {
  return <div className="m-fsec"><div className="m-fsec-h"><span>{icon}</span>{title}</div>{children}</div>;
}

/* ───────────── Add new staff ───────────── */
export function AddStaffSheet({ onClose, onSaved }) {
  const mt = useMT();
  const { settings } = useSettings();
  const { addEmployee } = useData();
  const [f, setF] = useState({ employeeId: '', fullName: '', gender: 'male', position: '', department: '', branch: '', mode: '', grade: '',
    phone: '', email: '', joinDate: '', deviceId: '', role: 'employee', onlineAttendanceEnabled: false });
  const [err, setErr] = useState({}); const [busy, setBusy] = useState(false); const [top, setTop] = useState(''); const [done, setDone] = useState(null);
  const [step, setStep] = useState(0);
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setErr(e => ({ ...e, [k]: '' })); };
  const submit = async () => {
    const e = {};
    if (!f.employeeId.trim()) e.employeeId = mt('Required field');
    if (!f.fullName.trim()) e.fullName = mt('Required field');
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = mt('Enter a valid email');
    setErr(e); if (Object.keys(e).length) return;
    setBusy(true); setTop('');
    try {
      const body = { ...f, employeeId: f.employeeId.trim(), fullName: f.fullName.trim(), email: f.email.trim() || undefined,
        deviceId: (f.deviceId || f.employeeId).trim(), status: 'Active' };
      Object.keys(body).forEach(k => { if (body[k] === '') delete body[k]; });
      const saved = await addEmployee(body);
      setDone(saved); onSaved?.(saved);
    } catch (x) { setTop(x?.message || mt('Could not save')); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Sheet title={mt('Staff added')} onClose={onClose} footer={<button className="m-btn m-block" onClick={onClose}>{mt('Done')}</button>}>
        <div className="m-okbox">✅ {done.fullName || f.fullName} {mt('was added.')}</div>
        <div className="m-kv"><span className="m-muted">{mt('Login')}</span><b>{done.username || f.email || f.employeeId}</b></div>
        <div className="m-kv"><span className="m-muted">{mt('First password')}</span><b>{f.deviceId || f.employeeId}</b></div>
        <p className="m-muted" style={{ fontSize: 12.5 }}>{mt('Open the person from the Staff list to enrol them on an attendance device.')}</p>
      </Sheet>
    );
  }
  const initial = (f.fullName.trim()[0] || '＋').toUpperCase();
  const P = { f, err, set };
  const STEPS = [['👤', 'Basic'], ['💼', 'Job'], ['🔐', 'Access']];
  const next = () => {
    if (step === 0) {
      const e = {};
      if (!f.employeeId.trim()) e.employeeId = mt('Required field');
      if (!f.fullName.trim()) e.fullName = mt('Required field');
      if (f.email && !/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = mt('Enter a valid email');
      setErr(e); if (Object.keys(e).length) return;
    }
    setStep(s => Math.min(2, s + 1));
  };
  return (
    <Sheet title={mt('Add Staff')} onClose={() => !busy && onClose()}
      footer={step === 0
        ? <><button className="m-btn m-ghost" disabled={busy} onClick={onClose}>{mt('Cancel')}</button><button className="m-btn" onClick={next}>{mt('Next')} ›</button></>
        : step === 1
          ? <><button className="m-btn m-ghost" onClick={() => setStep(0)}>‹ {mt('Back')}</button><button className="m-btn" onClick={next}>{mt('Next')} ›</button></>
          : <><button className="m-btn m-ghost" disabled={busy} onClick={() => setStep(1)}>‹ {mt('Back')}</button>
              <button className="m-btn m-ok" disabled={busy} onClick={submit}>{busy ? '…' : `✓ ${mt('Save staff')}`}</button></>}>
      {top && <div className="m-err">{top}</div>}

      <div className="m-stepper">
        {STEPS.map(([ic, l], i) => (
          <React.Fragment key={l}>
            {i > 0 && <i className={`m-step-line${i <= step ? ' on' : ''}`} />}
            <button type="button" className={`m-step${i === step ? ' cur' : i < step ? ' done' : ''}`} onClick={() => i < step && setStep(i)}>
              <span>{i < step ? '✓' : ic}</span><em>{mt(l)}</em>
            </button>
          </React.Fragment>
        ))}
      </div>

      <div className="m-newhero">
        <div className="m-newhero-av">{initial}</div>
        <div className="m-grow" style={{ minWidth: 0 }}>
          <b className="m-ell" style={{ display: 'block', fontSize: 16 }}>{f.fullName.trim() || mt('New staff member')}</b>
          <span className="m-muted m-ell" style={{ display: 'block', fontSize: 12.5 }}>{[f.position, f.department].filter(Boolean).join(' · ') || (f.employeeId.trim() ? `ID ${f.employeeId.trim()}` : mt('Fill in the details below'))}</span>
        </div>
      </div>

      <div className="m-wiz" onKeyDown={e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.blur(); if (step < 2) next(); } }}>
        {step === 0 && (<>
          <div className="m-fgrid">
            <FTxt {...P} k="employeeId" label={mt('Employee ID')} required />
            <FTxt {...P} k="fullName" label={mt('Full Name')} required />
          </div>
          <div className="m-field"><label>{mt('Gender')}</label>
            <div className="m-optrow">{[['male', '👨', 'Male'], ['female', '👩', 'Female'], ['other', '🧑', 'Other']].map(([v, ic, l]) => (
              <button type="button" key={v} className={f.gender === v ? 'on' : ''} onClick={() => set('gender', v)}><span>{ic}</span>{mt(l)}</button>))}</div></div>
          <FTxt {...P} k="phone" label={mt('Mobile')} type="tel" />
          <FTxt {...P} k="email" label={mt('Email')} type="email" hint={mt('Used as the login name. Leave empty to log in with the Employee ID.')} />
        </>)}

        {step === 1 && (<>
          <div className="m-fgrid">
            <FSel {...P} k="position" label={mt('Post')} opts={optList(settings.posts)} />
            <FSel {...P} k="department" label={mt('Department')} opts={optList(settings.departments)} />
            <FSel {...P} k="branch" label={mt('Branch')} opts={optList(settings.branches)} />
            <FSel {...P} k="mode" label={mt('Mode')} opts={optList(settings.modes)} />
            <FSel {...P} k="grade" label={mt('Grade')} opts={optList(settings.grades)} />
            <DateField label={mt('Join Date')} value={f.joinDate} onChange={v => set('joinDate', v)} />
          </div>
        </>)}

        {step === 2 && (<>
          <FTxt {...P} k="deviceId" label={mt('Device ID / PIN')} hint={mt('The number on the attendance device. Empty = same as Employee ID.')} />
          <div className="m-field"><label>{mt('User Role')}</label>
            <div className="m-optrow">{ROLES.map(([v, l]) => <button type="button" key={v} className={f.role === v ? 'on' : ''} onClick={() => set('role', v)}>{mt(l)}</button>)}</div></div>
          <button type="button" className={`m-switchrow${f.onlineAttendanceEnabled ? ' on' : ''}`} onClick={() => set('onlineAttendanceEnabled', !f.onlineAttendanceEnabled)}>
            <span className="m-grow"><b>{mt('Online attendance')}</b><small>{mt('Lets this person check in from the phone')}</small></span>
            <i className="m-switch"><u /></i>
          </button>
          <div className="m-sumbox">
            <div className="m-kv"><span className="m-muted">{mt('Name')}</span><b>{f.fullName.trim() || '—'}</b></div>
            <div className="m-kv"><span className="m-muted">{mt('Employee ID')}</span><b>{f.employeeId.trim() || '—'}</b></div>
            <div className="m-kv"><span className="m-muted">{mt('Mobile')}</span><b>{f.phone || '—'}</b></div>
            <div className="m-kv"><span className="m-muted">{mt('Login')}</span><b>{f.email.trim() || f.employeeId.trim() || '—'}</b></div>
          </div>
        </>)}
      </div>
    </Sheet>
  );
}

/* ───────────── Device enrolment for one person ───────────── */
export function EnrollSheet({ person, onClose }) {
  const mt = useMT();
  const [devices, setDevices] = useState(null); const [dev, setDev] = useState('');
  const [finger, setFinger] = useState('0');
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const pin = person.deviceId || person.device_id || '';
  useEffect(() => {
    api.get('/zkteco/devices').then(r => { const l = Array.isArray(r) ? r : []; setDevices(l); const first = l.find(d => d.active !== false && d.serial_number); if (first) setDev(String(first.id)); })
      .catch(e => { setErr(e?.message || mt('Could not load devices')); setDevices([]); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (key, path, body, ok) => {
    setBusy(key); setMsg(''); setErr('');
    try { await api.post(`/zkteco/devices/${dev}/${path}`, body); setMsg(ok); } catch (e) { setErr(e?.message || mt('Failed')); } finally { setBusy(''); }
  };
  const fs = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <Sheet title={`${mt('Device Enrollment')} · ${person.fullName}`} onClose={onClose}>
      {!pin && <div className="m-err">{mt('This person has no Device ID / PIN yet. Add one in the staff record first.')}</div>}
      {devices === null && <div className="m-empty"><Spinner dark /></div>}
      {devices && devices.length === 0 && <Empty icon="📟" text={mt('No attendance devices found')} />}
      {devices && devices.length > 0 && (<>
        <div className="m-kv"><span className="m-muted">{mt('Device ID / PIN')}</span><b>{pin || '—'}</b></div>
        <div className="m-field" style={{ marginTop: 10 }}><label>{mt('Device')}</label>
          <select className="m-input" value={dev} onChange={e => { setDev(e.target.value); setMsg(''); }}>{devices.map(d => <option key={d.id} value={d.id}>{d.name || d.serial_number}{d.location ? ` — ${d.location}` : ''}</option>)}</select></div>
        {msg && <div className="m-okbox" style={{ marginBottom: 10 }}>✅ {msg}</div>}
        {err && <div className="m-err">{err}</div>}
        <button className="m-btn m-block" style={{ marginBottom: 10 }} disabled={!pin || !dev || !!busy}
          onClick={() => run('up', 'upload-user', { pin, name: person.fullName }, mt('Sent to the device. It appears there within a minute.'))}>{busy === 'up' ? '…' : `📤 ${mt('Send person to device')}`}</button>
        <div className="m-field"><label>{mt('Finger')}</label>
          <select className="m-input" value={finger} onChange={e => setFinger(e.target.value)}>{fs.map(n => <option key={n} value={n}>{mt('Finger')} {Number(n) + 1}</option>)}</select></div>
        <button className="m-btn m-block m-ok" style={{ marginBottom: 10 }} disabled={!pin || !dev || !!busy}
          onClick={() => run('fp', 'enroll-fp', { pin, fingerId: Number(finger) }, mt('Fingerprint enrolment started — ask the person to place the finger on the device when it asks.'))}>{busy === 'fp' ? '…' : `☝️ ${mt('Enrol fingerprint')}`}</button>
        <button className="m-btn m-block m-ok" style={{ marginBottom: 10 }} disabled={!pin || !dev || !!busy}
          onClick={() => run('face', 'enroll-face', { pin }, mt('Face enrolment started — ask the person to look at the device when it asks.'))}>{busy === 'face' ? '…' : `🙂 ${mt('Enrol face')}`}</button>
        <button className="m-btn m-block m-ok" disabled={!pin || !dev || !!busy}
          onClick={() => run('card', 'enroll-card', { pin }, mt('Card enrolment started — ask the person to show the card to the device.'))}>{busy === 'card' ? '…' : `💳 ${mt('Enrol card')}`}</button>
        <p className="m-muted" style={{ fontSize: 12, marginTop: 10 }}>{mt('The device picks up each request the next time it checks in with the server (usually within a minute).')}</p>
      </>)}
    </Sheet>
  );
}

/* ───────────── More → Device Management ───────────── */
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v).getTime()) / 60000); if (isNaN(m)) return ''; return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const online = (d) => !!d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 5 * 60 * 1000;

export default function DeviceManagement() {
  const mt = useMT();
  const isAdmin = useIsAdmin();
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [confirm, setConfirm] = useState(false);
  const load = useCallback(() => api.get('/zkteco/devices').then(r => { setRows(Array.isArray(r) ? r : []); setErr(''); }).catch(e => { setErr(e?.message || mt('Could not load')); setRows([]); }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const cur = useMemo(() => rows?.find(d => d.id === open) || null, [rows, open]);
  const act = async (key, path, ok) => {
    setBusy(key); setMsg(''); setErr('');
    try { await api.post(`/zkteco/devices/${cur.id}/${path}`, {}); setMsg(ok); setTimeout(load, 2500); } catch (e) { setErr(e?.message || mt('Failed')); } finally { setBusy(''); setConfirm(false); }
  };
  if (!isAdmin) return <div style={{ padding: 14 }}><Empty icon="🔒" text={mt('Only an Admin can manage devices.')} /></div>;
  const on = rows?.filter(online).length || 0;
  return (
    <div style={{ padding: 14, paddingBottom: 30 }}>
      {rows && rows.length > 0 && <div className="m-stats m-cols3"><div className="m-stat"><b>{rows.length}</b><span>{mt('Devices')}</span></div><div className="m-stat"><b style={{ color: '#16a34a' }}>{on}</b><span>{mt('Online')}</span></div><div className="m-stat"><b style={{ color: '#dc2626' }}>{rows.length - on}</b><span>{mt('Offline')}</span></div></div>}
      {err && !cur && <div className="m-err">{err}</div>}
      {rows === null && <div className="m-empty"><Spinner dark /></div>}
      {rows && rows.length === 0 && !err && <div className="m-card"><Empty icon="📟" text={mt('No attendance devices found')} /></div>}
      {(rows || []).map(d => (
        <button key={d.id} className="m-task" data-st={online(d) ? 'ok' : 'bad'} onClick={() => { setOpen(d.id); setMsg(''); setErr(''); }}>
          <span className="m-task-bar" style={{ background: online(d) ? '#22c55e' : '#ef4444' }} />
          <span className="m-grow" style={{ minWidth: 0 }}>
            <b className="m-ell" style={{ display: 'block', fontSize: 16 }}>{d.name || d.serial_number}</b>
            <span className="m-muted m-ell" style={{ display: 'block' }}>{[d.model, d.location, d.serial_number].filter(Boolean).join(' · ')}</span>
            <span className="m-row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <span className={`m-pill ${online(d) ? 'ok' : 'bad'}`}>{online(d) ? mt('Online') : mt('Offline')}</span>
              <span className="m-pill">👥 {d.actual_user_count ?? 0}</span>
              {d.last_seen && <span className="m-pill">{ago(d.last_seen)}</span>}
            </span>
          </span>
        </button>
      ))}
      {cur && (
        <Sheet title={cur.name || cur.serial_number} onClose={() => setOpen(null)}>
          <div className={`m-locbox ${online(cur) ? 'ready' : 'error'}`}>{online(cur) ? `🟢 ${mt('Online')}` : `🔴 ${mt('Offline')}`} {cur.last_seen ? `· ${mt('last seen')} ${ago(cur.last_seen)}` : ''}</div>
          {[[mt('Model'), cur.model], [mt('Serial'), cur.serial_number], [mt('Location'), cur.location], [mt('IP'), cur.last_ip || cur.ip_address], [mt('Firmware'), cur.info_firmware || cur.firmware_ver],
            [mt('Users'), cur.actual_user_count], [mt('Fingerprints'), cur.finger_samples], [mt('Faces'), cur.face_samples], [mt('Cards'), cur.card_samples], [mt('Attendance records'), cur.total_logs]]
            .filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '').map(([l, v]) => <div key={l} className="m-kv"><span className="m-muted">{l}</span><b>{String(v)}</b></div>)}
          {msg && <div className="m-okbox" style={{ margin: '10px 0' }}>✅ {msg}</div>}
          {err && <div className="m-err" style={{ marginTop: 10 }}>{err}</div>}
          <div className="m-h2" style={{ marginTop: 14 }}>{mt('Actions')}</div>
          <div className="m-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="m-btn m-xs" disabled={!!busy} onClick={() => act('info', 'get-info', mt('Refreshing device information…'))}>{busy === 'info' ? '…' : `ℹ️ ${mt('Refresh info')}`}</button>
            <button className="m-btn m-xs" disabled={!!busy} onClick={() => act('sync', 'sync', mt('Attendance sync requested.'))}>{busy === 'sync' ? '…' : `🔄 ${mt('Sync attendance')}`}</button>
            <button className="m-btn m-xs" disabled={!!busy} onClick={() => act('users', 'get-users', mt('Reading the users on the device…'))}>{busy === 'users' ? '…' : `👥 ${mt('Get users')}`}</button>
            <button className="m-btn m-xs" disabled={!!busy} onClick={() => act('time', 'set-time', mt('Device time will be set to now.'))}>{busy === 'time' ? '…' : `🕒 ${mt('Set time')}`}</button>
            <button className="m-btn m-xs m-warn" disabled={!!busy} onClick={() => setConfirm(true)}>⟳ {mt('Reboot')}</button>
          </div>
          <p className="m-muted" style={{ fontSize: 12, marginTop: 10 }}>{mt('The device runs each request the next time it checks in (usually within a minute). Clearing data is not available on the phone — use the website.')}</p>
        </Sheet>
      )}
      {cur && confirm && (
        <Sheet title={mt('Reboot device?')} onClose={() => setConfirm(false)}
          footer={<><button className="m-btn m-ghost" onClick={() => setConfirm(false)}>{mt('Cancel')}</button>
            <button className="m-btn m-bad" disabled={!!busy} onClick={() => act('reboot', 'reboot', mt('Reboot requested.'))}>{busy === 'reboot' ? '…' : mt('Reboot')}</button></>}>
          <p style={{ margin: 0 }}>{mt('The device restarts and is offline for a minute or two. Fingerprints are restored automatically from the server.')}</p>
        </Sheet>
      )}
    </div>
  );
}
