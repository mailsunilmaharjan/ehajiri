import React, { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import EnglishDatePicker from '../Common/EnglishDatePicker.jsx';
import { formatNepalTime, getNepalTodayISO, toNepalISO } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, downloadBlob } from '../../utils/printHelper.js';
import { CHECKOUT_STATUS_LABEL } from './FieldVisitJourneyPanel.jsx';

/**
 * Field Visit Trip Log — one complete log of every trip in a date range:
 * Office Out -> each client (Check In | Check Out | Task Status | Remarks,
 * time stayed, travel time + estimated km to get there) -> Office In
 * (return travel + total trip time). Read-only; Print and Excel export.
 * Data: GET /field-visit/report (scoped server-side by role).
 */
const dur = (mins) => {
  if (mins == null || !Number.isFinite(mins)) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};
const minsBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null);
const kmText = (km) => (km != null ? `${Number(km).toFixed(1)} km` : '—');
const travelText = (min, km, est) => {
  if (min == null && km == null) return '—';
  return `${dur(min)}${km != null ? ` · ${kmText(km)}` : ''}${est != null ? ` (est. ${dur(est)})` : ''}`;
};

const TH = { padding: '7px 8px', background: '#efefef', color: '#374151', fontSize: 12, fontWeight: 700,
  borderBottom: '2px solid #dedede', borderRight: '1px solid #dedede', textAlign: 'left', whiteSpace: 'nowrap' };
const TD = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid #eef0f3', verticalAlign: 'top' };

