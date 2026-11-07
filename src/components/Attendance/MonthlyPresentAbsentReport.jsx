import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import ViewMonthlyBtn from './ViewMonthlyBtn.jsx';
import SearchableCheckSelect from '../Common/SearchableCheckSelect.jsx';
import Avatar from '../Common/Avatar.jsx';
import LoadingIndicator from '../Common/LoadingIndicator.jsx';
import ReportDateRange, { useReportDateRange } from '../Common/ReportDateRange.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits, getNepalNow, getNepalTodayISO, getCurrentFiscalYear } from '../../utils/dateUtils.js';
import { buildPrintDoc, openPrintWindow, downloadBlob } from '../../utils/printHelper.js';

const MONTHS_EN = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];


const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const DOW_NP = { Sun:'आइत', Mon:'सोम', Tue:'मंगल', Wed:'बुध', Thu:'बिही', Fri:'शुक्र', Sat:'शनि' };

/* ── Status cell config ──────────────────────────────────────── */
const STATUS_BASE = {
  P  : { color:'#059669', main:'P',   sup:null,  title:'Present'                   },
  P1 : { color:'#0369a1', main:'P',   sup:'1P',  title:'Present – single punch'    },
  PP : { color:'#ca8a04', main:'H.P', sup:null,  title:'Present on Public Holiday' },
  PP1: { color:'#ca8a04', main:'H.P', sup:'1P',  title:'Present on Public Holiday – single punch' },
  WP : { color:'#0f766e', main:'W.P', sup:null,  title:'Present on Weekend'        },
  WP1: { color:'#0f766e', main:'W.P', sup:'1P',  title:'Present on Weekend – single punch' },
  AB : { color:'#dc2626', main:'AB',  sup:null,  title:'Absent'                    },
  H  : { color:'#111827', main:'W',   sup:null,  title:'Weekend'                   },
  DO : { color:'#6b7280', main:'DO',  sup:null,  title:'Day Off'                   },
  NO : { color:'#4338ca', main:'NO',  sup:null,  title:'Night Off'                 },
  L  : { color:'#7c3aed', main:'L',   sup:null,  title:'Leave'                     },
  LH : { color:'#a855f7', main:'L',   sup:'½',   title:'Half-day Leave'            },
  OV : { color:'#2563eb', main:'OV',  sup:null,  title:'Office Visit'              },
  PH : { color:'#d97706', main:'H',   sup:null,  title:'Public Holiday'            },
  PLH: { color:'#059669', main:'P-L', sup:'½',   title:'Present + Half-day Leave'  },
  // Before the staff's Attendance Date — not counted as Present or Absent.
  NA : { color:'#d1d5db', main:'',    sup:null,  title:''                          },
};

// A tenant's own off shift arrives as 'OFF:<label>' (e.g. 'OFF:Due D/O') — shown with that label, like the roster.
const STATUS = new Proxy(STATUS_BASE, {
  get: (t, k) => (typeof k === 'string' && k.startsWith('OFF:'))
    ? { color:'#6b7280', main:k.slice(4), sup:null, title:k.slice(4).split('D/O').join('Day Off').split('N/O').join('Night Off') }
    : t[k],
});

// STATUS's own `title`/`main`/`sup` are the English defaults, used as-is for
// Print/Export (kept universal there so an exported file reads the same
// regardless of who opens it). The on-screen grid instead resolves through
// STATUS_NP/statusDisplay below when the app is in Nepali — see StatusCell.
const STATUS_TITLE_NP = {
  P: 'उपस्थित', P1: 'उपस्थित – एकल पन्च', PP: 'सार्वजनिक बिदामा उपस्थित', PP1: 'सार्वजनिक बिदामा उपस्थित – एकल पन्च',
  WP: 'सप्ताहन्तमा उपस्थित', WP1: 'सप्ताहन्तमा उपस्थित – एकल पन्च', AB: 'अनुपस्थित',
  H: 'सप्ताहन्त', DO: 'डे अफ', NO: 'नाइट अफ', L: 'बिदा', LH: 'आधा दिन बिदा',
  OV: 'कार्यालय भ्रमण', PH: 'सार्वजनिक बिदा', PLH: 'उपस्थित + आधा दिन बिदा',
};
const STATUS_NP = {
  P:  { main:'उ',    sup:null },
  P1: { main:'उ',    sup:'१'  },
  PP: { main:'उसा',  sup:null },
  PP1:{ main:'उसा',  sup:'१'  },
  WP: { main:'उस',   sup:null },
  WP1:{ main:'उस',   sup:'१'  },
  AB: { main:'अनु',  sup:null },
  H:  { main:'स',    sup:null },
  DO: { main:'दि.अ', sup:null },
  NO: { main:'रा.अ', sup:null },
  L:  { main:'बि',   sup:null },
  LH: { main:'बि',   sup:'½'  },
  OV: { main:'भ्रमण', sup:null },
  PH: { main:'साबि', sup:null },
  PLH:{ main:'उ-बि', sup:'½'  },
};
const statusDisplay = (st, language) => {
  const s = STATUS[st] || STATUS.AB;
  return language === 'np' ? (STATUS_NP[st] || s) : s;
};
const statusTitle = (st, language) => {
  const s = STATUS[st] || STATUS.AB;
  return language === 'np' ? (STATUS_TITLE_NP[st] || s.title) : s.title;
};

// Leave days show the leave type's short code (AL, SL…) from Settings → Leave Types
// instead of the generic "L". Half-day leave keeps its ½ superscript.
const withLeaveCode = (disp, st, code) => {
  if (!code) return disp;
  if (st === 'L' || st === 'LH') return { ...disp, main: code };
  if (st === 'PLH') return { ...disp, main: `P-${code}` };
  return disp;
};

const StatusCell = ({ st, language, code }) => {
  const s = STATUS[st] || STATUS.AB;
  const disp = withLeaveCode(statusDisplay(st, language), st, code);
  return (
    <span style={{ color:s.color, fontSize:12, fontWeight:700,
      display:'block', textAlign:'center', cursor:'default', whiteSpace:'nowrap' }}
      title={statusTitle(st, language)}>
      {disp.main}{disp.sup && <sup style={{ fontSize:8, fontWeight:800 }}>{disp.sup}</sup>}
    </span>
  );
};

/* Plain-text rendering of a day's status for Print/Export — STATUS entries
   have no `.label` field (only `main`/`sup`, used for the on-screen
   superscript), so a blank status here means every attendance cell in the
   printed/exported output is empty even though the grid shows it fine. */
const statusText = (st, code) => {
  const s = STATUS[st];
  if (!s) return '';
  const d = withLeaveCode(s, st, code);
  return d.sup ? `${d.main}(${d.sup})` : d.main;
};

