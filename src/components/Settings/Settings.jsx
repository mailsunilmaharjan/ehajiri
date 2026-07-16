import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { APP_VERSION, DB_VERSION } from '../../version.js';
import api, { getToken } from '../../api/client.js';
import ZKTecoDeviceSettings from './ZKTecoDeviceSettings.jsx';
import StandAloneDeviceSettings from './StandAloneDeviceSettings.jsx';
import ProfileTab from '../Common/ProfileTab.jsx';
import BugFinder from './BugFinder.jsx';
import {
  FORMAT_OPTIONS, formatDate,
  adToBS, bsToAD,
  BS_DATA, BS_MONTHS_NP, BS_MONTHS_EN, getBSDays,
  toNepaliDigits,
} from '../../utils/dateUtils.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import useNewShortcut from '../../hooks/useNewShortcut.js';

/* ─────────────── constants ─────────────── */
const ALL_DAYS = [
  { key:'Sun', np:'आइतबार',  en:'Sunday'    },
  { key:'Mon', np:'सोमबार',  en:'Monday'    },
  { key:'Tue', np:'मंगलबार', en:'Tuesday'   },
  { key:'Wed', np:'बुधबार',  en:'Wednesday' },
  { key:'Thu', np:'बिहीबार', en:'Thursday'  },
  { key:'Fri', np:'शुक्रबार',en:'Friday'    },
  { key:'Sat', np:'शनिबार',  en:'Saturday'  },
];
const LOGO_MAX_KB = 500;
const LOGO_MIN_AR = 1.5;
const LOGO_MAX_AR = 7.0;
const PREVIEW_DATE = new Date(2026, 4, 27);

const SHIFT_DAYS = [
  { key:'Sun', np:'आइत', en:'Sun' },
  { key:'Mon', np:'सोम',  en:'Mon' },
  { key:'Tue', np:'मंगल', en:'Tue' },
  { key:'Wed', np:'बुध',  en:'Wed' },
  { key:'Thu', np:'बिही', en:'Thu' },
  { key:'Fri', np:'शुक्र',en:'Fri' },
  { key:'Sat', np:'शनि',  en:'Sat' },
];
const SHIFT_COLORS = ['#52b02c','#0e9f6e','#e3a008','#f05252','#7e3af2','#e74694','#111827'];

/* ── shared table styles ── */
const thStyle = {
  padding:'9px 14px', textAlign:'left', fontSize:11,
  fontWeight:700, color:'#3a4a5c', textTransform:'uppercase',
  letterSpacing:'.5px', whiteSpace:'nowrap',
  background:'#f0f5fa', borderBottom:'2px solid #c8d6e5',
  borderRight:'1px solid #dce6f0',
};
const tdStyle = {
  padding:'9px 14px', fontSize:13,
  borderBottom:'1px solid #dce6f0', borderRight:'1px solid #e8f0f8',
  color:'#1f2937',
};

/* ─────────────── time helpers ─────────────── */
const calcHours = (start, end) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return Math.round(diff / 60 * 10) / 10;
};

/* ─────────────── helper: cell render ─────────────── */
const renderCellValue = (field, value, L) => {
  if (field.key === 'isDefault') {
    return value
      ? <span style={{ background:'#dcfce7', color:'#166534', padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700, border:'1px solid #bbf7d0', display:'inline-block' }}>{L('छ','Yes')}</span>
      : <span style={{ color:'#d1d5db', fontSize:13 }}>—</span>;
  }
  if (field.key === 'statusType') {
    return value === 'Working'
      ? <span style={{ background:'#dcfce7', color:'#15803d', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600 }}>{L('कार्यरत','Working')}</span>
      : <span style={{ background:'#fee2e2', color:'#b91c1c', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600 }}>{L('कार्यरत नभएको','Not Working')}</span>;
  }
  if (field.key === 'rankingOrder') {
    return <span style={{ fontWeight:700, color:'#6366f1', fontSize:13 }}>{value ?? '—'}</span>;
  }
  return <span>{String(value ?? '—')}</span>;
};

/* ─────────────── helper: form field render ─────────────── */
const renderFormField = (field, form, setForm, errors, L, fd, calendar) => {
  const val = form[field.key];
  if (field.type === 'date') {
    if (calendar === 'np') {
      return (
        <NepaliDatePicker
          value={val ?? ''}
          onChange={newVal => setForm(p => ({ ...p, [field.key]: newVal }))}
          error={!!errors[field.key]}
          maxToday={false}
        />
      );
    }
    return (
      <input type="date"
        className={`form-control ${errors[field.key] ? 'error' : ''}`}
        value={val ?? ''}
        onChange={e => setForm(p => ({ ...p, [field.key]: e.target.value }))}
      />
    );
  }
  if (field.type === 'boolean') {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:4 }}>
        <div
          style={{ width:44, height:24, background:val?'#52b02c':'#d1d5db', borderRadius:12, position:'relative', transition:'background .2s', cursor:'pointer', flexShrink:0 }}
          onClick={() => setForm(p => ({ ...p, [field.key]: !p[field.key] }))}
        >
          <div style={{ position:'absolute', top:2, left:val?22:2, width:20, height:20, background:'white', borderRadius:'50%', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}></div>
        </div>
        <span style={{ fontSize:13, color:val?'#52b02c':'#6b7280', fontWeight:val?600:400 }}>
          {val ? L('हो — डिफल्ट','Yes — Default') : L('होइन','No')}
        </span>
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <select className={`form-control ${errors[field.key]?'error':''}`}
        value={val||''}
        onChange={e => setForm(p => ({ ...p, [field.key]: e.target.value }))}>
        <option value="">— {L('छान्नुस','Select')} —</option>
        {(field.options||[]).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <input type={field.type||'text'}
      className={`form-control ${errors[field.key]?'error':''}`}
      placeholder={field.placeholder||''}
      value={val ?? ''}
      onChange={e => setForm(p => ({
        ...p,
        [field.key]: field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value
      }))}
    />
  );
};

/* ─────────────── small components ─────────────── */
const DayBadge = ({ dayKeys, language }) => (
  <div style={{ display:'flex', gap:4, flexWrap:'nowrap' }}>
    {ALL_DAYS.map(d => {
      const on = dayKeys?.includes(d.key);
      return (
        <span key={d.key} style={{
          padding:'2px 7px', borderRadius:5, fontSize:11, fontWeight:600,
          background: on ? '#dcfce7' : '#f3f4f6',
          color:      on ? '#166534' : '#9ca3af',
          border:`1px solid ${on ? '#bbf7d0' : '#e5e7eb'}`,
        }}>{language==='np' ? d.np : d.key}</span>
      );
    })}
  </div>
);

const DateInputWithPreview = ({ label, value, onChange, min }) => (
  <div className="form-group">
    {label && <label className="form-label">{label}</label>}
    <input type="date" className="form-control" value={value} min={min}
      onChange={e => onChange(e.target.value)} />
  </div>
);

/* ═══════════════════════════════════════════════════════════
   BSDatePicker — Nepali (BS) year/month/day dropdowns
   • value / onChange  use YYYY-MM-DD AD strings (for storage)
   • displays and lets the user pick in Bikram Sambat
════════════════════════════════════════════════════════════ */
const BS_YEARS = Object.keys(BS_DATA).map(Number).sort((a, b) => a - b);

