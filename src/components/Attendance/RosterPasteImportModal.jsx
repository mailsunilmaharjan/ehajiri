import React, { useState, useMemo } from 'react';
import api from '../../api/client.js';
import { adToBS, bsToAD, getBSDays } from '../../utils/dateUtils.js';
import { adToISO } from '../Common/NepaliDatePicker.jsx';

/**
 * Duty Roster (Department Wise) — Bulk Import by copy-paste.
 *
 * Pick Branch / Department / Month, then paste a month-wise roster copied from Excel:
 *
 *   Person            | Thu | Fri | Sat     ...   (weekday row — ignored)
 *                     |  1  |  2  |  3      ...   (day-number row — required)
 *   Gyanu Paneru [1]  | 09:00 - 18:00 | 09:00 - 18:00 | Weekend ...
 *
 * - Person: "Name [StaffID]" — matched by the ID in [ ] (Staff ID or Device ID), else by name.
 * - Cell:   "HH:MM - HH:MM" → the shift with that start/end time; "Weekend"/"Off" → weekly off;
 *           a shift name/code also works; blank / "-" → left unchanged.
 * Saved through the same POST /duty-roster/bulk-days the grid's own Save uses (one call per
 * staff per distinct shift), so scope checks, notifications and conflict handling are identical.
 */

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const hhmm = (t) => String(t || '').slice(0, 5).replace(/^(\d):/, '0$1:');
const TIME_RE = /(\d{1,2})[:.](\d{2})\s*(?:-|–|—|to)\s*(\d{1,2})[:.](\d{2})/i;
const OFF_WORDS = new Set(['weekend', 'off', 'weekly off', 'w/o', 'wo', 'holiday', 'बिदा', 'सार्वजनिक बिदा']);
const SKIP_WORDS = new Set(['', '-', '—', '–', 'n/a']);

function parsePaste(text) {
  const rows = String(text || '').replace(/\r/g, '').split('\n').map(l => l.split('\t').map(c => c.trim()));
  // header row = first row whose later cells start at 1 and count up
  let hIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const nums = rows[i].map(c => (/^\d{1,2}$/.test(c) ? Number(c) : null));
    const firstDay = nums.findIndex(n => n === 1);
    if (firstDay >= 0 && nums[firstDay + 1] === 2) { hIdx = i; break; }
  }
  if (hIdx < 0) return { error: 'Could not find the day-number row (1, 2, 3 …). Copy the sheet including that row.' };
  const hdr = rows[hIdx];
  const dayCols = [];
  hdr.forEach((c, j) => { if (/^\d{1,2}$/.test(c)) dayCols.push({ col: j, day: Number(c) }); });
  const people = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const label = r[Math.max(0, dayCols[0].col - 1)] || r[0];
    if (!label) continue;
    const m = label.match(/^(.*?)\s*\[\s*([^\]]+?)\s*\]\s*$/);
    people.push({
      raw: label,
      name: (m ? m[1] : label).trim(),
      idKey: m ? m[2].trim() : '',
      cells: dayCols.map(({ col, day }) => ({ day, text: r[col] ?? '' })),
    });
  }
  return { people, dayCount: dayCols.length };
}

