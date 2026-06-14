import React, { useState, useRef, useEffect } from 'react';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import DataGrid        from '../DataGrid/DataGrid.jsx';
import useDateFormat   from '../../hooks/useDateFormat.js';
import NepaliDatePicker, { adToISO } from '../Common/NepaliDatePicker.jsx';
import ImportDeviceUsersModal from '../Common/ImportDeviceUsersModal.jsx';
import ImportExcelModal       from './ImportExcelModal.jsx';
import RecoApprovalModal from './RecoApprovalModal.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';

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

const DeviceConnTab = ({ devicePin, staffName }) => {
  const [devices,     setDevices]     = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [selDevId,    setSelDevId]    = useState('');
  const [loading,     setLoading]     = useState(false);
  const [toast,       setToast]       = useState(null);
  const [fpSlot,      setFpSlot]      = useState(0);
  const [delFpSlot,   setDelFpSlot]   = useState(0);
  const [privilege,   setPrivilege]   = useState(0);
  const [passwd,      setPasswd]      = useState('');
  const [expires,     setExpires]     = useState(false);
  const [startDate,   setStartDate]   = useState(() => new Date().toISOString().split('T')[0]);
  const [endDate,     setEndDate]     = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().split('T')[0];
  });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadEnrollments = () => {
    if (!devicePin) return;
    fetch(`/api/zkteco/device-users?pin=${encodeURIComponent(devicePin)}`)
      .then(r => r.json())
      .then(d => setEnrollments(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  useEffect(() => {
    fetch('/api/zkteco/devices')
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d) ? d : [];
        setDevices(list);
        if (list.length > 0) setSelDevId(String(list[0].id));
      })
      .catch(() => {});
    loadEnrollments();
  }, [devicePin]);

  const selDev = devices.find(d => String(d.id) === selDevId);
  const enrollment = selDev ? enrollments.find(e => e.device_sn === selDev.serial_number) : null;

  const isOnline = (dev) => {
    if (!dev?.last_seen) return false;
    return (Date.now() - new Date(dev.last_seen).getTime()) < 5 * 60 * 1000;
  };

  const post = (path, body) =>
    fetch(`/api/zkteco${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });

  const doPost = async (r) => {
    let data = {};
    try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  };

  const run = async (label, fn) => {
    if (!selDevId) { showToast('Select a device first', 'error'); return; }
    setLoading(true);
    try {
      const data = await doPost(await fn());
      showToast(data.message || `${label} queued`);
      loadEnrollments();
    } catch (e) {
      showToast(e.message || `${label} failed`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Sync user info to device THEN run enrollment command
  const runEnroll = async (label, enrollFn) => {
    if (!selDevId) { showToast('Select a device first', 'error'); return; }
    setLoading(true);
    try {
      // Always push name/privilege first so the device knows this user
      await doPost(await post(`/devices/${selDevId}/upload-user`, {
        pin: devicePin, name: staffName, privilege,
        card: enrollment?.card_no || '',
        expires: expires ? 1 : 0,
        startDatetime: startDate + ' 00:00:00',
        endDatetime:   endDate   + ' 23:59:00',
      }));
      // Then send the enrollment command
      await doPost(await enrollFn());
      showToast(`${label} queued — name synced to device`);
      loadEnrollments();
    } catch (e) {
      showToast(e.message || `${label} failed`, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!devicePin) {
    return (
      <div className="empty-state" style={{ padding:'40px 0' }}>
        <div className="empty-state-icon">🔗</div>
        <h3>No Device PIN</h3>
        <p>Set an Attendance Device ID on the Staff Detail tab first.</p>
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
      {/* Toast */}
      {toast && (
        <div style={{ padding:'10px 14px', borderRadius:8, fontSize:13, fontWeight:600,
          background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${toast.type === 'error' ? '#fca5a5' : '#86efac'}`,
          color: toast.type === 'error' ? '#dc2626' : '#16a34a' }}>
          {toast.type === 'error' ? '⚠️' : '✅'} {toast.msg}
        </div>
      )}

      {/* PIN + Name info */}
      <div style={{ display:'flex', gap:12, background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 14px', fontSize:13 }}>
        <div><span style={{ color:'#6b7280', fontWeight:600 }}>Device PIN: </span><span style={{ fontWeight:700, fontFamily:'monospace', color:'#1a56db' }}>{devicePin}</span></div>
        <div style={{ borderLeft:'1px solid #e5e7eb', paddingLeft:12 }}><span style={{ color:'#6b7280', fontWeight:600 }}>Staff: </span><span style={{ fontWeight:700 }}>{staffName || '—'}</span></div>
      </div>

      {/* Device cards — show all devices with online + enrollment status */}
      {devices.length > 0 && (
        <div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
            <span style={s.label}>Select Target Device</span>
            <button style={{ ...outlineBtn, height:28, fontSize:12, padding:'0 10px' }} onClick={loadEnrollments}>↺ Refresh</button>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {devices.map(d => {
              const online  = isOnline(d);
              const enr     = enrollments.find(en => en.device_sn === d.serial_number);
              const isSelected = String(d.id) === selDevId;
              return (
                <div key={d.id} onClick={() => setSelDevId(String(d.id))}
                  style={{ padding:'8px 12px', borderRadius:10, cursor:'pointer', minWidth:160,
                    border: isSelected ? '2px solid #1a56db' : '2px solid #e5e7eb',
                    background: isSelected ? '#eff6ff' : 'white',
                    boxShadow: isSelected ? '0 2px 8px rgba(26,86,219,.12)' : 'none',
                    transition:'all .15s' }}>
                  <div style={{ fontWeight:700, fontSize:13, color: isSelected ? '#1a56db' : '#1f2937', marginBottom:5 }}>
                    {d.name || d.serial_number}
                  </div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    <span style={{ fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:10,
                      background: online ? '#d1fae5' : '#f3f4f6',
                      color:      online ? '#065f46' : '#6b7280',
                      border:     `1px solid ${online ? '#6ee7b7' : '#e5e7eb'}` }}>
                      {online ? '● Online' : '○ Offline'}
                    </span>
                    <span style={{ fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:10,
                      background: enr ? '#eff6ff' : '#fff7ed',
                      color:      enr ? '#1d4ed8' : '#9a3412',
                      border:     `1px solid ${enr ? '#bfdbfe' : '#fed7aa'}` }}>
                      {enr ? 'Enrolled' : 'Not Enrolled'}
                    </span>
                    {enr && enr.fp_slots_count > 0 && (
                      <span style={{ fontSize:11, padding:'2px 7px', borderRadius:10,
                        background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb' }}>
                        {enr.fp_slots_count} FP
                      </span>
                    )}
                    {enr?.card_no && (
                      <span style={{ fontSize:11, padding:'2px 7px', borderRadius:10,
                        background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb' }}>
                        Card
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action sections grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>

        {/* ENROLL section */}
        <Panel title="Enroll">
          <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
              <div style={{ flex:1 }}>
                <span style={s.label}>Fingerprint Slot</span>
                <select value={fpSlot} onChange={e => setFpSlot(+e.target.value)} style={selectStyle}>
                  {FINGER_LABELS.map((l,i) => {
                    const has = enrollment?.fp_slots?.some(f => f.fid === i);
                    return <option key={i} value={i}>{i}: {l}{has ? ' ✓' : ''}</option>;
                  })}
                </select>
              </div>
              <button style={btn()} disabled={loading}
                onClick={() => runEnroll('Enroll FP', () => post(`/devices/${selDevId}/enroll-fp`, { pin:devicePin, name:staffName, fingerId:fpSlot }))}>
                Enroll FP
              </button>
            </div>
            <button style={{ ...btn('#7c3aed'), width:'100%' }} disabled={loading}
              onClick={() => runEnroll('Enroll Face', () => post(`/devices/${selDevId}/enroll-face`, { pin:devicePin, name:staffName }))}>
              Enroll Face
            </button>
            <button style={{ ...btn('#0891b2'), width:'100%' }} disabled={loading}
              onClick={() => runEnroll('Enroll Card', () => post(`/devices/${selDevId}/enroll-card`, { pin:devicePin }))}>
              Enroll Card
            </button>
          </div>
        </Panel>

        {/* MANAGE section */}
        <Panel title="Manage Access">
          <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
              <div style={{ flex:1 }}>
                <span style={s.label}>Privilege</span>
                <select value={privilege} onChange={e => setPrivilege(+e.target.value)} style={selectStyle}>
                  {PRIV_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <button style={btn()} disabled={loading}
                onClick={() => run('Set Privilege', () => post(`/devices/${selDevId}/upload-user`, {
                  pin:devicePin, name:staffName, privilege,
                  expires: expires ? 1 : 0, startDatetime: startDate+' 00:00:00', endDatetime: endDate+' 23:59:00',
                }))}>
                Set
              </button>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
              <div style={{ flex:1 }}>
                <span style={s.label}>Device Password</span>
                <input type="text" value={passwd} onChange={e => setPasswd(e.target.value)}
                  placeholder="Leave blank to keep current" style={inputStyle} />
              </div>
              <button style={btn()} disabled={loading}
                onClick={() => run('Set Password', () => post(`/devices/${selDevId}/upload-user`, {
                  pin:devicePin, name:staffName, privilege,
                  card: enrollment?.card_no || '', passwd,
                  expires: expires ? 1 : 0, startDatetime: startDate+' 00:00:00', endDatetime: endDate+' 23:59:00',
                }))}>
                Set
              </button>
            </div>
          </div>
        </Panel>
      </div>

      {/* VALIDITY section */}
      <Panel title="Validity / Expiry">
        <div style={{ padding:'14px' }}>
          {/* Toggle row */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: expires ? 14 : 0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div onClick={() => setExpires(p => !p)}
                style={{ width:40, height:22, borderRadius:11, background: expires ? '#059669' : '#d1d5db',
                  position:'relative', cursor:'pointer', transition:'background .2s', flexShrink:0 }}>
                <div style={{ position:'absolute', top:3, left: expires ? 21 : 3, width:16, height:16,
                  borderRadius:'50%', background:'white', transition:'left .2s',
                  boxShadow:'0 1px 3px rgba(0,0,0,.25)' }} />
              </div>
              <span style={{ fontSize:13, fontWeight:600, color: expires ? '#059669' : '#6b7280' }}>
                {expires ? 'Expiry Enabled' : 'Enable Expiry'}
              </span>
            </div>
            {expires && (
              <div style={{ display:'flex', gap:5 }}>
                {[['1M',1],['3M',3],['6M',6],['1Y',12]].map(([lbl,mo]) => (
                  <button key={lbl} onClick={() => {
                    const s = new Date(); const e = new Date();
                    e.setMonth(e.getMonth() + mo);
                    setStartDate(s.toISOString().split('T')[0]);
                    setEndDate(e.toISOString().split('T')[0]);
                  }} style={{ padding:'3px 9px', fontSize:11, fontWeight:700,
                    background:'#eff6ff', color:'#1d4ed8', border:'1px solid #bfdbfe',
                    borderRadius:5, cursor:'pointer' }}>{lbl}</button>
                ))}
              </div>
            )}
          </div>

          {expires && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              <div>
                <span style={{ fontSize:11, fontWeight:700, color:'#6b7280', letterSpacing:'.4px',
                  textTransform:'uppercase', display:'block', marginBottom:5 }}>From Date</span>
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
                  textTransform:'uppercase', display:'block', marginBottom:5 }}>To Date</span>
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
          )}

          <button style={{ width:'100%', height:38, borderRadius:8, border:'none', fontSize:13,
            fontWeight:700, cursor: loading ? 'not-allowed' : 'pointer', transition:'opacity .15s',
            background: expires ? '#059669' : '#6b7280', color:'white', opacity: loading ? 0.7 : 1 }}
            disabled={loading}
            onClick={() => run(expires ? 'Apply Validity' : 'Remove Expiry', () => post(`/devices/${selDevId}/upload-user`, {
              pin:devicePin, name:staffName, privilege,
              card: enrollment?.card_no || '',
              expires: expires ? 1 : 0,
              startDatetime: startDate + ' 00:00:00',
              endDatetime:   endDate   + ' 23:59:00',
            }))}>
            {expires ? '✅ Apply Validity' : '🚫 Remove Expiry'}
          </button>

          {!expires && (
            <div style={{ fontSize:11, color:'#9ca3af', marginTop:8, textAlign:'center' }}>
              Toggle on to restrict device access to a date range
            </div>
          )}
        </div>
      </Panel>

      {/* DELETE section */}
      <Panel title="Delete Operations">
        <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
            <div style={{ flex:1 }}>
              <span style={s.label}>Delete Fingerprint Slot</span>
              <select value={delFpSlot} onChange={e => setDelFpSlot(+e.target.value)} style={selectStyle}>
                {FINGER_LABELS.map((l,i) => {
                  const hasFp = enrollment?.fp_slots?.some(f => f.fid === i);
                  return <option key={i} value={i}>{i}: {l}{hasFp ? ' ✅' : ''}</option>;
                })}
              </select>
            </div>
            <button style={dangerBtn} disabled={loading}
              onClick={() => {
                if (!window.confirm(`Delete FP slot ${delFpSlot} (${FINGER_LABELS[delFpSlot]}) for PIN ${devicePin}?`)) return;
                run('Delete FP Slot', () => post(`/devices/${selDevId}/delete-fp-slot`, { pin:devicePin, fid:delFpSlot }));
              }}>
              Delete FP
            </button>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={{ ...dangerBtn, flex:1 }} disabled={loading}
              onClick={() => {
                if (!window.confirm(`Remove card for PIN ${devicePin}? This clears the card number.`)) return;
                run('Remove Card', () => post(`/devices/${selDevId}/upload-user`, {
                  pin:devicePin, name:staffName, privilege, card:'',
                  expires: expires ? 1 : 0, startDatetime: startDate+' 00:00:00', endDatetime: endDate+' 23:59:00',
                }));
              }}>
              Remove Card
            </button>
            <button style={{ ...dangerBtn, flex:1 }} disabled={loading}
              onClick={() => {
                if (!window.confirm(`DELETE user PIN ${devicePin} from device "${selDev?.name || selDevId}"?\nThis removes them from the device — eHajiri data is unaffected.`)) return;
                run('Delete from Device', () => post(`/devices/${selDevId}/delete-user`, { pin:devicePin }));
              }}>
              Delete from Device
            </button>
          </div>
        </div>
      </Panel>
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
  const [advFilters, setAdvFilters] = useState({
    q: '',
    branches: [], departments: [], positions: [], grades: [],
    modes: [], genders: [], timingTypes: [], religions: [],
    handicapped: '', eligibleForOt: '', statuses: [], roles: [],
  });

  const showToast = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
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
    const today = new Date().toISOString().split('T')[0];
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
    setForm({ ...defaultForm, ...buildDefaults(), employeeId:`EMP${String(employees.length+1).padStart(3,'0')}` });
    setErrors({}); setEditId(null); setActiveTab('Staff Detail'); setModal(true);
  };


  const openEdit = (u) => {
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
    setErrors({}); setEditId(u.id); setActiveTab('Staff Detail'); setModal(true);
  };

  const handleSave = async () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

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
        setLicLimitAlert({ max, msg: e.message });
      } else {
        showToast(e?.message || t('Save failed'), 'error');
      }
    }
  };

  const handleBulkDelete = (ids) => {
    ids.forEach(id => deleteEmployee(id));
    showToast(`${ids.length} ${t('records deleted successfully')}`);
  };

  const openResetPwd = () => {
    setResetPwdInput(''); setResetPwdConfirm(''); setResetPwdShowPass(false);
    setResetPwdModal(true);
  };

  const resetToDefault = async (row) => {
    if (!window.confirm(`Reset login password for "${row.fullName}" to default (123456)?`)) return;
    try {
      const res = await fetch(`/api/employees/${row.id}/reset-password`, {
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
        fetch(`/api/employees/${id}/reset-password`, {
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

  /* ── Print ── */
  const handlePrint = () => {
    const rows = employees.map((e, i) => `
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
      <p style="color:#6b7280;font-size:11px">Total: ${employees.length} staff | Printed: ${new Date().toLocaleDateString()}</p>
      <table><thead><tr><th>SN</th><th>Staff ID</th><th>Full Name</th><th>Device ID</th>
      <th>Post</th><th>Department</th><th>Branch</th><th>Mobile</th><th>Email</th><th>Mode</th><th>Join Date</th>
      </tr></thead><tbody>${rows}</tbody></table></body></html>`);
    win.document.close(); win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  /* ── Export CSV ── */
  const handleExport = () => {
    const h = ['SN','Staff ID','Full Name','Device ID','Post','Department','Branch','Mobile','Email','Mode','Join Date'];
    const rows = employees.map((e,i) => [
      i+1, e.employeeId, e.fullName, e.deviceId||'',
      e.position||'', e.department||'', e.branch||'',
      e.phone||'', e.email||'', e.mode||'', e.joinDate||'',
    ]);
    const csv = [h,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=`staff_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  /* ── Scope: filter employees to what this user is allowed to see ── */
  const scopedEmployees = filterByRole(employees);

  /* ── Sort employees by rankingOrder (nulls last) ── */
  const sortedEmployees = [...scopedEmployees].sort((a, b) => {
    const ra = a.rankingOrder > 0 ? a.rankingOrder : Infinity;
    const rb = b.rankingOrder > 0 ? b.rankingOrder : Infinity;
    return ra - rb;
  });

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
      render:v=><span style={{fontFamily:'monospace',fontSize:14,background:'#f3f4f6',padding:'2px 6px',borderRadius:4}}>{v}</span> },
    { field:'fullName',   header:'Full Name',  width:160,
      render:v=><span style={{fontWeight:500}}>{v}</span> },
    { field:'deviceId',   header:'Device ID',  width:90,
      render:v=>v?<span style={{fontFamily:'monospace',fontSize:14,color:'#0369a1'}}>{v}</span>:<span style={{color:'#d1d5db'}}>—</span> },
    { field:'position',   header:'Post',       width:140,
      render:v=>v||<span style={{color:'#d1d5db'}}>—</span> },
    { field:'department', header:'Department', width:120,
      render:v=>v||<span style={{color:'#d1d5db'}}>—</span> },
    { field:'branch',     header:'Branch',     width:110,
      render:v=>v||<span style={{color:'#d1d5db'}}>—</span> },
    { field:'phone',      header:'Mobile',     width:110,
      render:v=>v||<span style={{color:'#d1d5db'}}>—</span> },
    { field:'email',      header:'Email',      width:190,
      render:v=>v?<span style={{color:'#1a56db',fontSize:14}}>{v}</span>:<span style={{color:'#d1d5db'}}>—</span> },
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
      <div className="page-header">
        <div>
          <h1 className="page-title">👥 Staff Detail</h1>
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
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {/* Advanced Search — opens popup modal */}
          <button onClick={() => setShowAdvSearch(true)} style={{
            display:'inline-flex', alignItems:'center', gap:5, padding:'6px 13px', height:34,
            background: activeFilterCount > 0 ? '#eff6ff' : '#f8fafc',
            border: `1px solid ${activeFilterCount > 0 ? '#1a56db' : '#d1d5db'}`,
            color: activeFilterCount > 0 ? '#1a56db' : '#374151',
            borderRadius:6, fontSize:13, fontWeight:600, cursor:'pointer', position:'relative',
          }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
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
          <button onClick={handleExport} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'6px 13px', height:34, background:'#f0fdf4', border:'1px solid #86efac', color:'#15803d', borderRadius:6, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
            Export
          </button>
          <button onClick={handlePrint} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'6px 13px', height:34, background:'#eff6ff', border:'1px solid #93c5fd', color:'#1d4ed8', borderRadius:6, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9h8v3H6v-3zm8-4a1 1 0 110 2 1 1 0 010-2z" clipRule="evenodd"/></svg>
            Print
          </button>
          {canManageStaff && (
            <button
              onClick={() => setImportModal(true)}
              style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px', height:34,
                background:'linear-gradient(135deg,#059669,#047857)', border:'none',
                color:'white', borderRadius:6, fontSize:13, fontWeight:700, cursor:'pointer',
                boxShadow:'0 1px 4px rgba(5,150,105,.3)' }}
            >
              📥 Import Device Users
            </button>
          )}
          {canManageStaff && (
            <button className="btn btn-primary" onClick={openAdd}>+ {t('Add New Staff')}</button>
          )}
        </div>
      </div>

      {/* ── Advanced Search Modal Popup ── */}
      {showAdvSearch && (() => {
        /* ── Multi-checkbox select dropdown ── */
        const MCS = ({ label, value, onChange, options }) => {
          const [open, setOpen] = React.useState(false);
          const [srch, setSrch] = React.useState('');
          const ref  = React.useRef(null);
          React.useEffect(() => {
            const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
            document.addEventListener('mousedown', h);
            return () => document.removeEventListener('mousedown', h);
          }, []);
          const filtered = srch ? options.filter(o => o.toLowerCase().includes(srch.toLowerCase())) : options;
          const toggle   = v  => onChange(value.includes(v) ? value.filter(x=>x!==v) : [...value, v]);
          const selLabel = value.length === 0 ? 'All'
            : value.length === 1 ? value[0]
            : `${value.length} selected`;

          return (
            <div ref={ref} style={{ position:'relative' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#1f2937', marginBottom:5 }}>{label}</div>
              <div
                tabIndex={0}
                onKeyDown={e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setOpen(p=>!p); } if (e.key==='Escape') setOpen(false); }}
                onClick={() => setOpen(p=>!p)}
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
                      onKeyDown={e=>e.stopPropagation()}
                      style={{ width:'100%', border:'1px solid #d1d5db', borderRadius:5, padding:'5px 8px',
                        fontSize:12, outline:'none', boxSizing:'border-box' }} />
                  </div>
                  <div style={{ overflowY:'auto', flex:1 }}>
                    {/* "All" row */}
                    <div onMouseDown={e=>{e.preventDefault(); onChange([]);}}
                      style={{ padding:'8px 11px', display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                        background: value.length===0 ? '#eff6ff' : 'white', borderBottom:'1px solid #f1f5f9' }}>
                      <span style={{ width:14, height:14, borderRadius:3, flexShrink:0, border:`2px solid ${value.length===0?'#1a56db':'#d1d5db'}`,
                        background:value.length===0?'#1a56db':'white', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {value.length===0 && <svg viewBox="0 0 12 12" fill="none" width="9" height="9"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                      </span>
                      <span style={{ fontSize:13, fontWeight:600, color: value.length===0?'#1e40af':'#374151' }}>All</span>
                    </div>
                    {filtered.map(opt => {
                      const sel = value.includes(opt);
                      return (
                        <div key={opt} onMouseDown={e=>{e.preventDefault(); toggle(opt);}}
                          style={{ padding:'8px 11px', display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                            background: sel ? '#eff6ff' : 'white', borderBottom:'1px solid #f9fafb' }}
                          onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='#f8fafc'; }}
                          onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='white'; }}>
                          <span style={{ width:14, height:14, borderRadius:3, flexShrink:0, border:`2px solid ${sel?'#1a56db':'#d1d5db'}`,
                            background: sel?'#1a56db':'white', display:'flex', alignItems:'center', justifyContent:'center' }}>
                            {sel && <svg viewBox="0 0 12 12" fill="none" width="9" height="9"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                          </span>
                          <span style={{ fontSize:13, color: sel?'#1e40af':'#374151', fontWeight: sel?600:400 }}>{opt}</span>
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
                background:'linear-gradient(135deg,#eff6ff,#f0f9ff)', flexShrink:0 }}>
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
        defaultPageSize={10}
        showSearch={true}
        showFilterButton={false}
        searchPlaceholder={t('Search')+'...'}
        compact={true}
        onRowDoubleClick={canManageStaff ? openEdit : undefined}
        onDeleteKey={canManageStaff ? (row) => setDeleteConfirm(row.id) : null}
        contextMenu={canManageStaff ? [
          { label: 'Add New Staff',         icon: '➕', onClick: () => openAdd() },
          'divider',
          { label: 'Edit',                  icon: '✏️', onClick: (row) => openEdit(row) },
          { label: 'Enroll Device',         icon: '📲', onClick: (row) => { openEdit(row); setTimeout(() => setActiveTab('Device Connectivity'), 50); } },
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
        toolbarLeft={
          canManageStaff && (
            <button
              onClick={() => setExcelImport(true)}
              style={{
                display:'inline-flex', alignItems:'center', gap:6,
                padding:'5px 13px', height:32,
                background:'#f0fdf4', border:'1px solid #86efac',
                color:'#15803d', borderRadius:6, fontSize:13, fontWeight:600, cursor:'pointer',
                whiteSpace:'nowrap',
              }}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 9.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 8.414V13a1 1 0 11-2 0V8.414L7.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
              </svg>
              Import Excel
            </button>
          )
        }
        toolbar={
          canManageStaff && (
            <button onClick={() => setRecoModal(true)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', height: 34,
              background: '#f8fafc',
              border: '1px solid #e2e8f0', color: '#1e293b', borderRadius: 6,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}>
              👥 Set Recommendator &amp; Approval
            </button>
          )
        }
      />

      {/* ══════════ ADD / EDIT MODAL ══════════ */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:1100 }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="modal-header">
              <h2>{editId ? `✏️ ${t('Edit Staff')}` : `+ ${t('Add Staff Management')}`}</h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>

            {/* Tab bar */}
            <div style={{ display:'flex', borderBottom:'1px solid var(--border)', padding:'0 20px', background:'#fafbfc' }}>
              {MODAL_TABS.map(tab => (
                <button key={tab} className={`tab-btn ${activeTab===tab?'active':''}`} onClick={() => setActiveTab(tab)}>
                  {tab}
                </button>
              ))}
            </div>

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
                      <div className="form-hint">Staff are listed in this order in the table</div>
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
                    <DeviceConnTab devicePin={form.deviceId} staffName={form.fullName} />
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
              {activeTab !== 'Device Connectivity' && (
                <button className="btn btn-primary" onClick={handleSave}>💾 {t('Save')}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════ QUICK ADD MODAL ══════════ */}
      {qaModal && (
        <div className="modal-overlay" style={{ zIndex:1100 }}>
          <div className="modal modal-sm" style={{ zIndex:1200, maxWidth:400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
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
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#fff7ed,#fef3c7)' }}>
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
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#fef2f2,#fee2e2)' }}>
              <h2 style={{ color:'#991b1b' }}>🔒 License Limit Reached</h2>
              <button className="modal-close" onClick={() => setLicLimitAlert(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ textAlign:'center', padding:'24px 28px' }}>
              <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#991b1b', marginBottom:8 }}>
                Staff Limit Reached
              </div>
              <div style={{ fontSize:14, color:'#374151', marginBottom:16, lineHeight:1.6 }}>
                Your license allows only <strong>{licLimitAlert.max} staff members</strong>.<br/>
                To add more staff, please upgrade your license.
              </div>
              <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:10, padding:'12px 16px', fontSize:13, color:'#92400e' }}>
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
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#f5f3ff,#ede9fe)' }}>
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
              <button className="btn btn-danger" onClick={() => { deleteEmployee(deleteConfirm); showToast(t('Record deleted successfully')); setDeleteConfirm(null); }}>
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