const BSDatePicker = ({ value, onChange, error, allowedYears }) => {
  const { settings } = useSettings();
  const { language }  = useLanguage();

  const todayBs = adToBS(new Date()) || { year: 2082, month: 1, day: 1 };

  const parseBs = (adVal) => {
    if (!adVal) return null;
    return adToBS(adVal) || null;
  };

  const [bsDate, setBsDate] = useState(() => parseBs(value));
  /* Track which dropdowns the user has explicitly touched for independent highlighting */
  const [touched, setTouched] = useState(() => {
    const bs = parseBs(value);
    return { year: !!bs, month: !!bs, day: !!bs };
  });
  const lastValueRef = useRef(value);

  // Sync when parent changes the value (e.g. editing a different record)
  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      const bs = parseBs(value);
      setBsDate(bs);
      setTouched({ year: !!bs, month: !!bs, day: !!bs });
    }
  }, [value]);

  const commit = (year, month, day) => {
    const safeDay = Math.min(day, getBSDays(year, month));
    const ad = bsToAD(year, month, safeDay);
    if (!ad || isNaN(ad)) return;
    // Build local ISO string (avoids UTC timezone shift)
    const y  = ad.getFullYear();
    const m  = String(ad.getMonth() + 1).padStart(2, '0');
    const d  = String(ad.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    lastValueRef.current = iso;
    setBsDate({ year, month, day: safeDay });
    onChange(iso);
  };

  const useNp  = settings.nepaliDigits;
  const fmt    = (n) => useNp ? toNepaliDigits(n) : String(n);
  const L2     = (np, en) => language === 'np' ? np : en;

  const curYear  = bsDate?.year  ?? todayBs.year;
  const curMonth = bsDate?.month ?? todayBs.month;
  const curDay   = bsDate?.day   ?? 1;
  const maxDay   = getBSDays(curYear, curMonth);
  const safeDay  = Math.min(curDay, maxDay);

  /* Each dropdown is highlighted independently based on whether it was explicitly touched */
  const sel = (hasValue) => ({
    flex: 1, padding: '7px 6px',
    border: `1.5px solid ${error ? '#ef4444' : hasValue ? '#52b02c' : '#d1d5db'}`,
    borderRadius: 6, fontSize: 13, outline: 'none',
    background: hasValue ? '#f0fdf4' : 'white',
    cursor: 'pointer',
    color: hasValue ? '#166534' : '#1f2937',
    fontWeight: hasValue ? 600 : 400,
    transition: 'border-color .15s, background .15s',
  });

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {/* ── Year ── */}
      <select
        style={{ ...sel(touched.year), flex: 2.2 }}
        value={bsDate ? curYear : ''}
        onChange={e => {
          const y = Number(e.target.value);
          setTouched(p => ({ ...p, year: true }));
          commit(y, curMonth, safeDay);
        }}
      >
        {!bsDate && <option value="">— {L2('वर्ष','Year')} —</option>}
        {(allowedYears || BS_YEARS).map(y => (
          <option key={y} value={y}>{fmt(y)}</option>
        ))}
      </select>

      {/* ── Month ── */}
      <select
        style={{ ...sel(touched.month), flex: 2.5 }}
        value={bsDate ? curMonth : ''}
        onChange={e => {
          const m = Number(e.target.value);
          setTouched(p => ({ ...p, month: true }));
          commit(curYear, m, safeDay);
        }}
      >
        {!bsDate && <option value="">— {L2('महिना','Month')} —</option>}
        {BS_MONTHS_NP.map((np, i) => (
          <option key={i + 1} value={i + 1}>
            {language === 'np' ? np : BS_MONTHS_EN[i]}
          </option>
        ))}
      </select>

      {/* ── Day ── */}
      <select
        style={{ ...sel(touched.day), flex: 1 }}
        value={bsDate ? safeDay : ''}
        onChange={e => {
          const d = Number(e.target.value);
          setTouched(p => ({ ...p, day: true }));
          commit(curYear, curMonth, d);
        }}
      >
        {!bsDate && <option value="">—</option>}
        {Array.from({ length: maxDay }, (_, i) => i + 1).map(d => (
          <option key={d} value={d}>{fmt(d)}</option>
        ))}
      </select>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   SetupSection — mini-DataGrid with sub-nav style header
════════════════════════════════════════════════════════════ */
const SetupSection = ({ title, data, fields, sortKey, onSave, onDelete }) => {
  const { t, language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const fd = useDateFormat();
  const { settings } = useSettings();

  const [modal,      setModal]      = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [form,       setForm]       = useState({});
  const [errors,     setErrors]     = useState({});
  const [delConfirm, setDelConfirm] = useState(null);

  const buildEmpty = () =>
    fields.reduce((acc, f) => ({
      ...acc,
      [f.key]: f.default !== undefined ? f.default
             : f.type === 'boolean' ? false
             : f.type === 'number'  ? ''
             : '',
    }), {});

  const openAdd  = () => { setForm(buildEmpty()); setErrors({}); setEditId(null); setModal(true); };
  const openEdit = (item) => { setForm({ ...item }); setErrors({}); setEditId(item.id); setModal(true); };

  const validate = () => {
    const errs = {};
    fields.filter(f => f.required).forEach(f => {
      if (String(form[f.key] ?? '').trim() === '') errs[f.key] = L('आवश्यक छ','Required');
    });
    return errs;
  };

  const handleSave = () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave(editId, { ...form });
    setModal(false);
  };

  /* Ctrl+S saves the Add/Edit modal — same action as the Save button */
  useSaveShortcut(modal, handleSave);
  /* Ctrl+N opens the Add modal when not already open */
  useNewShortcut(!modal, openAdd);

  /* Build DataGrid columns from field definitions */
  const visibleFields = fields.filter(f => f.column !== false);
  const columns = [
    ...visibleFields.map(f => ({
      field:      f.key,
      header:     f.header || f.key,
      width:      f.width,
      sortable:   f.sortable !== false,
      filterable: f.filterable !== false,
      render:     f.renderCell
        ? (v, row) => f.renderCell(v, row)
        : (v)      => renderCellValue(f, v, L),
    })),
    {
      field: 'actions', header: L('कार्य','Actions'), width: 80,
      sortable: false, filterable: false,
      render: (_, row) => (
        <div className="dg-actions">
          <button className="dg-action-btn edit" title={L('सम्पादन','Edit')}
            onClick={e => { e.stopPropagation(); openEdit(row); }}>✏</button>
          <button className="dg-action-btn delete" title={L('मेटाउनुस','Delete')}
            disabled={!!row.isSystem || !!row.isDefault}
            style={(row.isSystem || row.isDefault) ? { opacity:.3, cursor:'not-allowed' } : {}}
            onClick={e => {
              e.stopPropagation();
              if (!row.isSystem && !row.isDefault) setDelConfirm(row.id);
            }}>🗑</button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ marginBottom:0 }}>
      {/* ── DataGrid (handles search, sort, pagination, keyboard nav, bulk select) ── */}
      <DataGrid
        columns={columns}
        data={data}
        defaultPageSize={10}
        showSearch={true}
        searchPlaceholder={L('खोज्नुस...','Search...')}
        compact={true}
        onRowDoubleClick={openEdit}
        onDeleteKey={row => { if (!row.isSystem && !row.isDefault) setDelConfirm(row.id); }}
        onDeleteSelected={ids => {
          ids.filter(id => {
            const item = data.find(d => d.id === id);
            return item && !item.isSystem && !item.isDefault;
          }).forEach(id => onDelete(id));
        }}
        toolbar={
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            + {L('नयाँ थप्नुस','Add New')}
          </button>
        }
      />

      {/* ── Add/Edit Modal ── */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#f0fdf4,#f0fdf4)' }}>
              <h2>
                {editId ? `✏️ ${L('सम्पादन','Edit')} — ${title}` : `+ ${L('नयाँ','New')} — ${title}`}
              </h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {fields.map(f => (
                <div key={f.key} className="form-group" style={{ marginBottom:14 }}>
                  <label className="form-label">
                    {f.header}
                    {f.required && <span style={{ color:'#ef4444', marginLeft:2 }}>*</span>}
                  </label>
                  {renderFormField(f, form, setForm, errors, L, fd, settings.defaultCalendar)}
                  {errors[f.key] && <div className="form-error">{errors[f.key]}</div>}
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(false)}>{t('Cancel')}</button>
              <SaveButton onClick={handleSave} label={t('Save')} />
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {delConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚠️ {L('मेटाउने पुष्टि','Delete Confirmation')}</h2>
              <button className="modal-close" onClick={() => setDelConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p>{L('के तपाईं यो रेकर्ड मेटाउन चाहनुहुन्छ?','Are you sure you want to delete this record?')}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDelConfirm(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={() => {
                onDelete(delConfirm);
                setDelConfirm(null);
              }}>🗑 {t('Delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   ShiftInlineSection — full shift management in Settings
════════════════════════════════════════════════════════════ */
const defaultShiftForm = {
  name:'', nameEn:'', code:'',
  startTime:'09:00', endTime:'17:00', workHours:8,
  gracePeriodStart:5, gracePeriodEnd:5,
  makeDefault:false, active:true,
  exceptionalDayEnabled:false, exceptionalDays:[],
  exceptionalStartTime:'09:00', exceptionalEndTime:'17:00', exceptionalWorkHours:8,
  winterPolicyEnabled:false,
  winterPolicy:{ startDate:'', endDate:'', startTime:'10:00', endTime:'16:00', workHours:6, gracePeriodStart:5, gracePeriodEnd:5 },
};

const ShiftInlineSection = () => {
  const { t, language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const { shifts, addShift, updateShift, deleteShift, refreshShifts, refreshEmployees, employees } = useData();
  const { isAdmin, isManager } = useAuth();

  const [modal,             setModal]             = useState(false);
  const [editId,            setEditId]            = useState(null);
  const [form,              setForm]              = useState({ ...defaultShiftForm });
  const [errors,            setErrors]            = useState({});
  const [delConfirm,        setDelConfirm]        = useState(null);
  const [winterModal,       setWinterModal]       = useState(false);
  const [winterTemp,        setWinterTemp]        = useState({});
  const [toast,             setToast]             = useState(null);
  const [defaultConflict,   setDefaultConflict]   = useState(null); // existing default shift when trying to replace

  const showToast = (msg, type='success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2800); };

  const hc = (field, val) => {
    setForm(prev => {
      const u = { ...prev, [field]: val };
      if (field === 'startTime' || field === 'endTime')
        u.workHours = calcHours(u.startTime, u.endTime);
      if (field === 'exceptionalStartTime' || field === 'exceptionalEndTime')
        u.exceptionalWorkHours = calcHours(u.exceptionalStartTime, u.exceptionalEndTime);
      return u;
    });
    setErrors(p => ({ ...p, [field]:'' }));
  };

  const openAdd  = () => { setForm({ ...defaultShiftForm }); setErrors({}); setEditId(null); setModal(true); };
  const openEdit = (s) => {
    setForm({
      ...defaultShiftForm, ...s,
      winterPolicy: s.winterPolicy || { ...defaultShiftForm.winterPolicy },
    });
    setErrors({}); setEditId(s.id); setModal(true);
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = L('आवश्यक','Required');
    if (!form.startTime)   e.startTime = L('आवश्यक','Required');
    if (!form.endTime)     e.endTime   = L('आवश्यक','Required');
    return e;
  };

  const handleSave = () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const savedForm = { ...form };
    if (!savedForm.code) {
      savedForm.code = savedForm.name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'') || `shift_${Date.now()}`;
    }
    const savePromise = editId ? updateShift(editId, savedForm) : addShift(savedForm);
    Promise.resolve(savePromise).then(() => {
      // Re-fetch shifts/employees so the list reflects the server's single-default
      // enforcement and the bulk shift assignment it performs when makeDefault is set
      if (savedForm.makeDefault) { refreshShifts(); refreshEmployees(); }
    });

    if (savedForm.makeDefault) {
      showToast(L('डिफल्ट सिफ्ट अपडेट भयो — सबै कर्मचारीमा लागू भयो','Default shift updated — applied to all employees'), 'success');
    } else {
      showToast(t('Record saved successfully'));
    }
    setModal(false);
  };

  /* Ctrl+S saves the Shift Add/Edit modal — same action as the Save button */
  useSaveShortcut(modal, handleSave);

  const toggleExcDay = (key) => setForm(p => ({
    ...p,
    exceptionalDays: p.exceptionalDays.includes(key)
      ? p.exceptionalDays.filter(d => d !== key)
      : [...p.exceptionalDays, key],
  }));

  const openWinterModal = () => {
    setWinterTemp({
      startDate:'', endDate:'', startTime:'10:00', endTime:'16:00', workHours:6,
      gracePeriodStart:5, gracePeriodEnd:5,
      ...(form.winterPolicy || {}),
    });
    setWinterModal(true);
  };

  const hwc = (field, val) => setWinterTemp(prev => {
    const u = { ...prev, [field]: val };
    if (field === 'startTime' || field === 'endTime')
      u.workHours = calcHours(
        field === 'startTime' ? val : (prev.startTime || '10:00'),
        field === 'endTime'   ? val : (prev.endTime   || '16:00')
      );
    return u;
  });

  const saveWinter = () => {
    setForm(p => ({ ...p, winterPolicy: { ...winterTemp } }));
    setWinterModal(false);
  };

  /* Ctrl+S saves the Winter Policy modal — same action as the Save Policy button */
  useSaveShortcut(winterModal, saveWinter);

  // Ctrl+N opens the Add Shift modal when not already open (ShiftInlineSection)
  useNewShortcut(!modal, openAdd);

  const Toggle = ({ value, onChange, color='#52b02c' }) => (
    <div style={{ width:44, height:24, background:value?color:'#d1d5db', borderRadius:12, position:'relative', cursor:'pointer', transition:'background .2s', flexShrink:0 }}
      onClick={() => onChange(!value)}>
      <div style={{ position:'absolute', top:2, left:value?22:2, width:20, height:20, background:'white', borderRadius:'50%', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}></div>
    </div>
  );

  const shiftColumns = [
    { field:'makeDefault', header:L('डिफल्ट','Default'), width:90, sortable:false, filterable:false,
      render: v => v
        ? <span style={{ background:'#dcfce7', color:'#166534', padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700, border:'1px solid #bbf7d0', display:'inline-flex', alignItems:'center', gap:4 }}>⭐ {L('छ','Yes')}</span>
        : <span style={{ color:'#d1d5db', fontSize:13 }}>—</span>
    },
    { field:'name', header:L('सिफ्ट नाम','Shift Name'), width:160,
      render: (v, row) => (
        <span style={{ fontWeight:600 }}>
          {language === 'np' ? v : (row.nameEn || v)}
        </span>
      )
    },
    { field:'startTime', header:L('सुरु समय','Start Time'), width:100, render:v=><strong>{v}</strong> },
    { field:'endTime',   header:L('अन्त समय','End Time'),   width:100, render:v=><strong>{v}</strong> },
    { field:'workHours', header:L('घण्टा','Hours'), width:70, align:'center',
      render:v=><span style={{fontWeight:700,color:'#52b02c'}}>{v}h</span>
    },
    { field:'exceptionalDayEnabled', header:L('असाधारण','Exceptional'), width:105, sortable:false, filterable:false,
      render:v=>v
        ? <span style={{background:'#fef3c7',color:'#92400e',padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:600}}>✅ {L('छ','Yes')}</span>
        : <span style={{color:'#d1d5db',fontSize:12}}>—</span>
    },
    { field:'winterPolicyEnabled', header:L('शीतकालीन','Winter'), width:90, sortable:false, filterable:false,
      render:v=>v
        ? <span style={{background:'#e0f2fe',color:'#0369a1',padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:600}}>❄️ {L('छ','Yes')}</span>
        : <span style={{color:'#d1d5db',fontSize:12}}>—</span>
    },
    { field:'gracePeriodStart', header:L('ग्रेस (आउट/गेट)','Grace (In/Out)'), width:120,
      render:(v,row)=><span style={{fontSize:12,color:'#6b7280',fontFamily:'monospace'}}>+{v||0}m / +{row.gracePeriodEnd||0}m</span>
    },
    { field:'active', header:L('स्थिति','Status'), width:85,
      render:v=><span className={`badge ${v?'badge-success':'badge-gray'}`}>{v?L('सक्रिय','Active'):L('निष्क्रिय','Inactive')}</span>
    },
    { field:'actions', header:L('कार्य','Actions'), width:80, sortable:false, filterable:false,
      render:(_,row) => (
        <div className="dg-actions">
          {(isAdmin||isManager) && (
            <button className="dg-action-btn edit" title={L('सम्पादन','Edit')}
              onClick={e=>{e.stopPropagation();openEdit(row);}}>✏</button>
          )}
          {isAdmin && (
            <button className="dg-action-btn delete" title={L('मेटाउनुस','Delete')}
              onClick={e=>{e.stopPropagation();setDelConfirm(row.id);}}>🗑</button>
          )}
        </div>
      )
    },
  ];

  return (
    <div style={{ marginBottom:0 }}>
      <DataGrid
        columns={shiftColumns}
        data={shifts}
        defaultPageSize={10}
        showSearch={true}
        searchPlaceholder={L('खोज्नुस...','Search...')}
        compact={true}
        onRowDoubleClick={openEdit}
        onDeleteKey={row=>setDelConfirm(row.id)}
        onDeleteSelected={async ids=>{
          const errors=[];
          for(const id of ids){try{await deleteShift(id);}catch(e){errors.push(e.message);}}
          if(errors.length) showToast(errors[0]||'Some shifts could not be deleted','error');
          else showToast(t('Record deleted successfully'));
        }}
        toolbar={
          (isAdmin||isManager) && (
            <button className="btn btn-primary btn-sm" onClick={openAdd}>
              + {L('नयाँ सिफ्ट','Add New')}
            </button>
          )
        }
      />

      {/* ══ ADD/EDIT MODAL ══ */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal modal-lg" style={{ maxHeight:'92vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#f0fdf4,#f0fdf4)', position:'sticky', top:0, zIndex:10 }}>
              <h2>{editId ? `✏️ ${L('सिफ्ट सम्पादन','Edit Shift')}` : `+ ${L('नयाँ सिफ्ट','New Shift')}`}</h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body">

              {/* Basic Info */}
              <div style={{ background:'#f9fafb', borderRadius:8, padding:'14px 16px', marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:12 }}>📋 {L('आधारभूत जानकारी','Basic Information')}</div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">नेपाली नाम *</label>
                    <input type="text" className={`form-control ${errors.name?'error':''}`}
                      placeholder="बिहान सिफ्ट" value={form.name}
                      onChange={e => hc('name', e.target.value)} />
                    {errors.name && <div className="form-error">{errors.name}</div>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">English Name</label>
                    <input type="text" className="form-control" placeholder="Morning Shift"
                      value={form.nameEn} onChange={e => hc('nameEn', e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Time Settings */}
              <div style={{ background:'#f9fafb', borderRadius:8, padding:'14px 16px', marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:12 }}>⏰ {L('समय सेटिङ','Time Settings')}</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                  <div className="form-group">
                    <label className="form-label">{L('सुरु समय','Start Time')} *</label>
                    <input type="time" className={`form-control ${errors.startTime?'error':''}`}
                      value={form.startTime} onChange={e => hc('startTime', e.target.value)} />
                    {errors.startTime && <div className="form-error">{errors.startTime}</div>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">{L('अन्त समय','End Time')} *</label>
                    <input type="time" className={`form-control ${errors.endTime?'error':''}`}
                      value={form.endTime} onChange={e => hc('endTime', e.target.value)} />
                    {errors.endTime && <div className="form-error">{errors.endTime}</div>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">{L('कार्य घण्टा','Work Hours')}</label>
                    <input type="number" className="form-control" value={form.workHours} readOnly
                      style={{ background:'#e0f2fe', fontWeight:700, color:'#0369a1' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{L('ग्रेस — सुरु','Grace Time Start')} ({L('मिनेट','min')})</label>
                    <input type="number" className="form-control" min={0} max={60}
                      value={form.gracePeriodStart}
                      onChange={e => hc('gracePeriodStart', +e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{L('ग्रेस — अन्त','Grace Time End')} ({L('मिनेट','min')})</label>
                    <input type="number" className="form-control" min={0} max={60}
                      value={form.gracePeriodEnd}
                      onChange={e => hc('gracePeriodEnd', +e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Make Default */}
              <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'12px 16px', marginBottom:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, color:'#166534' }}>⭐ {L('डिफल्ट सिफ्ट बनाउनुस','Make Default Shift')}</div>
                  <div style={{ fontSize:12, color:'#22c55e', marginTop:2 }}>
                    {L('चेक गरेमा यो सिफ्ट सबै कर्मचारीमा लागू हुनेछ','If checked, this shift will be applied to all staff')}
                  </div>
                </div>
                <Toggle value={form.makeDefault} onChange={v => {
                  if (v) {
                    // Check if another shift already has makeDefault = true
                    const existing = shifts.find(s => s.makeDefault && s.id !== editId);
                    if (existing) {
                      setDefaultConflict(existing);
                      return; // Wait for user confirmation
                    }
                  }
                  hc('makeDefault', v);
                }} color="#52b02c" />
              </div>

              {/* Exceptional Day */}
              <div style={{ border:`2px solid ${form.exceptionalDayEnabled?'#f59e0b':'#e5e7eb'}`, borderRadius:8, padding:'12px 16px', marginBottom:14, transition:'border-color .2s' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: form.exceptionalDayEnabled ? 14 : 0 }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600, color:form.exceptionalDayEnabled?'#92400e':'#374151' }}>📅 {L('असाधारण दिन सक्षम','Enable Exceptional Day')}</div>
                    <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{L('विशेष दिनहरूमा फरक समय सेटिङ','Different time settings for exceptional days')}</div>
                  </div>
                  <Toggle value={form.exceptionalDayEnabled} onChange={v => hc('exceptionalDayEnabled', v)} color="#f59e0b" />
                </div>
                {form.exceptionalDayEnabled && (
                  <div style={{ borderTop:'1px solid #fde68a', paddingTop:14 }}>
                    <div className="form-group" style={{ marginBottom:12 }}>
                      <label className="form-label">{L('असाधारण दिनहरू','Exceptional Days (Weekends)')}</label>
                      <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginTop:6 }}>
                        {SHIFT_DAYS.map(d => {
                          const on = form.exceptionalDays.includes(d.key);
                          return (
                            <label key={d.key} style={{
                              display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:7, cursor:'pointer',
                              border:`2px solid ${on?'#f59e0b':'#e5e7eb'}`, background:on?'#fef3c7':'#f9fafb',
                              fontWeight:on?700:400, color:on?'#92400e':'#374151', transition:'all .13s',
                            }}>
                              <input type="checkbox" checked={on} onChange={() => toggleExcDay(d.key)}
                                style={{ accentColor:'#f59e0b', width:13, height:13 }} />
                              {language==='np' ? d.np : d.en}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                      <div className="form-group">
                        <label className="form-label">{L('सुरु समय','Start Time')}</label>
                        <input type="time" className="form-control" value={form.exceptionalStartTime}
                          onChange={e => hc('exceptionalStartTime', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{L('अन्त समय','End Time')}</label>
                        <input type="time" className="form-control" value={form.exceptionalEndTime}
                          onChange={e => hc('exceptionalEndTime', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{L('कार्य घण्टा','Work Hours')}</label>
                        <input type="number" className="form-control" value={form.exceptionalWorkHours} readOnly
                          style={{ background:'#fef3c7', fontWeight:700, color:'#92400e' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Winter Policy */}
              <div style={{ border:`2px solid ${form.winterPolicyEnabled?'#0ea5e9':'#e5e7eb'}`, borderRadius:8, padding:'12px 16px', marginBottom:14, transition:'border-color .2s' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600, color:form.winterPolicyEnabled?'#0369a1':'#374151' }}>❄️ {L('शीतकालीन सुविधा नीति','Winter Facilities Policy')}</div>
                    <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{L('शीतकालमा फरक समय तालिका','Apply different schedule during winter')}</div>
                  </div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {form.winterPolicyEnabled && (
                      <button type="button" style={{ background:'#e0f2fe', color:'#0369a1', border:'1px solid #bae6fd', borderRadius:6, padding:'4px 10px', fontSize:12, cursor:'pointer' }}
                        onClick={openWinterModal}>⚙️ {L('कन्फिगर','Configure')}</button>
                    )}
                    <Toggle value={form.winterPolicyEnabled} onChange={v => {
                      hc('winterPolicyEnabled', v);
                      if (v) openWinterModal();
                    }} color="#0ea5e9" />
                  </div>
                </div>
                {form.winterPolicyEnabled && form.winterPolicy?.startDate && (
                  <div style={{ marginTop:10, borderTop:'1px solid #bae6fd', paddingTop:10, display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, fontSize:12 }}>
                    <div><span style={{ color:'#9ca3af' }}>{L('देखि','From')}: </span><strong>{form.winterPolicy.startDate}</strong></div>
                    <div><span style={{ color:'#9ca3af' }}>{L('सम्म','To')}: </span><strong>{form.winterPolicy.endDate}</strong></div>
                    <div><span style={{ color:'#9ca3af' }}>{L('घण्टा','Hrs')}: </span><strong>{form.winterPolicy.workHours}h</strong></div>
                    <div><span style={{ color:'#9ca3af' }}>Grace: </span><strong>+{form.winterPolicy.gracePeriodStart}m/+{form.winterPolicy.gracePeriodEnd}m</strong></div>
                  </div>
                )}
              </div>

              {/* Active */}
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:13, fontWeight:500 }}>{L('सक्रिय','Active')}</span>
                <Toggle value={form.active} onChange={v => hc('active', v)} color="#0e9f6e" />
              </div>
            </div>
            <div className="modal-footer" style={{ position:'sticky', bottom:0, background:'white', borderTop:'1px solid #e5e7eb' }}>
              <button className="btn btn-outline" onClick={() => setModal(false)}>{t('Cancel')}</button>
              <SaveButton onClick={handleSave} label={t('Save')} />
            </div>
          </div>
        </div>
      )}

      {/* ══ DEFAULT SHIFT CONFLICT MODAL ══ */}
      {defaultConflict && (
        <div className="modal-overlay" style={{ zIndex:1100 }}>
          <div className="modal modal-sm" style={{ zIndex:1200 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#fffbeb,#fef3c7)' }}>
              <h2>⚠️ {L('डिफल्ट सिफ्ट विरोध','Default Shift Conflict')}</h2>
              <button className="modal-close" onClick={() => setDefaultConflict(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#fef3c7', border:'1px solid #f59e0b', borderRadius:8, padding:'12px 14px', marginBottom:14 }}>
                <div style={{ fontSize:13, color:'#92400e', fontWeight:600 }}>
                  ⭐ {L('पहिले नै डिफल्ट सिफ्ट छ','Already have a Default Shift')}
                </div>
                <div style={{ fontSize:15, fontWeight:700, color:'#78350f', marginTop:4 }}>
                  "{defaultConflict.name}" ({defaultConflict.nameEn || defaultConflict.code})
                </div>
              </div>
              <p style={{ fontSize:14, color:'#374151' }}>
                {L(
                  'के तपाईं डिफल्ट सिफ्ट बदल्न चाहनुहुन्छ?',
                  'Do you want to replace the Default Shift?'
                )}
              </p>
              <p style={{ fontSize:12, color:'#6b7280', marginTop:4 }}>
                {L(
                  'हो भने, पुरानो डिफल्ट हट्नेछ र नयाँ सिफ्ट डिफल्ट हुनेछ।',
                  'If Yes, the old default will be removed and this shift will become the new default.'
                )}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDefaultConflict(null)}>
                {L('होइन','No, Cancel')}
              </button>
              <button className="btn btn-primary" onClick={() => {
                hc('makeDefault', true);
                setDefaultConflict(null);
              }}>
                ✅ {L('हो, बदल्नुस','Yes, Replace')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ WINTER POLICY MODAL ══ */}
      {winterModal && (
        <div className="modal-overlay" style={{ zIndex:1100 }}>
          <div className="modal modal-sm" style={{ zIndex:1200 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#e0f2fe,#f0f9ff)' }}>
              <h2>❄️ {L('शीतकालीन नीति सेटिङ','Winter Policy Settings')}</h2>
              <button className="modal-close" onClick={() => setWinterModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{L('शीतकाल सुरु मिति','Winter Start Date')}</label>
                  {settings.defaultCalendar === 'np'
                    ? <NepaliDatePicker value={winterTemp.startDate||''} onChange={v => hwc('startDate', v)} maxToday={false} />
                    : <input type="date" className="form-control" value={winterTemp.startDate||''}
                        onChange={e => hwc('startDate', e.target.value)} />
                  }
                </div>
                <div className="form-group">
                  <label className="form-label">{L('शीतकाल अन्त मिति','Winter End Date')}</label>
                  {settings.defaultCalendar === 'np'
                    ? <NepaliDatePicker value={winterTemp.endDate||''} onChange={v => hwc('endDate', v)} maxToday={false} />
                    : <input type="date" className="form-control" value={winterTemp.endDate||''}
                        onChange={e => hwc('endDate', e.target.value)} />
                  }
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                <div className="form-group">
                  <label className="form-label">{L('सुरु समय','Start Time')}</label>
                  <input type="time" className="form-control" value={winterTemp.startTime||'10:00'}
                    onChange={e => hwc('startTime', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{L('अन्त समय','End Time')}</label>
                  <input type="time" className="form-control" value={winterTemp.endTime||'16:00'}
                    onChange={e => hwc('endTime', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{L('कुल घण्टा','Total Hours')}</label>
                  <input type="number" className="form-control" readOnly
                    value={winterTemp.workHours ?? calcHours(winterTemp.startTime||'10:00', winterTemp.endTime||'16:00')}
                    style={{ background:'#e0f2fe', fontWeight:700, color:'#0369a1' }} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{L('ग्रेस — सुरु','Grace Time Start')} ({L('मिनेट','min')})</label>
                  <input type="number" className="form-control" min={0} max={60}
                    value={winterTemp.gracePeriodStart??5}
                    onChange={e => hwc('gracePeriodStart', +e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{L('ग्रेस — अन्त','Grace Time End')} ({L('मिनेट','min')})</label>
                  <input type="number" className="form-control" min={0} max={60}
                    value={winterTemp.gracePeriodEnd??5}
                    onChange={e => hwc('gracePeriodEnd', +e.target.value)} />
                </div>
              </div>
              {winterTemp.startDate && winterTemp.endDate && (
                <div style={{ background:'#e0f2fe', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#0369a1' }}>
                  ❄️ &nbsp;{winterTemp.startDate} → {winterTemp.endDate}
                  &nbsp;·&nbsp; {winterTemp.startTime||'10:00'} – {winterTemp.endTime||'16:00'}
                  &nbsp;·&nbsp;<strong>{winterTemp.workHours ?? calcHours(winterTemp.startTime||'10:00',winterTemp.endTime||'16:00')}h / {L('दिन','day')}</strong>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setWinterModal(false)}>{t('Cancel')}</button>
              <SaveButton onClick={saveWinter} label={L('नीति सुरक्षित','Save Policy')} />
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {delConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ {L('मेटाउने पुष्टि','Delete Confirmation')}</h2><button className="modal-close" onClick={() => setDelConfirm(null)}>✕</button></div>
            <div className="modal-body"><p>{L('के तपाईं यो सिफ्ट मेटाउन चाहनुहुन्छ?','Are you sure you want to delete this shift?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDelConfirm(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={async () => {
                const id = delConfirm;
                setDelConfirm(null);
                try {
                  await deleteShift(id);
                  showToast(t('Record deleted successfully'));
                } catch (e) {
                  showToast(e.message || 'Cannot delete this shift', 'error');
                }
              }}>🗑 {t('Delete')}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}><span>{toast.type==='success'?'✅':'❌'}</span><span>{toast.msg}</span></div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   Shared helpers for the three new sections
════════════════════════════════════════════════════════════ */
const Toggle = ({ value, onChange, label }) => (
  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
    <div
      onClick={() => onChange(!value)}
      style={{ width:40, height:22, background:value?'#52b02c':'#d1d5db', borderRadius:11, position:'relative', cursor:'pointer', flexShrink:0, transition:'background .2s' }}
    >
      <div style={{ position:'absolute', top:2, left:value?20:2, width:18, height:18, background:'white', borderRadius:'50%', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.25)' }}></div>
    </div>
    {label && <span style={{ fontSize:13, color:value?'#52b02c':'#6b7280', fontWeight:value?600:400 }}>{label}</span>}
  </div>
);

const CheckGroup = ({ options, value = [], onChange, allKey = 'All' }) => {
  const has = (k) => value.includes(k);
  const toggle = (k) => {
    if (k === allKey) { onChange([allKey]); return; }
    let next = value.filter(v => v !== allKey);
    next = has(k) ? next.filter(v => v !== k) : [...next, k];
    if (next.length === 0) next = [allKey];
    onChange(next);
  };
  return (
    <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:4 }}>
      {options.map(opt => {
        const active = has(opt.value);
        return (
          <label key={opt.value} style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', userSelect:'none' }}>
            <input type="checkbox" checked={active} onChange={() => toggle(opt.value)} style={{ accentColor:'#52b02c', width:15, height:15 }} />
            <span style={{ fontSize:13, fontWeight:active?600:400, color:active?'#166534':'#374151' }}>{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
};

/* Dropdown with per-item checkboxes. Selecting any specific item removes "All";
   deselecting everything reverts to "All". */
const CheckDropdown = ({ options, value = [], onChange, allKey = 'All' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const has = (k) => value.includes(k);
  const toggle = (k) => {
    if (k === allKey) { onChange([allKey]); setOpen(false); return; }
    let next = value.filter(v => v !== allKey);          // always drop "All" first
    next = has(k) ? next.filter(v => v !== k) : [...next, k];
    if (next.length === 0) next = [allKey];              // nothing left → revert to All
    onChange(next);
  };

  const isAll = value.length === 0 || value.includes(allKey);
  const displayText = isAll
    ? (options.find(o => o.value === allKey)?.label || 'All')
    : value.map(v => options.find(o => o.value === v)?.label || v).join(', ');

  return (
    <div ref={ref} style={{ position:'relative' }}>
      {/* Trigger button */}
      <div onClick={() => setOpen(p => !p)} style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'7px 10px', border:'1.5px solid #d1d5db', borderRadius:6,
        background:'white', cursor:'pointer', fontSize:13, color:'#1f2937', minHeight:36,
        transition:'border-color .15s',
      }}>
        <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {displayText}
        </span>
        <span style={{ fontSize:10, color:'#9ca3af', marginLeft:6, flexShrink:0 }}>{open ? '▲' : '▼'}</span>
      </div>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 2px)', left:0, right:0, zIndex:200,
          background:'white', border:'1px solid #d1d5db', borderRadius:6,
          boxShadow:'0 6px 16px rgba(0,0,0,.12)', maxHeight:200, overflowY:'auto',
        }}>
          {options.map((opt, idx) => {
            const checked = has(opt.value);
            const isAllOpt = opt.value === allKey;
            return (
              <label key={opt.value} style={{
                display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
                cursor:'pointer', userSelect:'none',
                background: checked ? '#f0fdf4' : 'transparent',
                borderBottom: idx < options.length - 1 ? '1px solid #f3f4f6' : 'none',
                fontWeight: isAllOpt ? 600 : 400,
              }}>
                <input type="checkbox" checked={checked}
                  onChange={() => toggle(opt.value)}
                  style={{ accentColor:'#52b02c', width:15, height:15, cursor:'pointer', flexShrink:0 }}
                  onClick={e => e.stopPropagation()}
                />
                <span style={{ fontSize:13, color: checked ? '#166534' : '#374151', fontWeight: checked ? 600 : 400 }}>
                  {opt.label}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

const sectionBtnStyle = {
  background:'#f0fdf4', border:'1px solid #bbf7d0', color:'#52b02c',
  borderRadius:6, padding:'5px 12px', fontSize:13, fontWeight:600, cursor:'pointer',
};

/* ═══════════════════════════════════════════════════════════
   LeaveTypeSection
════════════════════════════════════════════════════════════ */
const defaultLeaveForm = {
  name:'', shortName:'', daysPerYear:'',
  reduceWeekend:false, reducePublicHoliday:false, provideOnlyOnBalance:false,
  genderFor:['All'], modeFor:['All'],
  carryForward:false, maxAccumulateDays:'',
  isServicePeriod:false, timesPerService:'',
  autoAccumulate:false,
};

const LeaveTypeSection = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const { settings, updateSetupList } = useSettings();
  const data = settings.leaveTypeConfigs || [];

  const [modal,    setModal]    = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [form,     setForm]     = useState({ ...defaultLeaveForm });
  const [errors,   setErrors]   = useState({});
  const [delId,    setDelId]    = useState(null);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const openAdd  = () => { setForm({ ...defaultLeaveForm }); setErrors({}); setEditId(null); setModal(true); };
  const openEdit = (item) => { setForm({ ...defaultLeaveForm, ...item }); setErrors({}); setEditId(item.id); setModal(true); };

  const validate = () => {
    const e = {};
    if (!form.name.trim())      e.name      = L('आवश्यक छ','Required');
    if (!form.shortName.trim()) e.shortName = L('आवश्यक छ','Required');
    if (form.daysPerYear === '' || form.daysPerYear < 0) e.daysPerYear = L('आवश्यक छ','Required');
    if (form.carryForward && (form.maxAccumulateDays === '' || form.maxAccumulateDays < 0)) e.maxAccumulateDays = L('आवश्यक छ','Required');
    if (form.isServicePeriod && (form.timesPerService === '' || form.timesPerService < 1))  e.timesPerService  = L('आवश्यक छ','Required');
    return e;
  };

  const handleSave = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    const next = editId
      ? data.map(d => d.id === editId ? { ...d, ...form, id: editId } : d)
      : [...data, { ...form, id: Date.now() }];
    updateSetupList('leaveTypeConfigs', next);
    setModal(false);
  };

  const handleDelete = (id) => {
    updateSetupList('leaveTypeConfigs', data.filter(d => d.id !== id));
    setDelId(null);
  };

  const modeOptions = [
    { value:'All', label:L('सबै','All') },
    ...(settings.modes || []).map(m => ({ value:String(m.id), label:m.name })),
  ];
  const genderOptions = [
    { value:'All',    label:L('सबै','All') },
    { value:'Male',   label:L('पुरुष','Male') },
    { value:'Female', label:L('महिला','Female') },
  ];

  const inp = (k, type='text', ph='') => (
    <input type={type} min={type==='number'?0:undefined}
      className={`form-control${errors[k]?' error':''}`}
      placeholder={ph} value={form[k]??''}
      onChange={e => set(k, type==='number' ? (e.target.value===''?'':Number(e.target.value)) : e.target.value)}
    />
  );

  return (
    <div>
      <DataGrid
        columns={[
          { field:'name',                header:L('बिदाको नाम','Leave Name'),      width:160, render:v=><span style={{fontWeight:600}}>{v}</span> },
          { field:'shortName',           header:L('छोटो नाम','Short'),             width:70,  render:v=><span style={{background:'#f0fdf4',color:'#52b02c',padding:'2px 8px',borderRadius:4,fontFamily:'monospace',fontSize:12,fontWeight:700}}>{v}</span> },
          { field:'daysPerYear',         header:L('दिन/वर्ष','Days/Yr'),           width:80,  align:'center', render:v=><span style={{fontWeight:700,color:'#0369a1'}}>{v}</span> },
          { field:'genderFor',           header:L('लिङ्ग','Gender'),               width:90,  render:v=>(v||['All']).join(', ') },
          { field:'reduceWeekend',       header:L('विकेन्ड घटाउ','Red.Wknd'),     width:95,  align:'center', render:v=>v?'✅':'—' },
          { field:'reducePublicHoliday', header:L('सा.छुट्टी','Red.PH'),          width:80,  align:'center', render:v=>v?'✅':'—' },
          { field:'provideOnlyOnBalance',header:L('ब्यालेन्स मात्र','Bal.Only'),  width:90,  align:'center', render:v=>v?'✅':'—' },
          { field:'carryForward',        header:L('ढुवानी','Carry Fwd'),           width:120, align:'center', render:(v,row)=>v?`✅ (max ${row.maxAccumulateDays??'—'})`:'—' },
          { field:'autoAccumulate',      header:L('स्वतः जम्मा','Auto Acc.'),      width:90,  align:'center', render:v=>v?'✅':'—' },
          { field:'actions', header:L('कार्य','Actions'), width:80, sortable:false, filterable:false, render:(_,row)=>(
            <div className="dg-actions">
              <button className="dg-action-btn edit"   onClick={e=>{e.stopPropagation();openEdit(row);}}>✏</button>
              <button className="dg-action-btn delete" onClick={e=>{e.stopPropagation();setDelId(row.id);}}>🗑</button>
            </div>
          )},
        ]}
        data={data}
        defaultPageSize={10}
        showSearch={true}
        compact={true}
        onRowDoubleClick={openEdit}
        onDeleteKey={row=>setDelId(row.id)}
        onDeleteSelected={ids=>updateSetupList('leaveTypeConfigs',data.filter(d=>!ids.includes(d.id)))}
        toolbar={<button className="btn btn-primary btn-sm" onClick={openAdd}>+ {L('नयाँ थप्नुस','Add New')}</button>}
      />

      {/* Add/Edit Modal */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:680, width:'95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#f0fdf4,#f0fdf4)' }}>
              <h2>{editId ? `✏️ ${L('सम्पादन','Edit')}` : `+ ${L('नयाँ बिदा प्रकार','New Leave Type')}`}</h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight:'70vh', overflowY:'auto' }}>

              {/* Row 1 */}
              <div className="form-row-3" style={{ marginBottom:14 }}>
                <div className="form-group">
                  <label className="form-label">{L('बिदाको नाम','Leave Name')} <span style={{ color:'#ef4444' }}>*</span></label>
                  {inp('name','text', L('वार्षिक बिदा','Annual Leave'))}
                  {errors.name && <div className="form-error">{errors.name}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">{L('छोटो नाम','Leave Short Name')} <span style={{ color:'#ef4444' }}>*</span></label>
                  {inp('shortName','text','AL')}
                  {errors.shortName && <div className="form-error">{errors.shortName}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">{L('दिन / वर्ष','No. of Days per Year')} <span style={{ color:'#ef4444' }}>*</span></label>
                  {inp('daysPerYear','number','20')}
                  {errors.daysPerYear && <div className="form-error">{errors.daysPerYear}</div>}
                </div>
              </div>

              {/* Row 2 — toggles */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14, marginBottom:14 }}>
                <div className="form-group">
                  <label className="form-label">{L('विकेन्ड घटाउने','Reduce Weekend')}</label>
                  <Toggle value={form.reduceWeekend} onChange={v => set('reduceWeekend',v)} label={form.reduceWeekend ? L('हो','Yes') : L('होइन','No')} />
                </div>
                <div className="form-group">
                  <label className="form-label">{L('सार्वजनिक छुट्टी घटाउने','Reduce Public Holiday')}</label>
                  <Toggle value={form.reducePublicHoliday} onChange={v => set('reducePublicHoliday',v)} label={form.reducePublicHoliday ? L('हो','Yes') : L('होइन','No')} />
                </div>
                <div className="form-group">
                  <label className="form-label">{L('ब्यालेन्समा मात्र','Provide Only on Balance')}</label>
                  <Toggle value={form.provideOnlyOnBalance} onChange={v => set('provideOnlyOnBalance',v)} label={form.provideOnlyOnBalance ? L('हो','Yes') : L('होइन','No')} />
                </div>
              </div>

              {/* Gender + Staff Mode — same row */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">{L('लिङ्गका लागि','Leave for Gender')}</label>
                  <CheckDropdown options={genderOptions} value={form.genderFor} onChange={v => set('genderFor',v)} />
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">{L('कर्मचारी मोडका लागि','Leave for Staff Mode')}</label>
                  <CheckDropdown options={modeOptions} value={form.modeFor} onChange={v => set('modeFor',v)} />
                </div>
              </div>

              {/* Carry Forward + Service Period — same line */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>

                {/* Carry Forward */}
                <div style={{ background:'#f8fafc', borderRadius:8, border:'1px solid #e5e7eb', padding:'12px 14px' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: form.carryForward ? 10 : 0 }}>
                    <label className="form-label" style={{ margin:0, fontSize:13 }}>{L('ढुवानी','Carry Forward')}</label>
                    <Toggle value={form.carryForward} onChange={v => set('carryForward',v)} label={form.carryForward ? L('हो','Yes') : L('होइन','No')} />
                  </div>
                  {form.carryForward && (
                    <div style={{ marginBottom:0 }}>
                      <label className="form-label" style={{ fontSize:12 }}>{L('अधिकतम जम्मा दिन','Max Accumulate Days')} <span style={{ color:'#ef4444' }}>*</span></label>
                      <input type="number" min={0} className={`form-control${errors.maxAccumulateDays?' error':''}`}
                        placeholder="30" value={form.maxAccumulateDays??''}
                        onChange={e => set('maxAccumulateDays', e.target.value===''?'':Number(e.target.value))} />
                      {errors.maxAccumulateDays && <div className="form-error">{errors.maxAccumulateDays}</div>}
                    </div>
                  )}
                </div>

                {/* Service Period */}
                <div style={{ background:'#f8fafc', borderRadius:8, border:'1px solid #e5e7eb', padding:'12px 14px' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: form.isServicePeriod ? 10 : 0 }}>
                    <label className="form-label" style={{ margin:0, fontSize:13 }}>{L('सेवा अवधि','Service Period')}</label>
                    <Toggle value={form.isServicePeriod} onChange={v => set('isServicePeriod',v)} label={form.isServicePeriod ? L('हो','Yes') : L('होइन','No')} />
                  </div>
                  {form.isServicePeriod && (
                    <div style={{ marginBottom:0 }}>
                      <label className="form-label" style={{ fontSize:12 }}>{L('सेवामा पटक सङ्ख्या','No. of Times in Service')} <span style={{ color:'#ef4444' }}>*</span></label>
                      <input type="number" min={1} className={`form-control${errors.timesPerService?' error':''}`}
                        placeholder="1" value={form.timesPerService??''}
                        onChange={e => set('timesPerService', e.target.value===''?'':Number(e.target.value))} />
                      {errors.timesPerService && <div className="form-error">{errors.timesPerService}</div>}
                    </div>
                  )}
                </div>

              </div>

              {/* Auto Accumulate */}
              <div className="form-group">
                <label className="form-label">{L('स्वतः जम्मा','Auto Accumulate')}</label>
                <Toggle value={form.autoAccumulate} onChange={v => set('autoAccumulate',v)} label={form.autoAccumulate ? L('हो','Yes') : L('होइन','No')} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(false)}>{L('रद्द','Cancel')}</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 {L('सुरक्षित','Save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {delId && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ {L('मेटाउने पुष्टि','Delete Confirmation')}</h2><button className="modal-close" onClick={() => setDelId(null)}>✕</button></div>
            <div className="modal-body"><p>{L('के तपाईं यो बिदा प्रकार मेटाउन चाहनुहुन्छ?','Delete this leave type?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDelId(null)}>{L('रद्द','Cancel')}</button>
              <button className="btn btn-danger" onClick={() => handleDelete(delId)}>🗑 {L('मेटाउनुस','Delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   OfficeVisitTypeSection
════════════════════════════════════════════════════════════ */
const OfficeVisitTypeSection = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const { settings, updateSetupList } = useSettings();
  const data = settings.officeVisitTypes || [];

  const [modal,  setModal]  = useState(false);
  const [editId, setEditId] = useState(null);
  const [form,   setForm]   = useState({ name:'', shortName:'' });
  const [errors, setErrors] = useState({});
  const [delId,  setDelId]  = useState(null);

  const openAdd  = () => { setForm({ name:'', shortName:'' }); setErrors({}); setEditId(null); setModal(true); };
  const openEdit = (item) => { setForm({ name:item.name, shortName:item.shortName }); setErrors({}); setEditId(item.id); setModal(true); };

  const handleSave = () => {
    const e = {};
    if (!form.name.trim())      e.name      = L('आवश्यक छ','Required');
    if (!form.shortName.trim()) e.shortName = L('आवश्यक छ','Required');
    if (Object.keys(e).length)  { setErrors(e); return; }
    const next = editId
      ? data.map(d => d.id===editId ? { ...d, ...form } : d)
      : [...data, { ...form, id:Date.now() }];
    updateSetupList('officeVisitTypes', next);
    setModal(false);
  };

  const handleDelete = (id) => { updateSetupList('officeVisitTypes', data.filter(d => d.id!==id)); setDelId(null); };

  return (
    <div>
      <DataGrid
        columns={[
          { field:'name',      header:L('भ्रमणको नाम','Office Visit Name'), width:220, render:v=><span style={{fontWeight:600}}>{v}</span> },
          { field:'shortName', header:L('छोटो नाम','Short Name'),           width:110, render:v=><span style={{background:'#f0fdf4',color:'#52b02c',padding:'2px 8px',borderRadius:4,fontFamily:'monospace',fontSize:12,fontWeight:700}}>{v}</span> },
          { field:'actions', header:L('कार्य','Actions'), width:80, sortable:false, filterable:false, render:(_,row)=>(
            <div className="dg-actions">
              <button className="dg-action-btn edit"   onClick={e=>{e.stopPropagation();openEdit(row);}}>✏</button>
              <button className="dg-action-btn delete" onClick={e=>{e.stopPropagation();setDelId(row.id);}}>🗑</button>
            </div>
          )},
        ]}
        data={data}
        defaultPageSize={10}
        showSearch={true}
        compact={true}
        onRowDoubleClick={openEdit}
        onDeleteKey={row=>setDelId(row.id)}
        onDeleteSelected={ids=>updateSetupList('officeVisitTypes',data.filter(d=>!ids.includes(d.id)))}
        toolbar={<button className="btn btn-primary btn-sm" onClick={openAdd}>+ {L('नयाँ थप्नुस','Add New')}</button>}
      />

      {modal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#f0fdf4,#f0fdf4)' }}>
              <h2>{editId ? `✏️ ${L('सम्पादन','Edit')}` : `+ ${L('नयाँ भ्रमण प्रकार','New Office Visit Type')}`}</h2>
              <button className="modal-close" onClick={()=>setModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{L('भ्रमणको नाम','Office Visit Name')} <span style={{ color:'#ef4444' }}>*</span></label>
                <input type="text" className={`form-control${errors.name?' error':''}`} placeholder={L('फिल्ड भिजिट','Field Visit')} value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} />
                {errors.name && <div className="form-error">{errors.name}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">{L('छोटो नाम','Office Visit Short Name')} <span style={{ color:'#ef4444' }}>*</span></label>
                <input type="text" className={`form-control${errors.shortName?' error':''}`} placeholder="FV" value={form.shortName} onChange={e=>setForm(p=>({...p,shortName:e.target.value}))} />
                {errors.shortName && <div className="form-error">{errors.shortName}</div>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setModal(false)}>{L('रद्द','Cancel')}</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 {L('सुरक्षित','Save')}</button>
            </div>
          </div>
        </div>
      )}

      {delId && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ {L('मेटाउने पुष्टि','Delete Confirmation')}</h2><button className="modal-close" onClick={()=>setDelId(null)}>✕</button></div>
            <div className="modal-body"><p>{L('के तपाईं यो भ्रमण प्रकार मेटाउन चाहनुहुन्छ?','Delete this office visit type?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setDelId(null)}>{L('रद्द','Cancel')}</button>
              <button className="btn btn-danger" onClick={()=>handleDelete(delId)}>🗑 {L('मेटाउनुस','Delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   PublicHolidaySection
════════════════════════════════════════════════════════════ */
const defaultHolidayForm = {
  name:'', startDate:'', endDate:'', days:0,
  gender:['All'], branch:['All'], department:['All'], religion:['All'],
  handicapped:['All'], isFixedEveryYear:false,
};

const PublicHolidaySection = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const fd = useDateFormat();
  const { settings, updateSetupList } = useSettings();
  const allHolidays = settings.publicHolidays || [];
  const todayStr = new Date().toISOString().split('T')[0];
  const allFYs   = settings.fiscalYears || [];
  // Prefer the FY that contains today; fall back to the one marked isDefault
  const activeFY  = allFYs.find(fy => fy.startDate <= todayStr && fy.endDate >= todayStr);
  const defaultFY = allFYs.find(fy => fy.isDefault);
  const displayFY = activeFY || defaultFY;
  const fyExpired = displayFY && displayFY.endDate < todayStr && !activeFY;
  // If today is inside a configured FY, filter to that FY only; otherwise show all
  const data = (displayFY && !fyExpired)
    ? allHolidays.filter(h => h.startDate && h.startDate >= displayFY.startDate && h.startDate <= displayFY.endDate)
    : allHolidays;

  const [modal,     setModal]     = useState(false);
  const [editId,    setEditId]    = useState(null);
  const [form,      setForm]      = useState({ ...defaultHolidayForm });
  const [errors,    setErrors]    = useState({});
  const [delId,     setDelId]     = useState(null);
  const [dupAlert,  setDupAlert]  = useState(null); // { name, date }

  const set = (k, v) => setForm(p => {
    const next = { ...p, [k]: v };
    /* When startDate is set and endDate is still empty → pre-fill endDate with same date */
    if (k === 'startDate' && v && !p.endDate) {
      next.endDate = v;
    }
    /* Auto-calculate days whenever either date changes */
    if (k === 'startDate' || k === 'endDate') {
      const s = k==='startDate' ? v        : next.startDate;
      const e = k==='endDate'   ? v        : next.endDate;
      if (s && e) {
        const diff = Math.round((new Date(e) - new Date(s)) / 86400000) + 1;
        next.days = diff > 0 ? diff : 0;
      } else {
        next.days = 0;
      }
    }
    return next;
  });

  const openAdd  = () => { setForm({ ...defaultHolidayForm }); setErrors({}); setEditId(null); setModal(true); };
  const openEdit = (item) => { setForm({ ...defaultHolidayForm, ...item }); setErrors({}); setEditId(item.id); setModal(true); };

  const handleSave = () => {
    const e = {};
    if (!form.name.trim())  e.name      = L('आवश्यक छ','Required');
    if (!form.startDate)    e.startDate = L('आवश्यक छ','Required');
    if (!form.endDate)      e.endDate   = L('आवश्यक छ','Required');
    if (form.startDate && form.endDate && form.endDate < form.startDate) e.endDate = L('अन्त मिति सुरु मितिभन्दा पछि हुनुपर्छ','End must be after start');
    if (Object.keys(e).length) { setErrors(e); return; }

    /* ── Duplicate date check ── */
    if (form.startDate) {
      const clash = allHolidays.find(h => h.id !== editId && h.startDate === form.startDate);
      if (clash) {
        setDupAlert({ name: clash.name, date: fd(form.startDate) });
        return;
      }
    }

    const next = editId
      ? allHolidays.map(d => d.id===editId ? { ...d, ...form } : d)
      : [...allHolidays, { ...form, id:Date.now() }];
    updateSetupList('publicHolidays', next);
    setModal(false);
  };

  const handleDelete = (id) => { updateSetupList('publicHolidays', allHolidays.filter(d => d.id!==id)); setDelId(null); };

  const calendar = settings.defaultCalendar || 'en';

  /* BS years restricted to the active/default fiscal year only */
  const fyYears = (() => {
    const fy = activeFY || defaultFY;
    if (!fy) return null;
    const startBs = adToBS(fy.startDate);
    const endBs   = adToBS(fy.endDate);
    if (!startBs || !endBs) return null;
    const years = [];
    for (let y = startBs.year; y <= endBs.year; y++) years.push(y);
    return years.length ? years : null;
  })();

  const branchOpts   = [{ value:'All', label:L('सबै','All') }, ...(settings.branches||[]).map(b=>({ value:String(b.id), label:b.name }))];
  const deptOpts     = [{ value:'All', label:L('सबै','All') }, ...(settings.departments||[]).map(d=>({ value:String(d.id), label:d.name }))];
  const religionOpts = [{ value:'All', label:L('सबै','All') }, ...(settings.religions||[]).map(r=>({ value:String(r.id), label:r.name }))];
  const genderOpts   = [{ value:'All', label:L('सबै','All') }, { value:'Male', label:L('पुरुष','Male') }, { value:'Female', label:L('महिला','Female') }, { value:'Other', label:L('अन्य','Other') }];
  const handicapOpts = [{ value:'All', label:L('सबै','All') }, { value:'Yes', label:L('हो','Yes') }, { value:'No', label:L('होइन','No') }];

  /* Date field: no preview label; BS picker restricted to fiscal-year years */
  const DateField = ({ field, label, required }) => (
    <div className="form-group" style={{ marginBottom:0 }}>
      <label className="form-label">{label}{required && <span style={{ color:'#ef4444', marginLeft:2 }}>*</span>}</label>
      {calendar === 'np'
        ? <NepaliDatePicker value={form[field]||''} onChange={v => set(field, v)} error={!!errors[field]} maxToday={false} />
        : <input type="date" className={`form-control${errors[field]?' error':''}`}
            value={form[field]||''} onChange={e => set(field, e.target.value)} />
      }
      {errors[field] && <div className="form-error">{errors[field]}</div>}
    </div>
  );

  return (
    <div>
      {/* Current FY indicator */}
      <div style={{ marginBottom:10, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        {activeFY ? (
          <span style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', color:'#166534', borderRadius:6, padding:'3px 12px', fontSize:12, fontWeight:700 }}>
            📆 {activeFY.name} &nbsp;·&nbsp; {fd(activeFY.startDate)} → {fd(activeFY.endDate)}
          </span>
        ) : fyExpired ? (
          <span style={{ background:'#fef3c7', border:'1px solid #fcd34d', color:'#92400e', borderRadius:6, padding:'3px 12px', fontSize:12, fontWeight:700 }}>
            ⚠️ {L('आर्थिक वर्ष समाप्त','Fiscal year ended')} ({displayFY.name}) — {L('नयाँ आर्थिक वर्ष थप्नुस','add new fiscal year')}
          </span>
        ) : (
          <span style={{ background:'#fef3c7', border:'1px solid #fcd34d', color:'#92400e', borderRadius:6, padding:'3px 12px', fontSize:12, fontWeight:700 }}>
            ⚠️ {L('कुनै सक्रिय आर्थिक वर्ष छैन','No active fiscal year set')}
          </span>
        )}
        <span style={{ fontSize:11, color:'#9ca3af' }}>
          {activeFY
            ? L('यस आर्थिक वर्षका छुट्टीहरू मात्र देखाइएका छन्','Showing holidays for this fiscal year only')
            : L('सबै छुट्टीहरू देखाइएका छन्','Showing all holidays')}
        </span>
      </div>

      <DataGrid
        columns={[
          { field:'name',            header:L('छुट्टीको नाम','Holiday Name'), width:160, render:v=><span style={{fontWeight:600}}>{v}</span> },
          { field:'startDate',       header:L('सुरु मिति','Start Date'),     width:120, render:v=>v?<span style={{color:'#0369a1',fontWeight:500}}>{fd(v)}</span>:'—' },
          { field:'endDate',         header:L('अन्त मिति','End Date'),       width:120, render:v=>v?<span style={{color:'#7c3aed',fontWeight:500}}>{fd(v)}</span>:'—' },
          { field:'days',            header:L('दिन','Days'),                  width:60,  align:'center', render:v=><span style={{fontWeight:700,color:'#0e9f6e'}}>{v||0}</span> },
          { field:'gender',          header:L('लिङ्ग','Gender'),             width:80,  render:v=>(v||['All']).join(', ') },
          { field:'religion',        header:L('धर्म','Religion'),            width:80,  render:v=>(v||['All']).join(', ') },
          { field:'isFixedEveryYear',header:L('प्रत्येक वर्ष','Fixed/Yr'),  width:90,  align:'center',
            render: v => v
              ? <span style={{ background:'#dcfce7', color:'#166534', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:700, border:'1px solid #bbf7d0' }}>✅ {L('हो','Yes')}</span>
              : <span style={{ color:'#d1d5db' }}>—</span>
          },
          { field:'actions', header:L('कार्य','Actions'), width:80, sortable:false, filterable:false, render:(_,row)=>(
            <div className="dg-actions">
              <button className="dg-action-btn edit"   onClick={e=>{e.stopPropagation();openEdit(row);}}>✏</button>
              <button className="dg-action-btn delete" onClick={e=>{e.stopPropagation();setDelId(row.id);}}>🗑</button>
            </div>
          )},
        ]}
        data={data}
        defaultPageSize={10}
        showSearch={true}
        compact={true}
        onRowDoubleClick={openEdit}
        onDeleteKey={row=>setDelId(row.id)}
        onDeleteSelected={ids=>updateSetupList('publicHolidays',allHolidays.filter(d=>!ids.includes(d.id)))}
        toolbar={<button className="btn btn-primary btn-sm" onClick={openAdd}>+ {L('नयाँ थप्नुस','Add New')}</button>}
      />

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:700, width:'95%' }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#fef3c7,#fff7ed)' }}>
              <h2>{editId ? `✏️ ${L('सम्पादन','Edit')}` : `+ ${L('नयाँ सार्वजनिक छुट्टी','New Public Holiday')}`}</h2>
              <button className="modal-close" onClick={()=>setModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight:'70vh', overflowY:'auto' }}>

              {/* Holiday Name */}
              <div className="form-group" style={{ marginBottom:14 }}>
                <label className="form-label">{L('छुट्टीको नाम','Holiday Name')} <span style={{ color:'#ef4444' }}>*</span></label>
                <input type="text" className={`form-control${errors.name?' error':''}`}
                  placeholder={L('दशैं','Dashain')} value={form.name}
                  onChange={e=>set('name',e.target.value)} />
                {errors.name && <div className="form-error">{errors.name}</div>}
              </div>

              {/* Dates row — respects Default Calendar setting */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:16, marginBottom:14, alignItems:'flex-start' }}>
                <DateField field="startDate" label={L('सुरु मिति','Holiday Start From')} previewColor="#52b02c" required />
                <DateField field="endDate"   label={L('अन्त मिति','Holiday Ends')}       previewColor="#7c3aed" required />
                <div className="form-group" style={{ marginBottom:0, minWidth:72 }}>
                  <label className="form-label">{L('दिन सङ्ख्या','No. of Days')}</label>
                  <input type="number" className="form-control" value={form.days||0} readOnly
                    style={{
                      background:'#f1f5f9', color:'#0e9f6e', fontWeight:700, cursor:'not-allowed',
                      width: `${Math.max(72, String(form.days||0).length * 12 + 40)}px`,
                      textAlign:'center', paddingLeft:8, paddingRight:8,
                    }} />
                </div>
              </div>

              {/* Gender + Branch — same row */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">{L('लिङ्ग','Gender')}</label>
                  <CheckDropdown options={genderOpts} value={form.gender} onChange={v=>set('gender',v)} />
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">{L('शाखा','Branch')}</label>
                  <CheckDropdown options={branchOpts} value={form.branch} onChange={v=>set('branch',v)} />
                  {(settings.branches||[]).length===0 && (
                    <span style={{ fontSize:11, color:'#9ca3af' }}>({L('शाखा सेटअपमा थप्नुहोस्','Add in Setup → Branch')})</span>
                  )}
                </div>
              </div>

              {/* Department + Religion — same row */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">{L('विभाग','Department')}</label>
                  <CheckDropdown options={deptOpts} value={form.department} onChange={v=>set('department',v)} />
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">{L('धर्म','Religion')}</label>
                  <CheckDropdown options={religionOpts} value={form.religion} onChange={v=>set('religion',v)} />
                </div>
              </div>

              {/* Handicapped + Fixed every year — same form-group structure, same height */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">{L('अपाङ्गता','Handicapped')}</label>
                  <CheckDropdown options={handicapOpts} value={form.handicapped} onChange={v=>set('handicapped',v)} />
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">{L('प्रत्येक वर्ष निश्चित','Fixed Every Year')}</label>
                  <div onClick={() => set('isFixedEveryYear', !form.isFixedEveryYear)}
                    style={{
                      display:'flex', alignItems:'center', justifyContent:'space-between',
                      padding:'7px 10px', border:'1.5px solid #d1d5db', borderRadius:6,
                      background:'white', cursor:'pointer', minHeight:36,
                    }}>
                    <span style={{ fontSize:13, color: form.isFixedEveryYear ? '#166534' : '#6b7280', fontWeight: form.isFixedEveryYear ? 600 : 400 }}>
                      {form.isFixedEveryYear ? L('हो','Yes') : L('होइन','No')}
                    </span>
                    <Toggle value={form.isFixedEveryYear} onChange={v=>set('isFixedEveryYear',v)} />
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setModal(false)}>{L('रद्द','Cancel')}</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 {L('सुरक्षित','Save')}</button>
            </div>
          </div>
        </div>
      )}

      {delId && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ {L('मेटाउने पुष्टि','Delete Confirmation')}</h2><button className="modal-close" onClick={()=>setDelId(null)}>✕</button></div>
            <div className="modal-body"><p>{L('के तपाईं यो सार्वजनिक छुट्टी मेटाउन चाहनुहुन्छ?','Delete this public holiday?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setDelId(null)}>{L('रद्द','Cancel')}</button>
              <button className="btn btn-danger" onClick={()=>handleDelete(delId)}>🗑 {L('मेटाउनुस','Delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Duplicate Date Alert ── */}
      {dupAlert && (
        <div className="modal-overlay" style={{ zIndex:1100 }}>
          <div className="modal modal-sm" style={{ zIndex:1200, maxWidth:420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#fff7ed,#fef3c7)' }}>
              <h2 style={{ color:'#92400e' }}>⚠️ {L('मिति दोहोरिएको','Duplicate Date')}</h2>
              <button className="modal-close" onClick={() => setDupAlert(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, padding:'14px 16px', fontSize:14, color:'#9a3412', lineHeight:1.7 }}>
                <div style={{ fontSize:16, fontWeight:700, marginBottom:6 }}>
                  📅 {L('यस मितिमा पहिले नै छुट्टी छ','Already Holiday on this Date')}
                </div>
                <div>
                  <strong>{L('मिति','Date')}:</strong>&nbsp;{dupAlert.date}
                </div>
                <div>
                  <strong>{L('छुट्टी नाम','Holiday Name')}:</strong>&nbsp;
                  <span style={{ color:'#52b02c', fontWeight:600 }}>"{dupAlert.name}"</span>
                </div>
              </div>
              <div style={{ fontSize:13, color:'#6b7280', marginTop:10 }}>
                {L('एउटै मितिमा २ वटा छुट्टी राख्न मिल्दैन।','Two holidays cannot be saved on the same date.')}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setDupAlert(null)}>
                OK, {L('मिति परिवर्तन गर्छु','I\'ll change the date')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   LanguageSection — editable translation table
════════════════════════════════════════════════════════════ */
const LanguageSection = () => {
  const { language, changeLanguage,
          getAllTranslations, getBaseTranslations, getCustomTranslations,
          updateTranslation, addTranslation, deleteCustomTranslation } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'custom' | 'missing'
  const [editEntry,  setEditEntry]  = useState(null);  // { english, nepali, isNew }
  const [editForm,   setEditForm]   = useState({ english: '', nepali: '' });
  const [toast,      setToast]      = useState(null);

  const showToast = (msg, type='success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  const allTr   = getAllTranslations();
  const baseTr  = getBaseTranslations();
  const custTr  = getCustomTranslations();

  // Build sorted rows from merged dictionary
  const allRows = Object.keys(allTr).sort((a, b) => a.localeCompare(b)).map(en => ({
    english: en,
    nepali:  allTr[en],
    isCustom: en in custTr,
    isBase:   en in baseTr,
  }));

  // Mode filter only — DataGrid handles text search internally
  const modeFiltered = allRows.filter(row =>
    filterMode === 'all'     ? true :
    filterMode === 'custom'  ? row.isCustom :
    filterMode === 'missing' ? !row.nepali :
    true
  );

  const openEdit = (row) => {
    setEditEntry({ ...row, isNew: false });
    setEditForm({ english: row.english, nepali: row.nepali });
  };
  const openAdd = () => {
    setEditEntry({ english: '', nepali: '', isNew: true });
    setEditForm({ english: '', nepali: '' });
  };

  const handleSave = () => {
    const en = editForm.english.trim();
    const np = editForm.nepali.trim();
    if (!en) { showToast(L('अंग्रेजी लेबल आवश्यक', 'English label is required'), 'danger'); return; }
    if (editEntry.isNew) addTranslation(en, np);
    else                 updateTranslation(en, np);
    showToast(L('अनुवाद सुरक्षित भयो', 'Translation saved'));
    setEditEntry(null);
  };

  const handleReset = (english) => {
    deleteCustomTranslation(english);
    showToast(L('मूल अनुवादमा फर्कियो', 'Reset to default'));
  };

  const customCount  = Object.keys(custTr).length;
  const totalCount   = allRows.length;

  return (
    <div className="card" style={{ overflow:'hidden' }}>

      {/* Header */}
      <div className="card-header" style={{ background:'linear-gradient(135deg,#f0fdf4,#f0fdf4)', borderBottom:'1px solid #e5e7eb' }}>
        <div>
          <h3>🌐 {L('भाषा तालिका','Language Translation Table')}</h3>
          <div style={{ fontSize:11, color:'#6b7280', marginTop:2 }}>
            {L('अनुवाद हेर्नुस र सम्पादन गर्न दोहोरो-क्लिक गर्नुस','View translations · Double-click a row to edit')}
          </div>
        </div>
        <div style={{ fontSize:11, color:'#94a3b8', fontStyle:'italic' }}>
          {L('खोज्न वा दोहोरो-क्लिक गरेर सम्पादन गर्नुस','Search or double-click any row to edit')}
        </div>
      </div>

      {/* Stats bar + Filter mode buttons */}
      <div style={{ display:'flex', gap:16, padding:'10px 20px', background:'#f8fafc', borderBottom:'1px solid #f1f5f9', fontSize:12, flexWrap:'wrap', alignItems:'center' }}>
        <span>📝 {L('कुल','Total')}: <strong>{totalCount}</strong></span>
        <span>🤖 {L('स्वतः','Auto')}: <strong style={{ color:'#059669' }}>{totalCount - customCount}</strong></span>
        <span>✏️ {L('सम्पादित','Edited')}: <strong style={{ color:'#52b02c' }}>{customCount}</strong></span>
        <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
          {['all','custom','missing'].map(m => (
            <button key={m} onClick={() => setFilterMode(m)} style={{
              padding:'2px 10px', borderRadius:10, fontSize:11, fontWeight:600, cursor:'pointer', border:'none',
              background: filterMode===m ? '#52b02c' : '#e5e7eb',
              color:      filterMode===m ? 'white'   : '#374151',
            }}>
              {m==='all'     ? L('सबै','All') :
               m==='custom'  ? L('सम्पादित','Edited') :
                               L('नेपाली छैन','Missing NP')}
            </button>
          ))}
        </div>
      </div>

      <DataGrid
        columns={[
          { field:'english',  header:L('अंग्रेजी','English (Key)'), render:v=><span style={{color:'#1f2937',fontWeight:500}}>{v}</span> },
          { field:'nepali',   header:L('नेपाली','Nepali'),          render:v=>v||<span style={{color:'#fca5a5',fontStyle:'italic',fontSize:11}}>—</span> },
          { field:'isCustom', header:L('स्रोत','Source'), width:80, align:'center', sortable:false, filterable:false,
            render:v=>(
              <span style={v
                ? {background:'#f0fdf4',color:'#52b02c',fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:10,border:'1px solid #bbf7d0'}
                : {background:'#f0fdf4',color:'#059669',fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:10,border:'1px solid #a7f3d0'}}>
                {v?'✏️':'🤖'}
              </span>
            )
          },
          { field:'actions', header:L('कार्य','Action'), width:70, sortable:false, filterable:false, render:(_,row)=>(
            <div style={{display:'flex',gap:4,justifyContent:'center'}}>
              <button title={L('सम्पादन','Edit')} onClick={e=>{e.stopPropagation();openEdit(row);}}
                style={{background:'none',border:'none',cursor:'pointer',fontSize:14,padding:'2px 4px',color:'#52b02c'}}>✏️</button>
              {row.isCustom && (
                <button title={L('मूलमा फर्काउनुस','Reset to default')} onClick={e=>{e.stopPropagation();handleReset(row.english);}}
                  style={{background:'none',border:'none',cursor:'pointer',fontSize:14,padding:'2px 4px',color:'#6b7280'}}>↩️</button>
              )}
            </div>
          )},
        ]}
        data={modeFiltered}
        rowKey="english"
        defaultPageSize={20}
        showSearch={true}
        searchPlaceholder={L('अंग्रेजी वा नेपालीमा खोज्नुस...','Search English or Nepali...')}
        compact={true}
        onRowDoubleClick={openEdit}
        toolbar={
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button onClick={()=>changeLanguage(language==='np'?'en':'np')}
              style={{padding:'5px 14px',background:language==='np'?'#52b02c':'#059669',color:'white',border:'none',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer'}}>
              {language==='np'?'🇬🇧 EN':'🇳🇵 NP'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={openAdd}>+ {L('नयाँ थप्नुस','Add New')}</button>
          </div>
        }
      />

      {/* ── Edit / Add Modal ── */}
      {editEntry && (
        <div className="modal-overlay">
          <div className="modal modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {editEntry.isNew
                  ? `+ ${L('नयाँ अनुवाद थप्नुस','Add New Translation')}`
                  : `✏️ ${L('अनुवाद सम्पादन','Edit Translation')}`}
              </h2>
              <button className="modal-close" onClick={() => setEditEntry(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* English key */}
              <div className="form-group">
                <label className="form-label" style={{ display:'flex', alignItems:'center', gap:6 }}>
                  🇬🇧 {L('अंग्रेजी लेबल (Key)','English Label (Key)')}
                  {!editEntry.isNew && (
                    <span style={{ fontSize:10, background:'#fef3c7', color:'#92400e', padding:'1px 6px', borderRadius:8, fontWeight:600 }}>
                      {L('परिवर्तन गर्न मिल्दैन','Read-only')}
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  className="form-control"
                  value={editForm.english}
                  onChange={e => editEntry.isNew && setEditForm(p => ({ ...p, english: e.target.value }))}
                  readOnly={!editEntry.isNew}
                  autoFocus={editEntry.isNew}
                  style={!editEntry.isNew ? { background:'#f1f5f9', color:'#374151', cursor:'not-allowed', fontFamily:'monospace' } : { fontFamily:'monospace' }}
                />
              </div>
              {/* Nepali value */}
              <div className="form-group" style={{ marginTop:12 }}>
                <label className="form-label">🇳🇵 {L('नेपाली अनुवाद','Nepali Translation')}</label>
                <input
                  type="text"
                  className="form-control"
                  value={editForm.nepali}
                  onChange={e => setEditForm(p => ({ ...p, nepali: e.target.value }))}
                  autoFocus={!editEntry.isNew}
                  placeholder={L('नेपाली अनुवाद लेख्नुस...','Enter Nepali translation...')}
                />
              </div>
              {/* Info: base value */}
              {!editEntry.isNew && editEntry.isCustom && getBaseTranslations()[editEntry.english] && (
                <div style={{ marginTop:8, padding:'6px 12px', background:'#f0fdf4', borderRadius:8, fontSize:12, color:'#065f46' }}>
                  🤖 {L('मूल अनुवाद','Original')}: <strong>{getBaseTranslations()[editEntry.english]}</strong>
                </div>
              )}
            </div>
            <div className="modal-footer">
              {!editEntry.isNew && editEntry.isCustom && (
                <button className="btn btn-outline" onClick={() => { handleReset(editEntry.english); setEditEntry(null); }} style={{ marginRight:'auto' }}>
                  ↩️ {L('मूलमा फर्काउनुस','Reset to Default')}
                </button>
              )}
              <button className="btn btn-outline" onClick={() => setEditEntry(null)}>{L('रद्द','Cancel')}</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 {L('सुरक्षित','Save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed', bottom:24, right:24, zIndex:9999,
          background: toast.type==='danger' ? '#dc2626' : '#059669',
          color:'white', padding:'10px 20px', borderRadius:10,
          fontSize:13, fontWeight:600, boxShadow:'0 4px 16px rgba(0,0,0,.15)',
          animation:'slideUp .2s ease',
        }}>
          {toast.type === 'danger' ? '❌' : '✅'} {toast.msg}
        </div>
      )}
    </div>
  );
};


/* ═══════════════════════════════════════════════════════════
   EmailSetupTab — extracted so hooks are at component top-level
════════════════════════════════════════════════════════════ */
const EmailSetupTab = ({ showToast }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [emailCfg,    setEmailCfg]    = useState(null);
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [testTo,      setTestTo]      = useState('');
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    api.get('/email-config').then(d => {
      setEmailCfg(d || {
        smtpHost: '', smtpPort: '587', smtpUser: '', smtpPass: '',
        fromName: 'eHajiri TMS', fromEmail: '', secure: false, enabled: true,
        dailyDigestTime: '18:00',
        notifications: {
          forgotPassword: true, resetPassword: true,
          leaveApplication: true, officeVisitApplication: true, staffCreated: true,
          missingAttendance: true,
          lateEarlyNotification: true, absentNotification: true,
          leaveStatusUpdate: true, officeVisitStatusUpdate: true,
        },
      });
      setEmailLoaded(true);
    }).catch(() => setEmailLoaded(true));
  }, []);

  const set      = (field, val) => setEmailCfg(c => ({ ...c, [field]: val }));
  const setNotif = (key, val)   => setEmailCfg(c => ({ ...c, notifications: { ...(c.notifications||{}), [key]: val } }));

  const saveConfig = async () => {
    setEmailSaving(true);
    try {
      await api.put('/email-config', emailCfg);
      showToast(L('इमेल सेटिङ सुरक्षित भयो','Email settings saved'));
    } catch (e) { showToast(e.message || 'Failed to save', 'error'); }
    finally { setEmailSaving(false); }
  };

  /* Ctrl+S saves — this tab only exists while it's the active tab */
  useSaveShortcut(true, saveConfig);

  const sendTest = async () => {
    if (!testTo) return showToast(L('परीक्षण इमेल ठेगाना आवश्यक छ','Test recipient email is required'), 'error');
    setTestLoading(true);
    try {
      await api.post('/email-config/test', { config: emailCfg, testTo });
      showToast(L(`परीक्षण इमेल पठाइयो: ${testTo}`, `Test email sent to ${testTo}`));
    } catch (e) { showToast(e.message || 'Failed to send test email', 'error'); }
    finally { setTestLoading(false); }
  };

  if (!emailLoaded) return <div style={{ padding:40, textAlign:'center', color:'#6b7280' }}>Loading…</div>;

  const notifItems = [
    { key: 'forgotPassword',         label: L('पासवर्ड बिर्सियो','Forgot Password'),                          desc: L('जब कर्मचारीले पासवर्ड रिसेट अनुरोध गर्छ','When a staff member requests a password reset') },
    { key: 'resetPassword',          label: L('पासवर्ड रिसेट','Reset Password'),                             desc: L('जब व्यवस्थापकले पासवर्ड रिसेट गर्छ','When an admin resets a staff password') },
    { key: 'leaveApplication',       label: L('बिदा आवेदन','Leave Application'),                             desc: L('जब कर्मचारीले बिदाको आवेदन दिन्छ','When a staff member submits a leave application') },
    { key: 'officeVisitApplication', label: L('कार्यालय भ्रमण आवेदन','Office Visit Application'),           desc: L('जब कर्मचारीले कार्यालय भ्रमण आवेदन दिन्छ','When a staff member submits an office visit application') },
    { key: 'missingAttendance',      label: L('छुटेको हाजिरी अनुरोध','Missing Attendance Request'),         desc: L('जब कर्मचारीले छुटेको हाजिरीको अनुरोध गर्छ','When a staff member requests missing attendance be recorded') },
    { key: 'leaveStatusUpdate',       label: L('बिदा स्वीकृति/अस्वीकृति','Leave Status Update'),              desc: L('जब बिदा आवेदन स्वीकृत वा अस्वीकृत हुन्छ — कर्मचारीलाई सूचित गरिन्छ','When a leave application is approved or rejected — notifies the employee') },
    { key: 'officeVisitStatusUpdate', label: L('भ्रमण स्वीकृति/अस्वीकृति','Office Visit Status Update'),      desc: L('जब कार्यालय भ्रमण आवेदन स्वीकृत वा अस्वीकृत हुन्छ — कर्मचारीलाई सूचित गरिन्छ','When an office visit application is approved or rejected — notifies the employee') },
    { key: 'lateEarlyNotification',   label: L('ढिलो/चाँडो सूचना','Late In / Early Out Notification'),       desc: L('दैनिक — कर्मचारी, विभाग प्रमुख, शाखा प्रबन्धक र एडमिनलाई सूचित गर्छ','Daily digest — notifies the staff member, their Dept. Head, Branch Manager, and Admins') },
    { key: 'absentNotification',      label: L('अनुपस्थिति सूचना','Absent Notification'),                    desc: L('दैनिक — कर्मचारी, विभाग प्रमुख र एडमिनलाई सूचित गर्छ','Daily digest — notifies the staff member, their Dept. Head, and Admins') },
    { key: 'staffCreated',           label: L('कर्मचारी खाता सिर्जना','Staff Account Created'),             desc: L('जब नयाँ कर्मचारीको खाता सिर्जना गरिन्छ','When a new staff account is created — sends login credentials') },
  ];

  const fieldStyle = { fontSize:13, borderRadius:6, border:'1px solid #d1d5db', padding:'7px 10px', width:'100%', boxSizing:'border-box', outline:'none' };
  const labelStyle = { fontSize:11, fontWeight:600, color:'#6b7280', textTransform:'uppercase', marginBottom:4, display:'block' };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div className="card">
        <div className="card-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <h3>📧 {L('SMTP कन्फिगरेसन','SMTP Configuration')}</h3>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600 }}>
            <input type="checkbox" checked={!!emailCfg.enabled} onChange={e => set('enabled', e.target.checked)} style={{ width:16, height:16, accentColor:'#52b02c' }} />
            {L('इमेल सक्रिय','Enable Email')}
          </label>
        </div>
        <div className="card-body">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <div style={{ gridColumn:'1/3' }}>
              <label style={labelStyle}>{L('SMTP होस्ट','SMTP Host')}</label>
              <input style={fieldStyle} placeholder="smtp.gmail.com" value={emailCfg.smtpHost||''} onChange={e => set('smtpHost', e.target.value)} />
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:3 }}>Gmail: smtp.gmail.com &nbsp;|&nbsp; Outlook: smtp.office365.com &nbsp;|&nbsp; Yahoo: smtp.mail.yahoo.com</div>
            </div>
            <div>
              <label style={labelStyle}>{L('SMTP पोर्ट','SMTP Port')}</label>
              <input style={fieldStyle} placeholder="587" value={emailCfg.smtpPort||''} onChange={e => set('smtpPort', e.target.value)} />
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:3 }}>587 (TLS) · 465 (SSL) · 25 (plain)</div>
            </div>
            <div>
              <label style={labelStyle}>{L('सुरक्षा','Security')}</label>
              <select style={fieldStyle} value={emailCfg.secure ? 'ssl' : 'tls'} onChange={e => set('secure', e.target.value === 'ssl')}>
                <option value="tls">STARTTLS (port 587)</option>
                <option value="ssl">SSL/TLS (port 465)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>{L('SMTP प्रयोगकर्ता नाम','SMTP Username')}</label>
              <input style={fieldStyle} placeholder="your@gmail.com" value={emailCfg.smtpUser||''} onChange={e => set('smtpUser', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{L('SMTP पासवर्ड / एप पासवर्ड','SMTP Password / App Password')}</label>
              <input style={fieldStyle} type="password" placeholder="App password or SMTP password" value={emailCfg.smtpPass||''} onChange={e => set('smtpPass', e.target.value)} />
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:3 }}>For Gmail: use an App Password (not your login password)</div>
            </div>
            <div>
              <label style={labelStyle}>{L('प्रेषक नाम','From Name')}</label>
              <input style={fieldStyle} placeholder="eHajiri TMS" value={emailCfg.fromName||''} onChange={e => set('fromName', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{L('प्रेषक इमेल','From Email')}</label>
              <input style={fieldStyle} placeholder="noreply@yourcompany.com" value={emailCfg.fromEmail||''} onChange={e => set('fromEmail', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{L('दैनिक सूचना समय','Daily Digest Time')}</label>
              <input type="time" style={fieldStyle} value={emailCfg.dailyDigestTime || '18:00'} onChange={e => set('dailyDigestTime', e.target.value)} />
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:3 }}>{L('ढिलो/चाँडो र अनुपस्थिति सूचना यो समयमा पठाइन्छ','Late In/Early Out and Absent digests are sent once per day, after this time')}</div>
            </div>
          </div>
          <div style={{ marginTop:16, display:'flex', gap:10 }}>
            <button className="btn btn-primary" onClick={saveConfig} disabled={emailSaving} title="Ctrl+S">
              {emailSaving ? L('सुरक्षित हुँदैछ...','Saving...') : <>💾 {language === 'np' ? L('सेटिङ सुरक्षित','Save Settings') : <><u>S</u>ave Settings</>}</>}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>🔔 {L('स्वचालित सूचना','Auto Notifications')}</h3></div>
        <div className="card-body" style={{ padding:0 }}>
          {notifItems.map(({ key, label, desc }) => (
            <div key={key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px', borderBottom:'1px solid #f3f4f6' }}>
              <div>
                <div style={{ fontWeight:600, fontSize:14, color:'#1f2937' }}>{label}</div>
                <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{desc}</div>
              </div>
              <label style={{ position:'relative', display:'inline-block', width:44, height:24, flexShrink:0, cursor:'pointer' }}>
                <input type="checkbox" style={{ opacity:0, width:0, height:0 }}
                  checked={!!(emailCfg.notifications||{})[key]}
                  onChange={e => setNotif(key, e.target.checked)} />
                <span style={{ position:'absolute', inset:0, borderRadius:24, transition:'.2s', background: (emailCfg.notifications||{})[key] ? '#52b02c' : '#d1d5db' }}>
                  <span style={{ position:'absolute', top:3, left: (emailCfg.notifications||{})[key] ? 23 : 3, width:18, height:18, borderRadius:'50%', background:'white', transition:'.2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }} />
                </span>
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>🧪 {L('परीक्षण इमेल','Test Email')}</h3></div>
        <div className="card-body">
          <p style={{ fontSize:13, color:'#6b7280', marginTop:0 }}>{L('SMTP सेटिङ सुरक्षित गरेपछि परीक्षण इमेल पठाउनुहोस्।','Send a test email to verify your SMTP settings are working.')}</p>
          <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
            <div style={{ flex:1 }}>
              <label style={labelStyle}>{L('परीक्षण प्राप्तकर्ता','Test Recipient Email')}</label>
              <input style={fieldStyle} type="email" placeholder="test@example.com" value={testTo} onChange={e => setTestTo(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={sendTest} disabled={testLoading} style={{ height:36, whiteSpace:'nowrap' }}>
              {testLoading ? L('पठाउँदैछ...','Sending...') : `📨 ${L('परीक्षण पठाउनुहोस्','Send Test')}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   Module enable/disable banner — shown above the Attendance Device /
   StandAlone Device tabs. Only admin/superAdmin gets the toggle; everyone
   else (who can even see the tab, per the role permission matrix) just
   sees the disabled notice with no control.
════════════════════════════════════════════════════════════ */
const ModuleToggleBanner = ({ enabled, isAdmin, onToggle, label, L }) => (
  <div style={{
    display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
    background: enabled ? '#f0fdf4' : '#fff7ed',
    border:`1px solid ${enabled ? '#bbf7d0' : '#fed7aa'}`,
    borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:13,
  }}>
    <span style={{ color: enabled ? '#065f46' : '#9a3412', fontWeight:600 }}>
      {enabled
        ? `✅ ${label} ${L('सक्षम छ','is enabled')}`
        : `⛔ ${label} ${L('अक्षम छ','is disabled')} — ${L('कुनै पनि डिभाइस जडान वा डाटा सिंक हुनेछैन','no device connections or data sync will run')}`}
    </span>
    {isAdmin && (
      <button className={`btn btn-sm ${enabled ? 'btn-outline' : 'btn-primary'}`} onClick={onToggle}>
        {enabled ? L('अक्षम गर्नुहोस्','Disable') : L('सक्षम गर्नुहोस्','Enable')}
      </button>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════
   Main Settings component
════════════════════════════════════════════════════════════ */
const Settings = () => {
  const { currentUser, isAdmin, canView } = useAuth();
  const [moduleFlags, setModuleFlags] = useState({ attendanceDeviceEnabled: false, standaloneDeviceEnabled: false });
  const [moduleFlagsLoading, setModuleFlagsLoading] = useState(true);

  useEffect(() => {
    api.get('/module-flags')
      .then(f => setModuleFlags(f))
      .catch(() => {})
      .finally(() => setModuleFlagsLoading(false));
  }, []);

  const toggleModule = async (flagKey) => {
    const next = !moduleFlags[flagKey === 'module_attendance_device_enabled' ? 'attendanceDeviceEnabled' : 'standaloneDeviceEnabled'];
    try {
      await api.put('/settings', { [flagKey]: next });
      setModuleFlags(f => ({
        ...f,
        ...(flagKey === 'module_attendance_device_enabled'
          ? { attendanceDeviceEnabled: next }
          : { standaloneDeviceEnabled: next }),
      }));
    } catch (err) {
      alert(`Failed to update: ${err.message}`);
    }
  };
  const { t, language, changeLanguage, autoTranslate, toggleAutoTranslate } = useLanguage();
  const { settings, updateSettings, addWeekendHistory, updateSetupList, apiOk: settingsApiOk } = useSettings();
  const { apiOk: dataApiOk, employees, updateEmployee } = useData();
  const isOnline = settingsApiOk || dataApiOk;   // true when PostgreSQL is reachable
  const fd = useDateFormat();
  const location = useLocation();

  // Support ?tab=database deep-link from TopMenu
  const initialTab = new URLSearchParams(location.search).get('tab') || 'system';

  const [activeTab,   setActiveTab]   = useState(initialTab);
  const [activeSetup, setActiveSetup] = useState('fiscalYear');
  const [local,       setLocal]       = useState({ ...settings });
  const [logoError,   setLogoError]   = useState('');
  const [toast,       setToast]       = useState(null);
  const [companyModal, setCompanyModal] = useState(false);
  const [cForm,        setCForm]        = useState({});
  const [weekendModal, setWeekendModal] = useState(false);
  const [weekendEditId, setWeekendEditId] = useState(null); // null=new, id=edit existing
  const twoMonthsAgo = (() => { const d = new Date(); d.setMonth(d.getMonth() - 2); return d.toISOString().split('T')[0]; })();

  const [wForm, setWForm] = useState(() => {
    return {
      weekends: [...(settings.defaultWeekends || ['Sat'])],
      effectiveDate: twoMonthsAgo,
      reason: '',
    };
  });
  const logoInputRef        = useRef();
  const companyLogoInputRef = useRef();
  const restoreRef          = useRef();

  /* ── Database / Backup state ── */
  const [dbVersionInfo,  setDbVersionInfo]  = useState(null);
  const [backupLoading,  setBackupLoading]  = useState(false);
  const [sqlBackupLoading, setSqlBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restorePreview, setRestorePreview] = useState(null); // parsed backup meta
  const [restoreData,    setRestoreData]    = useState(null); // full backup object
  const [restoreLog,     setRestoreLog]     = useState('');
  const [backupPath, setBackupPath] = useState(() => {
    try { return localStorage.getItem('ls_backupPath') || ''; } catch { return ''; }
  });
  const [backupPathModal, setBackupPathModal] = useState(null); // { input, next: 'json'|'sql'|null }
  const [backupHistory,  setBackupHistory]  = useState(() => {
    try { return JSON.parse(localStorage.getItem('ls_backupHistory') || '[]'); } catch { return []; }
  });

  /* ── User Role management modals ── */
  const [assignModal,  setAssignModal]  = useState(null); // { roleKey, name, color, border, bg }
  const [changeModal,  setChangeModal]  = useState(null); // { emp, newRole }
  const [assignSearch, setAssignSearch] = useState('');
  /* Holds the latest Change-Role save closure (assigned each render below, inside the
     activeTab==='userRole' block) so Ctrl+S can call it without violating hook ordering rules */
  const changeRoleActionRef = useRef(null);
  useSaveShortcut(activeTab === 'userRole' && !!changeModal, () => changeRoleActionRef.current?.());

  // Fetch version info when database tab opens
  useEffect(() => {
    if (activeTab === 'database') {
      api.get('/backup/version').then(v => setDbVersionInfo(v)).catch(() => setDbVersionInfo(null));
    }
  }, [activeTab]);

  const showToast = (msg, type='success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };
  const set = (f, v) => setLocal(p => ({ ...p, [f]: v }));
  const L = (np, en) => language === 'np' ? np : en;
  const livePreview = (fmt) => formatDate(PREVIEW_DATE, {
    calendar: local.defaultCalendar, format: fmt, nepaliDigits: local.nepaliDigits,
  });

  /* ── Logo upload ── */
  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLogoError('');
    if (file.size > LOGO_MAX_KB * 1024) { setLogoError(`Max ${LOGO_MAX_KB} KB (current: ${(file.size/1024).toFixed(0)} KB)`); return; }
    if (!['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp'].includes(file.type)) { setLogoError('PNG, JPG, SVG or WebP only'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const ar = img.width / img.height;
        if (ar < LOGO_MIN_AR || ar > LOGO_MAX_AR) { setLogoError(`Ratio ${ar.toFixed(1)}:1 outside allowed range ${LOGO_MIN_AR}–${LOGO_MAX_AR}. Recommended: 300×80 px`); return; }
        set('companyLogo', ev.target.result); set('logoWidth', img.width); set('logoHeight', img.height); setLogoError('');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const sc = (f, v) => setCForm(p => ({ ...p, [f]: v }));

  const openCompanyModal = () => {
    setCForm({
      companyNameNp:    settings.companyNameNp    || '',
      companyNameEn:    settings.companyNameEn    || '',
      companyAddressNp: settings.companyAddressNp || '',
      companyAddressEn: settings.companyAddressEn || '',
      companyPhone:     settings.companyPhone     || '',
      companyEmail:     settings.companyEmail     || '',
      companyWebsite:   settings.companyWebsite   || '',
      companyLogo:      settings.companyLogo      || null,
      logoWidth:        settings.logoWidth        || null,
      logoHeight:       settings.logoHeight       || null,
    });
    setLogoError('');
    setCompanyModal(true);
  };

  const handleCompanySave = () => {
    updateSettings(cForm);
    setLocal(p => ({ ...p, ...cForm }));
    setCompanyModal(false);
    showToast(t('Record saved successfully'));
  };

  /* Ctrl+S saves the Company Settings modal — same action as the Save button */
  useSaveShortcut(companyModal, handleCompanySave);

  const handleSaveCalendarSettings = () => {
    updateSettings(local);
    showToast(t('Record saved successfully'));
  };

  /* Ctrl+S saves Calendar Settings — only while that tab is active */
  useSaveShortcut(activeTab === 'calendar', handleSaveCalendarSettings);

  const handleModalLogoUpload = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLogoError('');
    if (file.size > LOGO_MAX_KB * 1024) { setLogoError(`Max ${LOGO_MAX_KB} KB (current: ${(file.size/1024).toFixed(0)} KB)`); return; }
    if (!['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp'].includes(file.type)) { setLogoError('PNG, JPG, SVG or WebP only'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const ar = img.width / img.height;
        if (ar < LOGO_MIN_AR || ar > LOGO_MAX_AR) { setLogoError(`Ratio ${ar.toFixed(1)}:1 outside allowed range ${LOGO_MIN_AR}–${LOGO_MAX_AR}. Recommended: 300×80 px`); return; }
        sc('companyLogo', ev.target.result); sc('logoWidth', img.width); sc('logoHeight', img.height); setLogoError('');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSave = () => { updateSettings(local); showToast(t('Record saved successfully')); };

  const handleWeekendSave = () => {
    if (!wForm.weekends.length) { showToast('कम्तीमा एक दिन छान्नुस', 'danger'); return; }
    if (!wForm.effectiveDate)   { showToast('Effective Date required', 'danger'); return; }
    if (weekendEditId) {
      // Update existing history entry
      const updatedHistory = (settings.weekendHistory || []).map(h =>
        h.id === weekendEditId
          ? { ...h, weekends: wForm.weekends, effectiveDate: wForm.effectiveDate, reason: wForm.reason || '—' }
          : h
      );
      updateSettings({ weekendHistory: updatedHistory, defaultWeekends: wForm.weekends, weekendStartDate: wForm.effectiveDate });
      setLocal(p => ({ ...p, defaultWeekends: wForm.weekends, weekendStartDate: wForm.effectiveDate }));
      showToast(L('सप्ताहन्त अपडेट भयो','Weekend record updated'));
    } else {
      addWeekendHistory({
        weekends: wForm.weekends, effectiveDate: wForm.effectiveDate,
        changedBy: currentUser?.fullName || 'Admin', reason: wForm.reason || '—',
      });
      setLocal(p => ({ ...p, defaultWeekends: wForm.weekends, weekendStartDate: wForm.effectiveDate }));
      showToast(L('सप्ताहन्त सफलतापूर्वक परिवर्तन भयो','Weekend updated successfully'));
    }
    setWeekendModal(false);
    setWeekendEditId(null);
  };

  /* Ctrl+S saves the Weekend modal — same action as the Save Change button */
  useSaveShortcut(weekendModal, handleWeekendSave);

  const toggleWDay = (key) => setWForm(p => ({
    ...p, weekends: p.weekends.includes(key) ? p.weekends.filter(d => d !== key) : [...p.weekends, key],
  }));

  /* ── Setup CRUD ── */
  const handleSetupSave = (key, id, form, exclusiveDefault = false) => {
    const list = settings[key] || [];
    let savedId = id;
    let updated;
    if (id) {
      updated = list.map(item => item.id === id ? { ...item, ...form } : item);
    } else {
      savedId = Date.now();
      updated = [...list, { ...form, id: savedId, isSystem: false }];
    }
    if (exclusiveDefault && form.isDefault === true) {
      updated = updated.map(item => ({ ...item, isDefault: item.id === savedId }));
    }
    updateSetupList(key, updated);

    /* When a NEW fiscal year is created, auto-copy all fixed holidays into the new year */
    if (key === 'fiscalYears' && !id && form.startDate) {
      const newBsYear = adToBS(form.startDate)?.year;
      if (newBsYear) {
        const fixedHolidays = (settings.publicHolidays || []).filter(h => h.isFixedEveryYear && h.startDate);
        const toAdd = [];
        const base = Date.now();
        fixedHolidays.forEach((h, idx) => {
          const startBs = adToBS(h.startDate);
          if (!startBs) return;
          /* Skip if a holiday with same name+BS month+day already exists for this year */
          const exists = (settings.publicHolidays || []).some(ex => {
            if (!ex.startDate || ex.name !== h.name) return false;
            const exBs = adToBS(ex.startDate);
            return exBs && exBs.year === newBsYear && exBs.month === startBs.month && exBs.day === startBs.day;
          });
          if (exists) return;
          const newStartAd = bsToAD(newBsYear, startBs.month, startBs.day);
          if (!newStartAd || isNaN(newStartAd)) return;
          const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const newStart = fmt(newStartAd);
          let newEnd = newStart;
          if (h.endDate && h.endDate !== h.startDate) {
            const endBs = adToBS(h.endDate);
            if (endBs) { const ea = bsToAD(newBsYear, endBs.month, endBs.day); if (ea && !isNaN(ea)) newEnd = fmt(ea); }
          }
          const diff = Math.round((new Date(newEnd) - new Date(newStart)) / 86400000) + 1;
          toAdd.push({ ...h, id: base + idx + 1, startDate: newStart, endDate: newEnd, days: diff > 0 ? diff : 1 });
        });
        if (toAdd.length) {
          updateSetupList('publicHolidays', [...(settings.publicHolidays || []), ...toAdd]);
        }
      }
    }

    showToast(t('Record saved successfully'));
  };

  const handleSetupDelete = (key, id) => {
    updateSetupList(key, (settings[key] || []).filter(item => item.id !== id));
    showToast(t('Record deleted successfully'));
  };

  /* ── Backup helpers ── */
  const lsGet = (key, fb) => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fb; } catch { return fb; } };

  const buildOfflineBackup = () => ({
    meta: {
      appVersion: APP_VERSION,
      dbVersion : DB_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: currentUser?.fullName || 'Admin',
      source    : 'offline',
    },
    data: {
      users           : lsGet('ls_employees',    []),
      shifts          : lsGet('ls_shifts',        []),
      leaveTypes      : lsGet('ls_leaveTypes',    []),
      leaveBalances   : lsGet('ls_leaveBalances', []),
      leaves          : lsGet('ls_leaves',        []),
      officeVisits    : lsGet('ls_officeVisits',  []),
      fiscalYears     : settings.fiscalYears     || [],
      branches        : settings.branches        || [],
      departments     : settings.departments     || [],
      posts           : settings.posts           || [],
      grades          : settings.grades          || [],
      employmentModes : settings.modes           || [],
      religions       : settings.religions       || [],
      employeeStatuses: settings.statuses        || [],
      jobTimings      : settings.jobTimings      || [],
      weekendHistory  : settings.weekendHistory  || [],
      appSettings     : [{ key: 'main', value: JSON.stringify(settings) }],
    },
  });

  const downloadJson = (data) => {
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ehajiri-backup-v${data.meta?.appVersion}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ── Backup handlers ── */
  const addBackupHistory = (source, sizeKb, path) => {
    const entry = {
      id: Date.now(),
      date: new Date().toISOString(),
      source,
      sizeKb,
      path: path || '',
      by: currentUser?.fullName || 'Admin',
    };
    setBackupHistory(prev => {
      const next = [entry, ...prev].slice(0, 20); // keep last 20
      try { localStorage.setItem('ls_backupHistory', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  /* Open the backup-location modal; `next` = which backup to run after saving */
  const openBackupPathModal = async (next = null) => {
    let suggestion = backupPath;
    if (!suggestion) {
      try { suggestion = (await api.get('/backup/default-path')).path || ''; } catch { suggestion = ''; }
    }
    setBackupPathModal({ input: suggestion, next });
  };

  const confirmBackupPath = () => {
    const p = (backupPathModal?.input || '').trim();
    if (!p) return;
    setBackupPath(p);
    try { localStorage.setItem('ls_backupPath', p); } catch {}
    const next = backupPathModal?.next;
    setBackupPathModal(null);
    if (next === 'json') handleBackup(p);
    if (next === 'sql')  handleBackupSql(p);
  };

  /* Backups are written server-side straight into the chosen folder
     (date-wise file name) — no browser download of the payload. */
  const handleBackup = async (dirArg) => {
    const dir = typeof dirArg === 'string' ? dirArg : backupPath;
    if (!dir) { openBackupPathModal('json'); return; }
    setBackupLoading(true);
    try {
      const r = await api.post('/backup/save', { path: dir, by: currentUser?.fullName || 'Admin' });
      addBackupHistory('PostgreSQL', r.sizeKb, r.file);
      showToast(`${L('ब्याकअप सुरक्षित भयो','Backup saved')}: ${r.file}`);
    } catch (e) {
      if (isOnline) {
        showToast(e.message, 'danger');
      } else {
        /* API unavailable — export current in-memory / localStorage state */
        try {
          const offline = buildOfflineBackup();
          const json = JSON.stringify(offline);
          downloadJson(offline);
          addBackupHistory('localStorage', Math.round(json.length / 1024), L('ब्राउजर डाउनलोड','Browser download'));
          showToast(L('अफलाइन ब्याकअप डाउनलोड भयो (स्थानीय डेटा)','Offline backup downloaded (local data)'));
        } catch (e2) {
          showToast(e2.message, 'danger');
        }
      }
    } finally {
      setBackupLoading(false);
    }
  };

  const handleBackupSql = async (dirArg) => {
    const dir = typeof dirArg === 'string' ? dirArg : backupPath;
    if (!dir) { openBackupPathModal('sql'); return; }
    setSqlBackupLoading(true);
    try {
      const r = await api.post('/backup/sql/save', { path: dir });
      addBackupHistory('PostgreSQL dump (pg_dump -Fc)', r.sizeKb, r.file);
      showToast(`${L('SQL ब्याकअप सुरक्षित भयो','SQL backup saved')}: ${r.file}`);
    } catch (e) {
      showToast(e.message, 'danger');
    } finally {
      setSqlBackupLoading(false);
    }
  };

  const handleRestoreFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();

    // .backup = pg_dump custom-format dump ("PGDMP" magic) → native pg_restore path
    if (/\.backup$/i.test(file.name)) {
      reader.onload = (ev) => {
        const buf = ev.target.result;
        const magic = String.fromCharCode(...new Uint8Array(buf.slice(0, 5)));
        if (magic !== 'PGDMP') {
          showToast(L('अमान्य .backup फाइल','Not a valid PostgreSQL .backup dump'), 'danger');
          return;
        }
        setRestorePreview({ native: true, fileName: file.name, sizeMB: (file.size / 1048576).toFixed(1) });
        setRestoreData({ native: true, buffer: buf });
        setRestoreLog('');
      };
      reader.readAsArrayBuffer(file);
      e.target.value = '';
      return;
    }

    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.meta || !parsed.data) {
          showToast(L('अमान्य ब्याकअप फाइल','Invalid backup file format'), 'danger');
          return;
        }
        setRestorePreview(parsed.meta);
        setRestoreData(parsed);
        setRestoreLog('');
      } catch {
        showToast(L('JSON पार्स गर्न सकिएन','Failed to parse JSON file'), 'danger');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const restoreOffline = (d) => {
    /* Restore data tables to localStorage */
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
    if (d.users)            lsSet('ls_employees',    d.users);
    if (d.shifts)           lsSet('ls_shifts',       d.shifts);
    if (d.leaveTypes)       lsSet('ls_leaveTypes',   d.leaveTypes);
    if (d.leaveBalances)    lsSet('ls_leaveBalances',d.leaveBalances);
    if (d.leaves)           lsSet('ls_leaves',       d.leaves);
    if (d.officeVisits)     lsSet('ls_officeVisits', d.officeVisits);

    /* Restore app settings */
    const settingsPatch = { ...settings };
    if (d.fiscalYears)      settingsPatch.fiscalYears    = d.fiscalYears;
    if (d.branches)         settingsPatch.branches       = d.branches;
    if (d.departments)      settingsPatch.departments    = d.departments;
    if (d.posts)            settingsPatch.posts          = d.posts;
    if (d.grades)           settingsPatch.grades         = d.grades;
    if (d.employmentModes)  settingsPatch.modes          = d.employmentModes;
    if (d.religions)        settingsPatch.religions      = d.religions;
    if (d.employeeStatuses) settingsPatch.statuses       = d.employeeStatuses;
    if (d.jobTimings)       settingsPatch.jobTimings     = d.jobTimings;
    if (d.weekendHistory)   settingsPatch.weekendHistory = d.weekendHistory;
    if (d.appSettings) {
      const main = d.appSettings.find(s => s.key === 'main');
      if (main) {
        const val = typeof main.value === 'string' ? JSON.parse(main.value) : main.value;
        Object.assign(settingsPatch, val);
      }
    }
    localStorage.setItem('app_settings', JSON.stringify(settingsPatch));
  };

  const handleRestore = async () => {
    if (!restoreData) return;
    setRestoreLoading(true);
    setRestoreLog('');

    // Native pg_restore path — full replacement of all tables, no offline fallback
    if (restoreData.native) {
      try {
        const token = getToken();
        const res = await fetch('/api/backup/restore-native', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: restoreData.buffer,
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || `Restore failed (${res.status})`);
        setRestoreLog(`✅ ${result.message}${result.warnings ? `\n⚠️ ${result.warnings}` : ''}`);
        showToast(L('डेटाबेस पुनर्स्थापित भयो','Database restored successfully'));
        setRestorePreview(null);
        setRestoreData(null);
        setTimeout(() => window.location.reload(), 1500);
      } catch (e) {
        setRestoreLog(`❌ Error: ${e.message}`);
        showToast(e.message, 'danger');
      } finally {
        setRestoreLoading(false);
      }
      return;
    }

    try {
      /* Try API (PostgreSQL) restore first */
      const result = await api.post('/backup/restore', restoreData);
      const log = result.migrated
        ? `✅ ${L('माइग्रेट भयो','Migrated')} DB v${result.fromVersion} → v${result.toVersion}\n${result.message}`
        : `✅ ${result.message}`;
      setRestoreLog(log);
      showToast(L('डेटाबेस पुनर्स्थापित भयो','Database restored successfully'));
      setRestorePreview(null);
      setRestoreData(null);
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      /* API unavailable — restore to localStorage */
      try {
        restoreOffline(restoreData.data);
        setRestoreLog(`✅ ${L('अफलाइन पुनर्स्थापना सफल (स्थानीय भण्डारण)','Offline restore successful (local storage)')}`);
        showToast(L('डेटाबेस पुनर्स्थापित भयो','Database restored successfully'));
        setRestorePreview(null);
        setRestoreData(null);
        setTimeout(() => window.location.reload(), 1500);
      } catch (e2) {
        setRestoreLog(`❌ Error: ${e2.message}`);
        showToast(e2.message, 'danger');
      }
    } finally {
      setRestoreLoading(false);
    }
  };

  /* ── Tabs & Sub-nav ──
     "Attendance Device" / "StandAlone Device" are gated by the role
     permission matrix (Settings → Role Management) — hidden entirely from
     roles that can't view them, regardless of the global on/off flag. */
  const tabs = [
    { key:'system',        icon:'🏢',  label:L('कम्पनी सेटिङ','Company Settings')        },
    { key:'setup',         icon:'🏗️', label:L('संगठन सेटअप','Official Setting')         },
    { key:'leaveType',     icon:'🌴',  label:L('बिदा','Leave')                            },
    { key:'officeVisit',   icon:'🚗',  label:L('कार्यालय भ्रमण','Office Visit')          },
    { key:'publicHoliday', icon:'🎉',  label:L('सार्वजनिक छुट्टी','Public Holiday')      },
    canView('attendanceDevice') && { key:'device',        icon:'📡',  label:L('हाजिरी डिभाइस','Attendance Device')      },
    canView('standaloneDevice') && { key:'standaloneDevice', icon:'🖥️', label:L('स्टान्डअलोन डिभाइस','StandAlone Device') },
    { key:'language',      icon:'🌐',  label:L('भाषा','Language')                         },
    { key:'profile',       icon:'👤',  label:L('प्रोफाइल','Profile')                     },
    { key:'emailSetup',    icon:'📧',  label:L('इमेल सेटअप','Email Setup')               },
    { key:'database',      icon:'🗄️', label:L('डेटाबेस','Database')                     },
    isAdmin && { key:'bugFinder', icon:'🐞',  label:L('बग फाइन्डर','Bug Finder')          },
  ].filter(Boolean);

  const setupSubNav = [
    { key:'fiscalYear',  icon:'📆',  label:L('आर्थिक वर्ष','Fiscal Year')  },
    { key:'branch',      icon:'🏪',  label:L('शाखा','Branch')               },
    { key:'department',  icon:'🏗️', label:L('विभाग','Department')          },
    { key:'post',        icon:'🎖️', label:L('पद','Post')                   },
    { key:'grade',       icon:'📊',  label:L('ग्रेड','Grade')              },
    { key:'mode',        icon:'📋',  label:L('नियुक्ति','Mode')            },
    { key:'religion',    icon:'🕌',  label:L('धर्म','Religion')            },
    { key:'status',      icon:'🔄',  label:L('स्थिति','Status')            },
    { key:'jobTiming',   icon:'⏱️',  label:L('कार्य समय','Timing Type')   },
    { key:'shift',       icon:'⏰',  label:L('सिफ्ट','Shift')              },
  ];

  /* section title for content area */
  const setupTitle = setupSubNav.find(s => s.key === activeSetup)?.label || '';

  /* ════════════════════ RENDER ════════════════════ */
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">⚙️ {t('Settings')}</h1>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'230px 1fr', gap:20 }}>
        {/* Main Sidebar */}
        <div className="card" style={{ padding:'8px 0', height:'fit-content' }}>
          {tabs.map(tab => (
            <div key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              padding:'11px 18px', cursor:'pointer', fontSize:14, fontWeight:500,
              display:'flex', alignItems:'center', gap:9,
              background:   activeTab===tab.key ? '#f0fdf4' : 'transparent',
              color:        activeTab===tab.key ? '#52b02c' : '#374151',
              borderLeft:   activeTab===tab.key ? '3px solid #52b02c' : '3px solid transparent',
              transition:'all .15s',
            }}>
              <span style={{ fontSize:16 }}>{tab.icon}</span>
              {tab.label}
            </div>
          ))}

          {/* ── Version Badge (bottom of sidebar) ── */}
          <div style={{ margin:'12px 10px 0', padding:'8px 10px', background:'#f1f5f9', borderRadius:8, border:'1px solid #e2e8f0' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'.4px', marginBottom:4 }}>
              🐘 PostgreSQL
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:12, fontWeight:700, color:'#52b02c' }}>v{APP_VERSION}</span>
              <span style={{ fontSize:10, color:'#6b7280' }}>DB v{dbVersionInfo?.dbApplied ?? DB_VERSION}</span>
            </div>
          </div>
        </div>

        <div>

          {/* ══════════ COMPANY / SYSTEM ══════════ */}
          {activeTab === 'system' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

              {/* ── Company Information — view card, double-click to edit ── */}
              <div className="card" onDoubleClick={openCompanyModal}
                style={{ cursor:'pointer', transition:'box-shadow .15s' }}
                onMouseEnter={e => e.currentTarget.style.boxShadow='0 0 0 2px #52b02c55'}
                onMouseLeave={e => e.currentTarget.style.boxShadow=''}>
                <div className="card-header">
                  <div>
                    <h3>🏢 {L('कम्पनी जानकारी','Company Information')}</h3>
                    <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>
                      {L('सम्पादन गर्न दोहोरो क्लिक गर्नुस','Double-click to edit')}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-outline-primary"
                    onClick={e => { e.stopPropagation(); openCompanyModal(); }}>
                    ✏️ {L('सम्पादन','Edit')}
                  </button>
                </div>

                {/* Letterhead preview (read-only) */}
                <div style={{ background:'linear-gradient(135deg,#f8faff,#f0fdf4)', borderBottom:'1px solid #e5e7eb', padding:'14px 24px', display:'flex', alignItems:'center', gap:20, minHeight:90 }}>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                    {settings.companyLogo ? (
                      <img src={settings.companyLogo} alt="Logo" style={{ maxWidth:180, maxHeight:70, objectFit:'contain', borderRadius:4 }} />
                    ) : (
                      <div style={{ width:120, height:52, border:'2px dashed #bbf7d0', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', background:'white', gap:4 }}>
                        <span style={{ fontSize:20 }}>🖼️</span>
                        <span style={{ fontSize:11, color:'#94a3b8' }}>{L('लोगो छैन','No Logo')}</span>
                      </div>
                    )}
                    {settings.logoWidth && <span style={{ fontSize:10, color:'#9ca3af' }}>{settings.logoWidth}×{settings.logoHeight}px</span>}
                  </div>
                  <div style={{ flex:1, textAlign:'center' }}>
                    <div style={{ fontSize:17, fontWeight:800, color:'#14532d' }}>{language==='np' ? settings.companyNameNp : settings.companyNameEn}</div>
                    <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{language==='np' ? settings.companyAddressNp : settings.companyAddressEn}</div>
                    <div style={{ fontSize:12, color:'#6b7280' }}>{settings.companyPhone}{settings.companyEmail && ` | ${settings.companyEmail}`}</div>
                    {settings.companyWebsite && <div style={{ fontSize:11, color:'#6b7280' }}>{settings.companyWebsite}</div>}
                    <div style={{ borderTop:'2px solid #52b02c', marginTop:8 }}></div>
                  </div>
                </div>

                {/* Info rows */}
                <div style={{ padding:'12px 20px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px 20px', fontSize:13 }}>
                  {[
                    [L('नेपाली नाम','Nepali Name'), settings.companyNameNp],
                    [L('अंग्रेजी नाम','English Name'), settings.companyNameEn],
                    [L('फोन','Phone'), settings.companyPhone],
                    [L('नेपाली ठेगाना','Nepali Address'), settings.companyAddressNp],
                    [L('अंग्रेजी ठेगाना','English Address'), settings.companyAddressEn],
                    [L('इमेल','Email'), settings.companyEmail],
                    [L('वेबसाइट','Website'), settings.companyWebsite],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', marginBottom:2 }}>{label}</div>
                      <div style={{ fontWeight:500, color:val?'#1f2937':'#d1d5db' }}>{val || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* hidden file input always in DOM */}
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp" style={{ display:'none' }} onChange={handleLogoUpload} />

              {/* Weekend card */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <h3>📅 {L('सप्ताहन्त व्यवस्थापन','Weekend Management')}</h3>
                    <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>
                      {L('हालको सप्ताहन्त','Current Weekend')}:&nbsp;
                      <strong>{(settings.defaultWeekends||[]).map(k=>ALL_DAYS.find(d=>d.key===k)?.[language==='np'?'np':'en']||k).join(', ')}</strong>
                      &nbsp;·&nbsp;{L('देखि','from')} {fd(settings.weekendStartDate)}
                      &nbsp;·&nbsp;<span style={{ color:'#9ca3af', fontSize:11 }}>({L('सम्पादन गर्न दोहोरो क्लिक','Double-click row to edit')})</span>
                    </div>
                  </div>
                </div>
                <DataGrid
                  columns={[
                    { field:'effectiveDate', header:L('प्रभावी मिति','Effective Date'),        width:160, render:v=><span style={{fontWeight:600,color:'#52b02c'}}>{fd(v)}</span> },
                    { field:'weekends',      header:L('सप्ताहन्त दिनहरू','Weekend Days'),       width:560, minWidth:560, sortable:false, filterable:false, render:v=><DayBadge dayKeys={v||[]} language={language} /> },
                    { field:'changedDate',   header:L('परिवर्तन मिति','Changed On'),            width:160, render:v=><span style={{color:'#6b7280'}}>{fd(v)}</span> },
                    { field:'changedBy',     header:L('परिवर्तन गर्ने','Changed By'),           width:130, render:v=><span style={{fontWeight:500}}>{v}</span> },
                    { field:'reason',        header:L('कारण','Reason'),                         render:v=><span style={{color:'#6b7280'}}>{v||'—'}</span> },
                  ]}
                  data={[...(settings.weekendHistory||[])].reverse()}
                  defaultPageSize={10}
                  showSearch={true}
                  compact={true}
                  onRowDoubleClick={row=>{
                    setWForm({ weekends:[...row.weekends], effectiveDate:row.effectiveDate, reason:row.reason==='—'?'':row.reason });
                    setWeekendEditId(row.id);
                    setWeekendModal(true);
                  }}
                  onDeleteKey={row=>{
                    const remaining = (settings.weekendHistory||[]).filter(h=>h.id!==row.id);
                    updateSettings({ weekendHistory: remaining });
                  }}
                  onDeleteSelected={ids=>{
                    const remaining = (settings.weekendHistory||[]).filter(h=>!ids.includes(h.id));
                    updateSettings({ weekendHistory: remaining });
                  }}
                  toolbar={
                    <button className="btn btn-primary btn-sm" onClick={()=>{ setWForm({ weekends:[...settings.defaultWeekends], effectiveDate:twoMonthsAgo, reason:'' }); setWeekendEditId(null); setWeekendModal(true); }}>
                      + {L('सप्ताहन्त परिवर्तन','Change Weekend')}
                    </button>
                  }
                />
              </div>

              {/* ── Calendar & Date Format card (compact dropdowns) ── */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <h3>📅 {L('डिफल्ट क्यालेन्डर र मिति ढाँचा','Default Calendar & Date Format')}</h3>
                    <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{L('सबै फारम, DataGrid र रिपोर्टमा लागू हुनेछ','Applied to all forms, DataGrids and reports')}</div>
                  </div>
                </div>
                <div className="card-body">
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'start' }}>

                    {/* Calendar dropdown */}
                    <div className="form-group" style={{ marginBottom:0 }}>
                      <label className="form-label">{L('क्यालेन्डर','Calendar')}</label>
                      <select className="form-control" value={local.defaultCalendar}
                        onChange={e => set('defaultCalendar', e.target.value)}>
                        <option value="en">🌍 English (AD) — Gregorian</option>
                        <option value="np">🇳🇵 Nepali (BS) — Bikram Sambat</option>
                      </select>
                      {/* Nepali Digits toggle — visible only when BS selected */}
                      {local.defaultCalendar === 'np' && (
                        <div style={{ marginTop:10, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', background:'#f9fafb', borderRadius:8, border:'1px solid #e5e7eb' }}>
                          <div>
                            <div style={{ fontSize:12, fontWeight:600 }}>{L('नेपाली अंक (०,१,२...)','Nepali Digits')}</div>
                            <div style={{ fontSize:11, color:'#6b7280' }}>{L('उदाहरण','eg')}: {formatDate(PREVIEW_DATE,{calendar:'np',format:local.defaultDateFormat,nepaliDigits:true})}</div>
                          </div>
                          <div style={{ width:40, height:22, background:local.nepaliDigits?'#52b02c':'#d1d5db', borderRadius:11, position:'relative', cursor:'pointer', transition:'background .2s', flexShrink:0 }}
                            onClick={() => set('nepaliDigits', !local.nepaliDigits)}>
                            <div style={{ position:'absolute', top:2, left:local.nepaliDigits?20:2, width:18, height:18, background:'white', borderRadius:'50%', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}></div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Date Format dropdown + live preview */}
                    <div className="form-group" style={{ marginBottom:0 }}>
                      <label className="form-label">{L('मिति ढाँचा','Date Format')}</label>
                      <select className="form-control" value={local.defaultDateFormat}
                        onChange={e => set('defaultDateFormat', e.target.value)}>
                        {FORMAT_OPTIONS.map(opt => (
                          <option key={opt.key} value={opt.key}>{opt.label}</option>
                        ))}
                      </select>
                      {/* Live preview pill */}
                      <div style={{ marginTop:8, display:'inline-flex', alignItems:'center', gap:8, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'6px 14px', fontSize:13, fontWeight:700, color:'#166534' }}>
                        {livePreview(local.defaultDateFormat)}
                        <span style={{ fontSize:11, color:'#6b7280', fontWeight:400 }}>— {L('प्रिभ्यु','preview')}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop:14, display:'flex', justifyContent:'flex-end' }}>
                    <button className="btn btn-primary btn-sm" onClick={handleSave}>
                      💾 {L('सुरक्षित','Save')}
                    </button>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* ══════════ CALENDAR (legacy — now merged into system tab) ══════════ */}
          {activeTab === 'calendar' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div className="card">
                <div className="card-header"><h3>📅 {L('डिफल्ट क्यालेन्डर','Default Calendar')}</h3></div>
                <div className="card-body">
                  <p style={{ fontSize:13, color:'#6b7280', marginBottom:16 }}>{L('छानिएको क्यालेन्डर सबै फारम, डेटाग्रिड र रिपोर्टमा लागू हुनेछ।','The selected calendar will be applied to all forms, DataGrids and reports.')}</p>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                    {[{code:'en',flag:'🌍',title:L('अंग्रेजी (AD)','English (AD)'),sub:'Gregorian · Anno Domini'},{code:'np',flag:'🇳🇵',title:L('नेपाली (BS)','Nepali (BS)'),sub:'विक्रम सम्वत् · Bikram Sambat'}].map(cal => {
                      const active = local.defaultCalendar === cal.code;
                      return (
                        <div key={cal.code} onClick={() => set('defaultCalendar', cal.code)} style={{ border:`2px solid ${active?'#52b02c':'#e5e7eb'}`, background:active?'#f0fdf4':'#f9fafb', borderRadius:12, padding:'18px 20px', cursor:'pointer', transition:'all .15s' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                              <span style={{ fontSize:26 }}>{cal.flag}</span>
                              <div>
                                <div style={{ fontSize:15, fontWeight:700, color:active?'#166534':'#1f2937' }}>{cal.title}</div>
                                <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{cal.sub}</div>
                              </div>
                            </div>
                            <div style={{ width:20, height:20, borderRadius:'50%', border:`2px solid ${active?'#52b02c':'#d1d5db'}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                              {active && <div style={{ width:10, height:10, borderRadius:'50%', background:'#52b02c' }}></div>}
                            </div>
                          </div>
                          <div style={{ marginTop:12, background:active?'#dcfce7':'#f3f4f6', borderRadius:6, padding:'7px 12px', fontSize:14, fontWeight:700, color:active?'#166534':'#374151', textAlign:'center' }}>{livePreview(local.defaultDateFormat)}</div>
                        </div>
                      );
                    })}
                  </div>
                  {local.defaultCalendar === 'np' && (
                    <div style={{ marginTop:16, padding:'12px 16px', background:'#f9fafb', borderRadius:10, border:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div>
                        <div style={{ fontSize:14, fontWeight:600 }}>{L('नेपाली अंक (०,१,२...)','Nepali Digits (०,१,२...)')}</div>
                        <div style={{ fontSize:12, color:'#6b7280' }}>{L('मितिमा देवनागरी अंक','Use Devanagari numerals in dates')} — {L('उदाहरण','Example')}: {formatDate(PREVIEW_DATE,{calendar:'np',format:local.defaultDateFormat,nepaliDigits:true})}</div>
                      </div>
                      <div style={{ width:48, height:26, background:local.nepaliDigits?'#52b02c':'#d1d5db', borderRadius:13, position:'relative', cursor:'pointer', transition:'background .2s' }}
                        onClick={() => set('nepaliDigits', !local.nepaliDigits)}>
                        <div style={{ position:'absolute', top:3, left:local.nepaliDigits?24:3, width:20, height:20, background:'white', borderRadius:'50%', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="card">
                <div className="card-header"><h3>🗓️ {L('मिति ढाँचा','Date Format')}</h3></div>
                <div className="card-body">
                  <p style={{ fontSize:13, color:'#6b7280', marginBottom:14 }}>{L('यो ढाँचा सबै फारम, डेटाग्रिड, डेटापिकर र रिपोर्टमा स्वतः लागू हुनेछ।','This format will automatically apply to all forms, DataGrids, datepickers and reports.')}</p>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {FORMAT_OPTIONS.map(opt => {
                      const active = local.defaultDateFormat === opt.key;
                      return (
                        <label key={opt.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 16px', borderRadius:8, cursor:'pointer', border:`2px solid ${active?'#52b02c':'#e5e7eb'}`, background:active?'#f0fdf4':'#f9fafb', transition:'all .15s' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                            <input type="radio" name="dateFormat" checked={active} onChange={() => set('defaultDateFormat', opt.key)} style={{ accentColor:'#52b02c', width:15, height:15 }} />
                            <span style={{ fontFamily:'monospace', fontSize:14, fontWeight:600, color:active?'#166534':'#374151' }}>{opt.label}</span>
                          </div>
                          <span style={{ fontSize:14, fontWeight:active?700:500, color:active?'#52b02c':'#6b7280', background:active?'#dcfce7':'#f3f4f6', padding:'4px 12px', borderRadius:6 }}>{livePreview(opt.key)}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ marginTop:14, background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#92400e' }}>
                    ⚡ {L('यो ढाँचा — कर्मचारी फारम (Join Date), सप्ताहन्त मिति, Leave, Office Visit सबैमा लागू।','This format applies to: Employee Join Date, Weekend dates, Leave dates, Office Visit dates — everywhere.')}
                  </div>
                  <div style={{ marginTop:16 }}>
                    <SaveButton onClick={handleSaveCalendarSettings} label={L('क्यालेन्डर सेटिङ सुरक्षित','Save Calendar Settings')} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════ ORGANIZATION SETUP (image-1 layout) ══════════ */}
          {activeTab === 'setup' && (
            <div style={{ display:'grid', gridTemplateColumns:'175px 1fr', gap:16 }}>

              {/* Setup Sub-nav */}
              <div className="card" style={{ padding:'6px 0', height:'fit-content' }}>
                <div style={{ padding:'10px 14px 6px', fontSize:10, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.6px' }}>
                  {L('संगठन सेटअप','Official Setting')}
                </div>
                {setupSubNav.map(item => (
                  <div key={item.key} onClick={() => setActiveSetup(item.key)} style={{
                    padding:'9px 14px', cursor:'pointer', fontSize:13, fontWeight:500,
                    display:'flex', alignItems:'center', gap:8,
                    background:   activeSetup===item.key ? '#f0fdf4' : 'transparent',
                    color:        activeSetup===item.key ? '#15803d' : '#374151',
                    borderLeft:   activeSetup===item.key ? '3px solid #22c55e' : '3px solid transparent',
                    transition:'all .15s',
                  }}>
                    <span style={{ fontSize:14 }}>{item.icon}</span>
                    {item.label}
                  </div>
                ))}
              </div>

              {/* Content Panel */}
              <div>
                {/* Section title */}
                <div style={{ marginBottom:10, fontSize:16, fontWeight:700, color:'#1f2937', display:'flex', alignItems:'center', gap:8 }}>
                  <span>{setupSubNav.find(s=>s.key===activeSetup)?.icon}</span>
                  {setupTitle}
                </div>

                {activeSetup === 'fiscalYear' && (
                  <SetupSection
                    title={L('आर्थिक वर्ष','Fiscal Year')}
                    data={settings.fiscalYears || []}
                    fields={[
                      { key:'name',      type:'text',    header:L('आर्थिक वर्षको नाम','Fiscal Year Name'), required:true },
                      { key:'startDate', type:'date',    header:L('सुरु मिति','Start Date'),               required:true,
                        renderCell: v => (
                          <span style={{ fontWeight:500, color:'#0369a1' }}>📅 {v ? fd(v) : '—'}</span>
                        )},
                      { key:'endDate',   type:'date',    header:L('अन्त मिति','End Date'),                 required:true,
                        renderCell: v => (
                          <span style={{ fontWeight:500, color:'#7c3aed' }}>📅 {v ? fd(v) : '—'}</span>
                        )},
                      { key:'isDefault', type:'boolean', header:L('डिफल्ट वर्ष','Default Year') },
                    ]}
                    onSave={(id, form) => handleSetupSave('fiscalYears', id, form, true)}
                    onDelete={(id) => handleSetupDelete('fiscalYears', id)}
                  />
                )}

                {activeSetup === 'branch' && (
                  <SetupSection
                    title={L('शाखा','Branch')}
                    data={settings.branches || []}
                    fields={[
                      { key:'name',      header:L('शाखाको नाम','Branch Name'), required:true },
                      { key:'shortName', header:L('संक्षिप्त नाम','Short Name') },
                      { key:'address',   header:L('ठेगाना','Address') },
                      { key:'phone',     header:L('फोन','Phone') },
                    ]}
                    onSave={(id,form) => handleSetupSave('branches', id, form)}
                    onDelete={(id) => handleSetupDelete('branches', id)}
                  />
                )}

                {activeSetup === 'department' && (
                  <SetupSection
                    title={L('विभाग','Department')}
                    data={settings.departments || []}
                    fields={[
                      { key:'name',         header:L('विभागको नाम','Department Name'), required:true },
                      { key:'shortName',    header:L('संक्षिप्त नाम','Short Name') },
                      { key:'rankingOrder', header:L('क्रम','Ranking Order'), type:'number', placeholder:'1' },
                      { key:'isDefault',    header:L('डिफल्ट','Default'), type:'boolean' },
                    ]}
                    sortKey="rankingOrder"
                    onSave={(id,form) => handleSetupSave('departments', id, form, true)}
                    onDelete={(id) => handleSetupDelete('departments', id)}
                  />
                )}

                {activeSetup === 'post' && (
                  <SetupSection
                    title={L('पद','Post')}
                    data={[...(settings.posts || [])].sort((a,b)=>(a.rankingOrder??9999)-(b.rankingOrder??9999))}
                    fields={[
                      { key:'name',         header:L('पदको नाम','Post Name'), required:true },
                      { key:'shortName',    header:L('संक्षिप्त नाम','Short Name') },
                      { key:'rankingOrder', header:L('क्रम','Ranking Order'), type:'number', placeholder:'1' },
                      { key:'isDefault',    header:L('डिफल्ट','Default'), type:'boolean' },
                    ]}
                    sortKey="rankingOrder"
                    onSave={(id,form) => handleSetupSave('posts', id, form, true)}
                    onDelete={(id) => handleSetupDelete('posts', id)}
                  />
                )}

                {activeSetup === 'grade' && (
                  <SetupSection
                    title={L('ग्रेड','Grade')}
                    data={[...(settings.grades || [])].sort((a,b)=>(a.rankingOrder??9999)-(b.rankingOrder??9999))}
                    fields={[
                      { key:'name',         header:L('ग्रेड','Grade'),         required:true },
                      { key:'rankingOrder', header:L('क्रम','Ranking Order'),   type:'number', placeholder:'1' },
                    ]}
                    sortKey="rankingOrder"
                    onSave={(id,form) => handleSetupSave('grades', id, form)}
                    onDelete={(id) => handleSetupDelete('grades', id)}
                  />
                )}

                {activeSetup === 'mode' && (
                  <SetupSection
                    title={L('नियुक्ति प्रकार','Employment Mode')}
                    data={settings.modes || []}
                    fields={[
                      { key:'name',      header:L('मोड','Mode'), required:true },
                      { key:'isDefault', header:L('डिफल्ट','Default'), type:'boolean' },
                    ]}
                    onSave={(id,form) => handleSetupSave('modes', id, form, true)}
                    onDelete={(id) => handleSetupDelete('modes', id)}
                  />
                )}

                {activeSetup === 'religion' && (
                  <SetupSection
                    title={L('धर्म','Religion')}
                    data={settings.religions || []}
                    fields={[
                      { key:'name',      header:L('धर्म','Religious'), required:true },
                      { key:'isDefault', header:L('डिफल्ट','Default'), type:'boolean' },
                    ]}
                    onSave={(id,form) => handleSetupSave('religions', id, form, true)}
                    onDelete={(id) => handleSetupDelete('religions', id)}
                  />
                )}

                {activeSetup === 'status' && (
                  <SetupSection
                    title={L('स्थिति','Status')}
                    data={settings.statuses || []}
                    fields={[
                      { key:'name',       header:L('स्थिति नाम','Status Name'), required:true },
                      { key:'statusType', header:L('स्थिति प्रकार','Status Type'), type:'select', required:true,
                        options:[
                          { value:'Working',     label:L('कार्यरत','Working') },
                          { value:'Not Working', label:L('कार्यरत नभएको','Not Working') },
                        ] },
                      { key:'isDefault', header:L('डिफल्ट','Default'), type:'boolean' },
                    ]}
                    onSave={(id,form) => handleSetupSave('statuses', id, form, true)}
                    onDelete={(id) => handleSetupDelete('statuses', id)}
                  />
                )}

                {activeSetup === 'jobTiming' && (
                  <SetupSection
                    title={L('कार्य समय प्रकार','Job Timing')}
                    data={settings.jobTimings || []}
                    fields={[
                      { key:'name',      header:L('कार्य समय','Job Timing'), required:true },
                      { key:'isDefault', header:L('डिफल्ट','Default'), type:'boolean' },
                    ]}
                    onSave={(id,form) => handleSetupSave('jobTimings', id, form, true)}
                    onDelete={(id) => handleSetupDelete('jobTimings', id)}
                  />
                )}

                {activeSetup === 'shift' && <ShiftInlineSection />}
              </div>
            </div>
          )}

          {/* ══════════ LEAVE TYPE ══════════ */}
          {activeTab === 'leaveType' && (
            <div>
              <div style={{ marginBottom:10, fontSize:16, fontWeight:700, color:'#1f2937', display:'flex', alignItems:'center', gap:8 }}>
                🌴 {L('बिदा प्रकार सेटिङ','Leave Type Settings')}
              </div>
              <LeaveTypeSection />
            </div>
          )}

          {/* ══════════ OFFICE VISIT TYPE ══════════ */}
          {activeTab === 'officeVisit' && (
            <div>
              <div style={{ marginBottom:10, fontSize:16, fontWeight:700, color:'#1f2937', display:'flex', alignItems:'center', gap:8 }}>
                🚗 {L('कार्यालय भ्रमण प्रकार सेटिङ','Office Visit Type Settings')}
              </div>
              <OfficeVisitTypeSection />
            </div>
          )}

          {/* ══════════ PUBLIC HOLIDAY ══════════ */}
          {activeTab === 'publicHoliday' && (
            <div>
              <div style={{ marginBottom:10, fontSize:16, fontWeight:700, color:'#1f2937', display:'flex', alignItems:'center', gap:8 }}>
                🎉 {L('सार्वजनिक छुट्टी सेटिङ','Public Holiday Settings')}
              </div>
              <PublicHolidaySection />
            </div>
          )}

          {/* ══════════ ATTENDANCE DEVICE (ZKTeco) ══════════ */}
          {activeTab === 'device' && canView('attendanceDevice') && (
            <div className="card">
              <div className="card-header">
                <h3>📡 {L('हाजिरी डिभाइस सेटिङ','Attendance Device Setting')}</h3>
              </div>
              <div className="card-body">
                {!moduleFlagsLoading && (
                  <ModuleToggleBanner
                    enabled={moduleFlags.attendanceDeviceEnabled}
                    isAdmin={isAdmin}
                    onToggle={() => toggleModule('module_attendance_device_enabled')}
                    label={L('हाजिरी डिभाइस मोड्युल','Attendance Device module')}
                    L={L}
                  />
                )}
                {moduleFlags.attendanceDeviceEnabled && <ZKTecoDeviceSettings />}
              </div>
            </div>
          )}

          {/* ══════════ STANDALONE DEVICE (ZKTeco Legacy SDK) ══════════ */}
          {activeTab === 'standaloneDevice' && canView('standaloneDevice') && (
            <div className="card">
              <div className="card-header">
                <h3>🖥️ {L('स्टान्डअलोन डिभाइस सेटिङ','StandAlone Device Setting')}</h3>
              </div>
              <div className="card-body">
                {!moduleFlagsLoading && (
                  <ModuleToggleBanner
                    enabled={moduleFlags.standaloneDeviceEnabled}
                    isAdmin={isAdmin}
                    onToggle={() => toggleModule('module_standalone_device_enabled')}
                    label={L('स्टान्डअलोन डिभाइस मोड्युल','StandAlone Device module')}
                    L={L}
                  />
                )}
                {moduleFlags.standaloneDeviceEnabled && <StandAloneDeviceSettings />}
              </div>
            </div>
          )}

          {/* ══════════ LANGUAGE ══════════ */}
          {activeTab === 'language' && <LanguageSection />}

          {/* ══════════ PROFILE ══════════ */}
          {activeTab === 'profile' && (
            <ProfileTab currentUser={currentUser} showToast={showToast} />
          )}

          {/* ══════════ USER ROLE ══════════ */}
          {activeTab === 'userRole' && (() => {
            /* map old 'manager' key to 'branchManager' for display */
            const canon = (r) => r === 'manager' ? 'branchManager' : (r || 'employee');

            const GROUPS = [
              {
                key:'admin', icon:'👑',
                name:L('प्रशासक','Admin'),
                color:'#7e3af2', bg:'#f5f3ff', border:'#ddd6fe',
                desc:L('सम्पूर्ण कर्मचारीमा पूर्ण अधिकार — सबै शाखा र विभाग','Full rights of all staff across all branches and departments'),
              },
              {
                key:'branchManager', icon:'🏪',
                name:L('शाखा प्रबन्धक','Branch Manager'),
                color:'#52b02c', bg:'#f0fdf4', border:'#bbf7d0',
                desc:L('आफ्नो शाखाका सम्पूर्ण कर्मचारीमा पूर्ण अधिकार मात्र','Full rights of all staff only within their assigned Branch'),
              },
              {
                key:'departmentHead', icon:'🏗️',
                name:L('विभाग प्रमुख','Department Head'),
                color:'#0e9f6e', bg:'#f0fdf4', border:'#a7f3d0',
                desc:L('आफ्नो विभागका सम्पूर्ण कर्मचारीमा पूर्ण अधिकार मात्र','Full rights of all staff within their assigned Department only'),
              },
              {
                key:'employee', icon:'👤',
                name:L('कर्मचारी','Employee'),
                color:'#6b7280', bg:'#f9fafb', border:'#e5e7eb',
                desc:L('केवल आफ्नो रिपोर्ट मात्र हेर्न सक्छ','View own reports only — no management access'),
              },
            ];

            /* keep the Ctrl+S ref pointed at this render's closure (correct GROUPS/changeModal) */
            changeRoleActionRef.current = () => {
              if (!changeModal) return;
              updateEmployee(changeModal.emp.id, { ...changeModal.emp, role: changeModal.newRole });
              const grpName = GROUPS.find(g => g.key === changeModal.newRole)?.name || changeModal.newRole;
              showToast(`${changeModal.emp.fullName} → ${grpName}`);
              setChangeModal(null);
            };

            const PERMS = [
              { label:L('सबै कर्मचारी व्यवस्थापन','All Staff Management'),    vals:[true, false,false,false] },
              { label:L('शाखाका कर्मचारी','Branch Staff Management'),          vals:[true, true, false,false] },
              { label:L('विभागका कर्मचारी','Department Staff Management'),     vals:[true, true, true, false] },
              { label:L('प्रणाली सेटिङ','System Settings'),                   vals:[true, false,false,false] },
              { label:L('बिदा/भ्रमण अनुमोदन','Leave/Visit Approval'),         vals:[true, true, true, false] },
              { label:L('ब्याकअप/रिस्टोर','Database Backup/Restore'),         vals:[true, false,false,false] },
              { label:L('भूमिका व्यवस्थापन','Role Management'),               vals:[true, false,false,false] },
              { label:L('आफ्नो रिपोर्ट','View Own Report'),                    vals:[true, true, true, true]  },
            ];

            return (
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

                {/* ── Role group cards ── */}
                {GROUPS.map(grp => {
                  const staff = (employees||[]).filter(e => canon(e.role) === grp.key);
                  return (
                    <div className="card" key={grp.key} style={{ borderLeft:`4px solid ${grp.color}`, overflow:'visible' }}>
                      {/* Card header */}
                      <div className="card-header" style={{ background:`linear-gradient(135deg,${grp.bg},#ffffff)` }}>
                        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                          <div style={{ width:42,height:42,borderRadius:10,background:`${grp.color}18`,border:`1.5px solid ${grp.border}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0 }}>
                            {grp.icon}
                          </div>
                          <div>
                            <h3 style={{ color:grp.color, fontSize:15 }}>{grp.name}</h3>
                            <p style={{ fontSize:12, color:'#6b7280', margin:0, marginTop:1 }}>{grp.desc}</p>
                          </div>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                          <span style={{ background:grp.bg, color:grp.color, border:`1px solid ${grp.border}`, padding:'3px 12px', borderRadius:20, fontSize:12, fontWeight:700 }}>
                            {staff.length} {L('जना','staff')}
                          </span>
                          <button
                            className="btn btn-sm"
                            style={{ background:`${grp.color}14`, color:grp.color, border:`1px solid ${grp.border}` }}
                            onClick={() => { setAssignSearch(''); setAssignModal({ ...grp }); }}>
                            + {L('थप्नुस','Assign')}
                          </button>
                        </div>
                      </div>

                      {/* Staff chips */}
                      <div className="card-body" style={{ padding:'12px 16px', minHeight:52 }}>
                        {staff.length === 0 ? (
                          <div style={{ color:'#9ca3af', fontSize:13, fontStyle:'italic' }}>
                            {L('यस भूमिकामा कुनै कर्मचारी छैन','No staff assigned to this role')}
                          </div>
                        ) : (
                          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                            {staff.map(emp => (
                              <div key={emp.id} style={{ display:'flex', alignItems:'center', gap:8, background:grp.bg, border:`1px solid ${grp.border}`, borderRadius:8, padding:'6px 10px 6px 8px' }}>
                                <div style={{ width:30,height:30,borderRadius:'50%',background:`${grp.color}22`,color:grp.color,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,flexShrink:0 }}>
                                  {emp.avatar}
                                </div>
                                <div style={{ minWidth:0 }}>
                                  <div style={{ fontSize:13,fontWeight:600,color:'#1f2937',whiteSpace:'nowrap' }}>{emp.fullName}</div>
                                  <div style={{ fontSize:11,color:'#6b7280',whiteSpace:'nowrap' }}>{emp.branch||emp.department||'—'}</div>
                                </div>
                                <button
                                  title={L('भूमिका परिवर्तन','Change Role')}
                                  onClick={() => setChangeModal({ emp, newRole: grp.key })}
                                  style={{ background:'none',border:'none',cursor:'pointer',color:'#9ca3af',padding:'2px 4px',fontSize:13,lineHeight:1,borderRadius:4,transition:'all .15s' }}
                                  onMouseEnter={e=>e.currentTarget.style.color=grp.color}
                                  onMouseLeave={e=>e.currentTarget.style.color='#9ca3af'}>
                                  ✏
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* ── Permission matrix ── */}
                <div className="card">
                  <div className="card-header">
                    <h3>📋 {L('अनुमति सारांश','Permission Matrix')}</h3>
                  </div>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                      <thead>
                        <tr>
                          <th style={{ ...thStyle, width:200 }}>{L('अनुमति','Permission')}</th>
                          {GROUPS.map(g => (
                            <th key={g.key} style={{ ...thStyle, textAlign:'center', color:g.color, whiteSpace:'nowrap' }}>
                              {g.icon} {g.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PERMS.map(({ label, vals }) => (
                          <tr key={label}>
                            <td style={{ ...tdStyle, fontWeight:500 }}>{label}</td>
                            {vals.map((v, i) => (
                              <td key={i} style={{ ...tdStyle, textAlign:'center' }}>
                                {v
                                  ? <span style={{ color:'#0e9f6e', fontSize:15 }}>✅</span>
                                  : <span style={{ color:'#d1d5db', fontSize:13 }}>⛔</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Assign Staff Modal ── */}
                {assignModal && (
                  <div className="modal-overlay">
                    <div className="modal modal-md" onClick={e => e.stopPropagation()}>
                      <div className="modal-header" style={{ background:`linear-gradient(135deg,${assignModal.bg},#ffffff)` }}>
                        <h2>{assignModal.icon} {L('कर्मचारी थप्नुस','Assign Staff')} — {assignModal.name}</h2>
                        <button className="modal-close" onClick={() => setAssignModal(null)}>✕</button>
                      </div>
                      <div className="modal-body">
                        <input type="text" className="form-control" style={{ marginBottom:12 }}
                          placeholder={L('नाम खोज्नुस...','Search by name...')}
                          value={assignSearch}
                          onChange={e => setAssignSearch(e.target.value)} />
                        <div style={{ maxHeight:340, overflowY:'auto', display:'flex', flexDirection:'column', gap:6 }}>
                          {(employees||[])
                            .filter(e => canon(e.role) !== assignModal.key)
                            .filter(e => !assignSearch || e.fullName.toLowerCase().includes(assignSearch.toLowerCase()))
                            .sort((a,b) => (a.fullName||'').localeCompare(b.fullName||''))
                            .map(emp => {
                              const cr = GROUPS.find(g => g.key === canon(emp.role));
                              return (
                                <div key={emp.id}
                                  style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'#f9fafb', borderRadius:8, cursor:'pointer', border:'1px solid #e5e7eb', transition:'all .15s' }}
                                  onMouseEnter={e=>{ e.currentTarget.style.background=assignModal.bg; e.currentTarget.style.borderColor=assignModal.border; }}
                                  onMouseLeave={e=>{ e.currentTarget.style.background='#f9fafb'; e.currentTarget.style.borderColor='#e5e7eb'; }}
                                  onClick={() => {
                                    updateEmployee(emp.id, { ...emp, role: assignModal.key });
                                    showToast(`${emp.fullName} → ${assignModal.name}`);
                                    setAssignModal(null);
                                  }}>
                                  <div style={{ width:34,height:34,borderRadius:'50%',background:cr?.bg||'#f3f4f6',color:cr?.color||'#6b7280',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:14,flexShrink:0 }}>
                                    {emp.avatar}
                                  </div>
                                  <div style={{ flex:1, minWidth:0 }}>
                                    <div style={{ fontWeight:600, fontSize:13 }}>{emp.fullName}</div>
                                    <div style={{ fontSize:11, color:'#6b7280' }}>
                                      {emp.department||'—'} · {L('हालको','Current')}: {cr?.name||emp.role}
                                    </div>
                                  </div>
                                  <span style={{ fontSize:12, color:assignModal.color, fontWeight:600, flexShrink:0 }}>
                                    → {assignModal.name}
                                  </span>
                                </div>
                              );
                            })
                          }
                          {(employees||[]).filter(e => canon(e.role) !== assignModal.key).length === 0 && (
                            <div style={{ textAlign:'center', color:'#9ca3af', padding:'24px', fontSize:13 }}>
                              {L('सबै कर्मचारी यस भूमिकामा पहिले नै छन्','All staff are already in this role')}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="modal-footer">
                        <button className="btn btn-outline" onClick={() => setAssignModal(null)}>{t('Cancel')}</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Change Role Modal ── */}
                {changeModal && (
                  <div className="modal-overlay">
                    <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                      <div className="modal-header" style={{ background:'linear-gradient(135deg,#f0fdf4,#f0fdf4)' }}>
                        <h2>✏️ {L('भूमिका परिवर्तन','Change Role')}</h2>
                        <button className="modal-close" onClick={() => setChangeModal(null)}>✕</button>
                      </div>
                      <div className="modal-body">
                        {/* Staff info */}
                        <div style={{ display:'flex', alignItems:'center', gap:12, background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 14px', marginBottom:16 }}>
                          <div style={{ width:38,height:38,borderRadius:'50%',background:'#dcfce7',color:'#52b02c',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:16 }}>
                            {changeModal.emp.avatar}
                          </div>
                          <div>
                            <div style={{ fontWeight:600, fontSize:14 }}>{changeModal.emp.fullName}</div>
                            <div style={{ fontSize:12, color:'#6b7280' }}>{changeModal.emp.department||'—'}</div>
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label required">{L('नयाँ भूमिका','New Role')}</label>
                          <select className="form-control"
                            value={changeModal.newRole}
                            onChange={e => setChangeModal(p => ({ ...p, newRole: e.target.value }))}>
                            {GROUPS.map(g => (
                              <option key={g.key} value={g.key}>{g.icon} {g.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="modal-footer">
                        <button className="btn btn-outline" onClick={() => setChangeModal(null)}>{t('Cancel')}</button>
                        <SaveButton onClick={() => changeRoleActionRef.current?.()} label={L('सुरक्षित','Save Role')} />
                      </div>
                    </div>
                  </div>
                )}

              </div>
            );
          })()}

          {/* ══════════ EMAIL SETUP ══════════ */}
          {activeTab === 'emailSetup' && (
            <EmailSetupTab showToast={showToast} />
          )}

          {/* ══════════ DATABASE / BACKUP & RESTORE ══════════ */}
          {activeTab === 'database' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

              {/* ── Connection status banner ── */}
              {!isOnline && (
                <div style={{ background:'#fefce8', border:'1px solid #fde68a', borderRadius:10, padding:'12px 16px', display:'flex', alignItems:'center', gap:10, fontSize:13, color:'#92400e' }}>
                  <span style={{ fontSize:20 }}>⚠️</span>
                  <div>
                    <strong>{L('अफलाइन मोड','Offline Mode')}</strong>
                    {' — '}
                    {L('PostgreSQL सर्भर उपलब्ध छैन। ब्याकअप र पुनर्स्थापना स्थानीय भण्डारण (localStorage) मा काम गर्दछ।',
                       'PostgreSQL server not available. Backup & restore work with local storage.')}
                  </div>
                </div>
              )}

              {/* ── Version Info Card ── */}
              <div className="card">
                <div className="card-header">
                  <h3>🐘 {L('डेटाबेस जानकारी','Database Information')}</h3>
                  <span style={{
                    fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20,
                    background: isOnline ? '#d1fae5' : '#fee2e2',
                    color:      isOnline ? '#065f46' : '#991b1b',
                    border:     `1px solid ${isOnline ? '#6ee7b7' : '#fca5a5'}`,
                  }}>
                    {isOnline ? '🟢 Online' : '🔴 Offline'}
                  </span>
                </div>
                <div className="card-body" style={{ paddingTop:12, paddingBottom:12 }}>
                  {/* Compact info strip */}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                    {[
                      { label:L('एप संस्करण','App Version'), value:`v${APP_VERSION}`,                             icon:'🏷️', color:'#52b02c', bg:'#f0fdf4', border:'#bbf7d0' },
                      { label:L('DB स्किमा','DB Schema'),    value:`v${dbVersionInfo?.dbApplied ?? DB_VERSION}`,   icon:'🗂️', color:'#0369a1', bg:'#e0f2fe', border:'#bae6fd' },
                      { label:L('भण्डारण','Storage'),        value: isOnline ? 'PostgreSQL' : 'localStorage',     icon: isOnline?'🐘':'💾', color: isOnline?'#336791':'#7e3af2', bg: isOnline?'#f0f9ff':'#f5f3ff', border: isOnline?'#bae6fd':'#ddd6fe' },
                    ].map(item => (
                      <div key={item.label} style={{ background:item.bg, border:`1px solid ${item.border}`, borderRadius:8, padding:'6px 14px', display:'flex', alignItems:'center', gap:7 }}>
                        <span style={{ fontSize:17 }}>{item.icon}</span>
                        <div>
                          <div style={{ fontSize:13, fontWeight:800, color:item.color, fontFamily:'monospace', lineHeight:1.2 }}>{item.value}</div>
                          <div style={{ fontSize:10, color:'#6b7280', fontWeight:600, textTransform:'uppercase', letterSpacing:'.4px' }}>{item.label}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{ marginLeft:'auto', background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 14px', fontSize:12, color:'#6b7280', display:'flex', gap:14 }}>
                      <span>🖥️ <strong>localhost:5001</strong></span>
                      <span>📦 <strong>{isOnline ? 'ehajiri_db' : 'localStorage'}</strong></span>
                      <span>📅 {L('अन्तिम अपडेट','Last Updated')}: <strong>{dbVersionInfo?.dbAppliedAt ? fd(dbVersionInfo.dbAppliedAt.split('T')[0]) : fd(new Date().toISOString().split('T')[0])}</strong></span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Backup Card ── */}
              <div className="card">
                <div className="card-header">
                  <h3>📥 {L('डेटाबेस ब्याकअप','Database Backup')}</h3>
                </div>
                <div className="card-body">
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, fontSize:13, flexWrap:'wrap' }}>
                    <span style={{ color:'#6b7280', fontWeight:600 }}>📁 {L('ब्याकअप स्थान','Backup Location')}:</span>
                    {backupPath
                      ? <code style={{ background:'#f3f4f6', border:'1px solid #e5e7eb', borderRadius:6, padding:'3px 10px', fontSize:12, color:'#1f2937' }}>{backupPath}</code>
                      : <span style={{ color:'#9ca3af' }}>{L('सेट गरिएको छैन — पहिलो ब्याकअपमा सोधिनेछ','Not set — you will be asked on first backup')}</span>}
                    <button className="btn btn-sm btn-outline" onClick={() => openBackupPathModal(null)}>
                      {backupPath ? `✏️ ${L('परिवर्तन','Change')}` : `📂 ${L('स्थान छान्नुहोस','Set Location')}`}
                    </button>
                  </div>
                  <div style={{ background: isOnline ? '#f0fdf4' : '#fefce8', border:`1px solid ${isOnline ? '#bbf7d0' : '#fde68a'}`, borderRadius:8, padding:'12px 14px', marginBottom:16, fontSize:13, color: isOnline ? '#065f46' : '#92400e' }}>
                    {isOnline ? '✅' : '💾'}{' '}
                    {isOnline
                      ? `${L('ब्याकअपमा संस्करण जानकारी स्वतः समावेश हुन्छ।','Version info is automatically included in backup.')} ${L('पुनर्स्थापनामा स्वत: माइग्रेसन लागू हुन्छ।','Auto-migration is applied on restore.')}`
                      : L('PostgreSQL उपलब्ध नभएकोले स्थानीय डेटा ब्याकअप हुनेछ। PostgreSQL जडान भएपछि डेटाबेस ब्याकअप पूर्ण हुन्छ।',
                          'Local data will be backed up since PostgreSQL is not available. Full DB backup available when PostgreSQL is connected.')}
                  </div>
                  <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                    <button
                      className="btn btn-primary"
                      style={{ display:'flex', alignItems:'center', gap:8, fontSize:14, padding:'10px 22px' }}
                      onClick={() => handleBackup()}
                      disabled={backupLoading}
                    >
                      {backupLoading ? '⏳ ...' : '📥'} {L('ब्याकअप लिनुहोस','Backup')}
                    </button>
                    <button
                      className="btn btn-outline"
                      style={{ display:'flex', alignItems:'center', gap:8, fontSize:14, padding:'10px 22px' }}
                      onClick={() => handleBackupSql()}
                      disabled={sqlBackupLoading || !isOnline}
                      title={L('सबै तालिकाहरू (हाजिरी लग सहित) समेट्ने compressed PostgreSQL डम्प — pg_restore बाट restore गर्नुहोस्।','Compressed PostgreSQL dump of ALL tables (attendance logs included) — restore with: pg_restore -d ehajiri_db <file>.backup')}
                    >
                      {sqlBackupLoading ? '⏳ ...' : '🗄️'} {L('SQL निर्यात गर्नुहोस','Export SQL')}
                    </button>
                    <button
                      className="btn btn-outline"
                      style={{ display:'flex', alignItems:'center', gap:8, fontSize:14, padding:'10px 22px' }}
                      onClick={() => restoreRef.current?.click()}
                    >
                      📤 {L('ब्याकअप पुनर्स्थापना / फाइल छान्नुहोस','Database Restore / Select Backup File')}
                    </button>
                    <input ref={restoreRef} type="file" accept=".json,.backup" style={{ display:'none' }} onChange={handleRestoreFileSelect} />
                    {restorePreview && (
                      <span style={{ fontSize:12, color:'#059669', fontWeight:600 }}>
                        ✅ {L('फाइल लोड भयो','File loaded')}
                      </span>
                    )}
                  </div>

                  {/* ── Restore Preview — shown inline after file is selected ── */}
                  {restorePreview && (
                    <div style={{ marginTop:16, borderTop:'1px solid #e5e7eb', paddingTop:16 }}>
                      <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:13, color:'#9a3412' }}>
                        ⚠️ {L('सावधान: पुनर्स्थापनाले सबै अवस्थित डेटा मेटाउनेछ। पहिले ब्याकअप लिनुहोस।',
                              'Warning: Restore will overwrite all existing data. Take a backup first.')}
                      </div>
                      <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:10, textTransform:'uppercase', letterSpacing:'.4px' }}>
                          📋 {L('ब्याकअप विवरण','Backup Details')}
                        </div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:13 }}>
                          {(restorePreview.native
                            ? [
                                [L('फाइल','File'),   restorePreview.fileName],
                                [L('साइज','Size'),   `${restorePreview.sizeMB} MB`],
                                [L('ढाँचा','Format'), 'PostgreSQL dump (pg_dump -Fc)'],
                              ]
                            : [
                                [L('एप संस्करण','App Version'),    `v${restorePreview.appVersion}`],
                                [L('DB संस्करण','DB Version'),     `v${restorePreview.dbVersion}`],
                                [L('निर्यात मिति','Exported At'),  fd(restorePreview.exportedAt?.split('T')[0])],
                                [L('निर्यात गरेको','Exported By'), restorePreview.exportedBy],
                              ]
                          ).map(([k, v]) => (
                            <div key={k}>
                              <span style={{ color:'#9ca3af', fontSize:11 }}>{k}: </span>
                              <strong style={{ color:'#1f2937' }}>{v}</strong>
                            </div>
                          ))}
                        </div>
                        {restorePreview.native && (
                          <div style={{ marginTop:12, background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#0369a1' }}>
                            🗄️ {L('पूर्ण PostgreSQL पुनर्स्थापना — हाजिरी लग सहित सबै तालिकाहरू बदलिनेछन्। पुरानो संस्करणको डम्प भए माइग्रेसन स्वत: चल्नेछ।',
                                  'Full PostgreSQL restore — replaces ALL tables including attendance logs. If the dump is from an older version, migrations run automatically.')}
                          </div>
                        )}
                        {!restorePreview.native && restorePreview.dbVersion < DB_VERSION && (
                          <div style={{ marginTop:12, background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#92400e' }}>
                            🔄 {L('यो ब्याकअप पुरानो DB संस्करणको हो','This backup is from an older DB schema')}
                            {' '}(v{restorePreview.dbVersion} → v{DB_VERSION}).{' '}
                            {L('पुनर्स्थापनामा स्वत: माइग्रेसन लागू हुनेछ।','Migration will be applied automatically on restore.')}
                          </div>
                        )}
                        {!restorePreview.native && restorePreview.dbVersion === DB_VERSION && (
                          <div style={{ marginTop:12, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#065f46' }}>
                            ✅ {L('ब्याकअप हालको DB संस्करणसँग मेल खान्छ।','Backup matches current DB version — no migration needed.')}
                          </div>
                        )}
                        {!restorePreview.native && restorePreview.dbVersion > DB_VERSION && (
                          <div style={{ marginTop:12, background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#b91c1c' }}>
                            ❌ {L('ब्याकअप नयाँ DB संस्करणको छ।','Backup is from a newer DB version — please upgrade the app first.')}
                          </div>
                        )}
                      </div>
                      {(restorePreview.native || restorePreview.dbVersion <= DB_VERSION) && (
                        <button
                          className="btn btn-danger"
                          style={{ display:'flex', alignItems:'center', gap:8, fontSize:14, padding:'10px 22px' }}
                          onClick={handleRestore}
                          disabled={restoreLoading}
                        >
                          {restoreLoading ? '⏳ ...' : '📤'} {L('पुनर्स्थापना गर्नुहोस','Restore Database')}
                        </button>
                      )}
                      {restoreLog && (
                        <div style={{ marginTop:14, background:'#1f2937', borderRadius:8, padding:'12px 16px', fontFamily:'monospace', fontSize:12, color:'#d1fae5', whiteSpace:'pre-line' }}>
                          {restoreLog}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Backup History Card ── */}
              <div className="card">
                <DataGrid
                  title={
                    <div>
                      <div style={{ fontSize:15, fontWeight:700, color:'#111827' }}>🕓 {L('ब्याकअप इतिहास','Backup History')}</div>
                      <div style={{ fontSize:12, color:'#6b7280', marginTop:2, fontWeight:400 }}>{L('यस सत्रमा लिइएका ब्याकअपहरू (अधिकतम २०)','Backups taken this session — last 20')}</div>
                    </div>
                  }
                  columns={[
                    { field:'date',   header:L('मिति र समय','Date & Time'), width:160, render:v=>(
                      <div>
                        <div style={{fontWeight:600,color:'#1f2937'}}>{fd(v.split('T')[0])}</div>
                        <div style={{fontSize:11,color:'#6b7280'}}>{new Date(v).toLocaleTimeString()}</div>
                      </div>
                    )},
                    { field:'source', header:L('स्रोत','Source'), width:150, render:v=>(
                      <span style={{
                        padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700,
                        background:v==='PostgreSQL'?'#dcfce7':'#f3e8ff',
                        color:v==='PostgreSQL'?'#166534':'#7e3af2',
                        border:`1px solid ${v==='PostgreSQL'?'#bbf7d0':'#ddd6fe'}`,
                      }}>
                        {v==='PostgreSQL'?'🐘':'💾'} {v}
                      </span>
                    )},
                    { field:'sizeKb', header:L('साइज','Size'), width:90, align:'center', render:v=><span style={{color:'#0369a1',fontWeight:600}}>{v} KB</span> },
                    { field:'by',     header:L('गरेको','By'), width:130, render:v=><span style={{fontWeight:500}}>{v}</span> },
                    { field:'path',   header:L('ब्याकअप पथ','Backup Path'), render:v=> v
                      ? <span title={v} style={{ fontSize:11, color:'#374151', fontFamily:'ui-monospace, SFMono-Regular, Consolas, monospace', wordBreak:'break-all' }}>{v}</span>
                      : <span style={{ color:'#9ca3af' }}>—</span> },
                  ]}
                  data={backupHistory}
                  defaultPageSize={10}
                  showSearch={false}
                  compact={true}
                  toolbar={backupHistory.length > 0 && (
                    <button className="btn btn-sm btn-outline" onClick={()=>{
                      setBackupHistory([]);
                      try { localStorage.removeItem('ls_backupHistory'); } catch {}
                    }}>🗑 {L('सफा गर्नुस','Clear')}</button>
                  )}
                />
            </div>

          </div>
        )}

        {/* ══════════ BUG FINDER ══════════ */}
        {activeTab === 'bugFinder' && <BugFinder />}

        </div>
      </div>

      {/* ── Backup location modal ── */}
      {backupPathModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📁 {L('ब्याकअप स्थान','Backup Location')}</h2>
              <button className="modal-close" onClick={() => setBackupPathModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize:13, color:'#6b7280', marginBottom:14 }}>
                {L('ब्याकअप फाइलहरू सुरक्षित गर्ने ड्राइभ/फोल्डर लेख्नुहोस। सबै ब्याकअप यहीँ मिति-अनुसारको फाइल नामसहित सुरक्षित हुनेछन्।',
                   'Enter the drive/folder where backup files will be saved. Every backup is saved here with a date-wise file name.')}
              </p>
              <div className="form-group">
                <label className="form-label required">{L('फोल्डर पथ (ड्राइभ + फोल्डर)','Folder Path (drive + folder)')}</label>
                <input
                  type="text"
                  className="form-control"
                  value={backupPathModal.input}
                  onChange={e => setBackupPathModal(p => ({ ...p, input: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') confirmBackupPath(); }}
                  placeholder="D:\eHajiri Backups"
                  autoFocus
                />
                <div style={{ fontSize:11, color:'#9ca3af', marginTop:5 }}>
                  {L('उदाहरण','Example')}: D:\eHajiri Backups — {L('फोल्डर नभए स्वतः बनाइनेछ।','the folder is created automatically if it does not exist.')}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setBackupPathModal(null)}>{L('रद्द गर्नुस','Cancel')}</button>
              <button className="btn btn-primary" disabled={!backupPathModal.input?.trim()} onClick={confirmBackupPath}>
                💾 {backupPathModal.next ? L('सुरक्षित गरी ब्याकअप लिनुहोस','Save & Backup') : L('सुरक्षित गर्नुहोस','Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Weekend change modal ── */}
      {weekendModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📅 {weekendEditId
                ? L('साप्ताहिक बिदा अद्यावधिक','Update Weekend')
                : L('साप्ताहिक बिदा परिवर्तन','Change Weekend Days')}</h2>
              <button className="modal-close" onClick={() => { setWeekendModal(false); setWeekendEditId(null); }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label required">{L('साप्ताहिक बिदा','Weekend Days')}</label>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:6 }}>
                  {ALL_DAYS.map(d => {
                    const on = wForm.weekends.includes(d.key);
                    return (
                      <label key={d.key} style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:7, cursor:'pointer', border:`2px solid ${on?'#52b02c':'#e5e7eb'}`, background:on?'#f0fdf4':'#f9fafb', fontWeight:on?700:400, color:on?'#166534':'#374151', transition:'all .13s' }}>
                        <input type="checkbox" checked={on} onChange={() => setWForm(p => ({ ...p, weekends: on ? p.weekends.filter(k=>k!==d.key) : [...p.weekends, d.key] }))} style={{ accentColor:'#52b02c', width:13, height:13 }} />
                        {language==='np' ? d.np : d.en}
                      </label>
                    );
                  })}
                </div>
                {wForm.weekends.length===0 && <div className="form-error">कम्तीमा एक दिन छान्नुस</div>}
              </div>
              <div className="form-group">
                <label className="form-label required">
                  {weekendEditId
                    ? L('अद्यावधिक मिति','Updated Date')
                    : L('प्रभावी मिति','Effective Date')}
                  <span style={{ fontWeight:400, color:'#6b7280', marginLeft:6 }}>
                    — {weekendEditId
                        ? L('परिवर्तन गरिएको मिति','Date when this change was made')
                        : L('यस मितिदेखि सबै कर्मचारीमा लागू','Apply to all staff from this date')}
                  </span>
                </label>
                {settings.defaultCalendar === 'np'
                  ? <NepaliDatePicker value={wForm.effectiveDate} onChange={v => setWForm(p=>({...p, effectiveDate:v}))} maxToday={false} />
                  : <input type="date" className="form-control" value={wForm.effectiveDate}
                      onChange={e => setWForm(p=>({...p, effectiveDate:e.target.value}))} />
                }
                <div style={{ marginTop:5, fontSize:12, color:'#6b7280' }}>
                  {wForm.effectiveDate ? fd(wForm.effectiveDate) : ''}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">{L('कारण','Reason')} ({L('ऐच्छिक','Optional')})</label>
                <input type="text" className="form-control" placeholder={L('परिवर्तनको कारण...','Reason for this change...')}
                  value={wForm.reason} onChange={e => setWForm(p=>({...p,reason:e.target.value}))} />
              </div>
              {wForm.weekends.length > 0 && wForm.effectiveDate && (
                <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#065f46' }}>
                  ✅ &nbsp;{wForm.weekends.map(k=>ALL_DAYS.find(d=>d.key===k)?.[language==='np'?'np':'en']||k).join(', ')}
                  &nbsp;→&nbsp;<strong>{fd(wForm.effectiveDate)}</strong>
                  &nbsp;{L('देखि सबै कर्मचारीमा लागू','— applied to all staff from this date')}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setWeekendModal(false); setWeekendEditId(null); }}>{t('Cancel')}</button>
              <SaveButton onClick={handleWeekendSave}
                label={weekendEditId ? L('अपडेट गर्नुहोस','Update Record') : L('परिवर्तन सुरक्षित','Save Change')} />
            </div>
          </div>
        </div>
      )}

      {/* ── Company Edit Modal ── */}
      {companyModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:620, width:'95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#f0fdf4,#f0fdf4)' }}>
              <h2>🏢 {L('कम्पनी जानकारी सम्पादन','Edit Company Information')}</h2>
              <button className="modal-close" onClick={() => setCompanyModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Logo upload */}
              <div style={{ marginBottom:16, display:'flex', alignItems:'center', gap:14 }}>
                <div
                  style={{ width:150, height:64, border:'2px dashed #bbf7d0', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', background:'#f8faff', cursor:'pointer', overflow:'hidden', flexShrink:0 }}
                  onClick={() => companyLogoInputRef.current?.click()}
                >
                  {cForm.companyLogo
                    ? <img src={cForm.companyLogo} alt="Logo" style={{ maxWidth:146, maxHeight:60, objectFit:'contain' }} />
                    : <span style={{ fontSize:12, color:'#94a3b8' }}>{L('लोगो छैन','No Logo')}</span>
                  }
                </div>
                <div>
                  <div style={{ fontSize:12, color:'#6b7280', marginBottom:4 }}>PNG, JPG, SVG, WebP · max 500 KB · ratio 1.5–7</div>
                  {cForm.logoWidth && <div style={{ fontSize:11, color:'#9ca3af', marginBottom:4 }}>{cForm.logoWidth}×{cForm.logoHeight}px</div>}
                  {logoError && <div style={{ fontSize:11, color:'#ef4444', marginBottom:4 }}>{logoError}</div>}
                  <div style={{ display:'flex', gap:6 }}>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => companyLogoInputRef.current?.click()}>
                      📷 {L('अपलोड','Upload')}
                    </button>
                    {cForm.companyLogo && (
                      <button type="button" className="btn btn-sm" style={{ background:'#fee2e2', color:'#b91c1c', border:'1px solid #fca5a5' }}
                        onClick={() => { sc('companyLogo', null); sc('logoWidth', null); sc('logoHeight', null); }}>
                        🗑 {L('हटाउनुस','Remove')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <input ref={companyLogoInputRef} type="file" accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp" style={{ display:'none' }} onChange={handleModalLogoUpload} />

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">नेपाली नाम</label>
                  <input type="text" className="form-control" value={cForm.companyNameNp || ''}
                    onChange={e => sc('companyNameNp', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">English Name</label>
                  <input type="text" className="form-control" value={cForm.companyNameEn || ''}
                    onChange={e => sc('companyNameEn', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">नेपाली ठेगाना</label>
                  <input type="text" className="form-control" value={cForm.companyAddressNp || ''}
                    onChange={e => sc('companyAddressNp', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">English Address</label>
                  <input type="text" className="form-control" value={cForm.companyAddressEn || ''}
                    onChange={e => sc('companyAddressEn', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{L('फोन','Phone')}</label>
                  <input type="text" className="form-control" value={cForm.companyPhone || ''}
                    onChange={e => sc('companyPhone', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{L('इमेल','Email')}</label>
                  <input type="email" className="form-control" value={cForm.companyEmail || ''}
                    onChange={e => sc('companyEmail', e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">{L('वेबसाइट','Website')}</label>
                <input type="text" className="form-control" value={cForm.companyWebsite || ''}
                  onChange={e => sc('companyWebsite', e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setCompanyModal(false)}>{t('Cancel')}</button>
              <SaveButton onClick={handleCompanySave} label={t('Save')} />
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            <span>{toast.type==='success'?'✅':'❌'}</span>
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
