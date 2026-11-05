import React, { useState, useRef, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import api from '../../api/client.js';
import { useData } from '../../context/DataContext.jsx';
import { bsToAD, getBSDays } from '../../utils/dateUtils.js';

/* Super Admin only — see server/routes/visits.js POST /import, which enforces
   the same restriction server-side (requireRole('superAdmin')), not just
   here. Two ways in, both landing in the same preview/validate/import
   pipeline:
     - Upload: an Excel/CSV file, Staff-ID-keyed — mirrors
       src/components/Users/ImportExcelModal.jsx's staff-import flow.
     - Paste: tab-separated rows copied straight out of a legacy system's
       on-screen grid (the real use case this was built for) — no Staff ID
       column there, just person/approver/recommender NAMES and Bikram
       Sambat dates (e.g. 2083/01/13), so this path resolves names against
       the live staff list and converts BS → AD before anything reaches the
       API, exactly like NepaliDatePicker already does for manual entry. */

const COLUMNS = [
  { key: 'employeeId',    label: 'Staff ID',      required: true },
  { key: 'purpose',       label: 'Purpose',       required: true, note: 'What the visit was for (e.g. Kaj, Training, Seminar)' },
  { key: 'fromDate',      label: 'From Date',     required: true, note: 'YYYY-MM-DD' },
  { key: 'toDate',        label: 'To Date',       required: true, note: 'YYYY-MM-DD' },
  { key: 'location',      label: 'Location',      required: false },
  { key: 'approvedBy',    label: 'Approved By',   required: false, note: 'Staff ID of who historically approved it — defaults to you if blank' },
  { key: 'recommendedBy', label: 'Recommended By',required: false, note: 'Staff ID of who historically recommended it' },
  { key: 'visitType',     label: 'Visit Type',    required: false, note: 'National / International (defaults to National)' },
  { key: 'country',       label: 'Country',       required: false, note: 'Only used when Visit Type is International' },
  { key: 'description',   label: 'Description',   required: false },
  { key: 'status',        label: 'Status',        required: false, note: 'approved / pending / rejected (defaults to approved — for past records)' },
];

const HEADER_MAP = {
  'staff id':'employeeId','staff_id':'employeeId','employee id':'employeeId','employee_id':'employeeId','empid':'employeeId','id':'employeeId',
  'purpose':'purpose','official visit':'purpose','visit purpose':'purpose','reason':'purpose','kaj':'purpose',
  'visit type':'visitType','visit_type':'visitType','type':'visitType',
  'country':'country',
  'location':'location','address':'location','destination':'location',
  'from date':'fromDate','from_date':'fromDate','start date':'fromDate','fromdate':'fromDate',
  'to date':'toDate','to_date':'toDate','end date':'toDate','todate':'toDate',
  'description':'description','remarks':'description','note':'description','notes':'description',
  'approved by':'approvedBy','approved_by':'approvedBy','approvedby':'approvedBy',
  'recommended by':'recommendedBy','recommended_by':'recommendedBy','recommendedby':'recommendedBy',
  'status':'status',
};

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/* Excel serial dates and JS Date objects (from cellDates:true) both need to
   become plain YYYY-MM-DD strings — office_visits.from_date/to_date are DATE
   columns and the API expects that shape, same as every other date field in
   this app. Upload-mode dates are always treated as AD (matches the staff
   importer's template, which never asks for BS). */
function toISODate(val) {
  if (val instanceof Date && !isNaN(val)) {
    const tzOffset = val.getTimezoneOffset() * 60000;
    return new Date(val.getTime() - tzOffset).toISOString().slice(0, 10);
  }
  const s = String(val ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? s : d.toISOString().slice(0, 10);
}

function parseSheet(ws) {
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!json.length) return [];

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = (raw[0] || []).map(normalizeHeader);

  return json.map((rowRaw, ri) => {
    const row = {};
    headers.forEach((h, i) => {
      const key = HEADER_MAP[h];
      if (key) row[key] = raw[ri + 1]?.[i] ?? '';
    });
    Object.entries(rowRaw).forEach(([h, v]) => {
      const norm = normalizeHeader(h);
      const key = HEADER_MAP[norm];
      if (key && row[key] === undefined) row[key] = v;
    });
    if (row.fromDate) row.fromDate = toISODate(row.fromDate);
    if (row.toDate)   row.toDate   = toISODate(row.toDate);
    return row;
  });
}

function downloadTemplate() {
  const headers = COLUMNS.map(c => c.label);
  const sample1 = ['5000', 'Kaj', '2025-01-15', '2025-01-15', 'Kathmandu', '', '', 'National', '', '', 'approved'];
  const sample2 = ['34',   'Training', '2025-02-01', '2025-02-05', 'Pokhara', '5000', '', 'National', '', '', 'approved'];

  const ws = XLSX.utils.aoa_to_sheet([headers, sample1, sample2]);
  ws['!cols'] = headers.map(() => ({ wch: 16 }));
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1A56DB' } },
        alignment: { horizontal: 'center' },
      };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Office Visit Template');
  XLSX.writeFile(wb, 'office_visit_import_template.xlsx');
}

