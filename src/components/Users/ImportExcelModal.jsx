import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';

/* ── Column schema ── */
const COLUMNS = [
  { key: 'deviceId',     label: 'Attendance Device Id', required: false, note: 'PIN on the attendance device (defaults to Employee ID)' },
  { key: 'employeeId',   label: 'Employee ID',   required: true  },
  { key: 'fullName',     label: 'Full Name',      required: true  },
  { key: 'phone',        label: 'Phone',          required: false },
  { key: 'email',        label: 'Email',          required: false },
  { key: 'gender',       label: 'Gender',         required: false, note: 'male / female / other' },
  { key: 'branch',       label: 'Branch',         required: false },
  { key: 'department',   label: 'Department',     required: false },
  { key: 'position',     label: 'Position',       required: false },
];

/* ── Flexible header → field key mapping ── */
const HEADER_MAP = {
  'employee_id':'employeeId','employee id':'employeeId','staff id':'employeeId','empid':'employeeId',
  'full_name':'fullName','full name':'fullName','name':'fullName','fullname':'fullName',
  'email':'email',
  'phone':'phone','mobile':'phone','contact':'phone','mobile no':'phone','phone no':'phone',
  'department':'department','dept':'department',
  'position':'position','post':'position','designation':'position',
  'branch':'branch',
  'role':'role','user role':'role',
  'gender':'gender','sex':'gender',
  'join_date':'joinDate','join date':'joinDate','joindate':'joinDate','joining date':'joinDate','date of joining':'joinDate',
  'mode':'mode','employment mode':'mode','employment type':'mode','type':'mode',
  'device_id':'deviceId','device id':'deviceId','deviceid':'deviceId','device pin':'deviceId',
  'attendance device id':'deviceId','attendance device':'deviceId','attendance id':'deviceId',
  'grade':'grade',
  'dob':'dob','date of birth':'dob','birth date':'dob','birthday':'dob',
  'status':'status','emp status':'status','employment status':'status',
  'ot_eligible':'eligibleForOt','ot eligible':'eligibleForOt','eligible for ot':'eligibleForOt','ot':'eligibleForOt',
  'remarks':'remarks','note':'remarks','notes':'remarks','comment':'remarks',
};

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g,' ');
}

function parseSheet(ws) {
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!json.length) return [];

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = (raw[0] || []).map(normalizeHeader);

  return json.map(rowRaw => {
    const row = {};
    headers.forEach((h, i) => {
      const key = HEADER_MAP[h];
      if (key) row[key] = raw[raw.indexOf(raw[0]) + json.indexOf(rowRaw) + 1]?.[i] ?? '';
    });
    // Also try direct field name keys (if header already matches a key)
    Object.entries(rowRaw).forEach(([h, v]) => {
      const norm = normalizeHeader(h);
      const key = HEADER_MAP[norm];
      if (key && row[key] === undefined) row[key] = v;
    });
    return row;
  });
}

/* ── Download template ── */
function downloadTemplate() {
  const headers = COLUMNS.map(c => c.label);
  const sample1 = ['1001','EMP001','Ram Bahadur Shrestha','9800000001','ram@example.com','male','PIPL','Admin','CEO'];
  const sample2 = ['1002','EMP002','Sita Kumari Karki','9800000002','sita@example.com','female','PIPL','Finance','Finance Director'];

  const ws = XLSX.utils.aoa_to_sheet([headers, sample1, sample2]);

  /* Style header row */
  ws['!cols'] = headers.map(() => ({ wch: 18 }));
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '52B02C' } },
        alignment: { horizontal: 'center' },
      };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Staff Template');
  XLSX.writeFile(wb, 'staff_import_template.xlsx');
}

