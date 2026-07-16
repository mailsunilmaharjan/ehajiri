import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useAuth }     from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { branchAbbr } from '../../utils/branchUtils.js';
import ViewYearlyBtn from './ViewYearlyBtn.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, toNepaliDigits } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, getExcelHeaderRows, downloadCSV } from '../../utils/printHelper.js';

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

function getCurrentFiscalYear(fiscalYears = []) {
  const today = new Date().toISOString().split('T')[0];
  return fiscalYears.find(fy => fy.startDate <= today && fy.endDate >= today)
      || fiscalYears.find(fy => fy.isDefault)
      || fiscalYears[fiscalYears.length - 1] || null;
}

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const abbrev = (name) => {
  if (!name) return '—';
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 5);
};

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

/* ── Give Reason Modal ──────────────────────────────────────── */
const ReasonModal = ({ row, existingReason, onClose, onSave, L, fd }) => {
  const [reason, setReason] = useState(existingReason || '');
  const [saving, setSaving] = useState(false);
  return (
    <div className="modal-overlay">
      <div style={{ background:'white', borderRadius:14, width:'min(480px,96vw)',
        boxShadow:'0 20px 60px rgba(0,0,0,.18)', overflow:'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #f3f4f6',
          display:'flex', justifyContent:'space-between', alignItems:'center', background:'#fafafa' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#1f2937' }}>
              📝 {L('कारण दिनुस','Give Reason')}
            </div>
            <div style={{ fontSize:12, color:'#9ca3af', marginTop:2 }}>
              {row.fullName} — {fd(row.date)}
            </div>
            <div style={{ fontSize:11, marginTop:2, fontWeight:600 }}>
              {row.lateInFormatted && <span style={{ color:'#dc2626' }}>{row.lateInFormatted} </span>}
              {row.earlyOutFormatted && <span style={{ color:'#d97706' }}>{row.earlyOutFormatted}</span>}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:'none',border:'none',cursor:'pointer',color:'#6b7280',fontSize:20,lineHeight:1 }}>✕</button>
        </div>
        <div style={{ padding:'20px' }}>
          <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:8 }}>
            {L('कारण','Reason')}:
          </label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={4}
            placeholder={L('ढिला आउने / चाँडो जाने कारण लेख्नुस...','Reason for being late / leaving early...')}
            style={{ width:'100%', border:'1.5px solid #d1d5db', borderRadius:8, padding:'10px 12px',
              fontSize:13, resize:'vertical', outline:'none', boxSizing:'border-box' }}
            onFocus={e => e.target.style.borderColor='#52b02c'}
            onBlur={e => e.target.style.borderColor='#d1d5db'}
            autoFocus />
          <div style={{ marginTop:8, fontSize:12, color:'#6b7280', fontStyle:'italic' }}>
            💡 {L('यो कारण दैनिक हाजिरी र स्टाफ लेजरमा देखिनेछ।',
              'This reason will appear in Daily Attendance and Staff Ledger Remarks.')}
          </div>
        </div>
        <div style={{ padding:'12px 20px 16px', borderTop:'1px solid #f3f4f6',
          display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={onClose}
            style={{ padding:'8px 18px', border:'1.5px solid #d1d5db', borderRadius:8,
              background:'white', color:'#374151', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {L('रद्द','Cancel')}
          </button>
          <button onClick={async () => { setSaving(true); await onSave(row, reason); setSaving(false); onClose(); }}
            disabled={!reason.trim() || saving}
            style={{ padding:'8px 20px', border:'none', borderRadius:8,
              background:reason.trim()&&!saving?'#52b02c':'#86efac',
              color:'white', fontSize:13, fontWeight:700,
              cursor:reason.trim()&&!saving?'pointer':'not-allowed' }}>
            {saving ? L('सेभ हुँदैछ...','Saving...') : L('सेभ गर्नुस','Save')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Action Button ──────────────────────────────────────────── */
const ActionBtn = ({ row, savedReasons, onGiveReason, L }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const key = `${row.id}-${row.date}`;
  const hasReason = !!savedReasons[key];

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} style={{ position:'relative', display:'inline-flex', alignItems:'center', gap:6 }}>
      <button onClick={() => setOpen(p => !p)}
        style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px', height:28,
          background:open?'#166534':'#52b02c', color:'white', border:'none', borderRadius:6,
          fontSize:12, fontWeight:600, cursor:'pointer', transition:'background .12s' }}>
        {L('कार्य','Action')}
        <svg viewBox="0 0 20 20" fill="white" width="11" height="11"
          style={{ transform:open?'rotate(180deg)':'none', transition:'transform .15s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {hasReason && (
        <span style={{ fontSize:10, color:'#059669', fontWeight:700 }}>✓ {L('कारण','Reason')}</span>
      )}
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', right:0, zIndex:600,
          background:'white', border:'1px solid #e5e7eb', borderRadius:10,
          boxShadow:'0 8px 24px rgba(0,0,0,.13)', overflow:'hidden', minWidth:175 }}>
          <button onClick={() => { setOpen(false); onGiveReason(row); }}
            style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'10px 14px',
              border:'none', textAlign:'left', cursor:'pointer', fontSize:13, background:'white', color:'#374151' }}
            onMouseEnter={e => { e.currentTarget.style.background='#ede9fe'; e.currentTarget.style.color='#5b21b6'; }}
            onMouseLeave={e => { e.currentTarget.style.background='white'; e.currentTarget.style.color='#374151'; }}>
            <span style={{ fontSize:16 }}>📝</span>
            <span style={{ fontWeight:500 }}>
              {hasReason ? L('कारण सम्पादन','Edit Reason') : L('कारण दिनुस','Give Reason')}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Yearly Late In Early Out Report
   — Flat list: Staff | Post | Dept | Date | Shift | In | Out | Remarks | Action