/* ── Paste mode: BS/AD date parsing + name resolution ── */

const NP_DIGITS = '०१२३४५६७८९';
function normalizeDigits(s) {
  return String(s ?? '').replace(/[०-९]/g, d => String(NP_DIGITS.indexOf(d)));
}

function bsSlashToISO(raw) {
  const s = normalizeDigits(raw).trim();
  const m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12) return '';
  // Validate the day against this exact BS month's real length before ever
  // calling bsToAD — a garbage/out-of-range day (e.g. a stray 45 from a
  // paste mishap) makes bsToAD's forward-search loop spin forever looking
  // for a (year,month,day) triple that will never exist, hanging the tab.
  if (d < 1 || d > getBSDays(y, mo)) return '';
  const ad = bsToAD(y, mo, d);
  if (!ad || isNaN(ad)) return '';
  return `${ad.getFullYear()}-${String(ad.getMonth() + 1).padStart(2, '0')}-${String(ad.getDate()).padStart(2, '0')}`;
}

function adSlashToISO(raw) {
  const s = normalizeDigits(raw).trim();
  const m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!m) return '';
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isNaN(new Date(iso)) ? '' : iso;
}

/* Fixed column order matching the legacy grid this was built for: व्यक्ति,
   मिति बाट, मिति सम्म, दिनहरु (ignored — derivable from the two dates),
   काज, स्वीकृत गर्ने, स्वीकृत मिति, सिफारिस गर्ने, सिफारिस मिति, स्थान. */
function looksLikeHeaderRow(cells) {
  return /व्यक्ति|^staff$|^name$|^person$/i.test(String(cells[0] || '').trim());
}

function parsePasteRows(text, employees, calendar) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (!lines.length) return [];
  const dataLines = looksLikeHeaderRow(lines[0].split('\t')) ? lines.slice(1) : lines;
  const toISO = calendar === 'bs' ? bsSlashToISO : adSlashToISO;

  const findPerson = (name) => {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return { status: 'empty', match: null };
    const matches = employees.filter(e => String(e.fullName || '').trim().toLowerCase() === n);
    if (matches.length === 1) return { status: 'ok', match: matches[0] };
    if (matches.length > 1)   return { status: 'ambiguous', match: null };
    return { status: 'notfound', match: null };
  };

  return dataLines.map(line => {
    const c = line.split('\t').map(x => x.trim());
    const personName        = c[0] || '';
    const approvedByName    = c[5] || '';
    const recommendedByName = c[7] || '';
    const person     = findPerson(personName);
    const approver    = approvedByName    ? findPerson(approvedByName)    : { status: 'empty', match: null };
    const recommender = recommendedByName ? findPerson(recommendedByName) : { status: 'empty', match: null };

    return {
      employeeId:    person.match?.employeeId || '',
      purpose:       c[4] || '',
      visitType:     'National',
      country:       '',
      location:      c[9] || '',
      fromDate:      toISO(c[1]),
      toDate:        toISO(c[2]),
      description:   '',
      status:        'approved',
      approvedBy:    approver.match?.employeeId || '',
      approvedDate:  toISO(c[6]) || undefined,
      recommendedBy: recommender.match?.employeeId || '',
      recommendedDate: toISO(c[8]) || undefined,
      _personName: personName,           _personStatus: person.status,
      _approvedByName: approvedByName,    _approvedByStatus: approver.status,
      _recommendedByName: recommendedByName, _recommendedByStatus: recommender.status,
    };
  });
}