/* ── Advanced Search Modal ───────────────────────────────────── */
const EMPTY_FILTERS = {
  _status:'working', staffId:'', branch:'', dept:'', post:'', grade:'', mode:'', timingType:'', shift:'',
};

const AdvanceSearchModal = ({ filters, onApply, onClose, L, settings, employees, shifts, month, onMonthChange, useNP }) => {
  const [local,      setLocal]      = useState({ ...filters });
  const [localMonth, setLocalMonth] = useState(month);
  const set = (k, v) => setLocal(p => ({ ...p, [k]: v }));

  const monthOpts = useNP
    ? BS_MONTHS_NP.map((m, i)  => ({ value: String(i+1), label: m }))
    : MONTHS_EN.map((m, i)     => ({ value: String(i+1), label: m }));

  const fyOpts = (settings.fiscalYears || []).map(fy => ({ value: fy.name, label: fy.name }));
  const modes       = (settings.modes   || []).map(m => ({ value:m.name,  label:m.name  }));
  const grades      = (settings.grades  || []).map(g => ({ value:g.name,  label:g.name  }));
  const timingTypes = (settings.timingTypes || []).map(t => ({ value:t.name||t, label:t.name||t }));
  const shiftOpts = shifts.map(s => ({ value:s.code, label:s.name || s.code }));

  const activeFlag = (local._status || 'working') === 'working';
  const empOpts = employees.filter(e => (e.active !== false) === activeFlag)
    .sort((a,b) => (a.fullName||'').localeCompare(b.fullName||''))
    .map(e => ({
      value: String(e.id),
      label: e.fullName || `Staff ${e.id}`,
      sub: [e.employeeId, e.position].filter(Boolean).join(' - '),
      photo: e.profilePhoto,
    }));

  const filteredEmps = employees.filter(e => (e.active !== false) === activeFlag);
  const branches = [...new Set(filteredEmps.map(e=>e.branch).filter(Boolean))].sort().map(b=>({value:b,label:b}));
  const depts    = [...new Set(filteredEmps.map(e=>e.department).filter(Boolean))].sort().map(d=>({value:d,label:d}));
  const posts    = [...new Set(filteredEmps.map(e=>e.position).filter(Boolean))].sort().map(p=>({value:p,label:p}));

  const Lbl = ({ text }) => (
    <div style={{ fontSize:13, fontWeight:600, color:'#111827', marginBottom:6 }}>{text}</div>
  );
  const Field = ({ label, children }) => (
    <div style={{ position:'relative', overflow:'visible' }}>
      <Lbl text={label} />
      {children}
    </div>
  );

  return (
    <div className="modal-overlay">
      <div style={{
        background:'white', borderRadius:16, width:'min(960px,96vw)',
        boxShadow:'0 20px 60px rgba(0,0,0,.18)', overflow:'visible', position:'relative',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'18px 24px 14px', background:'#ffffff',borderBottom:'1px solid #f3f4f6',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:17, fontWeight:700, color:'#1e40af' }}>
            {L('विस्तृत खोज','Advance Search')}
          </span>
          <button onClick={onClose}
            style={{ background:'none',border:'none',cursor:'pointer',color:'#6b7280',
              fontSize:20,lineHeight:1,padding:'2px 6px',borderRadius:6 }}
            onMouseEnter={e=>e.currentTarget.style.background='#f3f4f6'}
            onMouseLeave={e=>e.currentTarget.style.background='none'}>✕</button>
        </div>

        {/* Body */}
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

          {/* Row 1: Month */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('महिना','Month')}>
              <SearchableCheckSelect
                options={monthOpts}
                value={String(localMonth)}
                onChange={v => setLocalMonth(v ? +v : month)}
                allLabel={useNP
                  ? (BS_MONTHS_NP[month-1] || '')
                  : (MONTHS_EN[month-1]    || '')}
              />
            </Field>
            <div />
            <div />
          </div>

          {/* Row 2: Staff | Branch | Department */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('कर्मचारी','Staff')}>
              <SearchableCheckSelect options={empOpts} value={local.staffId} showAvatar
                onChange={v=>set('staffId',v)} allLabel={L('सबै कर्मचारी','All Staff')} />
            </Field>
            <Field label={L('शाखा','Branch')}>
              <SearchableCheckSelect options={branches} value={local.branch}
                onChange={v=>set('branch',v)} allLabel={L('सबै शाखा','All Branches')} />
            </Field>
            <Field label={L('विभाग','Department')}>
              <SearchableCheckSelect options={depts} value={local.dept}
                onChange={v=>set('dept',v)} allLabel={L('सबै विभाग','All Depts')} />
            </Field>
          </div>

          {/* Row 3: Post | Grade | Mode */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('पद','Post')}>
              <SearchableCheckSelect options={posts} value={local.post}
                onChange={v=>set('post',v)} allLabel={L('सबै पद','All Posts')} />
            </Field>
            <Field label={L('ग्रेड','Grade')}>
              <SearchableCheckSelect options={grades} value={local.grade}
                onChange={v=>set('grade',v)} allLabel={L('सबै ग्रेड','All Grades')} />
            </Field>
            <Field label={L('नियुक्ति','Mode')}>
              <SearchableCheckSelect options={modes} value={local.mode}
                onChange={v=>set('mode',v)} allLabel={L('सबै मोड','All Modes')} />
            </Field>
          </div>

          {/* Row 4: Timing Type | Shift */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <Field label={L('टाइमिङ प्रकार','Timing Type')}>
              <SearchableCheckSelect options={timingTypes} value={local.timingType}
                onChange={v=>set('timingType',v)} allLabel={L('सबै प्रकार','All Types')} />
            </Field>
            <Field label={L('सिफ्ट','Shift')}>
              <SearchableCheckSelect options={shiftOpts} value={local.shift}
                onChange={v=>set('shift',v)} allLabel={L('सबै शिफ्ट','All Shifts')} />
            </Field>
            <div />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 24px 18px', borderTop:'1px solid #f3f4f6',
          display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button
            onClick={() => { onApply({ ...EMPTY_FILTERS }); onMonthChange(month); onClose(); }}
            style={{ padding:'8px 20px', border:'1.5px solid #d1d5db', borderRadius:8,
              background:'white', color:'#374151', fontSize:14, fontWeight:600, cursor:'pointer' }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='#9ca3af';e.currentTarget.style.background='#f9fafb';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='white';}}>
            {L('रिसेट','Reset')}
          </button>
          <button
            onClick={() => { onApply(local); onMonthChange(localMonth); onClose(); }}
            style={{ padding:'8px 24px', border:'none', borderRadius:8,
              background:'#1a56db', color:'white', fontSize:14, fontWeight:700,
              cursor:'pointer', boxShadow:'0 2px 8px rgba(26,86,219,.3)' }}
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
   Monthly Present Absent Report
═══════════════════════════════════════════════════════════════ */
const MonthlyPresentAbsentReport = () => {
  const [searchParams] = useSearchParams();
  const { language }   = useLanguage();
  const { settings }   = useSettings();
  const { filteredEmployees: allEmployees, shifts, getApprovedLeaveForDate, rosterVersion } = useData();
  const fd             = useDateFormat();
  const L = (np, en)   => language === 'np' ? np : en;

  const now    = getNepalNow();
  const useNP  = settings.defaultCalendar === 'np';
  const todayBS = adToBS(getNepalTodayISO());

  const urlYear  = parseInt(searchParams.get('year'));
  const urlMonth = parseInt(searchParams.get('month'));

  const initYM = () => {
    if (urlYear && urlMonth) {
      if (useNP) {
        const bs = adToBS(new Date(urlYear, urlMonth - 1, 15));
        if (bs) return { year: bs.year, month: bs.month };
      }
      return { year: urlYear, month: urlMonth };
    }
    return {
      year:  useNP ? (todayBS?.year  || now.getFullYear())  : now.getFullYear(),
      month: useNP ? (todayBS?.month || now.getMonth() + 1) : now.getMonth() + 1,
    };
  };

  const init = initYM();
  const currentFY = getCurrentFiscalYear(settings.fiscalYears || []);

  const { isEmployee, currentUser } = useAuth();
  const myEmpId = isEmployee ? String(currentUser?.id || '') : '';

  const [year,        setYear]        = useState(init.year);
  const [month,       setMonth]       = useState(init.month);
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [showSearch,  setShowSearch]  = useState(false);
  // Ctrl+A opens Advance Search — same shortcut across every report/page
  // that has one, skipped while typing in a text field so it doesn't hijack
  // native "select all text" there.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.key.toLowerCase() !== 'a') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      setShowSearch(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [filters,     setFilters]     = useState({ ...EMPTY_FILTERS, staffId: myEmpId });
  const [staffStatus, setStaffStatus] = useState('working'); // 'working' | 'notworking'
  const [exporting,   setExporting]   = useState(false);

  const dr = useReportDateRange();
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let apiUrl;
      if (dr.active) {
        apiUrl = `/attendance/present-absent?startDate=${dr.from}&endDate=${dr.to}`;
      } else if (useNP) {
        const startAD = bsToAD(year, month, 1);
        const endAD   = bsToAD(year, month, getBSDays(year, month));
        if (startAD && endAD) {
          apiUrl = `/attendance/present-absent?startDate=${isoDate(startAD)}&endDate=${isoDate(endAD)}`;
        }
      }
      if (!apiUrl) {
        const lastDay = new Date(year, month, 0).getDate();
        const pad = n => String(n).padStart(2,'0');
        const s = `${year}-${pad(month)}-01`;
        const e = `${year}-${pad(month)}-${pad(lastDay)}`;
        apiUrl = `/attendance/present-absent?startDate=${s}&endDate=${e}`;
      }
      apiUrl += `&active=${staffStatus === 'notworking' ? 'false' : 'true'}&orgScope=1`;
      setData(await api.get(apiUrl));
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }, [year, month, useNP, staffStatus, dr.active, dr.from, dr.to]);

  useEffect(() => { load(); }, [load, rosterVersion]);

  const period    = data?.period;
  const dates     = data?.dates     || [];
  const allRows = [...new Map((data?.employees || []).map(e => [e.id, e])).values()].map(emp => {
    const newDays = { ...emp.days };
    const newCodes = { ...(emp.leaveCodes || {}) };
    Object.keys(newDays).forEach(dateStr => {
      if (newDays[dateStr] === 'AB') {
        const leave = getApprovedLeaveForDate(emp.id, dateStr);
        if (leave) { newDays[dateStr] = 'L'; if (leave.leaveTypeCode) newCodes[dateStr] = leave.leaveTypeCode; }
      }
    });
    return { ...emp, days: newDays, leaveCodes: newCodes };
  });

  /* ── Client-side filtering ── */
  const nz = v => String(v ?? '').trim().toLowerCase();
  const employees = allRows.filter(e => {
    if (filters.staffId    && String(e.id) !== filters.staffId)           return false;
    if (filters.branch     && nz(e.branch)     !== nz(filters.branch))     return false;
    if (filters.dept       && nz(e.department) !== nz(filters.dept))       return false;
    if (filters.post       && nz(e.position)   !== nz(filters.post))       return false;
    if (filters.grade      && nz(e.grade)      !== nz(filters.grade))      return false;
    if (filters.mode       && nz(e.mode)       !== nz(filters.mode))       return false;
    if (filters.timingType && nz(e.timingType) !== nz(filters.timingType)) return false;
    if (filters.shift      && nz(e.shift)      !== nz(filters.shift))      return false;
    return true;
  });

  const activeFilterCount = Object.entries(filters).filter(([k,v]) => k !== '_status' && Boolean(v)).length;

  const periodLabel = () => {
    if (dr.active) return `${dr.from} → ${dr.to}`;
    const mn     = useNP ? (BS_MONTHS_NP[month-1] || '') : MONTHS_EN[month-1];
    const yr     = settings.nepaliDigits ? toNepaliDigits(year) : String(year);
    const calStr = useNP ? ' BS' : '';
    return `${mn} ${yr}${calStr}`;
  };

  /* Totals per date column */
  const dateTotals = dates.map(({ date }) => {
    let p=0, ab=0, l=0, ov=0;
    employees.forEach(e => {
      const st = e.days[date];
      if      (st==='P'||st==='PP'||st==='PP1'||st==='WP'||st==='WP1'||st==='P1') p++;
      else if (st==='AB')                       ab++;
      else if (st==='L'||st==='LH')             l++;
      else if (st==='OV')                        ov++;
    });
    return { p, ab, l, ov };
  });

  const grandP  = employees.reduce((s,e) => s + (e.totalP  || 0), 0);
  const grandAB = employees.reduce((s,e) => s + (e.totalAB || 0), 0);
  const grandL  = employees.reduce((s,e) => s + (e.totalL  || 0), 0);
  const grandOV = employees.reduce((s,e) => s + (e.totalOV || 0), 0);

  /* Branch short-name from settings — camelCase shortName */
  const branchShortMap = useMemo(() => {
    const m = {};
    (settings.branches||[]).forEach(b => {
      const sn = b.shortName || b.short_name;
      if (b.name && sn) m[b.name.toLowerCase().trim()] = sn;
    });
    return m;
  }, [settings.branches]);
  const resolveShort = emp =>
    branchShortMap[(emp.branch||'').toLowerCase().trim()]
    || (emp.branchShort && emp.branchShort !== '—' ? emp.branchShort : null)
    || emp.branch || '—';

  /* ── Column widths for sticky offset calculation ── */
  const W_SN      = 38;
  const W_STAFFID = 64;
  const W_NAME    = 160;
  const W_POST    = 50;
  const W_DEPT    = 50;
  const W_BRANCH  = 50;
  const L_SN      = 0;
  const L_STAFFID = L_SN + W_SN;
  const L_NAME    = L_STAFFID + W_STAFFID;
  const L_POST    = L_NAME + W_NAME;
  const L_DEPT    = L_POST + W_POST;
  const L_BRANCH  = L_DEPT + W_DEPT;

  /* ── Standard DataGrid header style (matches .dg-th) ── */
  const thBase = {
    background:'#efefef', color:'#374151',
    fontWeight:700, fontSize:12.5,
    borderRight:'1px solid #dedede', borderBottom:'2px solid #dedede',
    padding:'4px 8px', textAlign:'center',
    whiteSpace:'nowrap', position:'sticky', top:0, zIndex:3,
    userSelect:'none',
  };
  const thSub = {
    ...thBase, fontSize:11, borderBottom:'1px solid #dedede',
    padding:'3px 8px', top:29,
  };
  const thWeekend    = { ...thBase, background:'#e5e7eb', color:'#111827' };
  const thHoliday    = { ...thBase, background:'#fef3c7', color:'#92400e' };
  const thSubWeekend = { ...thSub,  background:'#e5e7eb', color:'#111827' };
  const thSubHoliday = { ...thSub, background:'#fef3c7', color:'#92400e' };
  const thTotalP   = { ...thBase, background:'#d1fae5', color:'#065f46' };
  const thTotalAB  = { ...thBase, background:'#fee2e2', color:'#991b1b' };
  const thTotalOT  = { ...thBase, background:'#d1fae5', color:'#059669' };

  const tdBase = {
    padding:'3px 8px', fontSize:12.5,
    borderRight:'1px solid #e5e7eb', borderBottom:'1px solid #f3f4f6',
    verticalAlign:'middle', whiteSpace:'nowrap', textAlign:'center',
  };

  const rptTitle = 'Monthly Present Absent Report';
  const rptSub = () => periodLabel();

  /* Print-only Nepali status label — Export deliberately stays English-only
     (statusText above) so the .xlsx reads the same for whoever opens it, but
     a printed page is a local, view-language document, so it should match
     what's already on screen (see STATUS_NP / statusDisplay). */
  const statusTextPrint = (st, code) => {
    const s = STATUS[st];
    if (!s) return '';
    const disp = withLeaveCode(language === 'np' ? (STATUS_NP[st] || s) : s, st, code);
    return disp.sup ? `${disp.main}(${disp.sup})` : disp.main;
  };

  const handlePrint = () => {
    if (!employees.length) return;
    const printTitle = L('मासिक उपस्थित/अनुपस्थित रिपोर्ट', rptTitle);
    // Sequential day numbers: BS mode = 1,2,...N; AD mode = actual AD day
    const dayHeaders = dates.map((d, idx) => {
      const num = useNP ? (idx + 1) : d.dayNum;
      const dispNum = settings.nepaliDigits ? toNepaliDigits(num) : num;
      const dow = language === 'np' ? (DOW_NP[d.dayKey] || d.dayKey.slice(0,3)) : d.dayKey.slice(0,3);
      return `<th style="padding:2px 3px;border:1px solid #dedede;background:#efefef;font-size:9px;text-align:center;white-space:nowrap">${dispNum}<br/><span style="font-weight:500;color:#6b7280">${dow}</span></th>`;
    }).join('');
    const dataRows = employees.map((e,i) => {
      const dayCells = dates.map(d => {
        const lbl = statusTextPrint(e.days[d.date], e.leaveCodes?.[d.date]);
        const bg = e.days[d.date]==='AB'?'#fff0f0':e.days[d.date]==='P'||e.days[d.date]==='PP'||e.days[d.date]==='PP1'||e.days[d.date]==='WP'||e.days[d.date]==='WP1'||e.days[d.date]==='PLH'?'#f0fff4':
                   e.days[d.date]==='H'?'#f9fafb':e.days[d.date]==='PH'?'#fffbeb':'white';
        const col = STATUS[e.days[d.date]]?.color || '#374151';
        return `<td style="padding:1px 2px;border:1px solid #e5e7eb;text-align:center;font-size:9px;font-weight:800;color:${col};background:${bg}">${lbl}</td>`;
      }).join('');
      const bg = i%2===0?'white':'#f9fafb';
      return `<tr style="background:${bg}">
        <td style="padding:2px 4px;border:1px solid #e5e7eb;text-align:center;font-size:8px;color:#6b7280;background:#efefef">${i+1}</td>
        <td style="padding:2px 4px;border:1px solid #e5e7eb;text-align:center;font-size:8px;font-weight:700;color:#374151">${e.empCode||'—'}</td>
        <td style="padding:2px 4px;border:1px solid #e5e7eb;font-size:9px;font-weight:700;color:#1f2937;white-space:nowrap">${e.fullName}</td>
        <td style="padding:2px 3px;border:1px solid #e5e7eb;text-align:center;font-size:8px;font-weight:700;color:#0369a1">${e.postShort||'—'}</td>
        <td style="padding:2px 3px;border:1px solid #e5e7eb;text-align:center;font-size:8px;font-weight:700;color:#059669">${e.deptShort||'—'}</td>
        <td style="padding:2px 3px;border:1px solid #e5e7eb;text-align:center;font-size:8px;font-weight:700;color:#7c3aed">${resolveShort(e)}</td>
        ${dayCells}
        <td style="padding:2px 4px;border:1px solid #e5e7eb;text-align:center;font-size:10px;font-weight:800;color:#065f46;background:#f0fdf4">${e.totalP}</td>
        <td style="padding:2px 4px;border:1px solid #e5e7eb;text-align:center;font-size:10px;font-weight:800;color:${e.totalAB>0?'#991b1b':'#d1d5db'};background:${e.totalAB>0?'#fff5f5':'white'}">${e.totalAB}</td>
        <td style="padding:2px 4px;border:1px solid #e5e7eb;text-align:center;font-size:10px;font-weight:800;color:#059669;background:#f0fdf4">${e.eligibleForOt ? (e.otApprovedFormatted||'—') : '—'}</td>
      </tr>`;
    }).join('');
    const TH = 'padding:3px 4px;border:1px solid #dedede;background:#efefef;font-size:9px;font-weight:700;text-align:center;';
    const contentHtml = `<table style="border-collapse:collapse;width:100%;table-layout:auto">
      <thead><tr>
        <th style="${TH}">SN</th>
        <th style="${TH}">${L('स्टाफ आईडी','Staff ID')}</th>
        <th style="${TH};text-align:left;min-width:80px">${L('कर्मचारी','Staff')}</th>
        <th style="${TH}">${L('पद','Post')}</th>
        <th style="${TH}">${L('विभाग','Dept')}</th>
        <th style="${TH}">${L('शाखा','Branch')}</th>
        ${dayHeaders}
        <th style="padding:3px 4px;border:1px solid #dedede;background:#d1fae5;color:#065f46;font-size:9px;font-weight:700">P</th>
        <th style="padding:3px 4px;border:1px solid #dedede;background:#fee2e2;color:#991b1b;font-size:9px;font-weight:700">AB</th>
        <th style="padding:3px 4px;border:1px solid #dedede;background:#d1fae5;color:#059669;font-size:9px;font-weight:700">OT</th>
      </tr></thead>
      <tbody>${dataRows}</tbody>
    </table>`;
    openPrintWindow(buildPrintDoc({ settings, language, reportTitle: printTitle, reportSub: rptSub(), contentHtml, isLandscape: true }), true);
  };

  /* ── Export to Excel (.xlsx via ExcelJS — xlsx/CSV can't write real
     styles/merges) — a proper letterhead (company name/address/logo) above
     the table, and every column visible on screen including the day-by-day
     status cells, which the old CSV export silently left blank (STATUS
     entries only have `main`/`sup`, never the `.label` it was reading). */
  const exportExcel = async () => {
    if (!employees.length || exporting) return;
    setExporting(true);
    setError(null);
    try {
    const companyName = language === 'np'
      ? (settings.companyNameNp || settings.companyNameEn || '')
      : (settings.companyNameEn || settings.companyNameNp || '');
    const companyAddr = language === 'np'
      ? (settings.companyAddressNp || settings.companyAddressEn || '')
      : (settings.companyAddressEn || settings.companyAddressNp || '');
    const companyPhone = settings.companyPhone ? `Tel: ${settings.companyPhone}` : '';

    const FIXED_COLS = ['SN', 'Staff ID', 'Staff', 'Post', 'Dept.', 'Branch'];
    const dayCols = dates.map((d, idx) => useNP ? (idx + 1) : d.dayNum);
    const dayDows = dates.map(d => d.dayKey.slice(0, 3));
    const dayIsWeekendHoliday = dates.map(d => d.isWeekend || d.isHoliday);
    const lastCol = FIXED_COLS.length + dayCols.length + 3; // + P, AB, OT

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Present Absent');

    const thin  = { style: 'thin',   color: { argb: 'FFDEDEDE' } };
    const heavy = { style: 'medium', color: { argb: 'FFC5CDD8' } };

    // ── Letterhead — company name/address/logo above the report, same as
    // every other printed report in the app. ──
    if (settings.companyLogo) {
      try {
        // settings.companyLogo is a full data: URL (used directly as an
        // <img src>elsewhere) — ExcelJS wants the bare base64 payload plus
        // a matching extension, not the data: URI itself.
        const m = settings.companyLogo.match(/^data:image\/(\w+);base64,(.+)$/);
        const ext = m?.[1] === 'jpg' ? 'jpeg' : m?.[1];
        if (m && ['png', 'jpeg', 'gif'].includes(ext)) {
          const imgId = wb.addImage({ base64: m[2], extension: ext });
          ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 48, height: 48 } });
        }
      } catch { /* bad/unsupported logo data — skip it, the rest of the header still renders */ }
    }
    [companyName, [companyAddr, companyPhone].filter(Boolean).join('  |  '), rptTitle,
      rptSub() + (period ? `   (${period.startDate} to ${period.endDate})` : ''), ''
    ].forEach((text, i) => {
      const row = ws.addRow([text]);
      ws.mergeCells(row.number, 1, row.number, lastCol);
      row.getCell(1).font = i === 0 ? { bold: true, size: 13 } : i === 2 ? { bold: true, size: 12 } : { size: 10, color: { argb: 'FF6B7280' } };
      row.getCell(1).alignment = { horizontal: 'center' };
      if (i === 0 && settings.companyLogo) row.height = 36;
    });
    // NOT a hardcoded 5 — when a company logo is embedded, ws.addImage()
    // with tl.row:0 shifts ExcelJS's internal row numbering by +1 (a real
    // ExcelJS quirk: the very first addRow() after addImage lands on row 2,
    // not row 1). A hardcoded offset then pointed the table-header merge
    // below at a row that was already part of the letterhead's own merged
    // range, throwing "Cannot merge already merged cells" — but only for
    // companies that actually have a logo configured. ws.rowCount always
    // reflects where the letterhead rows actually landed, image shift or not.
    const headerOffset = ws.rowCount;

    // ── Table header (2 rows, matching the on-screen layout) ──
    const hdr1 = ws.addRow([...FIXED_COLS, ...dayCols, 'P', 'AB', 'OT']);
    const hdr2 = ws.addRow([...FIXED_COLS.map(() => ''), ...dayDows, '', '', '']);
    // Merge BEFORE styling — ExcelJS drops any border/fill already applied
    // to a merged range's non-master cells the moment mergeCells() runs.
    [1, 2, 3, 4, 5, 6, lastCol - 2, lastCol - 1, lastCol].forEach(c => {
      ws.mergeCells(headerOffset + 1, c, headerOffset + 2, c);
    });
    [hdr1, hdr2].forEach((row, rowIdx) => {
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const dayIdx = colNum - FIXED_COLS.length - 1;
        const isDayCol = dayIdx >= 0 && dayIdx < dayCols.length;
        const weekendHoliday = isDayCol && dayIsWeekendHoliday[dayIdx];
        cell.font = { bold: true, size: 10.5, color: { argb: weekendHoliday ? 'FF111827' : 'FF374151' } };
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: weekendHoliday ? 'FFE5E7EB' : 'FFEFEFEF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { right: thin, bottom: rowIdx === 1 ? heavy : thin };
      });
    });
    ws.getRow(headerOffset + 1).getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };

    // ── Data rows — one per employee, matching the on-screen grid exactly ──
    employees.forEach((e, i) => {
      const post   = (settings.posts||[]).find(p=>p.name===e.position)?.shortName || e.postShort || e.position || '—';
      const dept   = (settings.departments||[]).find(d=>d.name===e.department)?.shortName || e.deptShort || e.department || '—';
      const branch = resolveShort(e);
      const row = ws.addRow([
        i + 1, e.empCode || '—', e.fullName, post, dept, branch,
        ...dates.map(d => statusText(e.days[d.date], e.leaveCodes?.[d.date])),
        e.totalP, e.totalAB, e.eligibleForOt ? (e.otApprovedFormatted || '—') : '—',
      ]);
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.alignment = { horizontal: colNum === 3 ? 'left' : 'center', vertical: 'middle' };
        cell.border = { right: thin, bottom: { style: 'thin', color: { argb: 'FFF3F4F6' } } };
      });
      row.getCell(lastCol - 2).font = { bold: true, color: { argb: 'FF065F46' } };
      row.getCell(lastCol - 1).font = { bold: true, color: { argb: e.totalAB > 0 ? 'FF991B1B' : 'FFD1D5DB' } };
      row.getCell(lastCol).font = { bold: true, color: { argb: 'FF059669' } };
    });

    // ── Leave Total / Office Visit Total summary rows — same two rows the
    // on-screen table appends below the staff list, only when there's
    // anything to summarize. ──
    if (grandL > 0) {
      const row = ws.addRow(['', '🌴 Leave Total', '', '', '', '', ...dateTotals.map(dt => dt.l > 0 ? dt.l : ''), grandL, '', '']);
      ws.mergeCells(row.number, 2, row.number, 6);
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.font = { bold: true, color: { argb: 'FF5B21B6' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
        cell.alignment = { horizontal: colNum === 2 ? 'left' : 'center', vertical: 'middle' };
        cell.border = { right: thin, bottom: thin };
      });
    }
    if (grandOV > 0) {
      const row = ws.addRow(['', '🚗 Office Visit Total', '', '', '', '', ...dateTotals.map(dt => dt.ov > 0 ? dt.ov : ''), '', grandOV, '']);
      ws.mergeCells(row.number, 2, row.number, 6);
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.font = { bold: true, color: { argb: 'FF1E40AF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
        cell.alignment = { horizontal: colNum === 2 ? 'left' : 'center', vertical: 'middle' };
        cell.border = { right: thin, bottom: thin };
      });
    }
    ws.getRow(ws.rowCount).eachCell({ includeEmpty: true }, cell => { cell.border = { ...cell.border, bottom: heavy }; });

    ws.columns = [
      { width: 5 }, { width: 11 }, { width: 20 }, { width: 8 }, { width: 8 }, { width: 8 },
      ...dayCols.map(() => ({ width: 6 })),
      { width: 7 }, { width: 7 }, { width: 7 },
    ];
    ws.views = [{ state: 'frozen', ySplit: headerOffset + 2 }];

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, `MonthlyPresentAbsent_${period?.startDate || ''}_${period?.endDate || ''}.xlsx`);
    } catch (err) {
      // Previously this threw silently — an unhandled rejection with no
      // visible feedback, indistinguishable from the button just not
      // working. Surface it through the same error banner the page's own
      // data load already uses.
      setError(`Export failed: ${err.message || 'Unknown error'}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            ✅ {L('मासिक उपस्थित/अनुपस्थित रिपोर्ट','Monthly Present Absent Report')}
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
              <span style={{ marginLeft:8, fontSize:11, color:'#9ca3af' }}>
                {fd(period.startDate)} → {fd(period.endDate)}
                <span style={{ marginLeft:5,background:'#f1f5f9',color:'#475569',
                  borderRadius:4,padding:'1px 6px',fontSize:10,fontWeight:600 }}>
                  {period.totalWorkingDays} {L('दिन','days')}
                </span>
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
          <button onClick={exportExcel} disabled={exporting}
            style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'0 14px',height:34,
              background:'#f0fdf4',border:'1px solid #86efac',color:'#15803d',
              borderRadius:8,fontSize:13,fontWeight:600,
              cursor: exporting ? 'default' : 'pointer', opacity: exporting ? .6 : 1 }}>
            {exporting ? '⏳ Exporting…' : '📥 Export'}
          </button>
          <ViewMonthlyBtn year={year} month={month} useNP={useNP}
            currentPath="/attendance/reports/monthly/present-absent" />
        </div>
      </div>

      {/* ── Period selector + controls ── */}
      <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap',justifyContent:'flex-end' }}>
        <ReportDateRange ctl={dr} />
        <select className="form-control" style={{ width:useNP?115:85,height:36,fontSize:13 }}
          disabled={dr.active} value={year} onChange={e=>setYear(+e.target.value)}>
          {useNP
            ? [todayBS?.year-1,todayBS?.year,todayBS?.year+1].filter(Boolean).map(y=>(
                <option key={y} value={y}>{settings.nepaliDigits?toNepaliDigits(y):y} BS</option>
              ))
            : [now.getFullYear()-1,now.getFullYear(),now.getFullYear()+1].map(y=>(
                <option key={y} value={y}>{y}</option>
              ))
          }
        </select>
        <select className="form-control" style={{ width:useNP?120:140,height:36,fontSize:13 }}
          disabled={dr.active} value={month} onChange={e=>setMonth(+e.target.value)}>
          {useNP
            ? BS_MONTHS_NP.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
            : MONTHS_EN.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)
          }
        </select>

        {/* Working / Not Working toggle */}
        <div style={{ display:'flex',gap:0,border:'1px solid #d1d5db',borderRadius:8,overflow:'hidden' }}>
          {[['working',L('कार्यरत','Working')],['notworking',L('अवकाश','Not Working')]].map(([v,label])=>(
            <button key={v}
              onClick={() => { setStaffStatus(v); setFilters(p => ({ ...p, staffId:'' })); }}
              style={{ padding:'5px 14px',border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
                background:staffStatus===v?'#1a56db':'white',
                color:staffStatus===v?'white':'#374151',transition:'background .15s' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Staff selector */}
        <span style={{ fontSize:13,fontWeight:600,color:'#374151',whiteSpace:'nowrap' }}>
          {L('कर्मचारी','Staff')} :
        </span>
        {/* Searchable, same control as the Half Present Absent Report */}
        <div style={{ width:240 }}>
          <SearchableCheckSelect showAvatar
            options={[...allRows]
              .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
              .map(r => {
                const emp = allEmployees.find(x => String(x.id) === String(r.id)) || {};
                return {
                  value: String(r.id),
                  label: r.fullName || emp.fullName || `Staff ${r.id}`,
                  sub:   [emp.employeeId, emp.position].filter(Boolean).join(' - '),
                  photo: emp.profilePhoto,
                };
              })}
            value={filters.staffId}
            onChange={v => setFilters(p => ({ ...p, staffId: v }))}
            allLabel={L('सबै कर्मचारी','All Staff')} />
        </div>

        {/* Advance Search button */}
        <button onClick={() => setShowSearch(true)}
          style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'0 14px',height:36,
            background: activeFilterCount > 0 ? '#ede9fe' : '#f5f3ff',
            border: `1.5px solid ${activeFilterCount > 0 ? '#7c3aed' : '#c4b5fd'}`,
            color: activeFilterCount > 0 ? '#5b21b6' : '#6d28d9',
            borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',transition:'all .15s' }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
          </svg>
          {L('विस्तृत खोज','Advance Search')}
          {activeFilterCount > 0 && (
            <span style={{ background:'#1a56db',color:'white',borderRadius:'50%',
              width:18,height:18,display:'inline-flex',alignItems:'center',justifyContent:'center',
              fontSize:11,fontWeight:800 }}>{activeFilterCount}</span>
          )}
        </button>

        <button className="btn btn-outline btn-sm" style={{ height:36 }} onClick={load} disabled={loading}>🔃</button>
      </div>

      {error && (
        <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,
          padding:'10px 16px',marginBottom:12,color:'#991b1b',fontWeight:600 }}>
          ❌ {error}
        </div>
      )}

      {loading && <LoadingIndicator />}

      {/* ── Matrix Table ── */}
      {!loading && data && (
        <div style={{ overflowX:'auto', borderRadius:8, border:'1px solid #dedede',
          boxShadow:'0 1px 3px rgba(0,0,0,.07)' }}>
          <table style={{ borderCollapse:'collapse', width:'100%', minWidth:600 }}>
            <thead>
              {/* Row 1 — column labels */}
              <tr>
                <th style={{ ...thBase, width:W_SN, minWidth:W_SN, left:L_SN, position:'sticky', zIndex:4 }}>SN</th>
                <th style={{ ...thBase, textAlign:'left', width:W_STAFFID, minWidth:W_STAFFID, left:L_STAFFID, position:'sticky', zIndex:4 }}>
                  {L('स्टाफ आईडी','Staff ID')}
                </th>
                <th style={{ ...thBase, textAlign:'left', minWidth:W_NAME, left:L_NAME, position:'sticky', zIndex:4 }}>
                  {L('कर्मचारी','Staff')}
                </th>
                <th style={{ ...thBase, width:W_POST, minWidth:W_POST, left:L_POST, position:'sticky', zIndex:4 }}>{L('पद','Post')}</th>
                <th style={{ ...thBase, width:W_DEPT, minWidth:W_DEPT, left:L_DEPT, position:'sticky', zIndex:4 }}>{L('विभाग','Dept.')}</th>
                <th style={{ ...thBase, width:W_BRANCH, minWidth:W_BRANCH, left:L_BRANCH, position:'sticky', zIndex:4 }}>{L('शाखा','Branch')}</th>

                {dates.map(({ date, dayNum, isWeekend, isHoliday }, dateIdx) => {
                  // BS mode: sequential day number (1…N for the BS month)
                  // AD mode: the actual AD day of month
                  const dispNum = useNP
                    ? (settings.nepaliDigits ? toNepaliDigits(dateIdx + 1) : dateIdx + 1)
                    : dayNum;
                  return (
                    <th key={date} style={{
                      ...(isWeekend ? thWeekend : isHoliday ? thHoliday : thBase),
                      minWidth:32, fontSize:11,
                    }}>
                      {dispNum}
                    </th>
                  );
                })}
                <th style={{ ...thTotalP,  minWidth:38 }}>P</th>
                <th style={{ ...thTotalAB, minWidth:38 }}>AB</th>
                <th style={{ ...thTotalOT, minWidth:44 }}>OT</th>
              </tr>

              {/* Row 2 — day abbreviations */}
              <tr>
                <th style={{ ...thSub, left:L_SN,     position:'sticky', zIndex:4 }}></th>
                <th style={{ ...thSub, textAlign:'left', left:L_STAFFID, position:'sticky', zIndex:4 }}></th>
                <th style={{ ...thSub, textAlign:'left', left:L_NAME, position:'sticky', zIndex:4 }}></th>
                <th style={{ ...thSub, left:L_POST,   position:'sticky', zIndex:4 }}></th>
                <th style={{ ...thSub, left:L_DEPT,   position:'sticky', zIndex:4 }}></th>
                <th style={{ ...thSub, left:L_BRANCH, position:'sticky', zIndex:4 }}></th>

                {dates.map(({ date, dayKey, isWeekend, isHoliday }) => (
                  <th key={date} style={{
                    ...(isWeekend ? thSubWeekend : isHoliday ? thSubHoliday : thSub),
                    fontSize:10,
                  }}>
                    {language === 'np' ? (DOW_NP[dayKey] || dayKey.slice(0,3)) : dayKey.slice(0,3)}
                  </th>
                ))}
                <th style={{ ...thSub, background:'#d1fae5', color:'#065f46' }}>Total</th>
                <th style={{ ...thSub, background:'#fee2e2', color:'#991b1b' }}>Total</th>
                <th style={{ ...thSub, background:'#d1fae5', color:'#059669' }}>Total</th>
              </tr>
            </thead>

            <tbody>
              {employees.length === 0 && (
                <tr>
                  <td colSpan={6 + dates.length + 3}
                    style={{ textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:13 }}>
                    {L('कुनै कर्मचारी भेटिएन','No staff found matching the filters')}
                  </td>
                </tr>
              )}

              {employees.map((emp, idx) => (
                <tr key={emp.id}
                  style={{ background: idx%2===0 ? 'white' : '#f3f4f6' }}
                  onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
                  onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?'white':'#f3f4f6'}>

                  {/* SN — sticky */}
                  <td style={{ ...tdBase, fontWeight:600, color:'#6b7280',
                    width:W_SN, position:'sticky', left:L_SN, background:'#efefef', zIndex:1,
                    borderRight:'1px solid #dedede' }}>
                    {idx+1}
                  </td>
                  {/* Staff ID — sticky */}
                  <td style={{ ...tdBase, textAlign:'left', color:'#1f2937',
                    width:W_STAFFID, position:'sticky', left:L_STAFFID, background:'inherit', zIndex:1,
                    whiteSpace:'nowrap' }}>
                    {emp.empCode || '—'}
                  </td>
                  {/* Name — sticky, auto-width */}
                  <td style={{ ...tdBase, textAlign:'left', color:'#1f2937',
                    position:'sticky', left:L_NAME, background:'inherit', zIndex:1,
                    minWidth:W_NAME, whiteSpace:'nowrap' }}>
                    <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <Avatar photo={emp.profilePhoto} name={emp.fullName} size={20} />
                      {emp.fullName}
                    </span>
                  </td>
                  {/* Post — sticky */}
                  <td style={{ ...tdBase, color:'#1f2937', textAlign:'left',
                    width:W_POST, position:'sticky', left:L_POST, background:'inherit', zIndex:1 }}
                    title={emp.position}>
                    {(settings.posts||[]).find(p=>p.name===emp.position)?.shortName || emp.postShort || emp.position || '—'}
                  </td>
                  {/* Dept — sticky */}
                  <td style={{ ...tdBase, color:'#1f2937', textAlign:'left',
                    width:W_DEPT, position:'sticky', left:L_DEPT, background:'inherit', zIndex:1 }}
                    title={emp.department}>
                    {(settings.departments||[]).find(d=>d.name===emp.department)?.shortName || emp.deptShort || emp.department || '—'}
                  </td>
                  {/* Branch — sticky, short name from settings */}
                  <td style={{ ...tdBase, color:'#1f2937', textAlign:'left',
                    width:W_BRANCH, position:'sticky', left:L_BRANCH, background:'inherit', zIndex:1 }}
                    title={emp.branch}>
                    {resolveShort(emp)}
                  </td>

                  {dates.map(({ date }) => (
                    <td key={date} style={{ ...tdBase, padding:'3px' }}>
                      <StatusCell st={emp.days[date]} language={language} code={emp.leaveCodes?.[date]} />
                    </td>
                  ))}

                  <td style={{ ...tdBase, fontWeight:800, color:'#065f46',
                    background:'#f0fdf4' }}>{emp.totalP}</td>
                  <td style={{ ...tdBase, fontWeight:800,
                    color:emp.totalAB>0?'#991b1b':'#d1d5db',
                    background:emp.totalAB>0?'#fff5f5':'white' }}>{emp.totalAB}</td>
                  <td style={{ ...tdBase, fontWeight:800,
                    color: (emp.eligibleForOt && emp.otApprovedFormatted!=='—') ? '#059669' : '#d1d5db',
                    background: (emp.eligibleForOt && emp.otApprovedFormatted!=='—') ? '#f0fdf4' : 'white' }}>
                    {emp.eligibleForOt ? (emp.otApprovedFormatted||'—') : '—'}
                  </td>
                </tr>
              ))}

              {/* Leave summary row */}
              {employees.length > 0 && grandL > 0 && (
                <tr style={{ background:'#faf5ff', borderTop:'2px solid #ddd6fe' }}>
                  <td style={{ ...tdBase, background:'#ede9fe', color:'#6b7280', fontWeight:600,
                    position:'sticky', left:0, zIndex:3, borderRight:'1px solid #dedede' }}></td>
                  <td colSpan={5} style={{ ...tdBase, fontWeight:700, color:'#5b21b6',
                    textAlign:'left', background:'#ede9fe',
                    position:'sticky', left:W_SN, zIndex:3 }}>
                    🌴 {L('बिदा जम्मा','Leave Total')}
                  </td>
                  {dateTotals.map((dt, i) => (
                    <td key={i} style={{ ...tdBase, textAlign:'center', fontWeight:700,
                      color: dt.l > 0 ? '#7c3aed' : '#d1d5db' }}>
                      {dt.l > 0 ? dt.l : '—'}
                    </td>
                  ))}
                  <td style={{ ...tdBase, fontWeight:800, color:'#5b21b6', background:'#ede9fe', textAlign:'center' }}>{grandL}</td>
                  <td style={{ ...tdBase, color:'#d1d5db', textAlign:'center' }}>—</td>
                  <td style={{ ...tdBase, color:'#d1d5db', textAlign:'center' }}>—</td>
                </tr>
              )}

              {/* Office Visit summary row */}
              {employees.length > 0 && grandOV > 0 && (
                <tr style={{ background:'#eff6ff', borderTop:'1px solid #bfdbfe' }}>
                  <td style={{ ...tdBase, background:'#dbeafe', color:'#6b7280', fontWeight:600,
                    position:'sticky', left:0, zIndex:3, borderRight:'1px solid #dedede' }}></td>
                  <td colSpan={5} style={{ ...tdBase, fontWeight:700, color:'#1e40af',
                    textAlign:'left', background:'#dbeafe',
                    position:'sticky', left:W_SN, zIndex:3 }}>
                    🚗 {L('कार्यालय भ्रमण जम्मा','Office Visit Total')}
                  </td>
                  {dateTotals.map((dt, i) => (
                    <td key={i} style={{ ...tdBase, textAlign:'center', fontWeight:700,
                      color: dt.ov > 0 ? '#2563eb' : '#d1d5db' }}>
                      {dt.ov > 0 ? dt.ov : '—'}
                    </td>
                  ))}
                  <td style={{ ...tdBase, color:'#d1d5db', textAlign:'center' }}>—</td>
                  <td style={{ ...tdBase, fontWeight:800, color:'#1e40af', background:'#dbeafe', textAlign:'center' }}>{grandOV}</td>
                  <td style={{ ...tdBase, color:'#d1d5db', textAlign:'center' }}>—</td>
                </tr>
              )}

            </tbody>
          </table>
        </div>
      )}

      {/* ── Legend ── */}
      {!loading && employees.length > 0 && (
        <div style={{ marginTop:10, padding:'10px 14px', background:'#f9fafb',
          borderRadius:8, border:'1px solid #e5e7eb' }}>
          <div style={{ fontWeight:700, fontSize:12, color:'#374151', marginBottom:6 }}>
            {L('व्याख्या','Legend')}:
          </div>
          <div style={{ display:'flex',gap:12,flexWrap:'wrap',fontSize:11 }}>
            {[
              { st:'P',  desc:L('उपस्थित','Present')                   },
              { st:'P1', desc:L('एकल पन्च','Single Punch')              },
              { st:'AB', desc:L('अनुपस्थित','Absent')                  },
              { st:'H',  desc:L('सप्ताहन्त (स)','Weekend (W)')   },
              { st:'DO', desc:L('डे अफ','Day Off')                     },
              { st:'NO', desc:L('नाइट अफ','Night Off')                 },
              { st:'L',  desc:L('बिदा','Leave')                        },
              { st:'LH', desc:L('आधा दिन बिदा','Half-day Leave')       },
              { st:'PLH',desc:L('उपस्थित + आधा दिन बिदा','Present + Half-day Leave') },
              { st:'OV', desc:L('कार्यालय भ्रमण','Office Visit')       },
              { st:'PH', desc:L('सार्वजनिक बिदा','Public Holiday')     },
              { st:'PP', desc:L('सार्वजनिक बिदामा उपस्थित (H.P)','Present on Public Holiday (H.P)') },
              { st:'WP', desc:L('सप्ताहन्तमा उपस्थित (W.P)','Present on Weekend (W.P)') },
            ].map(({ st, desc }) => {
              const s = STATUS[st];
              const disp = statusDisplay(st, language);
              return (
                <div key={st} style={{ display:'flex',alignItems:'center',gap:5 }}>
                  <span style={{ color:s.color, fontWeight:800 }}>
                    {disp.main}{disp.sup && <sup style={{ fontSize:8 }}>{disp.sup}</sup>}
                  </span>
                  <span style={{ color:'#6b7280' }}>= {desc}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Advanced Search Modal ── */}
      {showSearch && (
        <AdvanceSearchModal
          filters={filters}
          onApply={f => { setFilters({ ...f, staffId: myEmpId || f.staffId }); setStaffStatus(f._status || 'working'); }}
          onClose={() => setShowSearch(false)}
          L={L}
          settings={settings}
          employees={allEmployees}
          shifts={shifts}
          month={month}
          onMonthChange={setMonth}
          useNP={useNP}
        />
      )}
    </div>
  );
};

export default MonthlyPresentAbsentReport;
