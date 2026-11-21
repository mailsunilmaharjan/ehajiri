import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import { adToBS, BS_MONTHS_EN, BS_MONTHS_NP, toNepaliDigits } from '../utils/dateUtils.js';
import { isHolidayForEmployee } from '../utils/holidayScope.js';
import { Empty, Sheet, useMT } from './kit.jsx';
import { DateField } from './fields.jsx';
import { monthRange } from './hooks.js';
import { useIsAdmin } from './MobileAdmin.jsx';

/* Public Holidays on the phone.
   Everyone : the holidays of one month (this month first, ‹ › for the previous / next month) — staff see the ones that apply to them.
   Admin / Super Admin only (the same people the website lets edit Settings → Public Holiday): add, edit and delete. */
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY = { name: '', startDate: '', endDate: '', days: 0, gender: ['All'], branch: ['All'], department: ['All'], religion: ['All'], handicapped: ['All'], isFixedEveryYear: false };
const d10 = (v) => String(v || '').slice(0, 10);
const span = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000) + 1) : 0);
const scoped = (h) => ['gender', 'branch', 'department', 'religion', 'handicapped'].some(k => (h[k] || []).length && !(h[k] || []).includes('All'));

export default function MobileHolidays() {
  const mt = useMT(); const fd = useDateFormat();
  const { currentUser } = useAuth();
  const { settings, updateSetupList } = useSettings();
  const { language } = useLanguage();
  const isAdmin = useIsAdmin();
  const cal = settings.defaultCalendar === 'np' ? 'np' : 'en';
  const [off, setOff] = useState(0);
  const [form, setForm] = useState(null);      // null | { id?, ...fields }
  const [errs, setErrs] = useState({}); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const mr = monthRange(off, cal);
  const label = cal === 'np'
    ? `${(language === 'np' ? BS_MONTHS_NP : BS_MONTHS_EN)[mr.bs.month - 1]} ${language === 'np' ? toNepaliDigits(mr.bs.year) : mr.bs.year}`
    : `${EN_MONTHS[mr.ad.month]} ${mr.ad.year}`;

  const all = settings.publicHolidays || [];
  const list = useMemo(() => all
    .filter(h => h.startDate && d10(h.startDate) <= mr.end && d10(h.endDate || h.startDate) >= mr.start)
    .filter(h => isAdmin || isHolidayForEmployee({ ...settings, publicHolidays: [h] }, d10(h.startDate), currentUser))
    .sort((a, b) => d10(a.startDate).localeCompare(d10(b.startDate))), [all, mr.start, mr.end, isAdmin, settings, currentUser]);

  const set = (k, v) => setForm(p => {
    const n = { ...p, [k]: v };
    if (k === 'startDate' && v && (!p.endDate || p.endDate < v)) n.endDate = v;
    n.days = span(n.startDate, n.endDate);
    return n;
  });
  const save = async () => {
    const e = {};
    if (!String(form.name || '').trim()) e.name = mt('Required');
    if (!form.startDate) e.startDate = mt('Required');
    if (!form.endDate) e.endDate = mt('Required');
    if (form.startDate && form.endDate && form.endDate < form.startDate) e.endDate = mt('End must be after start');
    const clash = form.startDate && all.find(h => h.id !== form.id && d10(h.startDate) === form.startDate);
    if (clash) e.startDate = `${mt('Already a holiday on this date')}: ${clash.name}`;
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true); setMsg('');
    try {
      const item = { ...EMPTY, ...form, name: form.name.trim(), days: span(form.startDate, form.endDate) };
      await updateSetupList('publicHolidays', (cur) => {
        const list = cur || [];
        return form.id ? list.map(h => (h.id === form.id ? { ...h, ...item } : h)) : [...list, { ...item, id: Date.now() }];
      });
      setForm(null); setMsg(mt(form.id ? 'Holiday updated' : 'Holiday added'));
    } catch (x) { setErrs({ name: x?.message || mt('Failed') }); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!window.confirm(mt('Delete this public holiday?'))) return;
    setBusy(true);
    try { await updateSetupList('publicHolidays', (cur) => (cur || []).filter(h => h.id !== form.id)); setForm(null); setMsg(mt('Holiday deleted')); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      <div className="m-row" style={{ marginBottom: 8, gap: 8 }}>
        <button className="m-btn m-ghost" style={{ width: 44, padding: 0 }} onClick={() => setOff(o => o - 1)} aria-label="Previous month">‹</button>
        <b className="m-grow" style={{ textAlign: 'center', fontSize: 16 }}>{label}</b>
        <button className="m-btn m-ghost" style={{ width: 44, padding: 0 }} onClick={() => setOff(o => o + 1)} aria-label="Next month">›</button>
      </div>
      {off !== 0 && <button className="m-btn m-ghost m-block" style={{ marginBottom: 8 }} onClick={() => setOff(0)}>{mt('This month')}</button>}
      {isAdmin && <button className="m-btn m-block" style={{ marginBottom: 10 }} onClick={() => { setErrs({}); setMsg(''); setForm({ ...EMPTY, startDate: mr.start, endDate: mr.start, days: 1 }); }}>＋ {mt('Add public holiday')}</button>}
      {msg && <div className="m-okbox" style={{ marginBottom: 8 }}>✅ {msg}</div>}
      {list.length === 0 && <Empty icon="🎉" text={mt('No public holiday this month')} />}
      {list.map((h, i) => {
        const s = d10(h.startDate), e = d10(h.endDate || h.startDate); const days = span(s, e);
        const wd = WD[new Date(s + 'T00:00:00').getDay()];
        const Tag = isAdmin ? 'button' : 'div';
        return (
          <Tag key={h.id ?? i} className={`m-roster m-z${i % 2}`} onClick={isAdmin ? () => { setErrs({}); setMsg(''); setForm({ ...EMPTY, ...h, startDate: s, endDate: e }); } : undefined}
            style={{ background: '#fef3c7', borderLeft: '5px solid #d97706', ...(isAdmin ? { width: '100%', textAlign: 'left', border: 0, borderLeft: '5px solid #d97706', font: 'inherit', display: 'block' } : {}) }}>
            <div className="m-row"><b className="m-grow">🎉 {h.name}</b><span className="m-chip" style={{ background: '#fde68a', color: '#92400e' }}>{days} {mt(days === 1 ? 'day' : 'days')}</span></div>
            <div className="m-muted" style={{ marginTop: 2 }}>{s === e ? `${fd(s)} · ${wd}` : `${fd(s)} → ${fd(e)}`}</div>
            {isAdmin && (h.isFixedEveryYear || scoped(h)) && (
              <div className="m-jsub">{h.isFixedEveryYear ? `🔁 ${mt('Every year')}` : ''}{h.isFixedEveryYear && scoped(h) ? ' · ' : ''}{scoped(h) ? mt('For selected staff only') : ''}</div>
            )}
          </Tag>
        );
      })}

      {form && (
        <Sheet title={`🎉 ${mt(form.id ? 'Edit public holiday' : 'Add public holiday')}`} onClose={() => !busy && setForm(null)}
          footer={<><button className="m-btn m-ghost" disabled={busy} onClick={() => setForm(null)}>{mt('Cancel')}</button>
            <button className="m-btn" disabled={busy} onClick={save}>{busy ? '…' : mt('Save')}</button></>}>
          <div className="m-field"><label>{mt('Holiday name')} <span style={{ color: '#dc2626' }}>*</span></label>
            <input className={`m-input${errs.name ? ' err' : ''}`} value={form.name} onChange={e => set('name', e.target.value)} placeholder={mt('e.g. Dashain')} />
            {errs.name && <div className="m-ferr">{errs.name}</div>}</div>
          <div className="m-row" style={{ gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}><DateField label={mt('Starts')} value={form.startDate} onChange={v => set('startDate', v)} required error={errs.startDate} /></div>
            <div style={{ flex: 1, minWidth: 0 }}><DateField label={mt('Ends')} value={form.endDate} min={form.startDate} onChange={v => set('endDate', v)} required error={errs.endDate} /></div>
          </div>
          <div className="m-jsub" style={{ marginBottom: 8 }}>{form.days || 0} {mt(form.days === 1 ? 'day' : 'days')}</div>
          <label className="m-check" style={{ padding: '6px 2px' }}>
            <input type="checkbox" checked={!!form.isFixedEveryYear} onChange={e => set('isFixedEveryYear', e.target.checked)} />
            <span>{mt('Same date every year')}</span>
          </label>
          <div className="m-jsub">{mt('Applies to all staff. Use Settings on the website to limit it to a gender, branch or department.')}</div>
          {form.id && <button className="m-btn m-block m-warn" style={{ marginTop: 12 }} disabled={busy} onClick={del}>🗑️ {mt('Delete')}</button>}
        </Sheet>
      )}
    </div>
  );
}