const NameCell = ({ id, name, status }) => {
  if (!name) return id || <span style={{ color: '#d1d5db' }}>—</span>;
  if (status === 'ok')
    return <span>{name} <span style={{ color: '#059669', fontWeight: 700 }}>✓{id}</span></span>;
  if (status === 'ambiguous')
    return <span style={{ color: '#b45309' }}>{name} ⚠ multiple matches</span>;
  return <span style={{ color: '#dc2626' }}>{name} ✗ not found</span>;
};

export default function OfficeVisitImportModal({ onClose, onImported }) {
  const { employees } = useData();
  const [mode, setMode]         = useState('paste'); // paste | file
  const [step, setStep]         = useState('upload'); // upload | preview | result
  const [rows, setRows]         = useState([]);
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [parseError, setParseError] = useState('');
  const [pasteText, setPasteText]   = useState('');
  const [pasteCalendar, setPasteCalendar] = useState('bs');
  const fileRef = useRef(null);

  const pastePreviewCount = useMemo(
    () => pasteText.split('\n').filter(l => l.trim()).length,
    [pasteText]
  );

  const handleFile = useCallback(file => {
    if (!file) return;
    setParseError('');
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setParseError('Only .xlsx, .xls, or .csv files are supported.');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const parsed = parseSheet(ws);
        if (!parsed.length) { setParseError('No data rows found in the file.'); return; }
        setRows(parsed);
        setStep('preview');
      } catch (err) {
        setParseError('Failed to parse file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const handlePastePreview = () => {
    setParseError('');
    const parsed = parsePasteRows(pasteText, employees || [], pasteCalendar);
    if (!parsed.length) { setParseError('No rows detected — paste tab-separated rows copied from Excel or a table.'); return; }
    setRows(parsed);
    setFileName(`Pasted (${parsed.length} rows)`);
    setStep('preview');
  };

  const validated = rows.map(r => {
    const errors = [];
    if (r._personName !== undefined) {
      if (r._personStatus === 'notfound')  errors.push(`"${r._personName}" not found in staff list`);
      if (r._personStatus === 'ambiguous') errors.push(`"${r._personName}" matches multiple staff — use Staff ID instead`);
      if (r._personStatus === 'empty')     errors.push('Person name missing');
    } else if (!String(r.employeeId || '').trim()) {
      errors.push('Staff ID missing');
    }
    if (!String(r.purpose || '').trim())             errors.push('Purpose missing');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fromDate || '')) errors.push('From Date invalid');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.toDate   || '')) errors.push('To Date invalid');
    if (r.fromDate && r.toDate && r.toDate < r.fromDate) errors.push('To Date before From Date');
    return { ...r, _errors: errors };
  });
  const validRows   = validated.filter(r => r._errors.length === 0);
  const invalidRows = validated.filter(r => r._errors.length > 0);

  const handleImport = async () => {
    setLoading(true);
    try {
      const payload = validRows.map(r => ({
        employeeId:      String(r.employeeId).trim(),
        purpose:         String(r.purpose).trim(),
        visitType:       r.visitType || 'National',
        country:         r.country || '',
        location:        r.location || '',
        fromDate:        r.fromDate,
        toDate:          r.toDate,
        description:     r.description || '',
        status:          ['approved', 'pending', 'rejected'].includes(String(r.status || '').toLowerCase())
          ? String(r.status).toLowerCase() : 'approved',
        approvedBy:      r.approvedBy    ? String(r.approvedBy).trim()    : undefined,
        approvedDate:    r.approvedDate  || undefined,
        recommendedBy:   r.recommendedBy ? String(r.recommendedBy).trim() : undefined,
        recommendedDate: r.recommendedDate || undefined,
      }));
      const data = await api.post('/visits/import', { visits: payload });
      setResult(data);
      setStep('result');
      if (data.created > 0 && onImported) onImported();
    } catch (err) {
      setParseError('Import failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const cellContent = (row, key) => {
    if (key === 'employeeId' && row._personName !== undefined)
      return <NameCell id={row.employeeId} name={row._personName} status={row._personStatus} />;
    if (key === 'approvedBy' && row._approvedByName !== undefined)
      return <NameCell id={row.approvedBy} name={row._approvedByName} status={row._approvedByStatus} />;
    if (key === 'recommendedBy' && row._recommendedByName !== undefined)
      return <NameCell id={row.recommendedBy} name={row._recommendedByName} status={row._recommendedByStatus} />;
    return row[key] || <span style={{ color: '#d1d5db' }}>—</span>;
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 880, width: '96vw' }} onClick={e => e.stopPropagation()}>

        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700, color: '#1e40af' }}>
            📥 Bulk Import Office Visits
          </h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {step === 'upload' && (
          <div className="modal-body" style={{ padding: 24 }}>
            {/* Mode tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              {[['paste', '📋 Paste from Grid'], ['file', '📂 Upload File']].map(([m, label]) => (
                <button key={m} onClick={() => { setMode(m); setParseError(''); }}
                  style={{
                    padding: '7px 16px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    border: `1.5px solid ${mode === m ? '#1a56db' : '#d1d5db'}`,
                    background: mode === m ? '#eff6ff' : '#fff',
                    color: mode === m ? '#1a56db' : '#374151',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {mode === 'paste' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Dates in the pasted data are:</div>
                  {[['bs', 'नेपाली (BS) — e.g. 2083/01/13'], ['ad', 'English (AD) — e.g. 2025-01-15']].map(([v, label]) => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, cursor: 'pointer' }}>
                      <input type="radio" name="pasteCalendar" checked={pasteCalendar === v} onChange={() => setPasteCalendar(v)} />
                      {label}
                    </label>
                  ))}
                </div>
                <textarea
                  autoFocus
                  rows={10}
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder={'Select the rows in the source grid (Person, From Date, To Date, Days, Purpose, Approved By, Approved Date, Recommended By, Recommended Date, Location), copy, and paste here.\nOne row per line, columns separated by Tab (this is what a normal browser/Excel copy already produces).'}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5, resize: 'vertical', boxSizing: 'border-box',
                    border: '1px solid #d1d5db', borderRadius: 8, padding: 10 }}
                />
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                  Column order expected: <strong>Person · From Date · To Date · Days · Purpose · Approved By · Approved Date · Recommended By · Recommended Date · Location</strong>.
                  Person / Approved By / Recommended By are matched by full name against the current staff list — ambiguous or unmatched names are flagged in the preview.
                </div>
                {parseError && (
                  <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca',
                    borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>
                    ⚠ {parseError}
                  </div>
                )}
                <div className="modal-footer" style={{ marginTop: 18, padding: 0, border: 'none' }}>
                  <button className="btn btn-outline" onClick={onClose}>Cancel</button>
                  <button className="btn btn-primary" disabled={!pastePreviewCount} onClick={handlePastePreview}>
                    Preview {pastePreviewCount > 0 ? `${pastePreviewCount} Row${pastePreviewCount === 1 ? '' : 's'}` : ''}
                  </button>
                </div>
              </>
            )}

            {mode === 'file' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 16px', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>Download Template</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                      Use this Excel template to prepare historical office visit records (Staff IDs, AD dates)
                    </div>
                  </div>
                  <button onClick={downloadTemplate} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 16px', background: '#1a56db', color: '#fff',
                    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>
                    ⬇ Template
                  </button>
                </div>

                <div
                  onDrop={onDrop}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? '#1a56db' : '#c7d2fe'}`,
                    borderRadius: 10,
                    background: dragOver ? '#eff6ff' : '#f8fafc',
                    padding: '40px 24px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all .15s',
                  }}
                >
                  <div style={{ fontSize: 40, marginBottom: 10 }}>📂</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#1e293b', marginBottom: 6 }}>
                    Drop your Excel / CSV file here
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>
                    or <span style={{ color: '#1a56db', textDecoration: 'underline' }}>browse</span> to choose a file
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                    Supported: .xlsx, .xls, .csv
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={e => handleFile(e.target.files[0])}
                  />
                </div>

                {parseError && (
                  <div style={{ marginTop: 14, background: '#fef2f2', border: '1px solid #fecaca',
                    borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>
                    ⚠ {parseError}
                  </div>
                )}

                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                    Expected Columns
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {COLUMNS.map(c => (
                      <span key={c.key} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: c.required ? '#dbeafe' : '#f3f4f6',
                        color: c.required ? '#1e40af' : '#6b7280',
                        border: `1px solid ${c.required ? '#93c5fd' : '#e5e7eb'}`,
                      }} title={c.note || ''}>
                        {c.required && <span style={{ color: '#ef4444' }}>*</span>}
                        {c.label}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                    <span style={{ color: '#ef4444' }}>*</span> Required &nbsp;·&nbsp; Column headers are case-insensitive
                    &nbsp;·&nbsp; Rows import as already-decided history (default status: approved)
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'preview' && (
          <>
            <div className="modal-body" style={{ padding: 0 }}>
              <div style={{ display: 'flex', gap: 12, padding: '12px 20px',
                background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>
                  📄 {fileName}
                </span>
                <span style={{ padding: '2px 10px', borderRadius: 10, background: '#d1fae5', color: '#065f46', fontSize: 12, fontWeight: 700 }}>
                  ✓ {validRows.length} valid
                </span>
                {invalidRows.length > 0 && (
                  <span style={{ padding: '2px 10px', borderRadius: 10, background: '#fee2e2', color: '#991b1b', fontSize: 12, fontWeight: 700 }}>
                    ✗ {invalidRows.length} invalid (will be skipped)
                  </span>
                )}
                <button onClick={() => { setStep('upload'); setRows([]); setFileName(''); }}
                  style={{ marginLeft: 'auto', background: 'none', border: '1px solid #d1d5db', borderRadius: 6,
                    fontSize: 12, color: '#6b7280', cursor: 'pointer', padding: '4px 12px' }}>
                  ← Back
                </button>
              </div>

              <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#efefef', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '7px 10px', fontWeight: 700, color: '#374151', fontSize: 12,
                        borderBottom: '2px solid #dedede', borderRight: '1px solid #dedede', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        #
                      </th>
                      {COLUMNS.map(c => (
                        <th key={c.key} style={{ padding: '7px 10px', fontWeight: 700, color: '#374151', fontSize: 12,
                          borderBottom: '2px solid #dedede', borderRight: '1px solid #dedede', whiteSpace: 'nowrap' }}>
                          {c.label}
                        </th>
                      ))}
                      <th style={{ padding: '7px 10px', fontWeight: 700, color: '#374151', fontSize: 12,
                        borderBottom: '2px solid #dedede', whiteSpace: 'nowrap' }}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {validated.map((row, i) => {
                      const hasErr = row._errors.length > 0;
                      return (
                        <tr key={i} style={{ background: hasErr ? '#fff5f5' : (i % 2 === 0 ? '#fff' : '#f9fafb') }}>
                          <td style={{ padding: '5px 10px', color: '#9ca3af', fontSize: 12, borderBottom: '1px solid #f0f0f0',
                            borderRight: '1px solid #f0f0f0', textAlign: 'center' }}>{i + 1}</td>
                          {COLUMNS.map(c => (
                            <td key={c.key} style={{ padding: '5px 10px', color: '#1f2937', borderBottom: '1px solid #f0f0f0',
                              borderRight: '1px solid #f0f0f0', whiteSpace: 'nowrap', maxWidth: 160,
                              overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {cellContent(row, c.key)}
                            </td>
                          ))}
                          <td style={{ padding: '5px 10px', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>
                            {hasErr
                              ? <span style={{ color: '#dc2626', fontSize: 11, fontWeight: 600 }}>✗ {row._errors.join(', ')}</span>
                              : <span style={{ color: '#059669', fontSize: 11, fontWeight: 600 }}>✓ Ready</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {parseError && (
                <div style={{ margin: '12px 20px', background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>
                  ⚠ {parseError}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={loading || validRows.length === 0}
                style={{ opacity: validRows.length === 0 ? 0.5 : 1 }}
              >
                {loading ? '⏳ Importing…' : `📥 Import ${validRows.length} Visit${validRows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}

        {step === 'result' && result && (
          <>
            <div className="modal-body" style={{ padding: 28, textAlign: 'center' }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>
                {result.created > 0 ? '✅' : '⚠️'}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 8 }}>
                Import Complete
              </div>

              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', margin: '18px 0', flexWrap: 'wrap' }}>
                <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 10,
                  padding: '12px 24px', minWidth: 100 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#065f46' }}>{result.created}</div>
                  <div style={{ fontSize: 12, color: '#047857', fontWeight: 600 }}>Created</div>
                </div>
                <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10,
                  padding: '12px 24px', minWidth: 100 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#991b1b' }}>{result.errors?.length || 0}</div>
                  <div style={{ fontSize: 12, color: '#991b1b', fontWeight: 600 }}>Errors</div>
                </div>
              </div>

              {result.errors?.length > 0 && (
                <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 8,
                  padding: '12px 16px', textAlign: 'left', maxHeight: 140, overflowY: 'auto' }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#dc2626', marginBottom: 6 }}>Errors:</div>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 3 }}>
                      <strong>{e.employeeId}</strong>: {e.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
