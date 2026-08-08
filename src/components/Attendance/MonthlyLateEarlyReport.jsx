import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { branchAbbr } from '../../utils/branchUtils.js';
import ViewMonthlyBtn from './ViewMonthlyBtn.jsx';
import SearchableCheckSelect from '../Common/SearchableCheckSelect.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits, getNepalNow, getNepalTodayISO, getCurrentFiscalYear } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, getExcelHeaderRows, downloadCSV } from '../../utils/printHelper.js';

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

const abbrev = (name) => {
  if (!name) return '—';
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 5);
};

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

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
      <div style={{ background:'white',borderRadius:14,width:'min(480px,96vw)',
        boxShadow:'0 20px 60px rgba(0,0,0,.18)',overflow:'hidden' }}
        onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'16px 20px',borderBottom:'1px solid #f3f4f6',
          display:'flex',justifyContent:'space-between',alignItems:'center',background:'#fafafa' }}>
          <div>
            <div style={{ fontSize:15,fontWeight:700,color:'#1f2937' }}>📝 {L('कारण दिनुस','Give Reason')}</div>
            <div style={{ fontSize:12,color:'#9ca3af',marginTop:2 }}>{row.fullName} — {fd(row.date)}</div>
            <div style={{ fontSize:11,marginTop:2,fontWeight:600 }}>
              {row.lateInFormatted && <span style={{ color:'#dc2626' }}>{row.lateInFormatted} </span>}
              {row.earlyOutFormatted && <span style={{ color:'#d97706' }}>{row.earlyOutFormatted}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:'#6b7280',fontSize:20,lineHeight:1 }}>✕</button>
        </div>
        <div style={{ padding:'20px' }}>
          <label style={{ fontSize:13,fontWeight:600,color:'#374151',display:'block',marginBottom:8 }}>
            {L('कारण','Reason')}:
          </label>
          <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={4}
            placeholder={L('ढिला आउने / चाँडो जाने कारण लेख्नुस...','Reason for being late / leaving early...')}
            style={{ width:'100%',border:'1.5px solid #d1d5db',borderRadius:8,padding:'10px 12px',
              fontSize:13,resize:'vertical',outline:'none',boxSizing:'border-box' }}
            onFocus={e=>e.target.style.borderColor='#1a56db'}
            onBlur={e=>e.target.style.borderColor='#d1d5db'}
            autoFocus />
          <div style={{ marginTop:8,fontSize:12,color:'#6b7280',fontStyle:'italic' }}>
            💡 {L('यो कारण दैनिक हाजिरी र स्टाफ लेजरमा देखिनेछ।',
              'This reason will appear in Daily Attendance and Staff Ledger Remarks.')}
          </div>
        </div>
        <div style={{ padding:'12px 20px 16px',borderTop:'1px solid #f3f4f6',display:'flex',justifyContent:'flex-end',gap:10 }}>
          <button onClick={onClose}
            style={{ padding:'8px 18px',border:'1.5px solid #d1d5db',borderRadius:8,background:'white',color:'#374151',fontSize:13,fontWeight:600,cursor:'pointer' }}>
            {L('रद्द','Cancel')}
          </button>
          <button onClick={async () => { setSaving(true); await onSave(row, reason); setSaving(false); onClose(); }}
            disabled={!reason.trim() || saving}
            style={{ padding:'8px 20px',border:'none',borderRadius:8,
              background:reason.trim()&&!saving?'#1a56db':'#93c5fd',
              color:'white',fontSize:13,fontWeight:700,cursor:reason.trim()&&!saving?'pointer':'not-allowed' }}>
            {saving ? L('सेभ हुँदैछ...','Saving...') : L('सेभ गर्नुस','Save')}
          </button>
        </div>
      </div>
    </div>
  );
};

