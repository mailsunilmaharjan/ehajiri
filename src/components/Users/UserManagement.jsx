import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import DataGrid        from '../DataGrid/DataGrid.jsx';
import useDateFormat   from '../../hooks/useDateFormat.js';
import NepaliDatePicker, { adToISO } from '../Common/NepaliDatePicker.jsx';
import ImportDeviceUsersModal from '../Common/ImportDeviceUsersModal.jsx';
import { getNepalNow, getNepalTodayISO } from '../../utils/dateUtils.js';
import ImportExcelModal       from './ImportExcelModal.jsx';
import RecoApprovalModal from './RecoApprovalModal.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import SaveButton       from '../Common/SaveButton.jsx';
import useSaveShortcut  from '../../hooks/useSaveShortcut.js';
import api, { apiUrl }  from '../../api/client.js';
import { staffRankCompare, branchRankOf } from '../../utils/branchUtils.js';

const ROLE_COLORS = {
  admin:'#7e3af2', branchManager:'#1a56db', departmentHead:'#0e9f6e',
  manager:'#1a56db',  // backward compat alias
  employee:'#6b7280',
};
const ROLE_BG = {
  admin:'#ede9fe', branchManager:'#dbeafe', departmentHead:'#d1fae5',
  manager:'#dbeafe',
  employee:'#f3f4f6',
};
const ROLE_LABELS = {
  admin:'Admin', branchManager:'Branch Manager', departmentHead:'Department Head',
  manager:'Branch Manager',
  employee:'Employee',
};
const MODAL_TABS  = ['Staff Detail', 'Staff Identity', 'Officially Changes', 'Device Connectivity'];

/* NepaliDatePicker imported from Common/NepaliDatePicker.jsx */


/* ── AD date input ── */
const ADDateInput = ({ value, onChange, error }) => {
  return (
    <input type="date"
      className={`form-control ${error ? 'error' : ''}`}
      style={{ fontSize:13 }}
      value={value}
      onChange={e => onChange(e.target.value)} />
  );
};

/* ── Date field dispatcher ── */
const DateInput = ({ value, onChange, error }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} error={error} />;
  }
  return <ADDateInput value={value} onChange={onChange} error={error} />;
};

/* ── Row colors — very subtle tints per row index ── */
const ROW_BG = [
  '#ffffff',  // white
  '#f7faff',  // barely blue
  '#f7fef9',  // barely green
  '#fffefc',  // barely amber
  '#fdf9ff',  // barely purple
  '#fff8f9',  // barely rose
  '#f7fdfc',  // barely teal
  '#fafaff',  // barely indigo
];

/* ── Panel card ── */
const Panel = ({ title, children }) => (
  <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius-md)', overflow:'hidden' }}>
    <div style={{ padding:'8px 14px', borderBottom:'1px solid var(--border)', background:'#f0f5fb', fontSize:11, fontWeight:700, color:'#4b6a8a', letterSpacing:'.6px', textTransform:'uppercase' }}>
      {title}
    </div>
    <div>{children}</div>
  </div>
);

/* ── Field group row with alternating color ── */
const Fg = ({ children, idx = 0 }) => (
  <div style={{ padding:'8px 14px', background:ROW_BG[idx % ROW_BG.length], borderBottom:'1px solid #eef0f4' }}>
    {children}
  </div>
);

/* ── Field label + optional Quick Add button ── */
const Fl = ({ children, required, onQA }) => (
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
    <span style={{ fontSize:12, fontWeight:500, color:'#374151' }}>
      {children}{required && <span style={{ color:'#f05252', marginLeft:2 }}>*</span>}
    </span>
    {onQA && (
      <button type="button" onClick={onQA}
        style={{ fontSize:11, color:'#1a56db', background:'#e8f0fe', border:'1px solid #bfdbfe', borderRadius:4, cursor:'pointer', padding:'1px 7px', fontWeight:600, lineHeight:'18px' }}>
        + Quick Add
      </button>
    )}
  </div>
);

/* ────────────────────────────────── */

const FINGER_LABELS = [
  'Right Pinky','Right Ring','Right Middle','Right Index','Right Thumb',
  'Left Thumb','Left Index','Left Middle','Left Ring','Left Pinky',
];
const PRIV_OPTIONS = [
  { value:0,  label:'User' },
  { value:1,  label:'Enroller' },
  { value:2,  label:'Manager' },
  { value:6,  label:'Admin' },
  { value:14, label:'Super Admin' },
];