/* ── Main modal ── */
export default function ImportExcelModal({ onClose, onImported }) {
  const [step, setStep]         = useState('upload');   // upload | preview | result
  const [rows, setRows]         = useState([]);
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [parseError, setParseError] = useState('');
  const fileRef = useRef(null);

  /* ── Parse dropped / selected file ── */
  const handleFile = useCallback(file => {
    if (!file) return;
    setParseError('');
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx','xls','csv'].includes(ext)) {
      setParseError('Only .xlsx, .xls, or .csv files are supported.');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
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

  /* ── Validation ── */
  const validated = rows.map(r => {
    const errors = [];
    if (!String(r.employeeId || '').trim()) errors.push('Employee ID missing');
    if (!String(r.fullName   || '').trim()) errors.push('Full Name missing');
    return { ...r, _errors: errors };
  });
  const validRows   = validated.filter(r => r._errors.length === 0);
  const invalidRows = validated.filter(r => r._errors.length > 0);

  /* ── Import ── */
  const handleImport = async () => {
    setLoading(true);
    try {
      const payload = validRows.map(({ _errors, ...r }) => ({
        ...r,
        employeeId: String(r.employeeId || '').trim(),
        fullName:   String(r.fullName   || '').trim(),
        email:      String(r.email      || '').trim() || null,
        phone:      String(r.phone      || '').trim() || null,
      }));
      const res = await fetch('/api/employees/import', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ employees: payload }),
      });
      const data = await res.json();
      setResult(data);
      setStep('result');
      if (data.created > 0 && onImported) onImported();
    } catch (err) {
      setParseError('Import failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ═══════════ RENDER ═══════════ */
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 780, width: '94vw' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header" style={{ background:'linear-gradient(135deg,#f0fdf4,#dcfce7)' }}>
          <h2 style={{ display:'flex', alignItems:'center', gap:8, fontSize:16, fontWeight:700, color:'#166534' }}>
            📥 Import Staff from Excel
          </h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* ── STEP: UPLOAD ── */}
        {step === 'upload' && (
          <div className="modal-body" style={{ padding:24 }}>
            {/* Template download */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'10px 16px', marginBottom:20 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:13, color:'#1e293b' }}>Download Template</div>
                <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                  Use this Excel template to prepare your staff data
                </div>
              </div>
              <button onClick={downloadTemplate} style={{
                display:'inline-flex', alignItems:'center', gap:6,
                padding:'7px 16px', background:'#52b02c', color:'#fff',
                border:'none', borderRadius:6, fontSize:13, fontWeight:600, cursor:'pointer',
              }}>
                ⬇ Template
              </button>
            </div>

            {/* Drop zone */}
            <div
              onDrop={onDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? '#52b02c' : '#c7d2fe'}`,
                borderRadius: 10,
                background: dragOver ? '#f0fdf4' : '#f8fafc',
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
                or <span style={{ color:'#52b02c', textDecoration:'underline' }}>browse</span> to choose a file
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                Supported: .xlsx, .xls, .csv
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display:'none' }}
                onChange={e => handleFile(e.target.files[0])}
              />
            </div>

            {parseError && (
              <div style={{ marginTop:14, background:'#fef2f2', border:'1px solid #fecaca',
                borderRadius:8, padding:'10px 14px', fontSize:13, color:'#dc2626' }}>
                ⚠ {parseError}
              </div>
            )}

            {/* Column guide */}
            <div style={{ marginTop:20 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:8 }}>
                Expected Columns
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {COLUMNS.map(c => (
                  <span key={c.key} style={{
                    display:'inline-flex', alignItems:'center', gap:4,
                    padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:600,
                    background: c.required ? '#dcfce7' : '#f3f4f6',
                    color: c.required ? '#166534' : '#6b7280',
                    border: `1px solid ${c.required ? '#86efac' : '#e5e7eb'}`,
                  }} title={c.note || ''}>
                    {c.required && <span style={{ color:'#ef4444' }}>*</span>}
                    {c.label}
                  </span>
                ))}
              </div>
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:6 }}>
                <span style={{ color:'#ef4444' }}>*</span> Required &nbsp;·&nbsp; Column headers are case-insensitive
              </div>
            </div>
          </div>
        )}

        {/* ── STEP: PREVIEW ── */}
        {step === 'preview' && (
          <>
            <div className="modal-body" style={{ padding:0 }}>
              {/* Summary bar */}
              <div style={{ display:'flex', gap:12, padding:'12px 20px',
                background:'#f8fafc', borderBottom:'1px solid #e2e8f0', flexWrap:'wrap', alignItems:'center' }}>
                <span style={{ fontSize:13, color:'#374151', fontWeight:600 }}>
                  📄 {fileName}
                </span>
                <span style={{ padding:'2px 10px', borderRadius:10, background:'#d1fae5', color:'#065f46', fontSize:12, fontWeight:700 }}>
                  ✓ {validRows.length} valid
                </span>
                {invalidRows.length > 0 && (
                  <span style={{ padding:'2px 10px', borderRadius:10, background:'#fee2e2', color:'#991b1b', fontSize:12, fontWeight:700 }}>
                    ✗ {invalidRows.length} invalid (will be skipped)
                  </span>
                )}
                <button onClick={() => { setStep('upload'); setRows([]); setFileName(''); }}
                  style={{ marginLeft:'auto', background:'none', border:'1px solid #d1d5db', borderRadius:6,
                    fontSize:12, color:'#6b7280', cursor:'pointer', padding:'4px 12px' }}>
                  ← Change File
                </button>
              </div>

              {/* Preview table */}
              <div style={{ overflowX:'auto', maxHeight:340, overflowY:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                  <thead>
                    <tr style={{ background:'#efefef', position:'sticky', top:0 }}>
                      <th style={{ padding:'7px 10px', fontWeight:700, color:'#374151', fontSize:12,
                        borderBottom:'2px solid #dedede', borderRight:'1px solid #dedede', textAlign:'center', whiteSpace:'nowrap' }}>
                        #
                      </th>
                      {['Attendance Device Id','Employee ID','Full Name','Phone','Email','Gender','Branch','Department','Position'].map(h => (
                        <th key={h} style={{ padding:'7px 10px', fontWeight:700, color:'#374151', fontSize:12,
                          borderBottom:'2px solid #dedede', borderRight:'1px solid #dedede', whiteSpace:'nowrap' }}>
                          {h}
                        </th>
                      ))}
                      <th style={{ padding:'7px 10px', fontWeight:700, color:'#374151', fontSize:12,
                        borderBottom:'2px solid #dedede', whiteSpace:'nowrap' }}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {validated.map((row, i) => {
                      const hasErr = row._errors.length > 0;
                      return (
                        <tr key={i} style={{ background: hasErr ? '#fff5f5' : (i % 2 === 0 ? '#fff' : '#f9fafb') }}>
                          <td style={{ padding:'5px 10px', color:'#9ca3af', fontSize:12, borderBottom:'1px solid #f0f0f0',
                            borderRight:'1px solid #f0f0f0', textAlign:'center' }}>{i + 1}</td>
                          {[
                            row.deviceId, row.employeeId, row.fullName, row.phone,
                            row.email, row.gender, row.branch, row.department, row.position,
                          ].map((val, ci) => (
                            <td key={ci} style={{ padding:'5px 10px', color:'#1f2937', borderBottom:'1px solid #f0f0f0',
                              borderRight:'1px solid #f0f0f0', whiteSpace:'nowrap', maxWidth:140,
                              overflow:'hidden', textOverflow:'ellipsis' }}>
                              {val || <span style={{ color:'#d1d5db' }}>—</span>}
                            </td>
                          ))}
                          <td style={{ padding:'5px 10px', borderBottom:'1px solid #f0f0f0', whiteSpace:'nowrap' }}>
                            {hasErr
                              ? <span style={{ color:'#dc2626', fontSize:11, fontWeight:600 }}>✗ {row._errors.join(', ')}</span>
                              : <span style={{ color:'#059669', fontSize:11, fontWeight:600 }}>✓ Ready</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {parseError && (
                <div style={{ margin:'12px 20px', background:'#fef2f2', border:'1px solid #fecaca',
                  borderRadius:8, padding:'10px 14px', fontSize:13, color:'#dc2626' }}>
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
                {loading ? '⏳ Importing…' : `📥 Import ${validRows.length} Staff`}
              </button>
            </div>
          </>
        )}

        {/* ── STEP: RESULT ── */}
        {step === 'result' && result && (
          <>
            <div className="modal-body" style={{ padding:28, textAlign:'center' }}>
              <div style={{ fontSize:52, marginBottom:12 }}>
                {result.created > 0 ? '✅' : '⚠️'}
              </div>
              <div style={{ fontSize:18, fontWeight:800, color:'#111827', marginBottom:8 }}>
                Import Complete
              </div>

              <div style={{ display:'flex', gap:16, justifyContent:'center', margin:'18px 0', flexWrap:'wrap' }}>
                <div style={{ background:'#d1fae5', border:'1px solid #6ee7b7', borderRadius:10,
                  padding:'12px 24px', minWidth:100 }}>
                  <div style={{ fontSize:28, fontWeight:800, color:'#065f46' }}>{result.created}</div>
                  <div style={{ fontSize:12, color:'#047857', fontWeight:600 }}>Created</div>
                </div>
                <div style={{ background:'#fef3c7', border:'1px solid #fcd34d', borderRadius:10,
                  padding:'12px 24px', minWidth:100 }}>
                  <div style={{ fontSize:28, fontWeight:800, color:'#92400e' }}>{result.skipped}</div>
                  <div style={{ fontSize:12, color:'#92400e', fontWeight:600 }}>Skipped (duplicate)</div>
                </div>
                <div style={{ background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:10,
                  padding:'12px 24px', minWidth:100 }}>
                  <div style={{ fontSize:28, fontWeight:800, color:'#991b1b' }}>{result.errors?.length || 0}</div>
                  <div style={{ fontSize:12, color:'#991b1b', fontWeight:600 }}>Errors</div>
                </div>
              </div>

              {result.errors?.length > 0 && (
                <div style={{ background:'#fff5f5', border:'1px solid #fecaca', borderRadius:8,
                  padding:'12px 16px', textAlign:'left', maxHeight:140, overflowY:'auto' }}>
                  <div style={{ fontWeight:700, fontSize:12, color:'#dc2626', marginBottom:6 }}>Errors:</div>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ fontSize:12, color:'#7f1d1d', marginBottom:3 }}>
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