const FieldVisitTripLog = ({ onClose }) => {
  const { currentUser, isAdmin, isSuperAdmin, isBranchManager, isDeptHead } = useAuth();
  const { employees } = useData();
  const { settings } = useSettings();
  const { language } = useLanguage();
  const fd = useDateFormat();
  const canPickAnyone = isAdmin || isSuperAdmin || isBranchManager || isDeptHead;
  const Picker = settings.defaultCalendar === 'np' ? NepaliDatePicker : EnglishDatePicker;

  const [from, setFrom] = useState(getNepalTodayISO());
  const [to,   setTo]   = useState(getNepalTodayISO());
  const [employeeId, setEmployeeId] = useState('');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (!from || !to) return;
    let alive = true;
    setLoading(true); setError('');
    api.get(`/field-visit/report?startDate=${from}&endDate=${to}${employeeId ? `&employeeId=${employeeId}` : ''}`)
      .then(r => { if (alive) setData(r); })
      .catch(e => { if (alive) { setError(e.message || 'Failed to load'); setData(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [from, to, employeeId]);

  // Flatten into display rows (shared by the screen, print and Excel).
  const { rows, totals } = useMemo(() => {
    const out = [];
    let sn = 0, km = 0, travel = 0, stay = 0, trips = 0;
    (data?.sessions || []).forEach(sess => {
      trips += 1;
      const date = fd(toNepalISO(sess.officeOutAt));
      out.push({ kind: 'trip', staff: sess.employeeName, date, visit: `Office Out · ${sess.officeOutPlace || '—'}`,
        checkIn: formatNepalTime(sess.officeOutAt), checkOut: '', stayed: '', travel: '', status: '', remarks: '' });
      sess.stops.forEach(s => {
        sn += 1;
        const stayMin = minsBetween(s.checkInAt, s.checkOutAt);
        if (s.travelKm != null) km += Number(s.travelKm);
        if (s.travelMinutes != null) travel += s.travelMinutes;
        if (stayMin != null) stay += stayMin;
        out.push({ kind: 'stop', sn, staff: sess.employeeName, date,
          visit: `${s.checkInClientName || s.customerName || s.taskTitle || '—'}${s.taskTitle && (s.checkInClientName || s.customerName) ? ` — ${s.taskTitle}` : ''}`,
          checkIn: s.checkInAt ? `${formatNepalTime(s.checkInAt)}${s.checkInPlace ? ` · ${s.checkInPlace}` : ''}` : '—',
          checkOut: s.checkOutAt ? `${formatNepalTime(s.checkOutAt)}${s.checkOutPlace ? ` · ${s.checkOutPlace}` : ''}` : '—',
          stayed: stayMin != null ? dur(stayMin) : '—',
          travel: travelText(s.travelMinutes, s.travelKm, s.estimatedMinutes),
          status: s.checkOutWorkProgress ? (CHECKOUT_STATUS_LABEL[s.checkOutWorkProgress] || s.checkOutWorkProgress) : (s.checkInAt ? 'In progress' : 'Not started'),
          remarks: [s.checkInRemarks, s.checkOutRemarks].filter(Boolean).join(' | ') });
      });
      if (sess.officeInAt) {
        if (sess.travelKm != null) km += Number(sess.travelKm);
        if (sess.travelMinutes != null) travel += sess.travelMinutes;
        out.push({ kind: 'office', staff: sess.employeeName, date, visit: `Back at Office · ${sess.officeInPlace || '—'}`,
          checkIn: formatNepalTime(sess.officeInAt), checkOut: '',
          stayed: `Total trip ${dur(minsBetween(sess.officeOutAt, sess.officeInAt))}`,
          travel: travelText(sess.travelMinutes, sess.travelKm, sess.estimatedMinutes), status: '', remarks: '' });
      } else {
        out.push({ kind: 'office', staff: sess.employeeName, date, visit: 'Not yet back at Office (trip open)',
          checkIn: '', checkOut: '', stayed: '', travel: '', status: '', remarks: '' });
      }
    });
    return { rows: out, totals: { trips, stops: sn, km, travel, stay } };
  }, [data, fd]);

  const HEAD = ['SN', 'Staff', 'Date', 'Visit / Location', 'Check In', 'Check Out', 'Stayed / Trip', 'Travel (time · est. km)', 'Task Status', 'Remarks'];
  const cells = (r) => [r.sn ?? '', r.staff, r.date, r.visit, r.checkIn, r.checkOut, r.stayed, r.travel, r.status, r.remarks];
  const summaryText = `Trips: ${totals.trips} · Visits: ${totals.stops} · Total travel: ${dur(totals.travel)} · Est. distance: ${totals.km.toFixed(1)} km · Time at clients: ${dur(totals.stay)}`;
  const periodText = `${fd(from)} → ${fd(to)}`;

  const doPrint = () => {
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const body = rows.map(r => `<tr style="${r.kind === 'trip' ? 'background:#f1f5f9;font-weight:700' : r.kind === 'office' ? 'background:#f9fafb;font-weight:600' : ''}">${
      cells(r).map(c => `<td style="padding:3px 5px;border:1px solid #dedede;font-size:9px;vertical-align:top">${esc(c)}</td>`).join('')}</tr>`).join('');
    const html = `<table style="width:100%;border-collapse:collapse"><thead><tr>${HEAD.map(h =>
      `<th style="padding:4px 5px;border:1px solid #dedede;background:#efefef;color:#374151;font-size:9px;text-align:left">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
      <p style="font-size:10px;margin-top:8px"><b>${esc(summaryText)}</b></p>`;
    openPrintWindow(buildPrintDoc({ settings, language, reportTitle: 'Field Visit Trip Log', reportSub: periodText, contentHtml: html, isLandscape: true }), true);
  };

  const doExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Trip Log');
    ws.addRow(['Field Visit Trip Log']).font = { bold: true, size: 14 };
    ws.addRow([periodText]);
    ws.addRow([summaryText]);
    ws.addRow([]);
    const h = ws.addRow(HEAD);
    h.font = { bold: true, color: { argb: 'FF374151' } };
    h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; c.border = { bottom: { style: 'medium', color: { argb: 'FFDEDEDE' } } }; });
    rows.forEach(r => {
      const row = ws.addRow(cells(r));
      if (r.kind !== 'stop') row.font = { bold: true };
      if (r.kind === 'trip') row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; });
    });
    [5, 22, 13, 40, 30, 30, 18, 28, 16, 40].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    downloadBlob(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `FieldVisitTripLog_${from}_${to}.xlsx`);
  };

  const sel = { height: 34, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13, background: '#fff' };
  const btn = { height: 34, padding: '0 14px', borderRadius: 7, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

  return (
    <div className="modal-overlay" style={{ zIndex: 2000 }} onClick={onClose}>
      <div className="modal" style={{ maxWidth: 1600, width: '97vw', height: '92vh', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📋 Field Visit Trip Log</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>From</label>
            <div style={{ width: 150 }}><Picker value={from} onChange={setFrom} maxDate={to || undefined} /></div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>To</label>
            <div style={{ width: 150 }}><Picker value={to} onChange={setTo} minDate={from || undefined} /></div>
            {canPickAnyone && (
              <>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Staff</label>
                <select style={{ ...sel, minWidth: 190 }} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                  <option value="">All Staff</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                </select>
              </>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button style={btn} onClick={doPrint} disabled={!rows.length}>🖨️ Print</button>
              <button style={btn} onClick={doExcel} disabled={!rows.length}>📥 Excel</button>
            </div>
          </div>

          {loading ? <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>
            : error ? <div style={{ padding: 20, color: '#b91c1c' }}>{error}</div>
            : !rows.length ? <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af' }}>No field visit trips in this period.</div>
            : (
              <>
                <div style={{ background: '#f1f5f9', borderTop: '2px solid #d1d5db', padding: '7px 10px', fontSize: 12.5, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                  {summaryText}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
                    <thead><tr>{HEAD.map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} style={{ background: r.kind === 'trip' ? '#f1f5f9' : r.kind === 'office' ? '#f9fafb' : '#fff', fontWeight: r.kind === 'stop' ? 400 : 700 }}>
                          {cells(r).map((c, j) => <td key={j} style={{ ...TD, whiteSpace: j === 9 ? 'pre-wrap' : 'normal' }}>{c}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  );
};

export default FieldVisitTripLog;