export default function RosterPasteImportModal({
  employees, shifts, useNP, months, fiscalYears = [], defaultFyId, defaultMonth, branches, departments, currentUser, onClose, onDone,
}) {
  const [branch, setBranch] = useState('');
  const [dept,   setDept]   = useState('');
  const [fyId,   setFyId]   = useState(defaultFyId ?? fiscalYears[0]?.id ?? null);
  const [month,  setMonth]  = useState(defaultMonth);
  const [text,   setText]   = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [result, setResult] = useState('');

  // Year follows the Fiscal Year + Month (a fiscal year straddles two calendar years)
  const fy = fiscalYears.find(f => f.id === fyId);
  const calOf = (d) => {
    if (!d) return null;
    if (useNP) return adToBS(new Date(String(d).slice(0, 10) + 'T00:00:00'));
    const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
    return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate() };
  };
  const fyStart = fy ? calOf(fy.startDate) : null;
  const fyEnd   = fy ? calOf(fy.endDate) : null;
  const year = fyStart ? ((fyEnd && month < fyStart.month) ? fyEnd.year : fyStart.year) : new Date().getFullYear();
  const monthDays = useNP ? getBSDays(year, month) : new Date(year, month, 0).getDate();
  const dateOf = (d) => {
    const ad = useNP ? bsToAD(year, month, d) : new Date(year, month - 1, d);
    return ad && !isNaN(ad) ? adToISO(ad) : null;
  };

  const pool = useMemo(() => employees.filter(e =>
    (!branch || e.branch === branch) && (!dept || e.department === dept)), [employees, branch, dept]);

  const shiftMaps = useMemo(() => {
    const byTime = new Map(), byName = new Map();
    for (const s of shifts) {
      if (s.active === false) continue;
      if (s.startTime && s.endTime) {
        const k = `${hhmm(s.startTime)}-${hhmm(s.endTime)}`;
        if (!byTime.has(k)) byTime.set(k, s);
      }
      for (const n of [s.name, s.nameEn, s.code, s.rosterShortName]) if (n && !byName.has(norm(n))) byName.set(norm(n), s);
    }
    return { byTime, byName };
  }, [shifts]);

  const resolveCell = (raw) => {
    const t = norm(raw);
    if (SKIP_WORDS.has(t)) return { skip: true };
    if (OFF_WORDS.has(t)) return { value: ['OFF'] };
    const tm = String(raw).match(TIME_RE);
    if (tm) {
      const k = `${tm[1].padStart(2, '0')}:${tm[2]}-${tm[3].padStart(2, '0')}:${tm[4]}`;
      const s = shiftMaps.byTime.get(k);
      if (s) return { value: [String(s.id)] };
      return { bad: String(raw).trim() };
    }
    const s = shiftMaps.byName.get(t);
    return s ? { value: [String(s.id)] } : { bad: String(raw).trim() };
  };

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    const parsed = parsePaste(text);
    if (parsed.error) return { error: parsed.error };
    const byId = new Map(), byName = new Map();
    for (const e of pool) {
      if (e.employeeId != null) byId.set(norm(e.employeeId), e);
      if (e.deviceId != null && !byId.has(norm(e.deviceId))) byId.set(norm(e.deviceId), e);
      byName.set(norm(e.full_name || e.fullName), e);
    }
    const matched = [], unmatched = [], badCells = new Map();
    let outOfMonth = 0;
    for (const p of parsed.people) {
      const emp = (p.idKey && byId.get(norm(p.idKey))) || byName.get(norm(p.name));
      if (!emp) { unmatched.push(p.raw); continue; }
      const groups = new Map(); // shiftIds key → { shiftIds, dates[] }
      for (const c of p.cells) {
        if (c.day > monthDays) { outOfMonth++; continue; }
        const r = resolveCell(c.text);
        if (r.skip) continue;
        if (r.bad) { badCells.set(r.bad, (badCells.get(r.bad) || 0) + 1); continue; }
        const date = dateOf(c.day);
        if (!date) continue;
        const key = r.value.join(',');
        if (!groups.has(key)) groups.set(key, { shiftIds: r.value, dates: [] });
        groups.get(key).dates.push(date);
      }
      const days = [...groups.values()].reduce((a, g) => a + g.dates.length, 0);
      if (days) matched.push({ emp, groups: [...groups.values()], days });
    }
    return { matched, unmatched, badCells: [...badCells.entries()], outOfMonth };
  }, [text, pool, shiftMaps, year, month, monthDays, useNP]);

  const totalDays = preview?.matched?.reduce((a, m) => a + m.days, 0) || 0;

  const save = async () => {
    if (!preview?.matched?.length) return;
    setSaving(true); setError(''); setResult('');
    try {
      const createdBy = currentUser?.fullName || currentUser?.username || 'Admin';
      const calls = preview.matched.flatMap(m => m.groups.map(g => ({
        employeeId: m.emp.id, dates: g.dates, shiftIds: g.shiftIds, createdBy,
      })));
      for (let i = 0; i < calls.length; i += 5) {
        await Promise.all(calls.slice(i, i + 5).map(c => api.post('/duty-roster/bulk-days', c)));
      }
      setResult(`Imported ${totalDays} day(s) for ${preview.matched.length} staff.`);
      await onDone?.(`Roster imported: ${totalDays} day(s) for ${preview.matched.length} staff.`);
    } catch (e) {
      setError(e.message || 'Import failed.');
    } finally { setSaving(false); }
  };

  const sel = { height: 34, border: '1.5px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13, background: '#fff', minWidth: 120 };
  const lbl = { fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 4 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: 'min(860px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Bulk Import — Paste Month Roster</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div><div style={lbl}>Branch</div>
              <select style={sel} value={branch} onChange={e => setBranch(e.target.value)}>
                <option value="">All Branches</option>{branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select></div>
            <div><div style={lbl}>Department</div>
              <select style={sel} value={dept} onChange={e => setDept(e.target.value)}>
                <option value="">All Departments</option>{departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select></div>
            <div><div style={lbl}>Fiscal Year</div>
              <select style={sel} value={fyId ?? ''} onChange={e => setFyId(e.target.value ? Number(e.target.value) : null)}>
                {fiscalYears.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select></div>
            <div><div style={lbl}>Month</div>
              <select style={sel} value={month} onChange={e => setMonth(Number(e.target.value))}>
                {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select></div>
            <div style={{ alignSelf: 'flex-end', fontSize: 12, color: '#6b7280' }}>{pool.length} staff in scope · {months[month - 1]} {year} · {monthDays} days</div>
          </div>

          <div>
            <div style={lbl}>Paste from Excel (include the row with day numbers 1, 2, 3 …)</div>
            <textarea value={text} onChange={e => { setText(e.target.value); setResult(''); }} spellCheck={false}
              placeholder={'Person\tThu\tFri\tSat\n\t1\t2\t3\nGyanu Paneru [1]\t09:00 - 18:00\t09:00 - 18:00\tWeekend'}
              style={{ width: '100%', minHeight: 150, border: '1.5px solid #d1d5db', borderRadius: 8, padding: 8, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre', overflow: 'auto', boxSizing: 'border-box' }} />
          </div>

          {preview?.error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{preview.error}</div>}
          {preview && !preview.error && (
            <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: '#065f46', fontWeight: 600 }}>
                ✔ {preview.matched.length} staff matched · {totalDays} day(s) will be saved
              </div>
              {preview.unmatched.length > 0 && (
                <div style={{ color: '#b45309' }}>
                  ⚠ {preview.unmatched.length} not matched in the selected Branch/Department (skipped): {preview.unmatched.slice(0, 12).join(', ')}{preview.unmatched.length > 12 ? ' …' : ''}
                </div>
              )}
              {preview.badCells.length > 0 && (
                <div style={{ color: '#b45309' }}>
                  ⚠ No matching shift for: {preview.badCells.slice(0, 10).map(([k, n]) => `"${k}" ×${n}`).join(', ')} — create that shift first (Settings → Shift); those cells are skipped.
                </div>
              )}
              {preview.outOfMonth > 0 && <div style={{ color: '#6b7280' }}>{preview.outOfMonth} cell(s) beyond the month's last day were ignored.</div>}
            </div>
          )}
          {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
          {result && <div style={{ color: '#065f46', fontSize: 13, fontWeight: 600 }}>{result}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ height: 36, padding: '0 16px', border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            {result ? 'Close' : 'Cancel'}
          </button>
          <button onClick={save} disabled={saving || !totalDays}
            style={{ height: 36, padding: '0 18px', border: 'none', borderRadius: 8, fontWeight: 700, color: '#fff',
              background: saving || !totalDays ? '#9ca3af' : '#1a56db', cursor: saving || !totalDays ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Importing…' : `Import ${totalDays || ''} day(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
