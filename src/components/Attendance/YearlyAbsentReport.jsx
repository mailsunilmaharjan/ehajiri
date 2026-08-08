import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useAuth }     from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { branchAbbr } from '../../utils/branchUtils.js';
import ViewYearlyBtn from './ViewYearlyBtn.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, toNepaliDigits, getNepalNow, getNepalTodayISO, getCurrentFiscalYear } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, getExcelHeaderRows, downloadCSV } from '../../utils/printHelper.js';

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

const DOW_FULL = {
  Sun:'Sunday', Mon:'Monday', Tue:'Tuesday', Wed:'Wednesday',
  Thu:'Thursday', Fri:'Friday', Sat:'Saturday',
};

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const abbrev = (name) => {
  if (!name) return '—';
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 5);
};

/* ── Action Menu ─────────────────────────────────────────────── */
const ActionMenu = ({ row, navigate, L, onReason }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const actions = [
    {
      label: L('बिदा आवेदन','Apply Leave'),
      icon: '🏖️',
      color: '#5b21b6',
      bg: '#ede9fe',
      onClick: () => {
        navigate('/leave/apply', { state: { prefillDate: row.date, prefillStaffId: row.id } });
        setOpen(false);
      },
    },
    {
      label: L('कार्यालय भ्रमण','Office Visit'),
      icon: '🚗',
      color: '#1e40af',
      bg: '#dbeafe',
      onClick: () => {
        navigate('/office-visit/apply', { state: { prefillDate: row.date, prefillStaffId: row.id } });
        setOpen(false);
      },
    },
    {
      label: L('अनुपस्थित कारण','Absent Reason'),
      icon: '📝',
      color: '#374151',
      bg: '#f3f4f6',
      onClick: () => { onReason(row); setOpen(false); },
    },
  ];

  return (
    <div ref={ref} style={{ position:'relative', display:'inline-block' }}>
      <button onClick={() => setOpen(p => !p)}
        style={{
          display:'inline-flex', alignItems:'center', gap:4,
          padding:'4px 10px', height:28,
          background:open?'#1e40af':'#1a56db',
          color:'white', border:'none', borderRadius:6,
          fontSize:12, fontWeight:600, cursor:'pointer', transition:'background .12s',
        }}>
        {L('कार्य','Action')}
        <svg viewBox="0 0 20 20" fill="white" width="11" height="11"
          style={{ transform:open?'rotate(180deg)':'none', transition:'transform .15s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 4px)', right:0, zIndex:600,
          background:'white', border:'1px solid #e5e7eb', borderRadius:10,
          boxShadow:'0 8px 24px rgba(0,0,0,.13)', overflow:'hidden', minWidth:175,
        }}>
          {actions.map(a => (
            <button key={a.label} onClick={a.onClick}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:8,
                padding:'9px 14px', border:'none', textAlign:'left', cursor:'pointer',
                fontSize:13, background:'white', color:'#374151', transition:'background .1s' }}
              onMouseEnter={e => { e.currentTarget.style.background = a.bg; e.currentTarget.style.color = a.color; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = '#374151'; }}>
              <span style={{ fontSize:16, flexShrink:0 }}>{a.icon}</span>
              <span style={{ fontWeight:500 }}>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Absent Reason Modal ─────────────────────────────────────── */
const ReasonModal = ({ row, onClose, onSave, L, fd }) => {
  const [reason, setReason] = useState('');
  return (
    <div className="modal-overlay">
      <div style={{ background:'white', borderRadius:14, width:'min(480px,96vw)',
        boxShadow:'0 20px 60px rgba(0,0,0,.18)', overflow:'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #f3f4f6',
          display:'flex', justifyContent:'space-between', alignItems:'center', background:'#fafafa' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#1f2937' }}>
              📝 {L('अनुपस्थित कारण','Absent Reason')}
            </div>
            <div style={{ fontSize:12, color:'#9ca3af', marginTop:2 }}>
              {row.fullName} — {fd(row.date)}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:'none',border:'none',cursor:'pointer',color:'#6b7280',fontSize:20,lineHeight:1 }}>✕</button>
        </div>
        <div style={{ padding:'20px' }}>
          <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:8 }}>
            {L('कारण लेख्नुस','Enter Reason')}:
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={4}
            placeholder={L('अनुपस्थितको कारण लेख्नुस...','Write the reason for absence...')}
            style={{ width:'100%', border:'1.5px solid #d1d5db', borderRadius:8, padding:'10px 12px',
              fontSize:13, resize:'vertical', outline:'none', boxSizing:'border-box' }}
            onFocus={e => e.target.style.borderColor='#1a56db'}
            onBlur={e => e.target.style.borderColor='#d1d5db'}
            autoFocus
          />
        </div>
        <div style={{ padding:'12px 20px 16px', borderTop:'1px solid #f3f4f6',
          display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={onClose}
            style={{ padding:'8px 18px', border:'1.5px solid #d1d5db', borderRadius:8,
              background:'white', color:'#374151', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {L('रद्द','Cancel')}
          </button>
          <button onClick={() => { onSave(row, reason); onClose(); }}
            disabled={!reason.trim()}
            style={{ padding:'8px 20px', border:'none', borderRadius:8,
              background:reason.trim()?'#1a56db':'#93c5fd',
              color:'white', fontSize:13, fontWeight:700,
              cursor:reason.trim()?'pointer':'not-allowed' }}>
            {L('सेभ गर्नुस','Save')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Yearly Absent Report
   — Flat list: Staff | Post | Dept | Branch | Date | Day | Action
═══════════════════════════════════════════════════════════════ */
const YearlyAbsentReport = () => {
  const [searchParams]  = useSearchParams();
  const navigate        = useNavigate();
  const { language }    = useLanguage();
  const { settings }    = useSettings();
  const { filteredEmployees: allEmployees, shifts } = useData();
  const { isEmployee, currentUser } = useAuth();
  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';
  const fd              = useDateFormat();
  const L = (np, en)    => language === 'np' ? np : en;

  const now     = getNepalNow();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(getNepalTodayISO());

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
      const result = await api.get(`/attendance/present-absent?startDate=${s}&endDate=${e}&active=${activeParam}`);
      setData(result);
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [getYearRange, staffStatus]);

  useEffect(() => { load(); }, [load]);

  /* ── Employee phone/email lookup ── */
  const empMap = useMemo(() => {
    const m = {};
    allEmployees.forEach(e => { m[String(e.id)] = e; });
    return m;
  }, [allEmployees]);

  /* ── Branch short-name map from settings ── */
  const branchShortMap = useMemo(() => {
    const m = {};
    (settings.branches || []).forEach(b => {
      if (b.name && b.short_name) m[b.name.toLowerCase().trim()] = b.short_name;
    });
    return m;
  }, [settings.branches]);

  /* ── Build flat absent records from present-absent matrix ── */
  const allRecords = useMemo(() => {
    if (!data) return [];
    const records = [];
    (data.dates || []).forEach(d => {
      if (d.isWeekend || d.isHoliday) return;
      (data.employees || []).forEach(emp => {
        if (myEmpId && String(emp.id) !== myEmpId) return;
        if (emp.days[d.date] !== 'AB') return;
        const detail = empMap[String(emp.id)] || {};
        records.push({
          _key:        `${emp.id}-${d.date}`,
          id:          emp.id,
          empCode:     emp.empCode,
          fullName:    emp.fullName,
          postShort:   emp.postShort,
          deptShort:   emp.deptShort,
          branchShort: branchShortMap[(emp.branch||'').toLowerCase().trim()] || emp.branchShort || abbrev(emp.branch),
          position:    emp.position,
          department:  emp.department,
          branch:      emp.branch,
          grade:       emp.grade,
          mode:        emp.mode,
          timingType:  emp.timingType,
          shift:       emp.shift,
          phone:       detail.phone || '',
          email:       detail.email || '',
          date:        d.date,
          dayKey:      d.dayKey,
        });
      });
    });
    return records;
  }, [data, empMap, branchShortMap]);

  const uniqueAbsentStaff = new Set(allRecords.map(r => r.id)).size;

  /* ── DataGrid columns ── */
  const columns = [
    {
      field:'fullName', header:L('नाम','Name'), sortable:true,
      render: v => <span style={{ color:'#1f2937' }}>{v}</span>,
    },
    {
      field:'postShort', header:L('पद','Post'),
      render: (v, row) => <span style={{ color:'#1f2937' }}>{row.position || v || '—'}</span>,
    },
    {
      field:'deptShort', header:L('विभाग','Dept.'),
      render: (v, row) => <span style={{ color:'#1f2937' }}>{row.department || v || '—'}</span>,
    },
    {
      field:'branchShort', header:L('शाखा','Branch'),
      render: (v, row) => <span style={{ color:'#1f2937' }}>{branchAbbr(row.branch, settings) || v || '—'}</span>,
    },
    {
      field:'date', header:L('मिति','Date'), sortable:true,
      render: v => <span style={{ color:'#374151', whiteSpace:'nowrap' }}>{fd(v)}</span>,
    },
    {
      field:'dayKey', header:L('दिन','Day'),
      render: v => <span style={{ color:'#6b7280' }}>{DOW_FULL[v] || v}</span>,
    },
    {
      field:'phone', header:L('मोबाइल','Mobile'),
      render: v => v
        ? <a href={`tel:${v}`} style={{ color:'#0369a1', fontFamily:'monospace',
            textDecoration:'none', fontWeight:600 }}
            onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
            onMouseLeave={e => e.currentTarget.style.textDecoration='none'}>
            📱 {v}
          </a>
        : <span style={{ color:'#d1d5db' }}>—</span>,
    },
    {
      field:'email', header:L('इमेल','Email'),
      render: v => v
        ? <a href={`mailto:${v}`} style={{ color:'#0369a1',
            textDecoration:'none', fontWeight:500 }}
            onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
            onMouseLeave={e => e.currentTarget.style.textDecoration='none'}>
            ✉️ {v}
          </a>
        : <span style={{ color:'#d1d5db' }}>—</span>,
    },
    {
      field:'_key', header:L('कार्य','Action'), sortable:false,
      render: (_, row) => {
        const key = `${row.id}-${row.date}`;
        const savedReason = savedReasons[key];
        return (
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <ActionMenu row={row} navigate={navigate} L={L} onReason={setReasonRow} />
            {savedReason && (
              <span style={{ fontSize:10, color:'#6b7280', fontStyle:'italic', maxWidth:120,
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                title={savedReason}>
                💬 {savedReason}
              </span>
            )}
          </div>
        );
      },
    },
  ];

  /* ── Export CSV ── */
  const rptTitle = 'Yearly Absent Report';
  const rptSub = `${settings.nepaliDigits?toNepaliDigits(year):year}${useNP?' BS':''}`;

  const handlePrint = () => {
    if (!allRecords.length) return;
    const dataRows = allRecords.map((r,i) => `<tr>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${i+1}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;font-weight:700">${r.fullName}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.postShort||''}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.deptShort||''}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.branchShort||''}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.date}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${DOW_FULL[r.dayKey]||r.dayKey}</td>
      <td style="padding:4px 6px;border:1px solid #dedede">${r.phone||''}</td>
    </tr>`).join('');
    const contentHtml = `<table style="border-collapse:collapse;width:100%;font-size:11px">
      <thead><tr>
        ${['SN','Name','Post','Dept','Branch','Date','Day','Mobile']
          .map(h=>`<th style="padding:4px 5px;border:1px solid #dedede;background:#efefef">${h}</th>`).join('')}
      </tr></thead>
      <tbody>${dataRows}</tbody>
    </table>`;
    openPrintWindow(buildPrintDoc({ settings, language, reportTitle: rptTitle, reportSub: rptSub, contentHtml, isLandscape: false }), false);
  };

  const exportCSV = () => {
    if (!allRecords.length) return;
    const headers = ['Name','Post','Dept.','Branch','Date','Day','Mobile','Email','Reason'];
    const dataRows = allRecords.map(r => {
      const reason = savedReasons[`${r.id}-${r.date}`] || '';
      return [r.fullName, r.postShort, r.deptShort, r.branchShort, r.date,
        DOW_FULL[r.dayKey]||r.dayKey, r.phone||'', r.email||'', reason]
        .map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
    }).join('\n');
    downloadCSV(getExcelHeaderRows(settings, language, rptTitle, rptSub) + headers.join(',') + '\n' + dataRows,
      `YearlyAbsent_${year}.csv`);
  };

  const yearLabel = settings.nepaliDigits ? toNepaliDigits(year) : String(year);
  const yearSuffix = useNP ? ' BS' : '';
  const period = data?.period;

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            📅 {L('वार्षिक अनुपस्थित रिपोर्ट','Yearly Absent Report')}
          </h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY && (
              <span style={{ background:'#eff6ff',color:'#1a56db',borderRadius:6,
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
              background:'#eff6ff',border:'1px solid #93c5fd',color:'#1d4ed8',
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
            currentPath="/attendance/reports/yearly/absent" />
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
                background: staffStatus === v ? '#1a56db' : 'white',
                color: staffStatus === v ? 'white' : '#374151' }}>
              {label}
            </button>
          ))}
        </div>

        <button className="btn btn-outline btn-sm" style={{ height:36 }} onClick={load} disabled={loading}>🔃</button>

        {/* summary badges */}
        {data && !loading && (
          <div style={{ display:'flex',gap:8,marginLeft:'auto',alignItems:'center' }}>
            <span style={{ background:'#fee2e2',color:'#991b1b',borderRadius:20,
              padding:'4px 12px',fontSize:12,fontWeight:700,border:'1px solid #fca5a5' }}>
              {allRecords.length} {L('कुल अनुपस्थित','Total Absences')}
            </span>
            <span style={{ background:'#fff5f5',color:'#dc2626',borderRadius:20,
              padding:'4px 12px',fontSize:12,fontWeight:600,border:'1px solid #fca5a5' }}>
              {uniqueAbsentStaff} {L('कर्मचारी','Staff')}
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
            {L('वार्षिक अनुपस्थित डेटा लोड हुँदैछ...','Loading yearly absent data...')}
          </div>
        </div>
      )}

      {!loading && data && allRecords.length === 0 && (
        <div style={{ textAlign:'center',padding:'60px 20px',color:'#9ca3af',
          background:'#f0fdf4',borderRadius:12,border:'1px solid #86efac' }}>
          <div style={{ fontSize:40,marginBottom:12 }}>✅</div>
          <div style={{ fontWeight:700,fontSize:16,color:'#065f46',marginBottom:6 }}>
            {L('कोही अनुपस्थित छैन!','No Absences!')}
          </div>
          <div style={{ fontSize:13,color:'#6b7280' }}>
            {L('यस वर्ष सबै कर्मचारी उपस्थित थिए।','All staff were present during this year.')}
          </div>
        </div>
      )}

      {/* ── DataGrid ── */}
      <DataGrid
        columns={columns}
        data={allRecords}
        defaultPageSize={100}
        showSearch={true}
        searchPlaceholder={L('नाम, मिति खोज्नुस...','Search name, date...')}
        compact={false}
        loading={loading}
        showCheckbox={false}
        autoWidth={true}
        showFilterButton={false}
      />

      {/* ── Modals ── */}
      {reasonRow && (
        <ReasonModal
          row={reasonRow}
          onClose={() => setReasonRow(null)}
          onSave={(row, reason) => {
            setSavedReasons(p => ({ ...p, [`${row.id}-${row.date}`]: reason }));
          }}
          L={L}
          fd={fd}
        />
      )}
    </div>
  );
};

export default YearlyAbsentReport;