═══════════════════════════════════════════════════════════════ */
const YearlyLateEarlyReport = () => {
  const [searchParams]  = useSearchParams();
  const { language }    = useLanguage();
  const { settings }    = useSettings();
  const { filteredEmployees: allEmployees, shifts } = useData();
  const { isEmployee, currentUser } = useAuth();
  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';
  const fd              = useDateFormat();
  const L = (np, en)    => language === 'np' ? np : en;

  const now     = new Date();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(now);

  const urlYear  = parseInt(searchParams.get('year'));
  const initYear = urlYear && !isNaN(urlYear)
    ? urlYear
    : useNP ? (todayBS?.year || now.getFullYear()) : now.getFullYear();

  const [year,         setYear]         = useState(initYear);
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [staffStatus,  setStaffStatus]  = useState('working'); // 'working' | 'notworking'
  const [reasonRow,    setReasonRow]    = useState(null);
  const [savedReasons, setSavedReasons] = useState({});

  const currentFY = getCurrentFiscalYear(settings.fiscalYears || []);

  /* ── Build full-year AD date range ── */
  const getYearRange = useCallback(() => {
    if (useNP) {
      const startAD = bsToAD(year, 1, 1);
      const endAD   = bsToAD(year, 12, getBSDays(year, 12));
      if (startAD && endAD) return { s: isoDate(startAD), e: isoDate(endAD) };
    }
    return { s: `${year}-01-01`, e: `${year}-12-31` };
  }, [year, useNP]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { s, e } = getYearRange();
      const activeParam = staffStatus === 'notworking' ? 'false' : 'true';
      const result = await api.get(`/attendance/half-late-early?startDate=${s}&endDate=${e}&active=${activeParam}`);
      setData(result);
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [getYearRange, staffStatus]);

  useEffect(() => { load(); }, [load]);

  const period  = data?.period;
  const allRecs = (data?.records || []).filter(r => !myEmpId || String(r.id) === myEmpId);

  const lateCount  = allRecs.filter(r => r.lateInMins  > 0).length;
  const earlyCount = allRecs.filter(r => r.earlyOutMins > 0).length;

  /* ── DataGrid columns ── */
  const columns = [
    {
      field:'fullName', header:L('कर्मचारी','Person'), sortable:true,
      render: v => <span style={{ fontWeight:700, color:'#1f2937', fontSize:14 }}>{v}</span>,
    },
    {
      field:'postShort', header:L('पद','Post'),
      render: (v, row) => <span style={{ fontSize:14, color:'#0369a1', fontWeight:700 }}>{row.position || v || '—'}</span>,
    },
    {
      field:'deptShort', header:L('विभाग','Dept.'),
      render: (v, row) => <span style={{ fontSize:14, color:'#059669', fontWeight:700 }}>{row.department || v || '—'}</span>,
    },
    {
      field:'branchShort', header:L('शाखา','Branch'),
      render: (v, row) => <span style={{ fontSize:14, color:'#7c3aed', fontWeight:700 }}>{branchAbbr(row.branch, settings) || v || '—'}</span>,
    },
    {
      field:'date', header:L('मिति','Date'), sortable:true,
      render: v => <span style={{ fontWeight:600, color:'#374151', fontSize:14, whiteSpace:'nowrap' }}>{fd(v)}</span>,
    },
    {
      field:'shiftDisplay', header:L('सिफ्ट','Shift'),
      render: v => <span style={{ fontSize:14, color:'#7c3aed', fontFamily:'monospace', whiteSpace:'nowrap' }}>{v}</span>,
    },
    {
      field:'timeIn', header:L('आउने समय','In Time'), align:'center',
      render: (v, row) => {
        const warn = row.punches === 1;
        return v
          ? <strong style={{ fontFamily:'monospace', color:warn?'#d97706':'#52b02c', fontSize:14 }}
              title={warn?'Single punch':''}>
              {fmtTime(v)}{warn && ' ⚠'}
            </strong>
          : <span style={{ color:'#d1d5db' }}>—</span>;
      },
    },
    {
      field:'timeOut', header:L('जाने समय','Out Time'), align:'center',
      render: v => v
        ? <strong style={{ fontFamily:'monospace', color:'#374151', fontSize:14 }}>{fmtTime(v)}</strong>
        : <span style={{ color:'#d1d5db' }}>—</span>,
    },
    {
      field:'lateInFormatted', header:L('कैफियत','Remarks'), sortable:false, wrap:true,
      render: (lateIn, row) => {
        const parts = [];
        if (lateIn) parts.push(
          <span key="late" style={{ color:'#dc2626', fontWeight:700, fontSize:14 }}>{lateIn}</span>
        );
        if (row.earlyOutFormatted) parts.push(
          <span key="early" style={{ color:'#d97706', fontWeight:700, fontSize:14 }}>{row.earlyOutFormatted}</span>
        );
        if (!parts.length) return <span style={{ color:'#d1d5db' }}>—</span>;
        return <div style={{ display:'flex', flexDirection:'column', gap:2 }}>{parts}</div>;
      },
    },
    {
      field:'_action', header:L('कार्य','Action'), sortable:false,
      render: (_, row) => (
        <ActionBtn row={row} savedReasons={savedReasons} onGiveReason={setReasonRow} L={L} />
      ),
    },
  ];

  /* ── Print & Export ── */
  const rptTitle = 'Yearly Late In Early Out Report';
  const rptSub = `${settings.nepaliDigits?toNepaliDigits(year):year}${useNP?' BS':''}`;

  const handlePrint = () => {
    if (!allRecs.length) return;
    const dataRows = allRecs.map((r,i) => `<tr>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${i+1}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;font-weight:700">${r.fullName}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.postShort||''}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.deptShort||''}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.branchShort||''}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.date}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.shiftDisplay||''}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;font-family:monospace">${fmtTime(r.timeIn)}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;font-family:monospace">${fmtTime(r.timeOut)}</td>
      <td style="padding:4px 6px;border:1px solid #dedede">${[r.lateInFormatted,r.earlyOutFormatted].filter(Boolean).join(' | ')||''}</td>
    </tr>`).join('');
    const contentHtml = `<table style="border-collapse:collapse;width:100%;font-size:11px">
      <thead><tr>
        ${['SN','Person','Post','Dept','Branch','Date','Shift','In Time','Out Time','Remarks']
          .map(h=>`<th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">${h}</th>`).join('')}
      </tr></thead>
      <tbody>${dataRows}</tbody>
    </table>`;
    openPrintWindow(buildPrintDoc({ settings, language, reportTitle: rptTitle, reportSub: rptSub, contentHtml, isLandscape: false }), false);
  };

  const exportCSV = () => {
    if (!allRecs.length) return;
    const headers = ['Person','Post','Dept.','Branch','Date','Shift','In Time','Out Time','Remarks'];
    const dataRows = allRecs.map(r => [
      r.fullName, r.postShort, r.deptShort, r.branchShort,
      r.date, r.shiftDisplay, fmtTime(r.timeIn), fmtTime(r.timeOut),
      [r.lateInFormatted, r.earlyOutFormatted].filter(Boolean).join(' | ') || '',
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    downloadCSV(getExcelHeaderRows(settings, language, rptTitle, rptSub) + headers.join(',') + '\n' + dataRows,
      `YearlyLateEarly_${year}.csv`);
  };

  const yearLabel = settings.nepaliDigits ? toNepaliDigits(year) : String(year);
  const yearSuffix = useNP ? ' BS' : '';

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            ⏰ {L('वार्षिक ढिला/चाँडो रिपोर्ट','Yearly Late In Early Out Report')}
          </h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY && (
              <span style={{ background:'#f0fdf4',color:'#52b02c',borderRadius:6,
                padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>
                {currentFY.name}
              </span>
            )}
            {yearLabel}{yearSuffix}
            {period && (
              <span style={{ marginLeft:8,fontSize:11,color:'#9ca3af' }}>
                {fd(period.startDate)} → {fd(period.endDate)}
              </span>
            )}
          </p>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' }}>
          <button onClick={handlePrint}
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#f0fdf4',border:'1px solid #86efac',color:'#15803d',
              borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            🖨️ Print
          </button>
          <button onClick={exportCSV}
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#f0fdf4',border:'1px solid #86efac',color:'#15803d',
              borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
            📥 Export
          </button>
          <ViewYearlyBtn year={year} useNP={useNP}
            currentPath="/attendance/reports/yearly/late-early" />
        </div>
      </div>

      {/* ── Year selector ── */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap' }}>
        <select className="form-control" style={{ width:useNP?115:85,height:36,fontSize:13 }}
          value={year} onChange={e => setYear(+e.target.value)}>
          {useNP
            ? [todayBS?.year-1, todayBS?.year, todayBS?.year+1].filter(Boolean).map(y => (
                <option key={y} value={y}>{settings.nepaliDigits ? toNepaliDigits(y) : y} BS</option>
              ))
            : [now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))
          }
        </select>

        {/* Status toggle */}
        <div style={{ display:'flex', gap:0, border:'1px solid #d1d5db', borderRadius:8, overflow:'hidden' }}>
          {[['working', L('कार्यरत','Working')], ['notworking', L('अवकाश','Not Working')]].map(([v, label]) => (
            <button key={v}
              onClick={() => setStaffStatus(v)}
              style={{ padding:'5px 14px', border:'none', cursor:'pointer',
                fontSize:13, fontWeight:600, transition:'background .15s',
                background: staffStatus === v ? '#52b02c' : 'white',
                color: staffStatus === v ? 'white' : '#374151' }}>
              {label}
            </button>
          ))}
        </div>

        <button className="btn btn-outline btn-sm" style={{ height:36 }} onClick={load} disabled={loading}>🔃</button>

        {/* summary badges */}
        {data && !loading && (
          <div style={{ display:'flex',gap:8,marginLeft:'auto',alignItems:'center' }}>
            <span style={{ background:'#fee2e2',color:'#dc2626',borderRadius:20,
              padding:'4px 12px',fontSize:12,fontWeight:700,border:'1px solid #fca5a5' }}>
              {lateCount} {L('ढिला','Late In')}
            </span>
            <span style={{ background:'#fff7ed',color:'#d97706',borderRadius:20,
              padding:'4px 12px',fontSize:12,fontWeight:700,border:'1px solid #fed7aa' }}>
              {earlyCount} {L('चाँडो','Early Out')}
            </span>
            <span style={{ background:'#f3f4f6',color:'#374151',borderRadius:20,
              padding:'4px 12px',fontSize:12,fontWeight:600,border:'1px solid #e5e7eb' }}>
              {allRecs.length} {L('कुल','Total')}
            </span>
          </div>
        )}
      </div>

      {error && (
        <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,
          padding:'10px 16px',marginBottom:12,color:'#991b1b',fontWeight:600 }}>
          ❌ {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign:'center',padding:'60px 20px',color:'#9ca3af' }}>
          <div style={{ fontSize:36,marginBottom:8 }}>⏳</div>
          <div style={{ fontWeight:600,fontSize:14 }}>
            {L('वार्षिक ढिला/चाँडो डेटा लोड हुँदैछ...','Loading yearly late/early data...')}
          </div>
        </div>
      )}

      {!loading && data && allRecs.length === 0 && (
        <div style={{ textAlign:'center',padding:'60px 20px',color:'#9ca3af',
          background:'#f0fdf4',borderRadius:12,border:'1px solid #86efac' }}>
          <div style={{ fontSize:40,marginBottom:12 }}>⭐</div>
          <div style={{ fontWeight:700,fontSize:16,color:'#065f46',marginBottom:6 }}>
            {L('कोही ढिला/चाँडो छैन!','No Late or Early Out Issues!')}
          </div>
          <div style={{ fontSize:13,color:'#6b7280' }}>
            {L('यस वर्ष सबै कर्मचारी समयमा आए र गए।','All staff arrived and left on time this year.')}
          </div>
        </div>
      )}

      {/* ── DataGrid ── */}
      <DataGrid
        columns={columns}
        data={allRecs}
        defaultPageSize={100}
        showSearch={true}
        searchPlaceholder={L('नाम, मिति, कैफियत खोज्नुस...','Search name, date, remarks...')}
        compact={false}
        loading={loading}
        showCheckbox={false}
        autoWidth={true}
        showFilterButton={false}
      />

      {/* ── Give Reason Modal ── */}
      {reasonRow && (
        <ReasonModal
          row={reasonRow}
          existingReason={savedReasons[`${reasonRow.id}-${reasonRow.date}`]}
          onClose={() => setReasonRow(null)}
          onSave={async (row, reason) => {
            try {
              await api.post('/attendance/remark', {
                employeeId: row.id,
                date: row.date,
                reason,
                type: 'late_early',
              });
              setSavedReasons(p => ({ ...p, [`${row.id}-${row.date}`]: reason }));
            } catch(e) {
              console.error('Save reason failed:', e);
            }
          }}
          L={L}
          fd={fd}
        />
      )}
    </div>
  );
};

export default YearlyLateEarlyReport;
