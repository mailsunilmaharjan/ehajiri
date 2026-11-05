import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import { useData } from '../context/DataContext.jsx';
import Avatar from '../components/Common/Avatar.jsx';
import { Empty, Sheet, Spinner, useMT } from './kit.jsx';
import { AddStaffSheet, EnrollSheet, useIsAdmin } from './MobileAdmin.jsx';

/* Staff directory, contacts and notes on the phone (opened from Attendance → Reports).
   Read-only lists with a search box; every row can call / WhatsApp / SMS / email the person. */

const digits = (v) => String(v || '').replace(/[^\d+]/g, '');
const waNumber = (v) => { const d = digits(v).replace(/^\+/, ''); return /^9\d{9}$/.test(d) ? '977' + d : d; };

function ContactButtons({ phone, email }) {
  const mt = useMT();
  const p = digits(phone);
  if (!p && !email) return null;
  return (
    <div className="m-contact3" style={{ marginTop: 10 }}>
      {p && <a className="m-btn m-xs" href={`tel:${p}`}>📞 {mt('Call')}</a>}
      {p && <a className="m-btn m-xs m-ok" href={`https://wa.me/${waNumber(phone)}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
      {p && <a className="m-btn m-xs" href={`sms:${p}`}>✉️ SMS</a>}
      {email && <a className="m-btn m-xs m-warn" href={`mailto:${email}`}>📧 Email</a>}
    </div>
  );
}

const Search = ({ value, onChange }) => {
  const mt = useMT();
  return <input className="m-input" style={{ marginBottom: 10 }} placeholder={`🔍 ${mt('Search')}`} value={value} onChange={e => onChange(e.target.value)} />;
};
const has = (q, ...vals) => !q.trim() || vals.filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase());
const SHOW = 80;   // render in pages so a long list stays fast

/* ───────── Staff ───────── */
function StaffList() {
  const mt = useMT();
  const { filteredEmployees, employees } = useData();
  const isAdmin = useIsAdmin();
  const [q, setQ] = useState(''); const [open, setOpen] = useState(null); const [more, setMore] = useState(SHOW);
  const [adding, setAdding] = useState(false); const [enrol, setEnrol] = useState(null);
  const all = useMemo(() => ((filteredEmployees && filteredEmployees.length ? filteredEmployees : employees) || []).filter(e => e.active !== false), [filteredEmployees, employees]);
  const list = all.filter(e => has(q, e.fullName, e.employeeId, e.position, e.department, e.branch, e.phone));
  return (<>
    {isAdmin && <button className="m-btn m-block m-ok" style={{ marginBottom: 10 }} onClick={() => setAdding(true)}>＋ {mt('Add Staff')}</button>}
    <Search value={q} onChange={v => { setQ(v); setMore(SHOW); }} />
    {list.length === 0 && <div className="m-card"><Empty icon="👥" text={mt('Nothing here yet')} /></div>}
    {list.slice(0, more).map(e => (
      <button key={e.id} className="m-task m-staffrow" onClick={() => setOpen(e)}>
        <span className="m-task-bar" style={{ background: '#bcd3fb' }} />
        <Avatar photo={e.profilePhoto} name={e.fullName} size={42} preview={false} />
        <span className="m-grow" style={{ minWidth: 0 }}>
          <b className="m-ell" style={{ display: 'block' }}>{e.fullName}</b>
          <span className="m-muted m-ell" style={{ display: 'block' }}>{[e.position, e.department].filter(Boolean).join(' · ') || '—'}</span>
          {e.phone && <span className="m-staffphone m-ell">📞 {e.phone}</span>}
        </span>
      </button>
    ))}
    {list.length > more && <button className="m-btn m-block" onClick={() => setMore(m => m + SHOW)}>{mt('Show more')} ({list.length - more})</button>}
    {open && (
      <Sheet title={open.fullName} onClose={() => setOpen(null)}>
        <div className="m-row" style={{ gap: 12, marginBottom: 10 }}>
          <Avatar photo={open.profilePhoto} name={open.fullName} size={64} preview={false} />
          <div className="m-grow"><b>{open.fullName}</b><div className="m-muted">{[open.position, open.department].filter(Boolean).join(' · ')}</div></div>
        </div>
        {[[mt('Employee ID'), open.employeeId], [mt('Branch'), open.branch], [mt('Department'), open.department], [mt('Post'), open.position], [mt('Mobile'), open.phone], [mt('Email'), open.email]]
          .filter(r => r[1]).map(([l, v]) => <div key={l} className="m-kv"><span className="m-muted">{l}</span><b>{v}</b></div>)}
        <ContactButtons phone={open.phone} email={open.email} />
        {isAdmin && <button className="m-btn m-block" style={{ marginTop: 14 }} onClick={() => { setEnrol(open); setOpen(null); }}>📟 {mt('Device Enrollment')}</button>}
      </Sheet>
    )}
    {adding && <AddStaffSheet onClose={() => setAdding(false)} />}
    {enrol && <EnrollSheet person={enrol} onClose={() => setEnrol(null)} />}
  </>);
}

/* ───────── Contacts ───────── */
function ContactList() {
  const mt = useMT();
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [q, setQ] = useState('');
  const [open, setOpen] = useState(null); const [persons, setPersons] = useState(null); const [more, setMore] = useState(SHOW);
  useEffect(() => { api.get('/contacts').then(r => setRows(Array.isArray(r) ? r : [])).catch(e => { setErr(e.message || 'Could not load'); setRows([]); }); }, []);
  useEffect(() => {
    if (!open) { setPersons(null); return; }
    api.get(`/contacts/${open.id}/persons`).then(r => setPersons(Array.isArray(r) ? r : [])).catch(() => setPersons([]));
  }, [open]);
  const title = (c) => c.companyName || c.personName || c.office || '—';
  const list = (rows || []).filter(c => has(q, c.companyName, c.personName, c.office, c.mobile1, c.email, c.address, c.district));
  return (<>
    <Search value={q} onChange={v => { setQ(v); setMore(SHOW); }} />
    {err && <div className="m-err">{err}</div>}
    {rows === null && <div className="m-empty"><Spinner dark /></div>}
    {rows && list.length === 0 && !err && <div className="m-card"><Empty icon="📇" text={mt('Nothing here yet')} /></div>}
    {list.slice(0, more).map(c => (
      <button key={c.id} className="m-task m-staffrow" onClick={() => setOpen(c)}>
        <span className="m-task-bar" style={{ background: '#bfe6dc' }} />
        <span className="m-list-ico" style={{ background: '#ccfbf1' }}>🏢</span>
        <span className="m-grow" style={{ minWidth: 0 }}>
          <b className="m-ell" style={{ display: 'block' }}>{title(c)}</b>
          <span className="m-muted m-ell" style={{ display: 'block' }}>{[c.personName && c.companyName ? c.personName : '', c.mobile1, c.address].filter(Boolean).join(' · ') || '—'}</span>
        </span>
      </button>
    ))}
    {list.length > more && <button className="m-btn m-block" onClick={() => setMore(m => m + SHOW)}>{mt('Show more')} ({list.length - more})</button>}
    {open && (
      <Sheet title={title(open)} onClose={() => setOpen(null)}>
        {[[mt('Contact Person'), open.personName], [mt('Office'), open.office], [mt('Mobile'), [open.mobile1, open.mobile2].filter(Boolean).join(', ')], [mt('Office Phone'), open.officePhone || open.companyPhone],
          [mt('Email'), open.email || open.companyEmail], [mt('Address'), open.address || open.companyAddress], [mt('District'), open.district]]
          .filter(r => r[1]).map(([l, v]) => <div key={l} className="m-kv"><span className="m-muted">{l}</span><b>{v}</b></div>)}
        <ContactButtons phone={open.mobile1 || open.companyPhone} email={open.email || open.companyEmail} />
        {persons === null && <div className="m-empty"><Spinner dark /></div>}
        {persons && persons.length > 0 && <div className="m-h2" style={{ marginTop: 14 }}>{mt('Contact Persons')}</div>}
        {(persons || []).map(p => (
          <div key={p.id} className="m-apcard">
            <b>{p.name}</b><div className="m-muted">{[p.post, p.department].filter(Boolean).join(' · ')}</div>
            <ContactButtons phone={p.mobile1} email={p.email} />
          </div>
        ))}
      </Sheet>
    )}
  </>);
}

/* ───────── Notes (view only — passwords are never shown on the phone) ───────── */
function NotesList() {
  const mt = useMT();
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [q, setQ] = useState(''); const [open, setOpen] = useState(null);
  useEffect(() => { api.get('/staff-notes').then(r => setRows(Array.isArray(r) ? r : [])).catch(e => { setErr(e.message || 'Could not load'); setRows([]); }); }, []);
  const list = (rows || []).filter(n => has(q, n.noteName, n.noteType, n.noteDetails, n.remarks));
  return (<>
    <Search value={q} onChange={setQ} />
    {err && <div className="m-err">{err}</div>}
    {rows === null && <div className="m-empty"><Spinner dark /></div>}
    {rows && list.length === 0 && !err && <div className="m-card"><Empty icon="📝" text={mt('Nothing here yet')} /></div>}
    {list.map(n => (
      <button key={n.id} className="m-task m-staffrow" onClick={() => setOpen(n)}>
        <span className="m-task-bar" style={{ background: '#f3dca6' }} />
        <span className="m-list-ico" style={{ background: '#fef3c7' }}>📝</span>
        <span className="m-grow" style={{ minWidth: 0 }}>
          <b className="m-ell" style={{ display: 'block' }}>{n.noteName}</b>
          <span className="m-muted m-ell" style={{ display: 'block' }}>{[n.noteType, n.visibility === 'public' ? `${mt('Public')}${n.ownerName ? ' · ' + n.ownerName : ''}` : mt('Private')].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
    ))}
    {open && (
      <Sheet title={open.noteName} onClose={() => setOpen(null)}>
        {open.noteType && <div className="m-kv"><span className="m-muted">{mt('Type')}</span><b>{open.noteType}</b></div>}
        {open.noteDetails && <div className="m-rmk-text" style={{ margin: '8px 0 12px' }}>{String(open.noteDetails).replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim()}</div>}
        {open.remarks && <div className="m-kv"><span className="m-muted">{mt('Remarks')}</span><b>{open.remarks}</b></div>}
        {(open.username || open.password) && <div className="m-okbox" style={{ background: '#fef3c7', color: '#92400e', marginTop: 10 }}>🔒 {mt('Login details are hidden on the phone — open this note on the website to view them.')}</div>}
      </Sheet>
    )}
  </>);
}

export default function Directory({ kind }) {
  return kind === 'staff' ? <StaffList /> : kind === 'contacts' ? <ContactList /> : <NotesList />;
}