const ActionBtn = ({ row, savedReasons, onGiveReason, L }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const key = `${row.id}-${row.date}`;
  const hasReason = !!savedReasons[key];
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} style={{ position:'relative',display:'inline-flex',alignItems:'center',gap:6 }}>
      <button onClick={() => setOpen(p=>!p)}
        style={{ display:'inline-flex',alignItems:'center',gap:4,padding:'4px 10px',height:28,
          background:open?'#1e40af':'#1a56db',color:'white',border:'none',borderRadius:6,
          fontSize:12,fontWeight:600,cursor:'pointer',transition:'background .12s' }}>
        {L('कार्य','Action')}
        <svg viewBox="0 0 20 20" fill="white" width="11" height="11"
          style={{ transform:open?'rotate(180deg)':'none',transition:'transform .15s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {hasReason && <span style={{ fontSize:10,color:'#059669',fontWeight:700 }}>✓ {L('कारण','Reason')}</span>}
      {open && (
        <div style={{ position:'absolute',top:'calc(100% + 4px)',right:0,zIndex:600,
          background:'white',border:'1px solid #e5e7eb',borderRadius:10,
          boxShadow:'0 8px 24px rgba(0,0,0,.13)',overflow:'hidden',minWidth:175 }}>
          <button onClick={() => { setOpen(false); onGiveReason(row); }}
            style={{ width:'100%',display:'flex',alignItems:'center',gap:8,padding:'10px 14px',
              border:'none',textAlign:'left',cursor:'pointer',fontSize:13,background:'white',color:'#374151' }}
            onMouseEnter={e=>{ e.currentTarget.style.background='#ede9fe'; e.currentTarget.style.color='#5b21b6'; }}
            onMouseLeave={e=>{ e.currentTarget.style.background='white'; e.currentTarget.style.color='#374151'; }}>
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

/* ── Advance Search Modal ───────────────────────────────────── */
const EMPTY_FILTERS = {
  _status:'working', staffId:'', branch:'', dept:'', post:'', grade:'', mode:'', timingType:'', shift:'',
};

const AdvanceSearchModal = ({ filters, onApply, onClose, L, settings, employees, shifts }) => {
  const [local, setLocal] = useState({ ...filters });
  const set = (k, v) => setLocal(p => ({ ...p, [k]: v }));

  const modes       = (settings.modes   || []).map(m => ({ value:m.name, label:m.name }));
  const grades      = (settings.grades  || []).map(g => ({ value:g.name, label:g.name }));
  const timingTypes = (settings.timingTypes||[]).map(t => ({ value:t.name||t, label:t.name||t }));
  const shiftOpts   = shifts.map(s => ({ value:s.code, label:s.name||s.code }));

  const activeFlag = (local._status || 'working') === 'working';
  const empOpts    = employees.filter(e => (e.active !== false) === activeFlag)
    .sort((a,b) => (a.fullName||'').localeCompare(b.fullName||''))
    .map(e => ({
      value: String(e.id),
      label: `${e.fullName||`Staff ${e.id}`}${e.position ? ` • ${abbrev(e.position)}` : ''}${e.deviceId ? ` [${e.deviceId}]` : ''}`,
    }));
  const filteredEmps = employees.filter(e => (e.active !== false) === activeFlag);
  const branches = [...new Set(filteredEmps.map(e=>e.branch).filter(Boolean))].sort().map(b=>({value:b,label:b}));
  const depts    = [...new Set(filteredEmps.map(e=>e.department).filter(Boolean))].sort().map(d=>({value:d,label:d}));
  const posts    = [...new Set(filteredEmps.map(e=>e.position).filter(Boolean))].sort().map(p=>({value:p,label:p}));

  const Lbl = ({ text }) => <div style={{ fontSize:13,fontWeight:600,color:'#111827',marginBottom:6 }}>{text}</div>;
  const Field = ({ label, children }) => (
    <div style={{ position:'relative', overflow:'visible' }}>
      <Lbl text={label} />
      {children}
    </div>
  );

  return (
    <div className="modal-overlay">
      <div style={{ background:'white', borderRadius:16, width:'min(960px,96vw)',
        boxShadow:'0 20px 60px rgba(0,0,0,.18)', overflow:'visible', position:'relative' }}
        onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'18px 24px 14px', background:'#ffffff',borderBottom:'1px solid #f3f4f6',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:17, fontWeight:700, color:'#1e40af' }}>
            {L('एडभान्स खोज','Advance Search')}
          </span>
          <button onClick={onClose} style={{ background:'none',border:'none',cursor:'pointer',color:'#6b7280',fontSize:20,lineHeight:1,padding:'2px 6px',borderRadius:6 }}
            onMouseEnter={e=>e.currentTarget.style.background='#f3f4f6'}
            onMouseLeave={e=>e.currentTarget.style.background='none'}>✕</button>
        </div>
        <div style={{ padding:'18px 24px', display:'flex', flexDirection:'column', gap:16 }}>
          {/* Row 0: Status */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:14, marginBottom:4 }}>
            <Field label={L('स्थिति','Status')}>
              <div style={{ display:'flex', gap:0, border:'1px solid #d1d5db', borderRadius:8, overflow:'hidden' }}>
                {[['working', L('कार्यरत','Working')], ['notworking', L('अवकाश','Not Working')]].map(([v, label]) => (
                  <button key={v}
                    onClick={() => { set('_status', v); set('staffId', ''); }}
                    style={{ flex:1, padding:'8px 12px', border:'none', cursor:'pointer',
                      fontSize:13, fontWeight:600, transition:'background .15s',
                      background: (local._status || 'working') === v ? '#1a56db' : 'white',
                      color: (local._status || 'working') === v ? 'white' : '#374151' }}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('कर्मचारी','Staff')}>
              <SearchableCheckSelect options={empOpts} value={local.staffId} onChange={v=>set('staffId',v)} allLabel={L('All Staff','All Staff')} />
            </Field>
            <Field label={L('शाखा','Branch')}>
              <SearchableCheckSelect options={branches} value={local.branch} onChange={v=>set('branch',v)} allLabel={L('All Branches','All Branches')} />
            </Field>
            <Field label={L('विभाग','Department')}>
              <SearchableCheckSelect options={depts} value={local.dept} onChange={v=>set('dept',v)} allLabel={L('All Depts','All Depts')} />
            </Field>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('पद','Post')}>
              <SearchableCheckSelect options={posts} value={local.post} onChange={v=>set('post',v)} allLabel={L('All Posts','All Posts')} />
            </Field>
            <Field label={L('ग्रेड','Grade')}>
              <SearchableCheckSelect options={grades} value={local.grade} onChange={v=>set('grade',v)} allLabel={L('All Grades','All Grades')} />
            </Field>
            <Field label={L('नियुक्ति','Mode')}>
              <SearchableCheckSelect options={modes} value={local.mode} onChange={v=>set('mode',v)} allLabel={L('All Modes','All Modes')} />
            </Field>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('टाइमिङ','Timing Type')}>
              <SearchableCheckSelect options={timingTypes} value={local.timingType} onChange={v=>set('timingType',v)} allLabel={L('All Types','All Types')} />
            </Field>
            <Field label={L('सिफ्ट','Shift')}>
              <SearchableCheckSelect options={shiftOpts} value={local.shift} onChange={v=>set('shift',v)} allLabel={L('All Shifts','All Shifts')} />
            </Field>
            <div />
          </div>
        </div>
        <div style={{ padding:'12px 24px 18px', borderTop:'1px solid #f3f4f6', display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={() => { onApply({ ...EMPTY_FILTERS }); onClose(); }}
            style={{ padding:'8px 20px', border:'1.5px solid #d1d5db', borderRadius:8, background:'white', color:'#374151', fontSize:14, fontWeight:600, cursor:'pointer' }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#9ca3af';e.currentTarget.style.background='#f9fafb';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='white';}}>
            {L('रिसेट','Reset')}
          </button>
          <button onClick={() => { onApply(local); onClose(); }}
            style={{ padding:'8px 24px', border:'none', borderRadius:8, background:'#1a56db', color:'white', fontSize:14, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 8px rgba(26,86,219,.3)' }}
            onMouseEnter={e=>e.currentTarget.style.background='#1e40af'}
            onMouseLeave={e=>e.currentTarget.style.background='#1a56db'}>
            {L('खोज्नुस','Search')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Monthly Late In Early Out Report
═══════════════════════════════════════════════════════════════ */
const MonthlyLateEarlyReport = () => {
  const [searchParams] = useSearchParams();
  const { language }   = useLanguage();
  const { settings }   = useSettings();
  const { filteredEmployees: employees, shifts } = useData();
  const fd             = useDateFormat();
  const L = (np, en)   => language === 'np' ? np : en;

  const now     = getNepalNow();
  const useNP   = settings.defaultCalendar === 'np';
  const todayBS = adToBS(getNepalTodayISO());

  const urlYear  = parseInt(searchParams.get('year'));
  const urlMonth = parseInt(searchParams.get('month'));

  const { isEmployee, currentUser } = useAuth();
  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';

  // Always default to current running month
  const [year,         setYear]         = useState(useNP ? (todayBS?.year  || now.getFullYear())  : now.getFullYear());
  const [month,        setMonth]        = useState(useNP ? (todayBS?.month || now.getMonth() + 1) : now.getMonth() + 1);
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [showSearch,   setShowSearch]   = useState(false);
  const [filters,      setFilters]      = useState({ ...EMPTY_FILTERS, staffId: myEmpId });
  const [staffStatus,  setStaffStatus]  = useState('working'); // 'working' | 'notworking'
  const [reasonRow,    setReasonRow]    = useState(null);
  const [savedReasons, setSavedReasons] = useState({});

  const currentFY = getCurrentFiscalYear(settings.fiscalYears || []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let apiUrl;
      if (useNP) {
        const startAD = bsToAD(year, month, 1);
        const endAD   = bsToAD(year, month, getBSDays(year, month));
        if (startAD && endAD) {
          apiUrl = `/attendance/half-late-early?startDate=${isoDate(startAD)}&endDate=${isoDate(endAD)}`;
        }
      }
      if (!apiUrl) {
        const lastDay = new Date(year, month, 0).getDate();
        const pad = n => String(n).padStart(2,'0');
        const s = `${year}-${pad(month)}-01`;
        const e = `${year}-${pad(month)}-${pad(lastDay)}`;
        apiUrl = `/attendance/half-late-early?startDate=${s}&endDate=${e}`;
      }
      apiUrl += `&active=${staffStatus === 'notworking' ? 'false' : 'true'}`;
      setData(await api.get(apiUrl));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year, month, useNP, staffStatus]);

  useEffect(() => { load(); }, [load]);

  const period   = data?.period;
  const allRecs  = data?.records || [];

  /* Branch short-name from settings (authoritative: PKR etc.) */
  const branchShortMap = React.useMemo(() => {
    const m = {};
    (settings.branches||[]).forEach(b => { if (b.name&&b.short_name) m[b.name.toLowerCase().trim()]=b.short_name; });
    return m;
  }, [settings.branches]);
  const resolveShort = r =>
    branchShortMap[(r.branch||'').toLowerCase().trim()] || r.branchShort || r.branch || '—';

  /* Client-side filtering */
  const records = allRecs.filter(r => {
    if (filters.staffId  && String(r.id) !== filters.staffId)      return false;
    if (filters.branch   && r.branch     !== filters.branch)        return false;
    if (filters.dept     && r.department !== filters.dept)          return false;
    if (filters.post     && r.position   !== filters.post)          return false;
    if (filters.grade    && r.grade      !== filters.grade)         return false;
    if (filters.mode     && r.mode       !== filters.mode)          return false;
    if (filters.timingType && r.timingType !== filters.timingType)  return false;
    if (filters.shift    && r.shift      !== filters.shift)         return false;
    return true;
  });

  const activeFilterCount = Object.entries(filters).filter(([k,v]) => k !== '_status' && Boolean(v)).length;

  const lateCount  = records.filter(r => r.lateInMins  > 0).length;
  const earlyCount = records.filter(r => r.earlyOutMins > 0).length;

  const periodLabel = () => {
    const mn     = useNP ? (BS_MONTHS_NP[month-1] || '') : MONTHS_EN[month-1];
    const yr     = settings.nepaliDigits ? toNepaliDigits(year) : String(year);
    const calStr = useNP ? ' BS' : '';
    return `${mn} ${yr}${calStr}`;
  };

  /* ── DataGrid columns ── */
  const columns = [
    {
      field:'fullName', header:L('कर्मचारी','Person'), sortable:true,
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
      field:'shiftDisplay', header:L('सिफ्ट','Shift'),
      render: v => <span style={{ color:'#1f2937', fontFamily:'monospace', whiteSpace:'nowrap' }}>{v}</span>,
    },
    {
      field:'timeIn', header:L('आउने समय','In Time'), align:'center',
      render: (v, row) => {
        const warn = row.punches === 1;
        return v
          ? <strong style={{ fontFamily:'monospace', color: warn?'#f59e0b':'#3b82f6' }}
              title={warn?'Single punch':''}>
              {fmtTime(v)}
            </strong>
          : <span style={{ color:'#d1d5db' }}>—</span>;
      },
    },
    {
      field:'timeOut', header:L('जाने समय','Out Time'), align:'center',
      render: v => v
        ? <strong style={{ fontFamily:'monospace', color:'#6b7280' }}>{fmtTime(v)}</strong>
        : <span style={{ color:'#d1d5db' }}>—</span>,
    },
    {
      field:'lateInFormatted', header:L('कैफियत','Remarks'), sortable:false, wrap:true,
      render: (lateIn, row) => {
        const parts = [];
        if (lateIn) parts.push(
          <span key="late" style={{ color:'#ef4444', fontWeight:700 }}>{lateIn}</span>
        );
        if (row.earlyOutFormatted) parts.push(
          <span key="early" style={{ color:'#f59e0b', fontWeight:700 }}>{row.earlyOutFormatted}</span>
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

  const rptTitle = 'Monthly Late In Early Out Report';
  const rptSub = () => periodLabel();

  const handlePrint = () => {
    if (!records.length) return;
    const dataRows = records.map((r,i) => `<tr>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${i+1}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;font-weight:700">${r.fullName}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.postShort||''}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center">${r.deptShort||''}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;color:#7c3aed;font-weight:700">${resolveShort(r)}</td>
      <td style="padding:4px 6px;border:1px solid #dedede;text-align:center;font-weight:600">${fd(r.date)||r.date}</td>
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
    openPrintWindow(buildPrintDoc({ settings, language, reportTitle: rptTitle, reportSub: rptSub(), contentHtml, isLandscape: false }), false);
  };

  const exportCSV = () => {
    if (!records.length) return;
    const headers = ['Person','Post','Dept.','Branch','Date','Shift','In Time','Out Time','Remarks'];
    const dataRows = records.map(r => [
      r.fullName, r.postShort, r.deptShort, r.branchShort,
      r.date, r.shiftDisplay, fmtTime(r.timeIn), fmtTime(r.timeOut),
      [r.lateInFormatted, r.earlyOutFormatted].filter(Boolean).join(' | ') || '',
    ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    downloadCSV(getExcelHeaderRows(settings, language, rptTitle, rptSub()) + headers.join(',') + '\n' + dataRows,
      `MonthlyLateEarly_${period?.startDate||''}.csv`);
  };

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            ⏰ {L('मासिक ढिला/चाँडो रिपोर्ट','Monthly Late In Early Out Report')}
          </h1>
          <p className="page-subtitle" style={{ margin:0 }}>
            {currentFY && (
              <span style={{ background:'#eff6ff',color:'#1a56db',borderRadius:6,
                padding:'1px 8px',fontSize:12,fontWeight:600,marginRight:8 }}>
                {currentFY.name}
              </span>
            )}
            {periodLabel()}
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
          <ViewMonthlyBtn year={year} month={month} useNP={useNP}
            currentPath="/attendance/reports/monthly/late-early" />
        </div>
      </div>

      {/* ── Period selector + Advance Search ── */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap' }}>
        <select className="form-control" style={{ width:useNP?115:85,height:36,fontSize:13 }}
          value={year} onChange={e=>setYear(+e.target.value)}>
          {useNP
            ? [todayBS?.year-1,todayBS?.year,todayBS?.year+1].filter(Boolean).map(y=>(
                <option key={y} value={y}>{settings.nepaliDigits?toNepaliDigits(y):y} BS</option>))
            : [now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1].map(y=>(
                <option key={y} value={y}>{y}</option>))
          }
        </select>
        <select className="form-control" style={{ width:useNP?120:140,height:36,fontSize:13 }}
          value={month} onChange={e=>setMonth(+e.target.value)}>
          {useNP
            ? BS_MONTHS_NP.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
            : MONTHS_EN.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
          }
        </select>

        {/* Status badge */}
        <span style={{ background: staffStatus==='working'?'#d1fae5':'#fee2e2',
          color: staffStatus==='working'?'#065f46':'#991b1b',
          border: `1px solid ${staffStatus==='working'?'#6ee7b7':'#fca5a5'}`,
          borderRadius:20, padding:'4px 12px', fontSize:12, fontWeight:700 }}>
          {staffStatus==='working' ? L('कार्यरत','Working') : L('अवकाश','Not Working')}
        </span>

        {/* Advance Search */}
        <button onClick={() => setShowSearch(true)}
          style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'0 14px',height:36,
            background: activeFilterCount>0?'#ede9fe':'#f5f3ff',
            border:`1.5px solid ${activeFilterCount>0?'#7c3aed':'#c4b5fd'}`,
            color: activeFilterCount>0?'#5b21b6':'#6d28d9',
            borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
          </svg>
          {L('एडभान्स खोज','Advance Search')}
          {activeFilterCount>0 && (
            <span style={{ background:'#1a56db',color:'white',borderRadius:'50%',
              width:18,height:18,display:'inline-flex',alignItems:'center',justifyContent:'center',
              fontSize:11,fontWeight:800 }}>{activeFilterCount}</span>
          )}
        </button>
        <button className="btn btn-outline btn-sm" style={{ height:36 }} onClick={load} disabled={loading}>🔃</button>

        {/* Summary badges */}
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
              {records.length} {L('कुल','Total')}
            </span>
          </div>
        )}
      </div>

      {error && (
        <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,
          padding:'10px 16px',marginBottom:12,color:'#991b1b',fontWeight:600 }}>❌ {error}</div>
      )}

      {/* ── DataGrid ── */}
      {!loading && data && records.length === 0 && (
        <div style={{ textAlign:'center',padding:'60px 20px',color:'#9ca3af',
          background:'#f0fdf4',borderRadius:12,border:'1px solid #86efac' }}>
          <div style={{ fontSize:40,marginBottom:12 }}>⭐</div>
          <div style={{ fontWeight:700,fontSize:16,color:'#065f46',marginBottom:6 }}>
            {L('कोही ढिला/चाँडो छैन!','No Late or Early Out Issues!')}
          </div>
          <div style={{ fontSize:13,color:'#6b7280' }}>
            {L('यस अवधिमा सबै कर्मचारी समयमा आए र गए।','All staff arrived and left on time.')}
          </div>
        </div>
      )}

      <DataGrid
        columns={columns}
        data={records}
        defaultPageSize={50}
        showSearch={true}
        searchPlaceholder={L('नाम, मिति, कैफियत खोज्नुस...','Search name, date, remarks...')}
        compact={false}
        loading={loading}
        showCheckbox={false}
        autoWidth={true}
        showFilterButton={false}
      />

      {/* ── Advance Search Modal ── */}
      {showSearch && (
        <AdvanceSearchModal
          filters={filters}
          onApply={f => { setFilters({ ...f, staffId: myEmpId || f.staffId }); setStaffStatus(f._status || 'working'); }}
          onClose={() => setShowSearch(false)}
          L={L}
          settings={settings}
          employees={employees}
          shifts={shifts}
        />
      )}

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
            } catch (e) {
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

export default MonthlyLateEarlyReport;