const DeviceConnTab = ({ devicePin, staffName, employeeId }) => {
  const { t } = useLanguage();
  const [devices,     setDevices]     = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [selDevIds,   setSelDevIds]   = useState([]); // multi-select — actions apply to all of these
  const [loading,     setLoading]     = useState(false);
  const [toast,       setToast]       = useState(null);
  const [fpSlot,      setFpSlot]      = useState(0);
  const [delFpSlot,   setDelFpSlot]   = useState(0);
  const [privilege,   setPrivilege]   = useState(0);
  const [passwd,      setPasswd]      = useState('');
  // expires mirrors the device's own Expires value: 0 none | 1 date range |
  // 2 use-count | 3 date range AND use-count (see Validity/Expiry panel below).
  const [expires,     setExpires]     = useState(0);
  const [startDate,   setStartDate]   = useState(() => getNepalTodayISO());
  const [endDate,     setEndDate]     = useState(() => {
    const d = getNepalNow(); d.setFullYear(d.getFullYear() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [validCount,  setValidCount]  = useState(1);
  const faceFileInputRef = useRef(null);

  // ZKTeco devices only PULL commands on their own poll cycle (no true
  // server push) — a queued command can sit for anywhere from a few seconds
  // to a few minutes before the device actually attempts it. This tracks
  // each queued enroll command's live status (queued/sent/done/error) per
  // device so the modal can show real progress instead of a fire-and-forget
  // toast that leaves the admin guessing when to have the staff member
  // present their finger/face at the terminal.
  const [cmdWatch, setCmdWatch] = useState({}); // devId -> { status, label }
  const watchTimers = useRef({});
  useEffect(() => () => { Object.values(watchTimers.current).forEach(clearInterval); }, []);

  const watchCommand = (devId, sn, cmdId, label) => {
    if (watchTimers.current[devId]) clearInterval(watchTimers.current[devId]);
    setCmdWatch(prev => ({ ...prev, [devId]: { status: 'queued', label } }));
    let elapsed = 0;
    const poll = async () => {
      elapsed += 3;
      try {
        const rows = await api.get(`/zkteco/commands?sn=${encodeURIComponent(sn)}`);
        const row = Array.isArray(rows) ? rows.find(r => r.id === cmdId) : null;
        if (row?.status === 'DONE') {
          clearInterval(watchTimers.current[devId]); delete watchTimers.current[devId];
          setCmdWatch(prev => ({ ...prev, [devId]: { status: 'done', label } }));
          loadEnrollments();
          return;
        }
        if (row?.status === 'ERROR') {
          clearInterval(watchTimers.current[devId]); delete watchTimers.current[devId];
          setCmdWatch(prev => ({ ...prev, [devId]: { status: 'error', label } }));
          return;
        }
        if (row?.status === 'SENT') {
          setCmdWatch(prev => ({ ...prev, [devId]: { status: 'sent', label } }));
        }
      } catch { /* transient — keep polling */ }
      if (elapsed >= 120) {
        clearInterval(watchTimers.current[devId]); delete watchTimers.current[devId];
        setCmdWatch(prev => ({ ...prev, [devId]: { status: 'timeout', label } }));
      }
    };
    watchTimers.current[devId] = setInterval(poll, 3000);
    poll();
  };

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadEnrollments = () => {
    if (!devicePin) return;
    api.get(`/zkteco/device-users?pin=${encodeURIComponent(devicePin)}`)
      .then(d => setEnrollments(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  const loadDevices = () => {
    api.get('/zkteco/devices')
      .then(d => {
        const list = Array.isArray(d) ? d : [];
        setDevices(list);
        setSelDevIds(prev => {
          const kept = prev.filter(id => list.some(dev => String(dev.id) === id));
          return kept.length ? kept : (list[0] ? [String(list[0].id)] : []);
        });
      })
      .catch(() => {});
  };

  const refresh = () => { loadDevices(); loadEnrollments(); };

  useEffect(() => {
    loadDevices();
    loadEnrollments();
  }, [devicePin]);

  // FP-slot / face-sample status indicators reflect the first selected device —
  // actions below still apply to ALL selected devices.
  const selDev = devices.find(d => String(d.id) === selDevIds[0]);
  const enrollment = selDev ? enrollments.find(e => e.device_sn === selDev.serial_number) : null;

  const isOnline = (dev) => {
    if (!dev?.last_seen) return false;
    return (Date.now() - new Date(dev.last_seen).getTime()) < 5 * 60 * 1000;
  };

  // Group devices by Area for the multi-select tree (Area checkbox → its devices).
  // Offline devices are hidden entirely — they can't receive enroll/manage
  // commands, so listing them only invites actions that would fail.
  const devicesByArea = (() => {
    const groups = new Map();
    for (const d of devices) {
      if (!isOnline(d)) continue;
      const key   = d.area_id != null ? String(d.area_id) : 'unassigned';
      const label = d.area_name || 'Unassigned';
      if (!groups.has(key)) groups.set(key, { areaId:key, areaName:label, devices:[] });
      groups.get(key).devices.push(d);
    }
    return [...groups.values()];
  })();

  const toggleDevice = (id) => {
    const sid = String(id);
    setSelDevIds(prev => prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid]);
  };
  const toggleArea = (areaDevices) => {
    const ids = areaDevices.map(d => String(d.id));
    const allSelected = ids.every(id => selDevIds.includes(id));
    setSelDevIds(prev => allSelected
      ? prev.filter(id => !ids.includes(id))
      : [...new Set([...prev, ...ids])]);
  };

  // Reflect the staff member's actual saved validity status (server-enforced —
  // see PostVerifyData) instead of always showing the toggle off with default dates.
  useEffect(() => {
    if (!enrollment) return;
    const mode = Number(enrollment.access_expiry_mode ?? (enrollment.access_expires ? 1 : 0));
    setExpires(mode);
    if (enrollment.access_valid_from) setStartDate(String(enrollment.access_valid_from).slice(0,10));
    if (enrollment.access_valid_to)   setEndDate(String(enrollment.access_valid_to).slice(0,10));
    if (enrollment.access_valid_count != null) setValidCount(enrollment.access_valid_count);
  }, [enrollment?.access_expiry_mode, enrollment?.access_expires, enrollment?.access_valid_from, enrollment?.access_valid_to, enrollment?.access_valid_count]);

  const post = (path, body) => api.post(`/zkteco${path}`, body);

  // fn receives each selected device's id — actions apply to every device currently ticked.
  const run = async (label, fn) => {
    if (!selDevIds.length) { showToast('Select at least one device first', 'error'); return; }
    setLoading(true);
    try {
      const results = await Promise.allSettled(selDevIds.map(devId => fn(devId)));
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length) {
        showToast(`${label}: ${failed.length}/${selDevIds.length} device(s) failed — ${failed[0].reason?.message || ''}`, 'error');
      } else {
        showToast(`${label} queued on ${selDevIds.length} device${selDevIds.length>1?'s':''}`);
      }
      loadEnrollments();
    } finally {
      setLoading(false);
    }
  };

  // Sync user info to device THEN run enrollment command — for every selected device
  const runEnroll = async (label, enrollFn) => {
    if (!selDevIds.length) { showToast('Select at least one device first', 'error'); return; }
    setLoading(true);
    try {
      const results = await Promise.allSettled(selDevIds.map(async (devId) => {
        // Always push name/privilege first so the device knows this user
        await post(`/devices/${devId}/upload-user`, {
          pin: devicePin, name: staffName, privilege,
          card: enrollment?.card_no || '',
          expires,
          startDatetime: startDate + ' 00:00:00',
          endDatetime:   endDate   + ' 23:59:00',
          validCount: (expires === 2 || expires === 3) ? (Number(validCount) || 0) : null,
        });
        const r = await enrollFn(devId);
        const dev = devices.find(d => String(d.id) === devId);
        if (r?.id && dev?.serial_number) watchCommand(devId, dev.serial_number, r.id, label);
      }));
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length) {
        showToast(`${label}: ${failed.length}/${selDevIds.length} device(s) failed — ${failed[0].reason?.message || ''}`, 'error');
      } else {
        showToast(`${label} queued on ${selDevIds.length} device${selDevIds.length>1?'s':''} — name synced, watch status below`);
      }
      loadEnrollments();
    } finally {
      setLoading(false);
    }
  };

  const handleFacePhotoFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file) return;
    if (!selDevIds.length) { showToast('Select at least one device first', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setLoading(true);
      try {
        const results = await Promise.allSettled(
          selDevIds.map(devId => post(`/devices/${devId}/upload-face-photo`, { pin: devicePin, photo: reader.result }))
        );
        const failed = results.filter(r => r.status === 'rejected');
        showToast(failed.length
          ? `Upload failed on ${failed.length}/${selDevIds.length} device(s)`
          : `Face photo uploaded to ${selDevIds.length} device${selDevIds.length>1?'s':''}`,
          failed.length ? 'error' : 'success');
        loadEnrollments();
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  if (!devicePin) {
    return (
      <div className="empty-state" style={{ padding:'40px 0' }}>
        <div className="empty-state-icon">🔗</div>
        <h3>{t('No Device PIN')}</h3>
        <p>{t('Set an Attendance Device ID on the Staff Detail tab first.')}</p>
      </div>
    );
  }

  const s = { label:{ fontSize:11, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.4px', marginBottom:4, display:'block' } };
  const inputStyle = { height:34, border:'1px solid #d1d5db', borderRadius:6, padding:'0 10px', fontSize:13, width:'100%', boxSizing:'border-box' };
  const selectStyle = { ...inputStyle };
  const btn = (color='#1a56db') => ({
    height:34, padding:'0 14px', background:color, color:'white', border:'none',
    borderRadius:6, fontSize:13, fontWeight:600, cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.7 : 1, whiteSpace:'nowrap',
  });
  const outlineBtn = { height:34, padding:'0 14px', background:'white', color:'#374151', border:'1px solid #d1d5db', borderRadius:6, fontSize:13, fontWeight:600, cursor: loading ? 'not-allowed' : 'pointer' };
  const dangerBtn  = { ...btn('#dc2626') };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Toast — sticky so it stays visible even when scrolled deep into this
          long form (e.g. after clicking Apply Validity near the bottom) */}
      {toast && (
        <div style={{ position:'sticky', top:0, zIndex:50,
          padding:'10px 14px', borderRadius:8, fontSize:13, fontWeight:600,
          boxShadow:'0 4px 12px rgba(0,0,0,.12)',
          background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${toast.type === 'error' ? '#fca5a5' : '#86efac'}`,
          color: toast.type === 'error' ? '#dc2626' : '#16a34a' }}>
          {toast.type === 'error' ? '⚠️' : '✅'} {toast.msg}
        </div>
      )}

      {/* PIN + Name + selection summary */}
      <div style={{ display:'flex', gap:12, alignItems:'center', background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 14px', fontSize:13 }}>
        <div><span style={{ color:'#6b7280', fontWeight:600 }}>{t('Device PIN')}: </span><span style={{ fontWeight:700, fontFamily:'monospace', color:'#1a56db' }}>{devicePin}</span></div>
        <div style={{ borderLeft:'1px solid #e5e7eb', paddingLeft:12 }}><span style={{ color:'#6b7280', fontWeight:600 }}>{t('Staff')}: </span><span style={{ fontWeight:700 }}>{staffName || '—'}</span></div>
        <div style={{ borderLeft:'1px solid #e5e7eb', paddingLeft:12, flex:1, display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ color:'#6b7280', fontWeight:600 }}>
            {selDevIds.length} {selDevIds.length===1 ? t('device selected') : t('devices selected')}
          </span>
        </div>
        <button style={{ ...outlineBtn, height:28, fontSize:12, padding:'0 10px' }} onClick={refresh}>↺ {t('Refresh')}</button>
      </div>

      {/* Target Devices — multi-select tree: Area Name (tick selects all its devices) → Serial No. */}
      <div>
        <span style={s.label}>{t('Target Devices')}</span>
        {devicesByArea.length === 0 ? (
          <div className="empty-state" style={{ padding:'20px 0' }}>
            <div className="empty-state-icon">📡</div>
            {devices.length === 0 ? (
              <>
                <h3>{t('No Devices Found')}</h3>
                <p>{t('Add a device in Settings → Attendance Device → Devices before enrolling staff.')}</p>
              </>
            ) : (
              <>
                <h3>{t('No Online Devices')}</h3>
                <p>{t('All devices are currently offline — bring a device online to enroll staff.')}</p>
              </>
            )}
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {devicesByArea.map(group => {
              const ids = group.devices.map(d => String(d.id));
              const allSelected = ids.every(id => selDevIds.includes(id));
              const someSelected = !allSelected && ids.some(id => selDevIds.includes(id));
              return (
                <div key={group.areaId} style={{ border:'1px solid #e5e7eb', borderRadius:8, overflow:'hidden' }}>
                  <div onClick={() => toggleArea(group.devices)}
                    style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer',
                      background: allSelected ? '#eff6ff' : '#f8fafc', borderBottom:'1px solid #e5e7eb' }}>
                    <input type="checkbox" checked={allSelected} readOnly
                      style={{ opacity: someSelected ? 0.6 : 1, accentColor:'#1a56db', width:15, height:15 }} />
                    <span style={{ fontWeight:700, fontSize:13, color:'#1f2937' }}>📍 {group.areaName}</span>
                    <span style={{ fontSize:11, color:'#9ca3af' }}>({group.devices.length} {group.devices.length===1 ? t('device') : t('devices')})</span>
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8, padding:8 }}>
                    {group.devices.map(d => {
                      const online      = isOnline(d);
                      const enr         = enrollments.find(en => en.device_sn === d.serial_number);
                      const isSelected  = selDevIds.includes(String(d.id));
                      return (
                        <div key={d.id} onClick={() => toggleDevice(d.id)}
                          style={{ padding:'8px 12px', borderRadius:10, cursor:'pointer', minWidth:160,
                            border: isSelected ? '2px solid #1a56db' : '2px solid #e5e7eb',
                            background: isSelected ? '#eff6ff' : 'white',
                            boxShadow: isSelected ? '0 2px 8px rgba(26,86,219,.12)' : 'none',
                            transition:'all .15s' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                            <input type="checkbox" checked={isSelected} readOnly style={{ accentColor:'#1a56db', width:13, height:13 }} />
                            <span style={{ fontWeight:700, fontSize:13, color: isSelected ? '#1a56db' : '#1f2937' }}>
                              {d.name || d.serial_number}
                            </span>
                          </div>
                          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:5, marginLeft:19 }}>
                            <span style={{ fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:10,
                              background: online ? '#d1fae5' : '#f3f4f6',
                              color:      online ? '#065f46' : '#6b7280',
                              border:     `1px solid ${online ? '#6ee7b7' : '#e5e7eb'}` }}>
                              {online ? `● ${t('Online')}` : `○ ${t('Offline')}`}
                            </span>
                            <span style={{ fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:10,
                              background: enr ? '#eff6ff' : '#fff7ed',
                              color:      enr ? '#1d4ed8' : '#9a3412',
                              border:     `1px solid ${enr ? '#bfdbfe' : '#fed7aa'}` }}>
                              {enr ? t('Enrolled') : t('Not Enrolled')}
                            </span>
                            {enr && enr.fp_slots_count > 0 && (
                              <span style={{ fontSize:11, padding:'2px 7px', borderRadius:10,
                                background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb' }}>
                                {enr.fp_slots_count} {t('FP')}
                              </span>
                            )}
                            {enr?.card_no && (
                              <span style={{ fontSize:11, padding:'2px 7px', borderRadius:10,
                                background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb' }}>
                                {t('Card')}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action sections grid */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12 }}>

        {/* ENROLL section */}
        <Panel title={t('Enroll')}>
          <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
              <div style={{ flex:1 }}>
                <span style={s.label}>{t('Fingerprint Slot')}</span>
                <select value={fpSlot} onChange={e => setFpSlot(+e.target.value)} style={selectStyle}>
                  {FINGER_LABELS.map((l,i) => {
                    const has = enrollment?.fp_slots?.some(f => f.fid === i);
                    return <option key={i} value={i}>{i}: {t(l)}{has ? ' ✓' : ''}</option>;
                  })}
                </select>
              </div>
              <button style={btn()} disabled={loading}
                onClick={() => runEnroll('Enroll FP', (devId) => post(`/devices/${devId}/enroll-fp`, { pin:devicePin, name:staffName, fingerId:fpSlot }))}>
                {t('Enroll FP')}
              </button>
            </div>
            <button style={{ ...btn('#7c3aed'), width:'100%' }} disabled={loading}
              onClick={() => runEnroll('Enroll Face', (devId) => post(`/devices/${devId}/enroll-face`, { pin:devicePin, name:staffName }))}>
              {t('Enroll Face')}
            </button>

            {/* Live status of the most recent enroll command on the first
                selected device — the device only picks up commands on its own
                poll cycle (seconds to a few minutes), so this tells the admin
                exactly when to have the staff member present at the terminal,
                instead of a fire-and-forget "queued" toast. */}
            {cmdWatch[selDevIds[0]] && (() => {
              const w = cmdWatch[selDevIds[0]];
              const style = {
                queued:  { bg:'#f3f4f6', fg:'#6b7280', text:`⏳ ${w.label}: waiting for device to check in…` },
                sent:    { bg:'#fef3c7', fg:'#92400e', text:`📡 ${w.label}: device is attempting it now — ask the staff member to present their finger/face!` },
                done:    { bg:'#d1fae5', fg:'#065f46', text:`✅ ${w.label}: completed` },
                error:   { bg:'#fee2e2', fg:'#991b1b', text:`❌ ${w.label}: device rejected the command` },
                timeout: { bg:'#fee2e2', fg:'#991b1b', text:`⚠️ ${w.label}: no response from device after 2 minutes — it may be offline` },
              }[w.status];
              return (
                <div style={{ fontSize:12, fontWeight:600, padding:'6px 10px', borderRadius:6, background:style.bg, color:style.fg }}>
                  {style.text}
                </div>
              );
            })()}

            {/* Face sample status + delete/upload */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 10px' }}>
              <span style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, fontWeight:600,
                color: enrollment?.face_photo ? '#059669' : '#9ca3af' }}>
                <span style={{ fontSize:15 }}>{enrollment?.face_photo ? '🟢😀' : '⚪😐'}</span>
                {t('Face Sample')}{enrollment?.face_photo ? ' ✓' : ''}
              </span>
              <div style={{ display:'flex', gap:6 }}>
                <input ref={faceFileInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleFacePhotoFile} />
                <button style={{ ...outlineBtn, height:26, fontSize:11.5, padding:'0 8px' }} disabled={loading}
                  onClick={() => faceFileInputRef.current?.click()}>
                  📤 {t('Upload Photo')}
                </button>
                <button style={{ ...dangerBtn, height:26, fontSize:11.5, padding:'0 8px' }}
                  disabled={loading || !enrollment?.face_photo}
                  onClick={() => run('Delete Face Sample', (devId) => post(`/devices/${devId}/delete-face`, { pin:devicePin }))}>
                  🗑️ {t('Delete')}
                </button>
              </div>
            </div>

            <button style={{ ...btn('#0891b2'), width:'100%' }} disabled={loading}
              onClick={() => runEnroll('Enroll Card', (devId) => post(`/devices/${devId}/enroll-card`, { pin:devicePin }))}>
              {t('Enroll Card')}
            </button>
          </div>
        </Panel>

        {/* MANAGE section */}
        <Panel title={t('Manage Access')}>
          <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
              <div style={{ flex:1 }}>
                <span style={s.label}>{t('Privilege')}</span>
                <select value={privilege} onChange={e => setPrivilege(+e.target.value)} style={selectStyle}>
                  {PRIV_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
                </select>
              </div>
              <button style={btn()} disabled={loading}
                onClick={() => run('Set Privilege', (devId) => post(`/devices/${devId}/upload-user`, {
                  pin:devicePin, name:staffName, privilege,
                  expires, startDatetime: startDate+' 00:00:00', endDatetime: endDate+' 23:59:00',
                  validCount: (expires === 2 || expires === 3) ? (Number(validCount) || 0) : null,
                }))}>
                {t('Set')}
              </button>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
              <div style={{ flex:1 }}>
                <span style={s.label}>{t('Device Password')}</span>
                <input type="text" value={passwd} onChange={e => setPasswd(e.target.value)}
                  placeholder={t('Leave blank to keep current')} style={inputStyle} />
              </div>
              <button style={btn()} disabled={loading}
                onClick={() => run('Set Password', (devId) => post(`/devices/${devId}/upload-user`, {
                  pin:devicePin, name:staffName, privilege,
                  card: enrollment?.card_no || '', passwd,
                  expires, startDatetime: startDate+' 00:00:00', endDatetime: endDate+' 23:59:00',
                  validCount: (expires === 2 || expires === 3) ? (Number(validCount) || 0) : null,
                }))}>
                {t('Set')}
              </button>
            </div>
          </div>
        </Panel>
      </div>

      {/* VALIDITY section */}
      <Panel title={t('Validity / Expiry')}>
        <div style={{ padding:'14px' }}>
          {/* Mode selector — mirrors the device's own Expires value:
              0 none | 1 date range | 2 use-count | 3 date range AND use-count */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))', gap:8, marginBottom:14 }}>
            {[
              [0, t('No Expiry')],
              [1, t('Date Range')],
              [2, t('Use Count')],
              [3, t('Date + Count')],
            ].map(([m, label]) => (
              <button key={m} onClick={() => setExpires(m)}
                style={{ height:36, borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer',
                  border: expires === m ? '2px solid #059669' : '1px solid #d1d5db',
                  background: expires === m ? '#d1fae5' : 'white',
                  color: expires === m ? '#065f46' : '#374151' }}>
                {label}
              </button>
            ))}
          </div>

          {(expires === 1 || expires === 3) && (
            <div style={{ marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:5, marginBottom:8 }}>
                {[['1M',1],['3M',3],['6M',6],['1Y',12]].map(([lbl,mo]) => (
                  <button key={lbl} onClick={() => {
                    const s = getNepalNow(); const e = getNepalNow();
                    e.setMonth(e.getMonth() + mo);
                    const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    setStartDate(toISO(s));
                    setEndDate(toISO(e));
                  }} style={{ padding:'3px 9px', fontSize:11, fontWeight:700,
                    background:'#eff6ff', color:'#1d4ed8', border:'1px solid #bfdbfe',
                    borderRadius:5, cursor:'pointer' }}>{lbl}</button>
                ))}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:12 }}>
                <div>
                  <span style={{ fontSize:11, fontWeight:700, color:'#6b7280', letterSpacing:'.4px',
                    textTransform:'uppercase', display:'block', marginBottom:5 }}>{t('From Date')}</span>
                  <div style={{ position:'relative' }}>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                      style={{ width:'100%', height:38, border:'2px solid #e5e7eb', borderRadius:8,
                        padding:'0 38px 0 12px', fontSize:13, boxSizing:'border-box',
                        outline:'none', fontWeight:500, background:'#f9fafb',
                        cursor:'pointer' }}
                      onFocus={e => { e.target.style.borderColor='#3b82f6'; e.target.style.background='white'; }}
                      onBlur={e  => { e.target.style.borderColor='#e5e7eb'; e.target.style.background='#f9fafb'; }} />
                    <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                      fontSize:15, pointerEvents:'none', userSelect:'none' }}>📅</span>
                  </div>
                </div>
                <div>
                  <span style={{ fontSize:11, fontWeight:700, color:'#6b7280', letterSpacing:'.4px',
                    textTransform:'uppercase', display:'block', marginBottom:5 }}>{t('To Date')}</span>
                  <div style={{ position:'relative' }}>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                      style={{ width:'100%', height:38, border:'2px solid #e5e7eb', borderRadius:8,
                        padding:'0 38px 0 12px', fontSize:13, boxSizing:'border-box',
                        outline:'none', fontWeight:500, background:'#f9fafb',
                        cursor:'pointer' }}
                      onFocus={e => { e.target.style.borderColor='#3b82f6'; e.target.style.background='white'; }}
                      onBlur={e  => { e.target.style.borderColor='#e5e7eb'; e.target.style.background='#f9fafb'; }} />
                    <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                      fontSize:15, pointerEvents:'none', userSelect:'none' }}>📅</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(expires === 2 || expires === 3) && (
            <div style={{ marginBottom:12 }}>
              <span style={{ fontSize:11, fontWeight:700, color:'#6b7280', letterSpacing:'.4px',
                textTransform:'uppercase', display:'block', marginBottom:5 }}>{t('Allowed Uses')}</span>
              <input type="number" min="1" value={validCount}
                onChange={e => setValidCount(e.target.value)}
                style={{ width:'100%', maxWidth:160, height:38, border:'2px solid #e5e7eb', borderRadius:8,
                  padding:'0 12px', fontSize:13, boxSizing:'border-box', outline:'none', fontWeight:500,
                  background:'#f9fafb' }}
                onFocus={e => { e.target.style.borderColor='#3b82f6'; e.target.style.background='white'; }}
                onBlur={e  => { e.target.style.borderColor='#e5e7eb'; e.target.style.background='#f9fafb'; }} />
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>
                {t('Access is denied once this many successful verifications have been used.')}
              </div>
            </div>
          )}

          <button style={{ width:'100%', height:38, borderRadius:8, border:'none', fontSize:13,
            fontWeight:700, cursor: loading ? 'not-allowed' : 'pointer', transition:'opacity .15s',
            background: expires > 0 ? '#059669' : '#6b7280', color:'white', opacity: loading ? 0.7 : 1 }}
            disabled={loading}
            onClick={() => run(expires > 0 ? 'Apply Validity' : 'Remove Expiry', (devId) => post(`/devices/${devId}/upload-user`, {
              pin:devicePin, name:staffName, privilege,
              card: enrollment?.card_no || '',
              expires,
              startDatetime: startDate + ' 00:00:00',
              endDatetime:   endDate   + ' 23:59:00',
              validCount: (expires === 2 || expires === 3) ? (Number(validCount) || 0) : null,
            }))}>
            {expires > 0 ? `✅ ${t('Apply Validity')}` : `🚫 ${t('Remove Expiry')}`}
          </button>

          {expires === 0 && (
            <div style={{ fontSize:11, color:'#9ca3af', marginTop:8, textAlign:'center' }}>
              {t('Select a mode above to restrict device access')}
            </div>
          )}
        </div>
      </Panel>

      {/* DELETE section */}
      <Panel title={t('Delete Operations')}>
        <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
            <div style={{ flex:1 }}>
              <span style={s.label}>{t('Delete Fingerprint Slot')}</span>
              <select value={delFpSlot} onChange={e => setDelFpSlot(+e.target.value)} style={selectStyle}>
                {FINGER_LABELS.map((l,i) => {
                  const hasFp = enrollment?.fp_slots?.some(f => f.fid === i);
                  return <option key={i} value={i}>{i}: {t(l)}{hasFp ? ' ✅' : ''}</option>;
                })}
              </select>
            </div>
            <button style={dangerBtn} disabled={loading}
              onClick={() => {
                if (!window.confirm(`${t('Delete FP slot')} ${delFpSlot} (${t(FINGER_LABELS[delFpSlot])}) ${t('for PIN')} ${devicePin} ${t('on')} ${selDevIds.length} ${t('device(s)?')}`)) return;
                run('Delete FP Slot', (devId) => post(`/devices/${devId}/delete-fp-slot`, { pin:devicePin, fid:delFpSlot }));
              }}>
              {t('Delete FP')}
            </button>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={{ ...dangerBtn, flex:1 }} disabled={loading}
              onClick={() => {
                if (!window.confirm(`${t('Remove card for PIN')} ${devicePin} ${t('on')} ${selDevIds.length} ${t('device(s)? This clears the card number.')}`)) return;
                run('Remove Card', (devId) => post(`/devices/${devId}/upload-user`, {
                  pin:devicePin, name:staffName, privilege, card:'',
                  expires, startDatetime: startDate+' 00:00:00', endDatetime: endDate+' 23:59:00',
                  validCount: (expires === 2 || expires === 3) ? (Number(validCount) || 0) : null,
                }));
              }}>
              {t('Remove Card')}
            </button>
            <button style={{ ...dangerBtn, flex:1 }} disabled={loading}
              onClick={() => {
                if (!window.confirm(`${t('DELETE user PIN')} ${devicePin} ${t('from')} ${selDevIds.length} ${t('selected device(s)?')}\n${t('This removes them from the device(s) — eHajiri data is unaffected.')}`)) return;
                run('Delete from Device', (devId) => post(`/devices/${devId}/delete-user`, { pin:devicePin }));
              }}>
              {t('Delete from Device')}
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
};

/* ══════════ Officially Changes tab — status/branch/post/department/mode/grade history ══════════ */
const OFFICIAL_CHANGE_FIELDS = [
  { key:'status',     label:'Status',     icon:'🔄' },
  { key:'branch',     label:'Branch',     icon:'🏢' },
  { key:'position',   label:'Post',       icon:'💼' },
  { key:'department', label:'Department', icon:'🏗️' },
  { key:'mode',       label:'Mode',       icon:'📋' },
  { key:'grade',      label:'Grade',      icon:'🎖️' },
];

const OfficialChangesTab = ({ employeeId, current, onApplied }) => {
  const { t }        = useLanguage();
  const { settings } = useSettings();
  const fd = useDateFormat();
  const [fieldTab, setFieldTab] = useState('status');
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [editor,   setEditor]   = useState(null);  // { row? } — popup open; row set = edit mode
  const [saving,   setSaving]   = useState(false);
  const [scForm,   setScForm]   = useState({ toValue:'', effectiveDate:'', remarks:'' });
  const [scErrors, setScErrors] = useState({});

  const fieldDef     = OFFICIAL_CHANGE_FIELDS.find(f => f.key === fieldTab);
  const fieldLabel   = t(fieldDef.label);
  const currentValue = current[fieldTab] || '';
  const fieldRows    = rows.filter(r => r.field === fieldTab);

  const load = async () => {
    try { setRows(await api.get(`/employees/${employeeId}/official-changes`)); }
    catch { /* table shows empty state */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [employeeId]);

  const statusType = (name) =>
    (settings.statuses || []).find(s => s.name === name)?.statusType;

  /* Dropdown options per field — same sources as the Staff Detail selects */
  const fieldOptions = () => {
    switch (fieldTab) {
      case 'status':
        return (settings.statuses || []).map(s => ({ value:s.name, label:`${s.name}${s.statusType ? ` (${s.statusType})` : ''}` }));
      case 'branch':
        return [
          ...(settings.companyNameEn ? [{ value: settings.companyNameEn, label: `${settings.companyNameEn} (HQ)` }] : []),
          ...(settings.branches || []).map(b => ({ value:b.name, label:`${b.name} Branch` })),
        ];
      case 'position':   return (settings.posts       || []).map(p => ({ value:p.name, label:p.name }));
      case 'department': return (settings.departments || []).map(d => ({ value:d.name, label:d.name }));
      case 'mode':       return (settings.modes       || []).map(m => ({ value:m.name, label:m.name }));
      case 'grade':      return (settings.grades      || []).map(g => ({ value:g.name, label:g.name }));
      default:           return [];
    }
  };

  const openAddNew = () => {
    setScForm({ toValue:'', effectiveDate: getNepalTodayISO(), remarks:'' });
    setScErrors({});
    setEditor({});
  };

  const openEditRow = (row) => {
    setScForm({ toValue: row.toValue, effectiveDate: row.effectiveDate, remarks: row.remarks || '' });
    setScErrors({});
    setEditor({ row });
  };

  const save = async () => {
    const e = {};
    if (!scForm.toValue) e.toValue = t('Required field');
    else if (!editor?.row && scForm.toValue === currentValue)
      e.toValue = t('Select a value different from the current one');
    if (!scForm.effectiveDate) e.effectiveDate = t('Required field');
    if (Object.keys(e).length) { setScErrors(e); return; }
    setSaving(true);
    try {
      const resp = editor?.row
        ? await api.put(`/employees/${employeeId}/official-changes/${editor.row.id}`, scForm)
        : await api.post(`/employees/${employeeId}/official-changes`, { field: fieldTab, ...scForm });
      setEditor(null);
      await load();
      onApplied?.(resp.user, resp.change);
    } catch (err) {
      setScErrors({ _global: err.message });
    } finally { setSaving(false); }
  };

  const remove = async (row) => {
    if (!window.confirm(`${t('Delete pending change to')} "${row.toValue}" (${fd(row.effectiveDate)})?`)) return;
    try {
      await api.delete(`/employees/${employeeId}/official-changes/${row.id}`);
      await load();
    } catch (err) { window.alert(err.message); }
  };

  /* Grid cells reuse the global DataGrid classes (dg-th / dg-td / dg-sn-col)
     so this table matches the Staff Detail grid exactly. */

  /* Status values get a green/red Working tint; other fields a neutral chip */
  const ValueChip = ({ name }) => {
    if (!name) return <span style={{ color:'#d1d5db' }}>—</span>;
    let bg = '#eff6ff', color = '#1e40af', border = '#1e40af33';
    if (fieldTab === 'status') {
      const working = statusType(name) ? statusType(name) === 'Working' : name === 'Active';
      bg = working ? '#f0fdf4' : '#fff5f5';
      color = working ? '#065f46' : '#991b1b';
      border = working ? '#065f4633' : '#991b1b33';
    }
    return (
      <span style={{ fontSize:12, fontWeight:600, padding:'2px 10px', borderRadius:10, whiteSpace:'nowrap',
        background:bg, color, border:`1px solid ${border}` }}>
        {name}
      </span>
    );
  };

  /* Most recent applied change for this field — its date is when the
     current value took effect (blank if the value was never changed here) */
  const latestApplied = fieldRows.find(r => r.applied);

  return (
    <div>
      {/* Field tab strip — underline tabs with count badges, same style as the
          Attendance Device sub-tabs (Devices / Att. Logs / Device Users / …) */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e5e7eb', marginBottom:14, flexWrap:'wrap' }}>
        {OFFICIAL_CHANGE_FIELDS.map(f => {
          const active = fieldTab === f.key;
          const count  = rows.filter(r => r.field === f.key).length;
          return (
            <button key={f.key} onClick={() => setFieldTab(f.key)} style={{
              padding:'8px 14px', background:'none', border:'none',
              borderBottom: active ? '2px solid #1a56db' : '2px solid transparent',
              color: active ? '#1a56db' : '#6b7280',
              fontWeight: active ? 700 : 400,
              cursor:'pointer', fontSize:12.5, display:'flex', alignItems:'center', gap:5, marginBottom:-2,
            }}>
              {f.icon} {t(f.label)}
              {count > 0 && <span style={{ background:'#1a56db', color:'white', borderRadius:9, padding:'0px 5px', fontSize:10, fontWeight:700 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Tab content card */}
      <div style={{ border:'1px solid #dedede', borderRadius:8, background:'white',
        boxShadow:'0 1px 3px rgba(0,0,0,.07)', overflow:'hidden' }}>

      {/* Toolbar — title + Add New, mirrors the DataGrid toolbar */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
        padding:'9px 14px', background:'#f9fafb', borderBottom:'1px solid #dedede' }}>
        <span style={{ fontSize:14, fontWeight:600, color:'#111827' }}>
          {fieldDef.icon} {fieldLabel} {t('Change History')}
        </span>
        <button className="btn btn-primary" style={{ height:32, fontSize:13 }} onClick={openAddNew}>
          + {t('Add New')}
        </button>
      </div>

      {/* History grid — same dg-* classes as the Staff Detail grid */}
      <table className="dg-table compact" style={{ minWidth:'unset' }}>
        <thead>
          <tr className="dg-header-row">
            <th className="dg-th dg-sn-col">SN</th>
            <th className="dg-th" style={{ textAlign:'left' }}>{fieldLabel}</th>
            <th className="dg-th" style={{ textAlign:'left', width:150 }}>{t('Effective Date')}</th>
            <th className="dg-th" style={{ textAlign:'left' }}>{t('Remarks')}</th>
            <th className="dg-th" style={{ width:110 }}></th>
          </tr>
        </thead>
        <tbody>
          {/* Pinned first row — the staff's current value */}
          {!loading && (
            <tr className="dg-row">
              <td className="dg-td dg-sn-col">★</td>
              <td className="dg-td"><ValueChip name={currentValue} /></td>
              <td className="dg-td">{latestApplied ? fd(latestApplied.effectiveDate) : <span className="dg-null">—</span>}</td>
              <td className="dg-td" style={{ color:'#9ca3af', fontStyle:'italic' }}>{t('Current')} {fieldLabel}</td>
              <td className="dg-td" style={{ textAlign:'right' }}>
                <span style={{ fontSize:11, fontWeight:700, color:'#1e40af', background:'#dbeafe', padding:'2px 8px', borderRadius:10 }}>
                  {t('Current')}
                </span>
              </td>
            </tr>
          )}
          {loading ? (
            <tr><td colSpan={5} className="dg-td" style={{ textAlign:'center', color:'#9ca3af', padding:'24px 0' }}>Loading…</td></tr>
          ) : fieldRows.length === 0 ? (
            <tr><td colSpan={5} className="dg-td" style={{ textAlign:'center', color:'#9ca3af', padding:'24px 0' }}>
              {t('No changes yet')} — {t('use + Add New to record one')}
            </td></tr>
          ) : fieldRows.map((r, i) => (
            <tr key={r.id} className="dg-row clickable" title={t('Double-click to edit')}
              onDoubleClick={() => openEditRow(r)}>
              <td className="dg-td dg-sn-col">{i + 1}</td>
              <td className="dg-td">
                <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  {r.fromValue && <>
                    <span style={{ fontSize:12, color:'#6b7280' }}>{r.fromValue}</span>
                    <span style={{ color:'#9ca3af' }}>→</span>
                  </>}
                  <ValueChip name={r.toValue} />
                </div>
              </td>
              <td className="dg-td">{fd(r.effectiveDate)}</td>
              <td className="dg-td" style={{ whiteSpace:'normal' }}>{r.remarks || <span className="dg-null">—</span>}</td>
              <td className="dg-td" style={{ textAlign:'right' }}>
                {r.applied ? (
                  <span style={{ fontSize:11, fontWeight:700, color:'#065f46', background:'#d1fae5', padding:'2px 8px', borderRadius:10 }}>
                    ✓ {t('Applied')}
                  </span>
                ) : (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:'#92400e', background:'#fef3c7', padding:'2px 8px', borderRadius:10 }}>
                      ⏳ {t('Pending')}
                    </span>
                    <button title={t('Delete')} onClick={e => { e.stopPropagation(); remove(r); }}
                      style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', fontSize:14, padding:2 }}>
                      🗑
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Footer hint — mirrors the DataGrid footer */}
      <div style={{ padding:'7px 14px', background:'#f9fafb', borderTop:'1px solid #dedede',
        fontSize:12, color:'#6b7280' }}>
        {t('Future-dated changes stay pending and apply automatically on the effective date. Double-click a row to edit it.')}
      </div>

      </div>{/* /tab content card */}

      {/* ── Add New / Edit popup ── */}
      {editor && (
        <div className="modal-overlay" style={{ zIndex:1100 }} onClick={() => setEditor(null)}>
          <div className="modal modal-sm" style={{ zIndex:1200, maxWidth:440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editor.row ? `✏️ ${t('Edit')}` : `+ ${t('Add New')}`} — {fieldLabel} {t('Change')}</h2>
              <button className="modal-close" onClick={() => setEditor(null)}>✕</button>
            </div>
            <div className="modal-body">
              {scErrors._global && (
                <div style={{ background:'#fff5f5', color:'#991b1b', border:'1px solid #fecaca',
                  borderRadius:6, padding:'8px 12px', fontSize:13, marginBottom:12 }}>
                  {scErrors._global}
                </div>
              )}
              <div className="form-group">
                <label className="form-label">{t('Current')} {fieldLabel}</label>
                <input type="text" className="form-control" readOnly
                  value={(editor.row ? editor.row.fromValue : currentValue) || '—'}
                  style={{ fontSize:13, background:'#f3f4f6', color:'#6b7280' }} />
              </div>
              <div className="form-group">
                <label className="form-label required">{t('Changing')} {fieldLabel}</label>
                <SearchableSelect
                  value={scForm.toValue}
                  onChange={v => { setScForm(p => ({ ...p, toValue:v })); setScErrors(p => ({ ...p, toValue:'' })); }}
                  placeholder="— Select —"
                  options={fieldOptions().filter(o => editor.row || o.value !== currentValue)}
                />
                {scErrors.toValue && <div className="form-error">{scErrors.toValue}</div>}
              </div>
              <div className="form-group">
                <label className="form-label required">{t('Effective Date')}</label>
                <DateInput value={scForm.effectiveDate}
                  onChange={v => { setScForm(p => ({ ...p, effectiveDate:v })); setScErrors(p => ({ ...p, effectiveDate:'' })); }}
                  error={!!scErrors.effectiveDate} />
                {scErrors.effectiveDate && <div className="form-error">{scErrors.effectiveDate}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">{t('Remarks')}</label>
                <textarea className="form-control" rows={3} style={{ fontSize:13, resize:'vertical' }}
                  placeholder={t('Reason for the change...')}
                  value={scForm.remarks}
                  onChange={e => setScForm(p => ({ ...p, remarks:e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setEditor(null)}>{t('Cancel')}</button>
              <SaveButton onClick={save} label={saving ? t('Saving...') : t('Save')} disabled={saving} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ══════════ Staff Identity tab — addresses / ID cards / emergency contacts ══════════ */
const IDENTITY_SECTIONS = [
  { key:'addresses',          label:'Address',           icon:'🏠' },
  { key:'id-cards',           label:'Personal ID Card',  icon:'🪪' },
  { key:'emergency-contacts', label:'Emergency Contact', icon:'🚨' },
];

const NEPAL_PROVINCES = ['Koshi','Madhesh','Bagmati','Gandaki','Lumbini','Karnali','Sudurpashchim'];
const RELATIONS = ['Father','Mother','Husband','Wife','Brother','Sister','Son','Daughter','Uncle','Aunt','Mama','Maiju','Grandfather','Grandmother','Boyfriend','Girlfriend','Friend','Driver','Other'];

const IDENTITY_EMPTY_FORMS = {
  'addresses':          { country:'Nepal', province:'', district:'', ward:'', addressType:'Permanent' },
  'id-cards':           { idName:'', idNumber:'', expiryDate:'', docImage:'' },
  'emergency-contacts': { name:'', contact1:'', contact2:'', relation:'', address:'' },
};

/** Downscale a picked document image to a JPEG data URL. Wider cap than the
    256px avatar downscale in ProfileTab — the document must stay readable. */
const readDocImage = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const max = 1400;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    resolve(canvas.toDataURL('image/jpeg', 0.85));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image file')); };
  img.src = url;
});

const StaffIdentityTab = ({ employeeId }) => {
  const { t } = useLanguage();
  const fd = useDateFormat();
  const [section, setSection] = useState('addresses');
  const [data,    setData]    = useState({ 'addresses':[], 'id-cards':[], 'emergency-contacts':[] });
  const [loading, setLoading] = useState(true);
  const [editor,  setEditor]  = useState(null);   // { row? } — popup open; row set = edit mode
  const [siForm,  setSiForm]  = useState(IDENTITY_EMPTY_FORMS.addresses);
  const [siErrors,setSiErrors]= useState({});
  const [saving,  setSaving]  = useState(false);
  const [docView, setDocView] = useState(null);   // data URL — full-size document viewer

  const sectionDef = IDENTITY_SECTIONS.find(s => s.key === section);
  const rows = data[section];

  const load = async () => {
    try {
      const [addresses, idCards, contacts] = await Promise.all(
        IDENTITY_SECTIONS.map(s => api.get(`/employees/${employeeId}/identity/${s.key}`))
      );
      setData({ 'addresses':addresses, 'id-cards':idCards, 'emergency-contacts':contacts });
    } catch { /* grids show empty state */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [employeeId]);

  const setField = (key, value) => {
    setSiForm(p => ({ ...p, [key]: value }));
    setSiErrors(p => ({ ...p, [key]: '' }));
  };

  const openAddNew = () => {
    setSiForm(IDENTITY_EMPTY_FORMS[section]);
    setSiErrors({});
    setEditor({});
  };

  const openEditRow = (row) => {
    const form = {};
    for (const key of Object.keys(IDENTITY_EMPTY_FORMS[section])) form[key] = row[key] || '';
    setSiForm(form);
    setSiErrors({});
    setEditor({ row });
  };

  /* Frontend mirror of the API's required fields per section */
  const REQUIRED = {
    'addresses':          ['addressType'],
    'id-cards':           ['idName', 'idNumber'],
    'emergency-contacts': ['name', 'contact1'],
  };

  const save = async () => {
    const e = {};
    for (const key of REQUIRED[section]) {
      if (!String(siForm[key] || '').trim()) e[key] = t('Required field');
    }
    if (Object.keys(e).length) { setSiErrors(e); return; }
    setSaving(true);
    try {
      if (editor?.row) await api.put(`/employees/${employeeId}/identity/${section}/${editor.row.id}`, siForm);
      else             await api.post(`/employees/${employeeId}/identity/${section}`, siForm);
      setEditor(null);
      await load();
    } catch (err) {
      setSiErrors({ _global: err.message });
    } finally { setSaving(false); }
  };

  const remove = async (row) => {
    if (!window.confirm(`${t('Delete this')} ${t(sectionDef.label)} ${t('record?')}`)) return;
    try {
      await api.delete(`/employees/${employeeId}/identity/${section}/${row.id}`);
      await load();
    } catch (err) { window.alert(err.message); }
  };

  const TypeChip = ({ type }) => {
    const permanent = type === 'Permanent';
    return (
      <span style={{ fontSize:12, fontWeight:600, padding:'2px 10px', borderRadius:10, whiteSpace:'nowrap',
        background: permanent ? '#eff6ff' : '#fef3c7',
        color:      permanent ? '#1e40af' : '#92400e',
        border:     `1px solid ${permanent ? '#1e40af33' : '#92400e33'}` }}>
        {t(type)}
      </span>
    );
  };

  const cell = (v) => v || <span className="dg-null">—</span>;

  /* Column heads + row cells per section — rendered into the shared dg-table */
  const GRID = {
    'addresses': {
      heads: ['Address Type', 'Country', 'Province', 'District', 'Ward'],
      cells: r => [<TypeChip type={r.addressType} />, cell(r.country), cell(r.province), cell(r.district), cell(r.ward)],
    },
    'id-cards': {
      heads: ['ID Name', 'ID Number', 'Expiry Date', 'Document'],
      cells: r => [
        <span style={{ fontWeight:600 }}>{r.idName}</span>,
        cell(r.idNumber),
        r.expiryDate ? fd(r.expiryDate) : <span className="dg-null">—</span>,
        r.docImage
          ? <img src={r.docImage} alt={r.idName} title={t('Click to view')}
              onClick={e => { e.stopPropagation(); setDocView(r.docImage); }}
              style={{ height:34, borderRadius:4, border:'1px solid #dedede', cursor:'zoom-in', verticalAlign:'middle' }} />
          : <span className="dg-null">—</span>,
      ],
    },
    'emergency-contacts': {
      heads: ['Name', 'Contact No. 1', 'Contact No. 2', 'Relation', 'Address'],
      cells: r => [<span style={{ fontWeight:600 }}>{r.name}</span>, cell(r.contact1), cell(r.contact2), cell(r.relation), cell(r.address)],
    },
  }[section];

  return (
    <div>
      {/* Section tab strip — same underline style as the Officially Changes field tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e5e7eb', marginBottom:14, flexWrap:'wrap' }}>
        {IDENTITY_SECTIONS.map(s => {
          const active = section === s.key;
          const count  = data[s.key].length;
          return (
            <button key={s.key} onClick={() => setSection(s.key)} style={{
              padding:'8px 14px', background:'none', border:'none',
              borderBottom: active ? '2px solid #1a56db' : '2px solid transparent',
              color: active ? '#1a56db' : '#6b7280',
              fontWeight: active ? 700 : 400,
              cursor:'pointer', fontSize:12.5, display:'flex', alignItems:'center', gap:5, marginBottom:-2,
            }}>
              {s.icon} {t(s.label)}
              {count > 0 && <span style={{ background:'#1a56db', color:'white', borderRadius:9, padding:'0px 5px', fontSize:10, fontWeight:700 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Section content card */}
      <div style={{ border:'1px solid #dedede', borderRadius:8, background:'white',
        boxShadow:'0 1px 3px rgba(0,0,0,.07)', overflow:'hidden' }}>

        {/* Toolbar — title + Add New */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'9px 14px', background:'#f9fafb', borderBottom:'1px solid #dedede' }}>
          <span style={{ fontSize:14, fontWeight:600, color:'#111827' }}>
            {sectionDef.icon} {t(sectionDef.label)}
          </span>
          <button className="btn btn-primary" style={{ height:32, fontSize:13 }} onClick={openAddNew}>
            + {t('Add New')}
          </button>
        </div>

        <table className="dg-table compact" style={{ minWidth:'unset' }}>
          <thead>
            <tr className="dg-header-row">
              <th className="dg-th dg-sn-col">SN</th>
              {GRID.heads.map(h => <th key={h} className="dg-th" style={{ textAlign:'left' }}>{t(h)}</th>)}
              <th className="dg-th" style={{ width:60 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={GRID.heads.length + 2} className="dg-td" style={{ textAlign:'center', color:'#9ca3af', padding:'24px 0' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={GRID.heads.length + 2} className="dg-td" style={{ textAlign:'center', color:'#9ca3af', padding:'24px 0' }}>
                {t('No records yet')} — {t('use + Add New to record one')}
              </td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.id} className="dg-row clickable" title={t('Double-click to edit')}
                onDoubleClick={() => openEditRow(r)}>
                <td className="dg-td dg-sn-col">{i + 1}</td>
                {GRID.cells(r).map((c, ci) => <td key={ci} className="dg-td" style={{ whiteSpace:'normal' }}>{c}</td>)}
                <td className="dg-td" style={{ textAlign:'right' }}>
                  <button title={t('Delete')} onClick={e => { e.stopPropagation(); remove(r); }}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', fontSize:14, padding:2 }}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ padding:'7px 14px', background:'#f9fafb', borderTop:'1px solid #dedede',
          fontSize:12, color:'#6b7280' }}>
          {t('Double-click a row to edit it.')}
        </div>
      </div>{/* /section content card */}

      {/* ── Add New / Edit popup ── */}
      {editor && (
        <div className="modal-overlay" style={{ zIndex:1100 }} onClick={() => setEditor(null)}>
          <div className="modal modal-sm" style={{ zIndex:1200, maxWidth:460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editor.row ? `✏️ ${t('Edit')}` : `+ ${t('Add New')}`} — {t(sectionDef.label)}</h2>
              <button className="modal-close" onClick={() => setEditor(null)}>✕</button>
            </div>
            <div className="modal-body">
              {siErrors._global && (
                <div style={{ background:'#fff5f5', color:'#991b1b', border:'1px solid #fecaca',
                  borderRadius:6, padding:'8px 12px', fontSize:13, marginBottom:12 }}>
                  {siErrors._global}
                </div>
              )}

              {section === 'addresses' && <>
                <div className="form-group">
                  <label className="form-label required">{t('Address Type')}</label>
                  <div style={{ display:'flex', gap:8 }}>
                    {['Permanent', 'Temporary'].map(type => (
                      <button key={type} type="button" onClick={() => setField('addressType', type)}
                        style={{
                          flex:1, padding:'8px 0', fontSize:13, borderRadius:6, cursor:'pointer',
                          fontWeight: siForm.addressType === type ? 700 : 400,
                          border: siForm.addressType === type ? '2px solid #1a56db' : '1px solid #d1d5db',
                          background: siForm.addressType === type ? '#eff6ff' : 'white',
                          color: siForm.addressType === type ? '#1a56db' : '#374151',
                        }}>
                        {type === 'Permanent' ? '🏛️' : '🏕️'} {t(type)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('Country')}</label>
                  <input type="text" className="form-control" style={{ fontSize:13 }}
                    value={siForm.country} onChange={e => setField('country', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('Province')}</label>
                  <SearchableSelect
                    value={siForm.province}
                    onChange={v => setField('province', v)}
                    placeholder="— Select —"
                    options={NEPAL_PROVINCES.map(p => ({ value:p, label:p }))}
                  />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 110px', gap:10 }}>
                  <div className="form-group">
                    <label className="form-label">{t('District')}</label>
                    <input type="text" className="form-control" style={{ fontSize:13 }}
                      value={siForm.district} onChange={e => setField('district', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('Ward')}</label>
                    <input type="text" className="form-control" style={{ fontSize:13 }}
                      placeholder="e.g. 5"
                      value={siForm.ward} onChange={e => setField('ward', e.target.value)} />
                  </div>
                </div>
              </>}

              {section === 'id-cards' && <>
                <div className="form-group">
                  <label className="form-label required">{t('ID Name')}</label>
                  <input type="text" className="form-control" style={{ fontSize:13 }}
                    placeholder={t('e.g. Citizenship, Passport, Driving License...')}
                    value={siForm.idName} onChange={e => setField('idName', e.target.value)} />
                  {siErrors.idName && <div className="form-error">{siErrors.idName}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label required">{t('ID Number')}</label>
                  <input type="text" className="form-control" style={{ fontSize:13 }}
                    value={siForm.idNumber} onChange={e => setField('idNumber', e.target.value)} />
                  {siErrors.idNumber && <div className="form-error">{siErrors.idNumber}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">{t('Expiry Date')}</label>
                  <DateInput value={siForm.expiryDate} onChange={v => setField('expiryDate', v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('Upload Doc')}</label>
                  {siForm.docImage ? (
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <img src={siForm.docImage} alt="document"
                        onClick={() => setDocView(siForm.docImage)}
                        style={{ height:64, borderRadius:6, border:'1px solid #dedede', cursor:'zoom-in' }} />
                      <button type="button" className="btn btn-outline" style={{ height:30, fontSize:12, color:'#ef4444' }}
                        onClick={() => setField('docImage', '')}>
                        ✕ {t('Remove')}
                      </button>
                    </div>
                  ) : (
                    <input type="file" accept="image/*" className="form-control" style={{ fontSize:13, padding:6 }}
                      onChange={async e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try { setField('docImage', await readDocImage(file)); }
                        catch (err) { setSiErrors(p => ({ ...p, _global: err.message })); }
                      }} />
                  )}
                </div>
              </>}

              {section === 'emergency-contacts' && <>
                <div className="form-group">
                  <label className="form-label required">{t('Name')}</label>
                  <input type="text" className="form-control" style={{ fontSize:13 }}
                    value={siForm.name} onChange={e => setField('name', e.target.value)} />
                  {siErrors.name && <div className="form-error">{siErrors.name}</div>}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div className="form-group">
                    <label className="form-label required">{t('Contact No. 1')}</label>
                    <input type="text" className="form-control" style={{ fontSize:13 }}
                      value={siForm.contact1} onChange={e => setField('contact1', e.target.value)} />
                    {siErrors.contact1 && <div className="form-error">{siErrors.contact1}</div>}
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('Contact No. 2')}</label>
                    <input type="text" className="form-control" style={{ fontSize:13 }}
                      value={siForm.contact2} onChange={e => setField('contact2', e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('Relation')}</label>
                  <SearchableSelect
                    value={siForm.relation}
                    onChange={v => setField('relation', v)}
                    placeholder="— Select —"
                    options={RELATIONS.map(r => ({ value:r, label:t(r) }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('Address')}</label>
                  <textarea className="form-control" rows={2} style={{ fontSize:13, resize:'vertical' }}
                    value={siForm.address} onChange={e => setField('address', e.target.value)} />
                </div>
              </>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setEditor(null)}>{t('Cancel')}</button>
              <SaveButton onClick={save} label={saving ? t('Saving...') : t('Save')} disabled={saving} />
            </div>
          </div>
        </div>
      )}

      {/* ── Full-size document viewer ── */}
      {docView && (
        <div className="modal-overlay" style={{ zIndex:1300, cursor:'zoom-out' }} onClick={() => setDocView(null)}>
          <img src={docView} alt="document"
            style={{ maxWidth:'88vw', maxHeight:'88vh', borderRadius:8, boxShadow:'0 8px 40px rgba(0,0,0,.45)' }} />
        </div>
      )}
    </div>
  );
};

/* ────────────────────────────────── */

const defaultForm = {
  employeeId:'', deviceId:'', fullName:'', gender:'male', religion:'',
  handicapped:false, eligibleForOt:false, email:'', phone:'',
  branch:'', department:'', position:'', mode:'', grade:'', timingType:'',
  dob:'1983-02-25', joinDate:'', attendanceDate:'',
  status:'Active', rankingOrder:'', role:'employee', shift:'', avatar:'', active:true,
  remarks:'',
};

const UserManagement = () => {
  const { isAdmin, canManageStaff, isBranchManager, isDeptHead, currentUser, filterByRole } = useAuth();
  const { t }        = useLanguage();
  const { filteredEmployees: employees, addEmployee, updateEmployee, deleteEmployee, shifts, refreshEmployees } = useData();
  const [importModal,    setImportModal]    = useState(false);
  const [excelImport,    setExcelImport]    = useState(false);
  const [recoModal,      setRecoModal]      = useState(false);
  const { settings, updateSetupList } = useSettings();
  const fd = useDateFormat();

  const [modal,         setModal]         = useState(false);
  const [activeTab,     setActiveTab]     = useState('Staff Detail');
  const [quickDeviceView, setQuickDeviceView] = useState(false);
  const [editId,        setEditId]        = useState(null);
  const [form,          setForm]          = useState(defaultForm);
  const [errors,        setErrors]        = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [viewUser,      setViewUser]      = useState(null);
  const [toast,         setToast]         = useState(null);
  const [qaModal,       setQaModal]       = useState(null);
  const [dupAlert,      setDupAlert]      = useState(null);
  const [licLimitAlert, setLicLimitAlert] = useState(null);
  const [showAdvSearch, setShowAdvSearch] = useState(false);
  const [selectedUserIds,   setSelectedUserIds]   = useState([]);
  const [resetPwdModal,     setResetPwdModal]     = useState(false);
  const [resetPwdInput,     setResetPwdInput]     = useState('');
  const [resetPwdConfirm,   setResetPwdConfirm]   = useState('');
  const [resetPwdLoading,   setResetPwdLoading]   = useState(false);
  const [resetPwdShowPass,  setResetPwdShowPass]  = useState(false);
  const modalBodyRef = useRef(null);
  const [advFilters, setAdvFilters] = useState({
    q: '',
    branches: [], departments: [], positions: [], grades: [],
    modes: [], genders: [], timingTypes: [], religions: [],
    handicapped: '', eligibleForOt: '', statuses: [], roles: [],
  });
  /* Working / Not Working view — staff whose status is a "Not Working" type
     (active === false) are hidden from the default list; flip the toggle to see them */
  const [statusView, setStatusView] = useState('working');

  /* License Staff/Device limits — fetched once so "+ Add New Staff" can be
     disabled proactively instead of only reacting to the server's STAFF_LIMIT
     error after a failed save (see handleSave below). Both counts come from
     /employees/license-usage (canManageStaff: admin/branchManager/
     superAdmin) rather than being derived client-side:
       - staffCount mirrors exactly what the server's STAFF_LIMIT check
         counts (getActiveStaffCount in employees.js). The Staff grid's own
         list (GET /, sql.list) excludes superAdmin accounts from what's
         displayed, so counting off `employees` instead would silently
         undercount whenever an active superAdmin exists — the button would
         stay enabled right up until the real save got rejected.
       - deviceCount combines ZKTeco + StandAlone devices since the
         license's maxDevices covers both; /zkteco/devices and
         /standalone/devices are locked to admin/superAdmin only (they
         return device credentials/IPs), so a branchManager could add
         staff/devices but never actually see this block fire. */
  const [licStatus,   setLicStatus]   = useState(null);
  const [licUsage,     setLicUsage]   = useState(null); // { staffCount, deviceCount }
  useEffect(() => {
    api.get('/license/status').then(setLicStatus).catch(() => {});
    api.get('/employees/license-usage').then(setLicUsage).catch(() => {});
  }, []);
  const activeStaffCount = licUsage?.staffCount ?? employees.filter(e => e.active).length;
  const deviceCount      = licUsage?.deviceCount ?? null;
  const overStaffLimit  = licStatus?.maxStaff   != null && activeStaffCount >= licStatus.maxStaff;
  const overDeviceLimit = licStatus?.maxDevices != null && deviceCount     != null && deviceCount >= licStatus.maxDevices;
  // Device count caps how many ZKTeco/standalone devices the license allows —
  // it has no 1:1 relationship with staff records (many staff can share one
  // device), so reaching it must never block adding staff on its own. Only
  // the staff count gates "Add New Staff"; overDeviceLimit is kept around to
  // add context to the tooltip/alert when both happen to be maxed together.
  const staffLimitBlocked = overStaffLimit;
  const staffLimitTooltip = overStaffLimit
    ? (overDeviceLimit
        ? `Users limit max is only ${licStatus.maxStaff} (device limit ${licStatus.maxDevices} also reached)`
        : `Users limit max is only ${licStatus.maxStaff}`)
    : '';

  const showToast = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  /* Push staff full names to the ZKTeco devices of their assigned Area */
  const [syncingNames, setSyncingNames] = useState(false);
  const handleSyncNames = async () => {
    if (!window.confirm(t('Send each staff member\'s name to the attendance devices in their assigned Area?'))) return;
    setSyncingNames(true);
    try {
      const r = await api.post('/zkteco/sync-names-to-devices', {});
      showToast(
        `${r.staffSynced} staff name(s) queued to ${r.devices} device(s)` +
        (r.skippedNoDevice ? ` — ${r.skippedNoDevice} skipped (no device/area)` : '')
      );
    } catch (err) { showToast(err.message, 'error'); }
    setSyncingNames(false);
  };

  const handleChange = (field, val) => {
    setForm(p => {
      const u = { ...p, [field]: val };
      if (field === 'fullName') {
        // Auto-capitalize first letter of every word (Latin chars only)
        const tc = val.replace(/(^|\s)([a-zA-Z])/g, (_, sp, ch) => sp + ch.toUpperCase());
        u.fullName = tc;
        u.avatar   = tc[0]?.toUpperCase() || '';
      }
      if (field === 'status') {
        const s = (settings.statuses || []).find(s => s.name === val);
        u.active = s ? s.statusType === 'Working' : val === 'Active';
      }
      return u;
    });
    setErrors(p => ({ ...p, [field]:'' }));
  };

  const validate = () => {
    const e = {};
    if (!form.deviceId.trim()) e.deviceId = t('Required field');
    if (!form.fullName.trim()) e.fullName  = t('Required field');
    if (!form.email.trim())    e.email     = t('Required field');
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) e.email = t('Invalid email');
    if (!form.joinDate)        e.joinDate  = t('Required field');
    return e;
  };

  const buildDefaults = () => {
    const s     = settings;
    const today = getNepalTodayISO();
    const def   = (arr) => (arr || []).find(x => x.isDefault)?.name || (arr || [])[0]?.name || '';

    /* First day of current/default fiscal year */
    const activeFY = (s.fiscalYears || []).find(fy => fy.isDefault)
                  || (s.fiscalYears || []).find(fy => fy.startDate <= today && fy.endDate >= today)
                  || (s.fiscalYears || [])[0];
    const fyStart = activeFY?.startDate || today;

    return {
      religion:      def(s.religions),
      status:        def(s.statuses) || 'Active',
      branch:        s.companyNameEn || def(s.branches),
      department:    def(s.departments),
      position:      def(s.posts),
      mode:          def(s.modes),
      grade:         def(s.grades),
      timingType:    (s.jobTimings||[]).find(jt => jt.isDefault)?.name
                  || (s.jobTimings||[]).find(jt => jt.name === 'Full Time')?.name
                  || def(s.jobTimings),
      shift:         shifts.find(x => x.makeDefault)?.code || shifts[0]?.code || '',
      joinDate:      fyStart,
      attendanceDate:today,
      dob:           '1983-02-25',
    };
  };

  const openAdd = () => {
    // The toolbar button is disabled once a license limit is hit, but this
    // is also reachable via the row context menu (which has no disabled
    // state of its own) — guard here too so both entry points are blocked.
    if (staffLimitBlocked) {
      setLicLimitAlert({
        reason: overDeviceLimit ? 'both' : 'staff',
        maxStaff: licStatus?.maxStaff, maxDevices: licStatus?.maxDevices, durationDays: licStatus?.durationDays,
      });
      return;
    }
    setForm({ ...defaultForm, ...buildDefaults(), employeeId:`EMP${String(employees.length+1).padStart(3,'0')}` });
    setErrors({}); setEditId(null); setActiveTab('Staff Detail'); setQuickDeviceView(false); setModal(true);
  };


  const openEdit = (u, quick=false) => {
    const { joinDate: fyStart } = buildDefaults();
    setForm({
      ...defaultForm, ...u,
      dob:            u.dob            ? String(u.dob).split('T')[0]            : '1983-02-25',
      joinDate:       u.joinDate       ? String(u.joinDate).split('T')[0]       : fyStart,
      attendanceDate: u.attendanceDate ? String(u.attendanceDate).split('T')[0] : '',
      deviceId:  u.deviceId  || '', religion:   u.religion   || '',
      handicapped: u.handicapped || false,
      eligibleForOt: u.eligibleForOt ?? false,
      branch:    u.branch    || '', mode:      u.mode      || '',
      grade:     u.grade     || '', timingType:u.timingType || '',
      status:    u.status    || 'Active', shift: u.shift || '',
      rankingOrder: u.rankingOrder != null ? String(u.rankingOrder) : '',
      remarks:   u.remarks   || '',
    });
    setErrors({}); setEditId(u.id);
    setActiveTab(quick ? 'Device Connectivity' : 'Staff Detail');
    setQuickDeviceView(quick);
    setModal(true);
  };

  // Lets other pages (e.g. Access Rules → By Person, double-click a row) deep-link
  // here and have that person's Edit Staff form open automatically.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const editEmpId = searchParams.get('editEmployee');
    if (!editEmpId || !employees.length) return;
    const emp = employees.find(e => String(e.id) === editEmpId);
    if (emp) openEdit(emp, false);
    setSearchParams(p => { p.delete('editEmployee'); return p; }, { replace: true });
  }, [searchParams, employees]);

  const handleSave = async () => {
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      // Required fields all live on "Staff Detail" — jump there and scroll to
      // top so the red-bordered field is actually visible. Without this, a
      // required field scrolled out of view (e.g. Attendance Device ID, which
      // is the very first field) makes Save look like it silently did nothing.
      setActiveTab('Staff Detail');
      setQuickDeviceView(false);
      modalBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(t('Please fill in the required fields'), 'error');
      return;
    }

    /* ── Duplicate checks ── */
    const others = employees.filter(e => e.id !== editId);
    const dups = [];
    if (form.deviceId?.trim() && others.some(e => e.deviceId?.trim() === form.deviceId.trim()))
      dups.push('Attendance Device ID');
    if (form.employeeId?.trim() && others.some(e => e.employeeId?.trim() === form.employeeId.trim()))
      dups.push('Staff ID');
    if (form.email?.trim() && others.some(e => e.email?.trim().toLowerCase() === form.email.trim().toLowerCase()))
      dups.push('Email Address');
    if (dups.length) { setDupAlert(dups); return; }

    try {
      if (editId) { await updateEmployee(editId, form); showToast(t('Record updated successfully')); }
      else        { await addEmployee(form);            showToast(t('Record saved successfully'));   }
      setModal(false);
    } catch (e) {
      if (e?.data?.code === 'STAFF_LIMIT') {
        const max = e?.data?.maxStaff || 25;
        setModal(false);
        setLicLimitAlert({ reason:'staff', maxStaff: max, maxDevices: licStatus?.maxDevices, durationDays: licStatus?.durationDays });
      } else {
        showToast(e?.message || t('Save failed'), 'error');
      }
    }
  };

  /* Ctrl+S saves the Edit/Add Staff modal — same action as the Save button.
     Skipped on tabs without a footer Save (Device Connectivity, Officially Changes). */
  useSaveShortcut(modal && activeTab !== 'Device Connectivity' && activeTab !== 'Officially Changes' && activeTab !== 'Staff Identity', handleSave);

  /* Called by the Officially Changes tab after a change is saved/edited.
     If it took effect immediately (effective date ≤ today), sync the form so a
     later "Save" on Staff Detail doesn't revert the value, and refresh the
     staff list so grid columns and Working/Not Working filtering pick it up. */
  const handleOfficialChangeApplied = (user, change) => {
    refreshEmployees?.();
    if (user && change?.applied) {
      setForm(p => ({ ...p,
        status:     user.status     || p.status,
        branch:     user.branch     ?? p.branch,
        position:   user.position   ?? p.position,
        department: user.department ?? p.department,
        mode:       user.mode       ?? p.mode,
        grade:      user.grade      ?? p.grade,
        active:     user.active,
      }));
      showToast(t('Change applied successfully'));
    } else {
      showToast(t('Change scheduled for the effective date'));
    }
  };

  const handleBulkDelete = async (ids) => {
    const results = await Promise.allSettled(ids.map(id => deleteEmployee(id)));
    const failed  = results.filter(r => r.status === 'rejected');
    if (failed.length) {
      showToast(`${failed.length}/${ids.length} ${t('could not be deleted')}: ${failed[0].reason?.message || ''}`, 'error');
    } else {
      showToast(`${ids.length} ${t('records deleted successfully')}`);
    }
  };

  const openResetPwd = () => {
    setResetPwdInput(''); setResetPwdConfirm(''); setResetPwdShowPass(false);
    setResetPwdModal(true);
  };

  const resetToDefault = async (row) => {
    if (!window.confirm(`Reset login password for "${row.fullName}" to default (123456)?`)) return;
    try {
      const res = await fetch(apiUrl(`/employees/${row.id}/reset-password`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({ password: '123456' }),
      });
      if (!res.ok) throw new Error('Failed');
      showToast(`Password reset to default for ${row.fullName}`);
    } catch {
      showToast('Failed to reset password', 'error');
    }
  };

  const handleResetPasswords = async () => {
    if (!resetPwdInput.trim()) { showToast('Password is required', 'error'); return; }
    if (resetPwdInput !== resetPwdConfirm) { showToast('Passwords do not match', 'error'); return; }
    setResetPwdLoading(true);
    try {
      await Promise.all(selectedUserIds.map(id =>
        fetch(apiUrl(`/employees/${id}/reset-password`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: resetPwdInput.trim() }),
        }).then(r => { if (!r.ok) throw new Error('Failed'); })
      ));
      showToast(`Password reset for ${selectedUserIds.length} staff`);
      setResetPwdModal(false);
    } catch {
      showToast('Failed to reset password', 'error');
    } finally {
      setResetPwdLoading(false);
    }
  };

  /* ── Quick Add: open modal for inline item creation ── */
  const openQA = (label, settingsKey, formField) => {
    setQaModal({ label, settingsKey, formField, name: '', shortName: '' });
  };

  const saveQA = () => {
    if (!qaModal?.name?.trim()) return;
    const name = qaModal.name.trim();
    const list = settings[qaModal.settingsKey] || [];
    const newItem = {
      id: Date.now(),
      name,
      shortName: qaModal.shortName?.trim() || name.slice(0, 4).toUpperCase(),
      isDefault: false,
      isSystem:  false,
      ...(list.some(x => 'rankingOrder' in x) ? { rankingOrder: list.length + 1 } : {}),
    };
    updateSetupList(qaModal.settingsKey, [...list, newItem]);
    handleChange(qaModal.formField, name);
    showToast(`${qaModal.label} "${name}" added`);
    setQaModal(null);
  };

  /* ── Print — prints the currently displayed (filtered) rows ── */
  const handlePrint = () => {
    const rows = filteredEmployees.map((e, i) => `
      <tr>
        <td style="text-align:center;color:#6b7280">${i+1}</td>
        <td style="font-family:monospace;background:#f3f4f6;padding:2px 6px;border-radius:4px">${e.employeeId}</td>
        <td style="font-weight:600">${e.fullName}</td>
        <td style="font-family:monospace;color:#0369a1">${e.deviceId||'—'}</td>
        <td>${e.position||'—'}</td>
        <td>${e.department||'—'}</td>
        <td>${e.branch||'—'}</td>
        <td>${e.phone||'—'}</td>
        <td>${e.email||'—'}</td>
        <td>${e.mode||'—'}</td>
        <td>${e.joinDate||'—'}</td>
      </tr>`).join('');
    const win = window.open('','_blank','width=1000,height=700');
    win.document.write(`<!DOCTYPE html><html><head><title>Staff List</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111827}h2{color:#1a56db;font-size:16px}
      table{width:100%;border-collapse:collapse}th{background:#efefef;padding:7px 10px;border:1px solid #dedede;text-align:left;font-size:11px;font-weight:700}
      td{padding:5px 10px;border:1px solid #dedede;font-size:12px}tr:nth-child(even)td{background:#f9fafb}
      @media print{body{margin:0}}</style></head><body>
      <h2>👥 Staff Detail</h2>
      <p style="color:#6b7280;font-size:11px">Total: ${filteredEmployees.length} staff | Printed: ${getNepalNow().toLocaleDateString()}</p>
      <table><thead><tr><th>SN</th><th>Staff ID</th><th>Full Name</th><th>Device ID</th>
      <th>Post</th><th>Department</th><th>Branch</th><th>Mobile</th><th>Email</th><th>Mode</th><th>Join Date</th>
      </tr></thead><tbody>${rows}</tbody></table></body></html>`);
    win.document.close(); win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  /* ── Export CSV — exports the currently displayed (filtered) rows ── */
  const handleExport = () => {
    const h = ['SN','Staff ID','Full Name','Device ID','Post','Department','Branch','Mobile','Email','Mode','Join Date'];
    const rows = filteredEmployees.map((e,i) => [
      i+1, e.employeeId, e.fullName, e.deviceId||'',
      e.position||'', e.department||'', e.branch||'',
      e.phone||'', e.email||'', e.mode||'', e.joinDate||'',
    ]);
    const csv = [h,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=`staff_${getNepalTodayISO()}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  /* ── Scope: filter employees to what this user is allowed to see ── */
  const scopedEmployees = filterByRole(employees);

  /* ── Sort employees by branch Ranking Order, then their own within it ── */
  const sortedEmployees = [...scopedEmployees].sort((a, b) => staffRankCompare(a, b, settings));

  /* ── Advanced filter helpers ── */
  const setAF = (field, val) => setAdvFilters(p => ({ ...p, [field]: val }));
  const clearAdvFilters = () => setAdvFilters({
    q: '',
    branches: [], departments: [], positions: [], grades: [],
    modes: [], genders: [], timingTypes: [], religions: [],
    handicapped: '', eligibleForOt: '', statuses: [], roles: [],
  });
  const activeFilterCount =
    (advFilters.q ? 1 : 0) +
    advFilters.branches.length + advFilters.departments.length + advFilters.positions.length +
    advFilters.grades.length + advFilters.modes.length + advFilters.genders.length +
    advFilters.timingTypes.length + advFilters.religions.length +
    (advFilters.handicapped ? 1 : 0) + (advFilters.eligibleForOt ? 1 : 0) +
    advFilters.statuses.length + advFilters.roles.length;

  const filteredEmployees = sortedEmployees.filter(e => {
    if ((e.active !== false) !== (statusView === 'working')) return false;
    const f = advFilters;
    if (f.q) {
      const ql = f.q.toLowerCase();
      if (!( (e.fullName||'').toLowerCase().includes(ql)
          || (e.employeeId||'').toLowerCase().includes(ql)
          || (e.email||'').toLowerCase().includes(ql)
          || (e.phone||'').includes(ql)
          || (e.deviceId||'').toLowerCase().includes(ql)
      )) return false;
    }
    if (f.branches.length    && !f.branches.includes(e.branch      || '')) return false;
    if (f.departments.length && !f.departments.includes(e.department|| '')) return false;
    if (f.positions.length   && !f.positions.includes(e.position   || '')) return false;
    if (f.grades.length      && !f.grades.includes(e.grade         || '')) return false;
    if (f.modes.length       && !f.modes.includes(e.mode           || '')) return false;
    if (f.genders.length     && !f.genders.includes(e.gender       || '')) return false;
    if (f.timingTypes.length && !f.timingTypes.includes(e.timingType||'')) return false;
    if (f.religions.length   && !f.religions.includes(e.religion   || '')) return false;
    if (f.handicapped) {
      if (f.handicapped === 'yes' && !e.handicapped) return false;
      if (f.handicapped === 'no'  &&  e.handicapped) return false;
    }
    if (f.eligibleForOt) {
      if (f.eligibleForOt === 'yes' && !e.eligibleForOt) return false;
      if (f.eligibleForOt === 'no'  &&  e.eligibleForOt) return false;
    }
    if (f.statuses.length && !f.statuses.includes(e.status || 'Active')) return false;
    if (f.roles.length && !f.roles.includes(e.role || 'employee')) return false;
    return true;
  });

  /* distinct values from employees (fallback for fields not in settings) */
  const uniq = (field) => [...new Set(scopedEmployees.map(e => e[field]).filter(Boolean))].sort();

  /* full lists from settings — ensures all configured options appear even if no staff assigned yet */
  const sNames = (key) => (settings[key] || []).map(x => x.name || x).filter(Boolean).sort();
  const branchOpts     = sNames('branches').length     ? sNames('branches')     : uniq('branch');
  const departmentOpts = sNames('departments').length  ? sNames('departments')  : uniq('department');
  const postOpts       = sNames('posts').length        ? sNames('posts')        : uniq('position');
  const gradeOpts      = sNames('grades').length       ? sNames('grades')       : uniq('grade');
  const modeOpts       = sNames('modes').length        ? sNames('modes')        : uniq('mode');
  /* Timing Type is stored in settings.jobTimings, NOT settings.timingTypes */
  const timingTypeOpts = sNames('jobTimings').length   ? sNames('jobTimings')   : uniq('timingType');
  const religionOpts   = sNames('religions').length    ? sNames('religions')    : uniq('religion');
  /* Status options from settings.statuses; fall back to simple Active/Inactive */
  const statusOpts     = sNames('statuses').length     ? sNames('statuses')     : ['Active', 'Inactive'];

  /* ── DataGrid columns ── */
  const columns = [
    { field:'employeeId', header:'Staff ID',   width:90,
      render:v=><span style={{fontFamily:'monospace',background:'#f3f4f6',padding:'2px 6px',borderRadius:4}}>{v}</span> },
    { field:'fullName',   header:'Full Name',  width:160,
      render:v=><span style={{color:'#1f2937'}}>{v}</span> },
    { field:'deviceId',   header:'Device ID',  width:90,
      render:v=>v?<span style={{fontFamily:'monospace',color:'#1f2937'}}>{v}</span>:<span style={{color:'#d1d5db'}}>—</span> },
    { field:'position',   header:'Post',       width:140,
      render:v=>v||<span style={{color:'#d1d5db'}}>—</span> },
    { field:'department', header:'Department', width:120,
      render:v=>v||<span style={{color:'#d1d5db'}}>—</span> },
    { field:'branch',     header:'Branch',     width:110,
      render:v=>v||<span style={{color:'#d1d5db'}}>—</span> },
    { field:'phone',      header:'Mobile',     width:110,
      render:v=>v||<span style={{color:'#d1d5db'}}>—</span> },
    { field:'email',      header:'Email',      width:190,
      render:v=>v?<span style={{color:'#1f2937'}}>{v}</span>:<span style={{color:'#d1d5db'}}>—</span> },
    { field:'mode',       header:'Mode',       width:110,
      render:v=>v||<span style={{color:'#d1d5db'}}>—</span> },
    { field:'joinDate',   header:'Join Date',  width:120, render:v=>fd(v) },
    { field:'role', header:'User Role', width:140,
      render: v => {
        const key = v || 'employee';
        const color = ROLE_COLORS[key] || '#6b7280';
        const bg    = ROLE_BG[key]     || '#f3f4f6';
        const label = ROLE_LABELS[key] || key;
        return (
          <span style={{ fontSize:12, fontWeight:700, padding:'2px 10px', borderRadius:10,
            background: bg, color, border:`1px solid ${color}44`, whiteSpace:'nowrap' }}>
            {label}
          </span>
        );
      }
    },
  ];

  /* ═══════════════════════════ RENDER ═══════════════════════════ */
  return (
    <div className="page-container">
      <div className="page-header" style={{ flexDirection:'column', alignItems:'stretch' }}>
        {/* Row 1: title left — Export / Print right */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <h1 className="page-title" style={{ fontSize:15 }}>👥 Staff Detail</h1>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {canManageStaff && (
              <button onClick={() => setExcelImport(true)} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 11px', height:30, background:'#f0fdf4', border:'1px solid #86efac', color:'#15803d', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 8.414V13a1 1 0 11-2 0V8.414L7.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                </svg>
                Import Excel
              </button>
            )}
            {canManageStaff && (
              <button onClick={handleSyncNames} disabled={syncingNames}
                title={t('Push each staff member\'s name to the attendance devices in their assigned Area')}
                style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 11px', height:30, background:'#eff6ff', border:'1px solid #93c5fd', color:'#1d4ed8', borderRadius:6, fontSize:12, fontWeight:600, cursor: syncingNames ? 'wait' : 'pointer', whiteSpace:'nowrap', opacity: syncingNames ? .6 : 1 }}>
                <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/>
                </svg>
                {syncingNames ? t('Syncing…') : t('Sync Name in Device')}
              </button>
            )}
            <button onClick={handleExport} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 11px', height:30, background:'#f0fdf4', border:'1px solid #86efac', color:'#15803d', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
              Export
            </button>
            <button onClick={handlePrint} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 11px', height:30, background:'#eff6ff', border:'1px solid #93c5fd', color:'#1d4ed8', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9h8v3H6v-3zm8-4a1 1 0 110 2 1 1 0 010-2z" clipRule="evenodd"/></svg>
              Print
            </button>
          </div>
        </div>
        {/* Row 2: stat chips left — action buttons right */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:10, marginTop:6, flexWrap:'wrap' }}>
            {[
              { label:t('Total Staff'), count:scopedEmployees.length,                                                bg:'#f3f4f6', color:'#374151' },
              { label:t('Active'),      count:scopedEmployees.filter(e=>e.active).length,                           bg:'#d1fae5', color:'#065f46' },
              { label:t('Male'),        count:scopedEmployees.filter(e=>e.gender==='male').length,                  bg:'#dbeafe', color:'#1e40af' },
              { label:t('Female'),      count:scopedEmployees.filter(e=>e.gender==='female').length,                bg:'#fce7f3', color:'#9d174d' },
              { label:'Permanent',      count:scopedEmployees.filter(e=>e.mode==='Permanent').length,               bg:'#ecfdf5', color:'#065f46' },
              { label:'Temporary',      count:scopedEmployees.filter(e=>e.mode==='Temporary').length,               bg:'#fffbeb', color:'#92400e' },
              { label:'Contract',       count:scopedEmployees.filter(e=>e.mode==='Contract').length,                bg:'#eff6ff', color:'#1e40af' },
            ].map(({ label, count, bg, color }) => (
              <span key={label} style={{ display:'inline-flex', alignItems:'center', gap:6, background:bg, color, borderRadius:6, padding:'3px 12px', fontSize:12, fontWeight:600 }}>
                {label}: <strong style={{ fontSize:14 }}>{count}</strong>
              </span>
            ))}
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end', marginLeft:'auto' }}>
          {/* Working / Not Working list toggle */}
          <div style={{ display:'flex', border:'1px solid #d1d5db', borderRadius:6, overflow:'hidden', height:30 }}>
            {[['working', t('Working')], ['notworking', t('Not Working')]].map(([v, label]) => (
              <button key={v} onClick={() => setStatusView(v)}
                style={{ padding:'0 11px', border:'none', cursor:'pointer', fontSize:12, fontWeight:600,
                  transition:'background .15s',
                  background: statusView === v ? '#1a56db' : 'white',
                  color: statusView === v ? 'white' : '#374151' }}>
                {label}
              </button>
            ))}
          </div>
          {/* Advanced Search — opens popup modal */}
          <button onClick={() => setShowAdvSearch(true)} style={{
            display:'inline-flex', alignItems:'center', gap:5, padding:'5px 11px', height:30,
            background: activeFilterCount > 0 ? '#eff6ff' : '#f8fafc',
            border: `1px solid ${activeFilterCount > 0 ? '#1a56db' : '#d1d5db'}`,
            color: activeFilterCount > 0 ? '#1a56db' : '#374151',
            borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', position:'relative',
          }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
              <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
            </svg>
            Advanced Search
            {activeFilterCount > 0 && (
              <span style={{ background:'#ef4444', color:'#fff', borderRadius:10,
                fontSize:10, fontWeight:700, padding:'1px 6px', minWidth:18, textAlign:'center' }}>
                {activeFilterCount}
              </span>
            )}
          </button>
          {canManageStaff && (
            <button
              onClick={() => setImportModal(true)}
              style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 12px', height:30,
                background:'linear-gradient(135deg,#059669,#047857)', border:'none',
                color:'white', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer',
                boxShadow:'0 1px 4px rgba(5,150,105,.3)' }}
            >
              📥 Import Device Users
            </button>
          )}
            {canManageStaff && (
              <button
                className="btn btn-primary"
                onClick={openAdd}
                disabled={staffLimitBlocked}
                title={staffLimitBlocked ? staffLimitTooltip : undefined}
                style={{ padding:'5px 14px', height:30, fontSize:12,
                  opacity: staffLimitBlocked ? 0.5 : 1,
                  cursor: staffLimitBlocked ? 'not-allowed' : 'pointer' }}
              >
                + {t('Add New Staff')}
              </button>
            )}
          </div>
        </div>
        {staffLimitBlocked && (
          <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:8,
            background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8,
            padding:'8px 14px', fontSize:12.5, color:'#92400e', fontWeight:600 }}>
            🔒 Maximum Users Limit — License: {licStatus?.durationDays ?? '—'} days,
            Staff {activeStaffCount}/{licStatus?.maxStaff ?? '—'}, Device {deviceCount ?? '—'}/{licStatus?.maxDevices ?? '—'}.
            Add New Staff is disabled — contact your distributor to upgrade.
          </div>
        )}
      </div>

      {/* ── Advanced Search Modal Popup ── */}
      {showAdvSearch && (() => {
        /* ── Multi-checkbox select dropdown ── */
        const MCS = ({ label, value, onChange, options }) => {
          const [open, setOpen] = React.useState(false);
          const [srch, setSrch] = React.useState('');
          const [activeIndex, setActiveIndex] = React.useState(-1);
          const ref  = React.useRef(null);
          const itemRefs = React.useRef([]);
          React.useEffect(() => {
            const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
            document.addEventListener('mousedown', h);
            return () => document.removeEventListener('mousedown', h);
          }, []);
          const filtered = srch ? options.filter(o => o.toLowerCase().includes(srch.toLowerCase())) : options;
          // "All" is always row 0 in the navigable list, followed by the filtered options
          const navItems = [null, ...filtered];
          itemRefs.current = [];
          const toggle   = v  => onChange(value.includes(v) ? value.filter(x=>x!==v) : [...value, v]);
          const selectNav = v => v === null ? onChange([]) : toggle(v);
          const selLabel = value.length === 0 ? 'All'
            : value.length === 1 ? value[0]
            : `${value.length} selected`;
          const openWithHighlight = () => {
            const idx = value.length === 1 ? navItems.findIndex(v => v === value[0]) : 0;
            setActiveIndex(idx >= 0 ? idx : 0);
            setOpen(true);
          };
          const handleTriggerKeyDown = e => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              open ? setOpen(false) : openWithHighlight();
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          };
          const handleSearchKeyDown = e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex(i => (navItems.length ? (i + 1) % navItems.length : -1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex(i => (navItems.length ? (i - 1 + navItems.length) % navItems.length : -1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (activeIndex >= 0 && activeIndex < navItems.length) selectNav(navItems[activeIndex]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          };
          React.useEffect(() => {
            if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
          }, [activeIndex, open]);
          React.useEffect(() => { if (open) setActiveIndex(navItems.length ? 0 : -1); }, [srch]);

          return (
            <div ref={ref} style={{ position:'relative' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#1f2937', marginBottom:5 }}>{label}</div>
              <div
                tabIndex={0}
                onKeyDown={handleTriggerKeyDown}
                onClick={() => { open ? setOpen(false) : openWithHighlight(); }}
                style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'8px 10px', border:`1.5px solid ${open?'#1a56db':'#d1d5db'}`,
                  borderRadius:7, background:'white', cursor:'pointer', fontSize:13,
                  color: value.length>0 ? '#1e40af' : '#9ca3af',
                  minHeight:42, fontWeight: value.length>0 ? 600 : 400,
                  boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none',
                  outline:'none', userSelect:'none',
                }}>
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{selLabel}</span>
                <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0, marginLeft:6 }}>
                  {value.length > 0 && (
                    <span style={{ background:'#1a56db', color:'white', borderRadius:10,
                      fontSize:10, fontWeight:700, padding:'1px 6px', minWidth:18, textAlign:'center' }}>
                      {value.length}
                    </span>
                  )}
                  {value.length > 0 && (
                    <span onMouseDown={e=>{ e.preventDefault(); e.stopPropagation(); onChange([]); }}
                      style={{ color:'#9ca3af', fontSize:16, lineHeight:1, cursor:'pointer' }}
                      onMouseEnter={e=>e.currentTarget.style.color='#ef4444'}
                      onMouseLeave={e=>e.currentTarget.style.color='#9ca3af'}>×</span>
                  )}
                  <span style={{ fontSize:9, color:'#9ca3af' }}>{open?'▲':'▼'}</span>
                </div>
              </div>
              {open && (
                <div style={{
                  position:'absolute', top:'calc(100% + 3px)', left:0, right:0, zIndex:9999,
                  background:'white', border:'1.5px solid #1a56db', borderRadius:8,
                  boxShadow:'0 8px 24px rgba(0,0,0,.18)', maxHeight:220,
                  display:'flex', flexDirection:'column',
                }}>
                  {/* always show search box */}
                  <div style={{ padding:'6px 8px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
                    <input autoFocus type="text" value={srch} onChange={e=>setSrch(e.target.value)}
                      placeholder="Search..."
                      onClick={e=>e.stopPropagation()}
                      onKeyDown={handleSearchKeyDown}
                      style={{ width:'100%', border:'1px solid #d1d5db', borderRadius:5, padding:'5px 8px',
                        fontSize:12, outline:'none', boxSizing:'border-box' }} />
                  </div>
                  <div style={{ overflowY:'auto', flex:1 }}>
                    {navItems.map((v, i) => {
                      const isAll = v === null;
                      const sel   = isAll ? value.length === 0 : value.includes(v);
                      const highlighted = i === activeIndex;
                      return (
                        <div key={v ?? '__all'} ref={el => itemRefs.current[i] = el}
                          onMouseDown={e=>{e.preventDefault(); selectNav(v);}}
                          onMouseEnter={() => setActiveIndex(i)}
                          style={{ padding:'8px 11px', display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                            background: sel ? '#eff6ff' : (highlighted ? '#f8fafc' : 'white'),
                            borderBottom: isAll ? '1px solid #f1f5f9' : '1px solid #f9fafb' }}>
                          <span style={{ width:14, height:14, borderRadius:3, flexShrink:0, border:`2px solid ${sel?'#1a56db':'#d1d5db'}`,
                            background: sel?'#1a56db':'white', display:'flex', alignItems:'center', justifyContent:'center' }}>
                            {sel && <svg viewBox="0 0 12 12" fill="none" width="9" height="9"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                          </span>
                          <span style={{ fontSize:13, color: sel?'#1e40af':'#374151', fontWeight: sel?600:400 }}>{isAll ? 'All' : v}</span>
                        </div>
                      );
                    })}
                    {filtered.length === 0 && (
                      <div style={{ padding:'10px 11px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>No results</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        };

        /* Enter key → Tab in modal */
        const handleEnterTab = (e) => {
          if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
          e.preventDefault();
          const modal = e.currentTarget;
          const els = Array.from(modal.querySelectorAll(
            'input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex="0"]:not([disabled])'
          )).filter(el => el.offsetParent !== null);
          const idx = els.indexOf(document.activeElement);
          if (idx >= 0 && idx < els.length - 1) els[idx + 1].focus();
        };

        return (
          <div className="modal-overlay">
            <div onClick={e => e.stopPropagation()} onKeyDown={handleEnterTab}
              style={{
                background:'white', borderRadius:14, width:'96vw', maxWidth:1050,
                maxHeight:'88vh', display:'flex', flexDirection:'column',
                boxShadow:'0 25px 60px rgba(0,0,0,.22)', overflow:'hidden',
              }}>

              {/* Header */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'16px 24px', borderBottom:'2px solid #e5e7eb',
                background:'#ffffff', flexShrink:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" style={{ color:'#1a56db' }}>
                    <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
                  </svg>
                  <span style={{ fontSize:17, fontWeight:800, color:'#111827' }}>Advanced Search</span>
                  {activeFilterCount > 0 && (
                    <span style={{ background:'#1a56db', color:'#fff', borderRadius:10, fontSize:12, fontWeight:700, padding:'2px 10px' }}>
                      {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
                    </span>
                  )}
                  <span style={{ fontSize:13, color:'#6b7280' }}>
                    — {filteredEmployees.length} of {sortedEmployees.length} staff shown
                  </span>
                </div>
                <button onClick={() => setShowAdvSearch(false)}
                  style={{ background:'#f3f4f6', border:'none', borderRadius:'50%', width:36, height:36,
                    fontSize:18, cursor:'pointer', color:'#6b7280', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  ×
                </button>
              </div>

              {/* Body */}
              <div style={{ overflowY:'auto', flex:1, padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>

                {/* Search bar */}
                <div style={{ position:'relative' }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15"
                    style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', color:'#9ca3af', pointerEvents:'none' }}>
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                  </svg>
                  <input type="text" value={advFilters.q} onChange={e => setAF('q', e.target.value)}
                    placeholder="Search by Name / Staff ID / Email / Phone / Device ID..." autoFocus tabIndex={0}
                    style={{ width:'100%', boxSizing:'border-box', padding:'11px 14px 11px 34px',
                      border:'1.5px solid #d1d5db', borderRadius:8, fontSize:14, outline:'none', fontFamily:'inherit' }}
                    onFocus={e => e.target.style.borderColor='#1a56db'}
                    onBlur={e  => e.target.style.borderColor='#d1d5db'} />
                </div>

                {/* Row 1: Branch / Department / Post */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <MCS label="Branch"     value={advFilters.branches}    onChange={v=>setAF('branches',v)}    options={branchOpts} />
                  <MCS label="Department" value={advFilters.departments}  onChange={v=>setAF('departments',v)} options={departmentOpts} />
                  <MCS label="Post"       value={advFilters.positions}    onChange={v=>setAF('positions',v)}   options={postOpts} />
                </div>

                {/* Row 2: Grade / Mode / Gender */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <MCS label="Grade" value={advFilters.grades} onChange={v=>setAF('grades',v)} options={gradeOpts} />
                  <MCS label="Mode"  value={advFilters.modes}  onChange={v=>setAF('modes',v)}  options={modeOpts} />
                  <MCS label="Gender" value={advFilters.genders} onChange={v=>setAF('genders',v)} options={['male','female','other']} />
                </div>

                {/* Row 3: Timing Type / Religion / Handicapped */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <MCS label="Timing Type" value={advFilters.timingTypes} onChange={v=>setAF('timingTypes',v)} options={timingTypeOpts} />
                  <MCS label="Religion"    value={advFilters.religions}   onChange={v=>setAF('religions',v)}   options={religionOpts} />
                  {/* Handicapped — single select */}
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:'#1f2937', marginBottom:5 }}>Handicapped</div>
                    <select value={advFilters.handicapped} onChange={e=>setAF('handicapped',e.target.value)}
                      tabIndex={0}
                      style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #d1d5db', borderRadius:7,
                        fontSize:13, outline:'none', fontFamily:'inherit', background:'white', cursor:'pointer',
                        minHeight:42, color: advFilters.handicapped ? '#1e40af' : '#9ca3af',
                        fontWeight: advFilters.handicapped ? 600 : 400 }}
                      onFocus={e => e.target.style.borderColor='#1a56db'}
                      onBlur={e  => e.target.style.borderColor='#d1d5db'}>
                      <option value="">All</option>
                      <option value="yes">Yes — Handicapped</option>
                      <option value="no">No — Not Handicapped</option>
                    </select>
                  </div>
                </div>

                {/* Row 4: Status / User Role / OT Eligible */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <MCS label="Status" value={advFilters.statuses} onChange={v=>setAF('statuses',v)} options={statusOpts} />
                  <MCS label="User Role" value={advFilters.roles} onChange={v=>setAF('roles',v)}
                    options={['admin','branchManager','departmentHead','employee']} />
                  {/* OT Eligible — single select */}
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:'#1f2937', marginBottom:5 }}>OT Eligible</div>
                    <select value={advFilters.eligibleForOt} onChange={e=>setAF('eligibleForOt',e.target.value)}
                      tabIndex={0}
                      style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #d1d5db', borderRadius:7,
                        fontSize:13, outline:'none', fontFamily:'inherit', background:'white', cursor:'pointer',
                        minHeight:42, color: advFilters.eligibleForOt ? '#1e40af' : '#9ca3af',
                        fontWeight: advFilters.eligibleForOt ? 600 : 400 }}
                      onFocus={e => e.target.style.borderColor='#1a56db'}
                      onBlur={e  => e.target.style.borderColor='#d1d5db'}>
                      <option value="">All</option>
                      <option value="yes">Yes — OT Eligible</option>
                      <option value="no">No — Not OT Eligible</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'14px 24px', borderTop:'2px solid #e5e7eb', background:'#f9fafb', flexShrink:0 }}>
                <button onClick={clearAdvFilters}
                  style={{ padding:'9px 20px', border:'1px solid #fca5a5', borderRadius:8,
                    background:'#fff5f5', color:'#dc2626', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  🗑️ Clear All Filters
                </button>
                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={() => setShowAdvSearch(false)}
                    style={{ padding:'9px 20px', border:'1.5px solid #d1d5db', borderRadius:8,
                      background:'white', color:'#374151', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                    Close
                  </button>
                  <button onClick={() => setShowAdvSearch(false)}
                    style={{ padding:'9px 24px', border:'none', borderRadius:8, background:'#1a56db',
                      color:'white', fontSize:13, fontWeight:700, cursor:'pointer',
                      boxShadow:'0 2px 8px rgba(26,86,219,.3)' }}>
                    ✅ Apply Filter
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <DataGrid
        columns={columns}
        data={filteredEmployees}
        defaultPageSize={25}
        showSearch={true}
        showFilterButton={false}
        searchPlaceholder={t('Search')+'...'}
        compact={true}
        onRowDoubleClick={canManageStaff ? (row) => openEdit(row, false) : undefined}
        onDeleteKey={canManageStaff ? (row) => setDeleteConfirm(row.id) : null}
        contextMenu={canManageStaff ? [
          { label: 'Add New Staff',         icon: '➕', onClick: () => openAdd() },
          'divider',
          { label: 'Edit',                  icon: '✏️', onClick: (row) => openEdit(row) },
          { label: 'Enroll Device',         icon: '📲', onClick: (row) => openEdit(row, true) },
          { label: 'Reset Login Password',  icon: '🔑', onClick: (row) => resetToDefault(row) },
          'divider',
          { label: 'Delete',                icon: '🗑', className: 'danger', onClick: (row) => setDeleteConfirm(row.id) },
        ] : undefined}
        onDeleteSelected={canManageStaff ? handleBulkDelete : null}
        onSelectionChange={setSelectedUserIds}
        selectionActions={
          canManageStaff ? (
            <button onClick={openResetPwd} style={{
              padding: '4px 12px', border: '1px solid #a78bfa',
              borderRadius: 6, background: '#f5f3ff', color: '#6d28d9',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              🔑 Reset Password
            </button>
          ) : null
        }
        filterButtonLabel="Advance Search"
        toolbar={
          canManageStaff && (
            <button onClick={() => setRecoModal(true)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', height: 30,
              background: '#ede9fe',
              border: '1px solid #c4b5fd', color: '#6d28d9', borderRadius: 6,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}>
              👥 Set Recommendator &amp; Approval
            </button>
          )
        }
      />

      {/* ══════════ ADD / EDIT MODAL ══════════ */}
      {/* Device Connectivity (row's Full Name clicked) opens as a right-side
          drawer instead of the centered popup used for Add/Edit Staff. */}
      {modal && (
        <div className={`modal-overlay ${quickDeviceView ? 'modal-drawer-overlay' : ''}`}>
          <div className={`modal ${quickDeviceView ? 'modal-drawer' : ''}`} ref={modalBodyRef}
            style={{ maxWidth: quickDeviceView ? 480 : 1100, maxHeight: quickDeviceView ? undefined : '95vh' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="modal-header">
              <h2>{quickDeviceView ? `📲 ${t('Device Connectivity')}` : editId ? `✏️ ${t('Edit Staff')}` : `+ ${t('Add Staff Management')}`}</h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>

            {/* Tab bar — hidden in quick device view (row click), shown for full Edit */}
            {!quickDeviceView && <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'0 20px', background:'#fafbfc' }}>
              {MODAL_TABS.map(tab => (
                <button key={tab} className={`tab-btn ${activeTab===tab?'active':''}`} onClick={() => setActiveTab(tab)}>
                  {tab}
                </button>
              ))}
            </div>}

            {/* Body */}
            <div className="modal-body" style={{ padding:'16px 20px' }}>
              {activeTab === 'Staff Detail' ? (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                <div style={{ gridRow:'1 / 3' }}>

                  {/* ── Panel 1: Personal Information ── */}
                  <Panel title="Personal Information">
                    <Fg idx={0}>
                      <Fl required>Attendance Device ID</Fl>
                      <input type="text"
                        className={`form-control ${errors.deviceId?'error':''}`}
                        style={{ fontSize:13, background: editId ? '#f3f4f6' : 'white', color: editId ? '#6b7280' : undefined }}
                        placeholder="DEV-001"
                        value={form.deviceId}
                        readOnly={!!editId}
                        title={editId ? 'Attendance Device ID cannot be changed after saving' : ''}
                        onChange={e => { if (!editId) handleChange('deviceId', e.target.value); }} />
                      {editId && (
                        <div className="form-hint" style={{ display:'flex', alignItems:'center', gap:4 }}>
                          🔒 Saved — cannot be edited
                        </div>
                      )}
                      {errors.deviceId && <div className="form-error">{errors.deviceId}</div>}
                    </Fg>
                    <Fg idx={1}>
                      <Fl>Staff ID</Fl>
                      <input type="text" className="form-control" style={{ fontSize:13, fontFamily:'monospace' }}
                        value={form.employeeId} onChange={e => handleChange('employeeId', e.target.value)} />
                    </Fg>
                    <Fg idx={2}>
                      <Fl required>Staff Name</Fl>
                      <input type="text" className={`form-control ${errors.fullName?'error':''}`} style={{ fontSize:13 }}
                        placeholder="राम प्रसाद श्रेष्ठ" value={form.fullName}
                        onChange={e => handleChange('fullName', e.target.value)} />
                      {errors.fullName && <div className="form-error">{errors.fullName}</div>}
                    </Fg>
                    <Fg idx={3}>
                      <Fl>Gender</Fl>
                      <SearchableSelect
                        value={form.gender}
                        onChange={v => handleChange('gender', v)}
                        options={[{value:'male',label:'Male'},{value:'female',label:'Female'},{value:'other',label:'Other'}]}
                      />
                    </Fg>
                    <Fg idx={5}>
                      <Fl>Religion</Fl>
                      <SearchableSelect
                        value={form.religion}
                        onChange={v => handleChange('religion', v)}
                        options={[{value:'',label:'— Select —'}, ...(settings.religions||[]).map(r => ({value:r.name,label:r.name}))]}
                      />
                    </Fg>
                    <Fg idx={6}>
                      <Fl>Handicapped</Fl>
                      <SearchableSelect
                        value={form.handicapped ? 'yes' : 'no'}
                        onChange={v => handleChange('handicapped', v === 'yes')}
                        options={[{value:'no',label:'No'},{value:'yes',label:'Yes'}]}
                      />
                    </Fg>
                    <Fg idx={7}>
                      <Fl required>Email Address</Fl>
                      <input type="email" className={`form-control ${errors.email?'error':''}`} style={{ fontSize:13 }}
                        placeholder="name@company.com" value={form.email}
                        onChange={e => handleChange('email', e.target.value)} />
                      {errors.email && <div className="form-error">{errors.email}</div>}
                    </Fg>
                    <Fg idx={0}>
                      <Fl>Mobile No.</Fl>
                      <input type="tel" className="form-control" style={{ fontSize:13 }}
                        placeholder="98XXXXXXXX" value={form.phone}
                        onChange={e => handleChange('phone', e.target.value.replace(/\D/g, ''))}
                        inputMode="numeric" maxLength={15} />
                    </Fg>
                  </Panel>
                </div>

                  {/* ── Panel 2: Organization ── */}
                  <Panel title="Organization">
                    <Fg idx={0}>
                      <Fl onQA={() => openQA('Branch', 'branches', 'branch')}>Company HQ / Branch</Fl>
                      <SearchableSelect
                        value={form.branch}
                        onChange={v => handleChange('branch', v)}
                        placeholder="— None —"
                        options={[
                          ...(settings.companyNameEn ? [{value: settings.companyNameEn, label: `${settings.companyNameEn} (HQ)`}] : []),
                          ...(settings.branches||[]).map(b => ({value: b.name, label: `${b.name} Branch`})),
                        ]}
                      />
                    </Fg>
                    <Fg idx={1}>
                      <Fl onQA={() => openQA('Department', 'departments', 'department')}>Department</Fl>
                      <SearchableSelect
                        value={form.department}
                        onChange={v => handleChange('department', v)}
                        options={[{value:'',label:'— Select —'}, ...(settings.departments||[]).map(d => ({value:d.name,label:d.name}))]}
                      />
                    </Fg>
                    <Fg idx={2}>
                      <Fl onQA={() => openQA('Post', 'posts', 'position')}>Post</Fl>
                      <SearchableSelect
                        value={form.position}
                        onChange={v => handleChange('position', v)}
                        options={[{value:'',label:'— Select —'}, ...(settings.posts||[]).map(p => ({value:p.name,label:p.name}))]}
                      />
                    </Fg>
                    <Fg idx={3}>
                      <Fl onQA={() => openQA('Mode', 'modes', 'mode')}>Mode</Fl>
                      <SearchableSelect
                        value={form.mode}
                        onChange={v => handleChange('mode', v)}
                        options={[{value:'',label:'— Select —'}, ...(settings.modes||[]).map(m => ({value:m.name,label:m.name}))]}
                      />
                    </Fg>
                    <Fg idx={4}>
                      <Fl>Grade</Fl>
                      <SearchableSelect
                        value={form.grade}
                        onChange={v => handleChange('grade', v)}
                        options={[{value:'',label:'— Select —'}, ...(settings.grades||[]).map(g => ({value:g.name,label:g.name}))]}
                      />
                    </Fg>
                    <Fg idx={5}>
                      <Fl>Timing Type</Fl>
                      <SearchableSelect
                        value={form.timingType}
                        onChange={v => handleChange('timingType', v)}
                        options={[{value:'',label:'— Select —'}, ...(settings.jobTimings||[]).map(jt => ({value:jt.name,label:jt.name}))]}
                      />
                    </Fg>
                    <Fg idx={6}>
                      <Fl>Eligible for OT</Fl>
                      <SearchableSelect
                        value={form.eligibleForOt ? 'yes' : 'no'}
                        onChange={v => handleChange('eligibleForOt', v === 'yes')}
                        options={[{value:'yes',label:'Yes'},{value:'no',label:'No'}]}
                      />
                    </Fg>
                  </Panel>

                  {/* ── Panel 3: Dates & Status ── */}
                  <Panel title="Dates & Status">
                    <Fg idx={0}>
                      <Fl>Date of Birth</Fl>
                      <DateInput value={form.dob} onChange={v => handleChange('dob', v)} />
                    </Fg>
                    <Fg idx={1}>
                      <Fl required>Join Date</Fl>
                      <DateInput value={form.joinDate} onChange={v => handleChange('joinDate', v)} error={!!errors.joinDate} />
                      {errors.joinDate && <div className="form-error">{errors.joinDate}</div>}
                    </Fg>
                    <Fg idx={2}>
                      <Fl>Attendance Date</Fl>
                      <DateInput value={form.attendanceDate} onChange={v => handleChange('attendanceDate', v)} />
                    </Fg>
                    <Fg idx={3}>
                      <Fl>Status</Fl>
                      <SearchableSelect
                        value={form.status}
                        onChange={v => handleChange('status', v)}
                        options={(settings.statuses||[]).map(s => ({value:s.name,label:s.name}))}
                      />
                    </Fg>
                    <Fg idx={4}>
                      <Fl>Ranking Order</Fl>
                      <input
                        type="number"
                        min="1"
                        className="form-control"
                        style={{ fontSize:13 }}
                        placeholder="e.g. 1, 2, 3..."
                        value={form.rankingOrder}
                        onChange={e => handleChange('rankingOrder', e.target.value === '' ? '' : e.target.value.replace(/[^0-9]/g, ''))}
                      />
                      <div className="form-hint">
                        Staff are listed in this order within their branch.
                        {(form.branch && form.rankingOrder) &&
                          ` Full Rank: ${branchRankOf(form.branch, settings) ?? '—'}.${form.rankingOrder}`}
                      </div>
                    </Fg>
                    <Fg idx={5}>
                      <Fl>User Role</Fl>
                      <select className="form-control" style={{ fontSize:13 }}
                        value={form.role}
                        onChange={e => handleChange('role', e.target.value)}>
                        <option value="employee">👤 Employee</option>
                        <option value="branchManager">🏪 Branch Manager</option>
                        <option value="departmentHead">🏗️ Department Head</option>
                        <option value="admin">👑 Admin</option>
                      </select>
                    </Fg>
                  </Panel>

                {/* Remarks — row 2, spans cols 2 & 3 */}
                <div style={{ gridColumn:'2 / 4' }}>
                  <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius-md)', overflow:'hidden' }}>
                    <div style={{ padding:'8px 14px', background:'white' }}>
                      <Fl>Remarks</Fl>
                      <textarea
                        className="form-control"
                        rows={4}
                        placeholder="Additional notes or remarks about this staff member..."
                        style={{ fontSize:13, resize:'vertical' }}
                        value={form.remarks}
                        onChange={e => handleChange('remarks', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                </div>
              ) : activeTab === 'Device Connectivity' ? (
                !editId
                  ? (
                    <div className="empty-state" style={{ padding:'40px 0' }}>
                      <div className="empty-state-icon">💾</div>
                      <h3>Save Staff First</h3>
                      <p>Save the staff record before managing device connectivity.</p>
                    </div>
                  ) : (
                    <DeviceConnTab devicePin={form.deviceId} staffName={form.fullName} employeeId={editId} />
                  )
              ) : activeTab === 'Officially Changes' ? (
                !editId
                  ? (
                    <div className="empty-state" style={{ padding:'40px 0' }}>
                      <div className="empty-state-icon">💾</div>
                      <h3>Save Staff First</h3>
                      <p>Save the staff record before adding official changes.</p>
                    </div>
                  ) : (
                    <OfficialChangesTab
                      employeeId={editId}
                      current={{
                        status:     form.status,
                        branch:     form.branch,
                        position:   form.position,
                        department: form.department,
                        mode:       form.mode,
                        grade:      form.grade,
                      }}
                      onApplied={handleOfficialChangeApplied}
                    />
                  )
              ) : activeTab === 'Staff Identity' ? (
                !editId
                  ? (
                    <div className="empty-state" style={{ padding:'40px 0' }}>
                      <div className="empty-state-icon">💾</div>
                      <h3>Save Staff First</h3>
                      <p>Save the staff record before adding identity records.</p>
                    </div>
                  ) : (
                    <StaffIdentityTab employeeId={editId} />
                  )
              ) : (
                <div className="empty-state" style={{ padding:'40px 0' }}>
                  <div className="empty-state-icon">🚧</div>
                  <h3>Coming Soon</h3>
                  <p>This section is under development</p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(false)}>{t('Cancel')}</button>
              {activeTab !== 'Device Connectivity' && activeTab !== 'Officially Changes' && activeTab !== 'Staff Identity' && (
                <SaveButton onClick={handleSave} label={t('Save')} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════ QUICK ADD MODAL ══════════ */}
      {qaModal && (
        <div className="modal-overlay" style={{ zIndex:1100 }}>
          <div className="modal modal-sm" style={{ zIndex:1200, maxWidth:400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>+ Quick Add — {qaModal.label}</h2>
              <button className="modal-close" onClick={() => setQaModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label required">{qaModal.label} Name</label>
                <input type="text" className="form-control" autoFocus
                  placeholder={`Enter ${qaModal.label} name...`}
                  value={qaModal.name}
                  onChange={e => setQaModal(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') saveQA(); }} />
              </div>
              <div className="form-group">
                <label className="form-label">Short Name</label>
                <input type="text" className="form-control" maxLength={10}
                  placeholder="e.g. HO, IT, HR..."
                  value={qaModal.shortName}
                  onChange={e => setQaModal(p => ({ ...p, shortName: e.target.value }))} />
                <div className="form-hint">Optional — auto-generated from name if left blank</div>
              </div>
              <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:6, padding:'8px 12px', fontSize:12, color:'#92400e' }}>
                ℹ️ The new item will also be saved in Official Settings → {qaModal.label}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setQaModal(null)}>{t('Cancel')}</button>
              <button className="btn btn-primary" onClick={saveQA} disabled={!qaModal.name?.trim()}>
                + Add {qaModal.label}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ DUPLICATE ALERT ══════════ */}
      {dupAlert && (
        <div className="modal-overlay" style={{ zIndex:1100 }}>
          <div className="modal modal-sm" style={{ zIndex:1200, maxWidth:420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ color:'#92400e' }}>⚠️ Duplicate Data Found</h2>
              <button className="modal-close" onClick={() => setDupAlert(null)}>✕</button>
            </div>
            <div className="modal-body">
              {dupAlert.map(field => (
                <div key={field} style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, padding:'10px 14px', marginBottom:8, fontSize:14, color:'#9a3412', display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:18, flexShrink:0 }}>⛔</span>
                  <span>Duplicate Data in <strong>{field}</strong></span>
                </div>
              ))}
              <div style={{ fontSize:13, color:'#6b7280', marginTop:10 }}>
                This record cannot be saved. Please change the duplicate value(s) before saving.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setDupAlert(null)}>OK, I'll fix it</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ LICENSE STAFF LIMIT ALERT ══════════ */}
      {licLimitAlert && (
        <div className="modal-overlay" style={{ zIndex:1100 }}>
          <div className="modal modal-sm" style={{ zIndex:1200, maxWidth:460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ color:'#991b1b' }}>🔒 Maximum Users Limit</h2>
              <button className="modal-close" onClick={() => setLicLimitAlert(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ textAlign:'center', padding:'24px 28px' }}>
              <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#991b1b', marginBottom:8 }}>
                {licLimitAlert.reason === 'device' ? 'Device Limit Reached'
                  : licLimitAlert.reason === 'both' ? 'Staff & Device Limit Reached'
                  : 'Staff Limit Reached'}
              </div>
              <div style={{ fontSize:14, color:'#374151', marginBottom:16, lineHeight:1.6 }}>
                {licLimitAlert.reason !== 'device' && (
                  <>Your license allows only <strong>{licLimitAlert.maxStaff} staff members</strong>.<br/></>
                )}
                {licLimitAlert.reason !== 'staff' && (
                  <>Your license allows only <strong>{licLimitAlert.maxDevices} device{licLimitAlert.maxDevices===1?'':'s'}</strong>.<br/></>
                )}
                Add New Staff is disabled until you upgrade your license.
              </div>
              <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:10, padding:'12px 16px', fontSize:13, color:'#92400e' }}>
                License: {licLimitAlert.durationDays ?? '—'} days · Staff limit {licLimitAlert.maxStaff ?? '—'} · Device limit {licLimitAlert.maxDevices ?? '—'}<br/>
                📞 Contact your distributor to upgrade your license plan.
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent:'center' }}>
              <button className="btn btn-primary" onClick={() => setLicLimitAlert(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ VIEW MODAL ══════════ */}
      {viewUser && (
        <div className="modal-overlay">
          <div className="modal modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>👤 {viewUser.fullName}</h2>
              <button className="modal-close" onClick={() => setViewUser(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:20, background:'#f9fafb', borderRadius:10, padding:16 }}>
                <div style={{ width:56, height:56, borderRadius:'50%', background:ROLE_BG[viewUser.role], color:ROLE_COLORS[viewUser.role], display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:22 }}>{viewUser.avatar}</div>
                <div>
                  <div style={{ fontSize:16, fontWeight:700 }}>{viewUser.fullName}</div>
                  <div style={{ fontSize:13, color:'#6b7280' }}>{viewUser.position} · {viewUser.department}</div>
                  <span style={{ background:ROLE_BG[viewUser.role], color:ROLE_COLORS[viewUser.role], padding:'2px 10px', borderRadius:10, fontSize:11, fontWeight:600 }}>{ROLE_LABELS[viewUser.role]}</span>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                {[
                  [t('Staff ID'),     viewUser.employeeId],
                  ['Device ID',       viewUser.deviceId||'—'],
                  [t('Email'),        viewUser.email],
                  [t('Phone'),        viewUser.phone||'—'],
                  ['Branch',          viewUser.branch||'—'],
                  ['Mode',            viewUser.mode||'—'],
                  ['Grade',           viewUser.grade||'—'],
                  [t('Gender'),       viewUser.gender==='male'?t('Male'):viewUser.gender==='female'?t('Female'):t('Other')],
                  ['Religion',        viewUser.religion||'—'],
                  ['Handicapped',     viewUser.handicapped?'Yes':'No'],
                  ['Eligible for OT', (viewUser.eligibleForOt ?? false)?'Yes':'No'],
                  ['Date of Birth',   viewUser.dob?fd(viewUser.dob):'—'],
                  [t('Join Date'),    fd(viewUser.joinDate)],
                  ['Attendance Date', viewUser.attendanceDate?fd(viewUser.attendanceDate):'—'],
                  [t('Status'),       viewUser.status||(viewUser.active?'Active':'Inactive')],
                  ['Ranking Order',   viewUser.rankingOrder||'—'],
                ].map(([l,v],i) => (
                  <div key={i}>
                    <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:2 }}>{l}</div>
                    <div style={{ fontSize:14, fontWeight:500 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              {canManageStaff && <button className="btn btn-outline-primary" onClick={() => { openEdit(viewUser); setViewUser(null); }}>✏️ {t('Edit')}</button>}
              <button className="btn btn-outline" onClick={() => setViewUser(null)}>{t('Close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ RESET PASSWORD MODAL ══════════ */}
      {resetPwdModal && (
        <div className="modal-overlay" style={{ zIndex:1100 }}>
          <div className="modal modal-sm" style={{ zIndex:1200, maxWidth:420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ color:'#6d28d9' }}>🔑 Reset Password</h2>
              <button className="modal-close" onClick={() => setResetPwdModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:13, color:'#1e40af' }}>
                Resetting password for <strong>{selectedUserIds.length}</strong> selected staff member{selectedUserIds.length > 1 ? 's' : ''}.
              </div>
              <div className="form-group" style={{ marginBottom:14 }}>
                <label className="form-label" style={{ fontWeight:600, fontSize:13 }}>New Password <span style={{ color:'#f05252' }}>*</span></label>
                <div style={{ position:'relative' }}>
                  <input
                    type={resetPwdShowPass ? 'text' : 'password'}
                    className="form-control"
                    style={{ fontSize:13, paddingRight:38 }}
                    placeholder="Enter new password"
                    value={resetPwdInput}
                    autoFocus
                    onChange={e => setResetPwdInput(e.target.value)}
                  />
                  <button type="button" onClick={() => setResetPwdShowPass(p => !p)}
                    style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', fontSize:16, padding:0, lineHeight:1 }}>
                    {resetPwdShowPass ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight:600, fontSize:13 }}>Confirm Password <span style={{ color:'#f05252' }}>*</span></label>
                <input
                  type={resetPwdShowPass ? 'text' : 'password'}
                  className="form-control"
                  style={{ fontSize:13, borderColor: resetPwdConfirm && resetPwdConfirm !== resetPwdInput ? '#f05252' : undefined }}
                  placeholder="Re-enter new password"
                  value={resetPwdConfirm}
                  onChange={e => setResetPwdConfirm(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleResetPasswords(); }}
                />
                {resetPwdConfirm && resetPwdConfirm !== resetPwdInput && (
                  <div className="form-error">Passwords do not match</div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setResetPwdModal(false)} disabled={resetPwdLoading}>{t('Cancel')}</button>
              <button
                onClick={handleResetPasswords}
                disabled={resetPwdLoading || !resetPwdInput.trim() || resetPwdInput !== resetPwdConfirm}
                style={{ background:'#6d28d9', color:'white', border:'none', borderRadius:6, padding:'8px 20px', fontSize:13, fontWeight:700, cursor: resetPwdLoading || !resetPwdInput.trim() || resetPwdInput !== resetPwdConfirm ? 'not-allowed' : 'pointer', opacity: resetPwdLoading || !resetPwdInput.trim() || resetPwdInput !== resetPwdConfirm ? 0.6 : 1 }}>
                {resetPwdLoading ? '⏳ Resetting...' : '🔑 Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ DELETE CONFIRM ══════════ */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚠️ {t('Delete Confirmation')}</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body"><p>{t('Are you sure you want to delete this record?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={async () => {
                try { await deleteEmployee(deleteConfirm); showToast(t('Record deleted successfully')); }
                catch (e) { showToast(e?.message || t('Delete failed'), 'error'); }
                setDeleteConfirm(null);
              }}>
                🗑 {t('Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            <span>{toast.type==='success'?'✅':toast.type==='info'?'ℹ️':'❌'}</span>
            {toast.msg}
          </div>
        </div>
      )}

      {/* ══ IMPORT EXCEL MODAL ══ */}
      {excelImport && (
        <ImportExcelModal
          onClose={() => setExcelImport(false)}
          onImported={async () => { await refreshEmployees(); }}
        />
      )}

      {/* ══ IMPORT DEVICE USERS MODAL ══ */}
      {importModal && (
        <ImportDeviceUsersModal
          onClose={() => setImportModal(false)}
          onDone={async () => { await refreshEmployees(); }}
        />
      )}

      {/* ══ RECO & APPROVAL MODAL ══ */}
      {recoModal && (
        <RecoApprovalModal
          employees={employees}
          onClose={() => setRecoModal(false)}
        />
      )}
    </div>
  );
};

export default UserManagement;
