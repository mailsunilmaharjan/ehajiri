import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';

/* ═══ constants ══════════════════════════════════════════════ */
const PRIV_LABELS   = { 0:'User',1:'Enroller',2:'Manager',6:'Admin',14:'Super Admin' };
const VERIFY_LABELS = { 0:'Password/FP',1:'Fingerprint',2:'Password',3:'Card',15:'Face' };
const INOUT_LABELS  = { 0:'Check In',1:'Check Out',2:'Break Out',3:'Break In',4:'OT In',5:'OT Out' };
const FINGER_LABELS = ['Right Pinky','Right Ring','Right Middle','Right Index','Right Thumb',
                       'Left Thumb','Left Index','Left Middle','Left Ring','Left Pinky'];

const WEEK_DAYS = [
  { key:'Sun', np:'आइतबार',  en:'Sunday'    },
  { key:'Mon', np:'सोमबार',   en:'Monday'    },
  { key:'Tue', np:'मंगलबार',  en:'Tuesday'   },
  { key:'Wed', np:'बुधबार',   en:'Wednesday' },
  { key:'Thu', np:'बिहिबार',  en:'Thursday'  },
  { key:'Fri', np:'शुक्रबार',  en:'Friday'    },
  { key:'Sat', np:'शनिबार',   en:'Saturday'  },
];
const defaultWeekSchedule = () => Object.fromEntries(WEEK_DAYS.map(d => [d.key, [{ s:'00:00', e:'23:59', closed:false }]]));

// Known IZKEM methods not exposed as dedicated endpoints — offered as autocomplete
// for the generic "Send Command" control (the long tail of the SDK's ~40 methods).
const KNOWN_COMMANDS = [
  'WriteLCD', 'ClearLCD', 'PlayVoice', 'PlayVoiceByIndex',
  'SetWorkCode', 'GetWorkCode', 'DeleteWorkCode', 'ClearWorkCode',
  'SetDaylight', 'GetDaylight', 'SetHoliday', 'GetHoliday',
  'SetDeviceCommPwd', 'SetDeviceIP', 'SetDeviceMAC', 'GetSysOption', 'SetSysOption',
  'GetDeviceStatus', 'GetDeviceInfo', 'SetDeviceInfo', 'QueryState',
];

const emptyDevice = { name:'', ipAddress:'', port:4370, commPassword:'', model:'', location:'' };

/* ═══ tiny atoms (mirrors ZKTecoDeviceSettings.jsx conventions) ═══ */
const Badge = ({ children, color='#1a56db', bg='#eff6ff', border='#bfdbfe' }) => (
  <span style={{ background:bg, color, border:`1px solid ${border}`, borderRadius:10,
    padding:'2px 9px', fontSize:11, fontWeight:700, display:'inline-block' }}>
    {children}
  </span>
);

const ConnectionDot = ({ status }) => {
  const map = {
    connected:    { color:'#10b981', bg:'#d1fae5', label:'Connected'    },
    disconnected: { color:'#9ca3af', bg:'none',    label:'Disconnected' },
    error:        { color:'#ef4444', bg:'#fee2e2', label:'Error'        },
  };
  const s = map[status] || map.disconnected;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <span style={{ width:8, height:8, borderRadius:'50%', flexShrink:0, background:s.color,
        boxShadow: s.bg !== 'none' ? `0 0 0 2px ${s.bg}` : 'none' }} />
      <span style={{ fontSize:11, color:'#6b7280' }}>{s.label}</span>
    </div>
  );
};

const ActionBtn = ({ icon, label, color='#1a56db', bg='#eff6ff', border='#bfdbfe',
  onClick, loading=false, disabled=false, danger=false }) => (
  <button
    disabled={disabled || loading}
    onClick={onClick}
    style={{
      display:'flex', alignItems:'center', gap:6,
      background: danger ? '#fef2f2' : bg,
      color:      danger ? '#ef4444' : color,
      border:`1px solid ${danger ? '#fca5a5' : border}`,
      borderRadius:8, padding:'8px 14px', fontSize:13, fontWeight:600,
      cursor: disabled||loading ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      whiteSpace:'nowrap',
    }}
  >
    <span style={{ fontSize:16 }}>{loading ? '⏳' : icon}</span>
    {label}
  </button>
);

/* ═══════════════════════════════════════════════════════════
   Device Control Modal — Device Info + Data Operations groups,
   plus an always-visible generic "Send Command" section for the
   long tail of SDK methods that don't have dedicated buttons.
═══════════════════════════════════════════════════════════ */
const DeviceControlModal = ({ device, allDevices, onClose, showToast, onRefresh }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const id = device.id;

  const [group, setGroup]   = useState('info');
  const [busy,  setBusy]    = useState({});
  const [result, setResult] = useState(null);
  const [cloneTarget, setCloneTarget] = useState('');

  // USB import — fallback for devices with no usable network/SDK connection
  const [usbFile, setUsbFile] = useState(null);
  const [usbResult, setUsbResult] = useState(null);
  const usbInputRef = useRef(null);

  // Send Command panel state
  const [cmdMethod, setCmdMethod] = useState('');
  const [cmdArgs,   setCmdArgs]   = useState('[]');
  const [cmdResult, setCmdResult] = useState(null);

  const run = async (key, fn, successMsg) => {
    setBusy(b => ({ ...b, [key]: true }));
    try {
      const r = await fn();
      setResult({ ok:true, key, data:r });
      showToast?.(successMsg || '✅ Done', 'success');
      if (r?.warning) showToast?.(`⚠️ ${r.warning}`, 'error');
      onRefresh?.();
    } catch (err) {
      setResult({ ok:false, key, error: err.message });
      showToast?.(`❌ ${err.message}`, 'error');
    } finally {
      setBusy(b => ({ ...b, [key]: false }));
    }
  };

  const sendCommand = async () => {
    setBusy(b => ({ ...b, command:true }));
    try {
      const args = cmdArgs.trim() ? JSON.parse(cmdArgs) : [];
      const r = await api.post(`/standalone/devices/${id}/command`, { method: cmdMethod, args });
      setCmdResult({ ok:true, data:r });
    } catch (err) {
      setCmdResult({ ok:false, error: err.message });
    } finally {
      setBusy(b => ({ ...b, command:false }));
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth:600, maxHeight:'92vh', overflowY:'auto' }}
           onClick={e => e.stopPropagation()}>

        <div className="modal-header"
          style={{ background:'linear-gradient(135deg,#eff6ff,#dbeafe)', position:'sticky', top:0, zIndex:10 }}>
          <div>
            <h2 style={{ color:'#1e40af', margin:0 }}>🖥️ {L('डिभाइस नियन्त्रण','Device Control')} — {device.name}</h2>
            <div style={{ fontSize:11, color:'#6b7280', marginTop:2 }}>
              {device.ip_address}:{device.port} &nbsp;·&nbsp; <ConnectionDot status={device.connection_status} />
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ padding:'12px 14px' }}>

          {/* Group tabs */}
          <div style={{ display:'flex', gap:0, marginBottom:14, border:'1px solid #e5e7eb',
            borderRadius:8, overflow:'hidden' }}>
            {[
              { key:'info', icon:'📊', label:L('डिभाइस जानकारी','Device Info') },
              { key:'data', icon:'📋', label:L('डाटा सञ्चालन','Data Operations') },
            ].map(({ key, icon, label }) => (
              <button key={key} onClick={() => setGroup(key)}
                style={{ flex:1, padding:'9px 6px', border:'none', cursor:'pointer',
                  fontSize:12, fontWeight:700, textAlign:'center',
                  background: group === key ? '#1a56db' : 'white',
                  color:      group === key ? 'white'   : '#6b7280',
                  borderRight: key === 'info' ? '1px solid #e5e7eb' : 'none' }}>
                <span style={{ fontSize:14, display:'block' }}>{icon}</span>
                {label}
              </button>
            ))}
          </div>

          {group === 'info' && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:14 }}>
              <ActionBtn icon="🔌" label="Connect" loading={busy.connect}
                onClick={() => run('connect', () => api.post(`/standalone/devices/${id}/connect`), '✅ Connected')} />
              <ActionBtn icon="🔴" label="Disconnect" loading={busy.disconnect} color="#6b7280" bg="#f3f4f6" border="#e5e7eb"
                onClick={() => run('disconnect', () => api.post(`/standalone/devices/${id}/disconnect`), '✅ Disconnected')} />
              <ActionBtn icon="ℹ️" label="Get Info" loading={busy.info}
                onClick={() => run('info', () => api.post(`/standalone/devices/${id}/sync-info`), '✅ Device info synced')} />
              <ActionBtn icon="⏰" label="Sync Time to Now" loading={busy.time}
                onClick={() => run('time', () => api.post(`/standalone/devices/${id}/time`, {}), '✅ Time synced')} />
              <ActionBtn icon="✅" label="Enable" loading={busy.enable} color="#059669" bg="#d1fae5" border="#6ee7b7"
                onClick={() => run('enable', () => api.post(`/standalone/devices/${id}/enable`), '✅ Device enabled')} />
              <ActionBtn icon="⛔" label="Disable" loading={busy.disable} color="#92400e" bg="#fef3c7" border="#fcd34d"
                onClick={() => run('disable', () => api.post(`/standalone/devices/${id}/disable`), '✅ Device disabled')} />
              <ActionBtn icon="🔄" label="Restart" loading={busy.restart} danger
                onClick={() => window.confirm('Restart this device?') && run('restart', () => api.post(`/standalone/devices/${id}/restart`), '✅ Restart sent')} />
              <ActionBtn icon="🔌" label="Power Off" loading={busy.poweroff} danger
                onClick={() => window.confirm('Power off this device?') && run('poweroff', () => api.post(`/standalone/devices/${id}/poweroff`), '✅ Power-off sent')} />
              <ActionBtn icon="🧹" label="Clear Admin Privileges" loading={busy.clearAdmin} danger
                onClick={() => window.confirm('Clear administrator privileges on this device? Admin users remain but lose admin rights.')
                  && run('clearAdmin', () => api.post(`/standalone/devices/${id}/clear-admin`), '✅ Admin privileges cleared')} />
            </div>
          )}

          {group === 'data' && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:14 }}>
              <ActionBtn icon="📥" label="Fetch Attendance Logs" loading={busy.logs}
                onClick={() => run('logs', () => api.post(`/standalone/devices/${id}/logs/fetch`), '✅ Logs fetched into Attendance')} />
              <ActionBtn icon="🗑" label="Clear Device Logs" loading={busy.clearLogs} danger
                onClick={() => window.confirm('Clear all attendance logs on the DEVICE? (eHajiri history is kept)')
                  && run('clearLogs', () => api.delete(`/standalone/devices/${id}/logs`), '✅ Device logs cleared')} />
              <ActionBtn icon="🧹" label="Clear eHajiri Log History" loading={busy.clearHistory} danger
                onClick={() => window.confirm(`Permanently delete all stored attendance logs for "${device.serial_number}" from eHajiri? (the device itself is untouched)`)
                  && run('clearHistory', () => api.delete(`/zkteco/logs?sn=${encodeURIComponent(device.serial_number)}`), '✅ Log history cleared')} />
              <ActionBtn icon="👥" label="Fetch Users (PIN/Name)" loading={busy.users}
                onClick={() => run('users', () => api.post(`/standalone/devices/${id}/users/fetch`), '✅ Users fetched')} />
              <ActionBtn icon="🖐️" label="Backup Fingerprints + Face" loading={busy.biometrics}
                onClick={() => run('biometrics', () => api.post(`/standalone/devices/${id}/biometrics/fetch-all`), '✅ Biometric templates backed up')} />
              <ActionBtn icon="💾" label="Backup Device (full)" loading={busy.backup}
                onClick={() => run('backup', () => api.post(`/standalone/devices/${id}/backup`), '✅ Device backup saved')} />
              <ActionBtn icon="🔃" label="Refresh Data" loading={busy.refresh}
                onClick={() => run('refresh', () => api.post(`/standalone/devices/${id}/refresh`), '✅ Refreshed')} />
              <ActionBtn icon="🗑" label="Delete ALL Users on Device" loading={busy.clearAllUsers} danger
                onClick={() => window.confirm('Delete EVERY user, fingerprint and face template on this device? This cannot be undone.')
                  && run('clearAllUsers', () => api.post(`/standalone/devices/${id}/users/clear-all`), '✅ All users deleted from device')} />
            </div>
          )}

          {group === 'data' && (
            <div style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:'10px 14px', marginBottom:14,
              display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <span style={{ fontSize:12, fontWeight:700, color:'#374151' }}>📋 {L('अर्को डिभाइसमा कपी गर्नुहोस्','Copy users + biometrics to another device')}:</span>
              <select className="form-control" style={{ width:'auto', flex:1, minWidth:160 }} value={cloneTarget}
                onChange={e => setCloneTarget(e.target.value)}>
                <option value="">{L('लक्षित डिभाइस छान्नुहोस्','Select target device')}</option>
                {(allDevices || []).filter(d => d.id !== id).map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.ip_address}:{d.port})</option>
                ))}
              </select>
              <ActionBtn icon="📤" label="Copy" loading={busy.clone} disabled={!cloneTarget}
                onClick={() => window.confirm(`Copy all users + backed-up fingerprint/face templates from "${device.name}" onto the selected device?`)
                  && run('clone', () => api.post(`/standalone/devices/${cloneTarget}/clone-from/${id}`), '✅ Clone complete')} />
            </div>
          )}

          {group === 'data' && (
            <div style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:'10px 14px', marginBottom:14 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:8 }}>
                📁 {L('USB बाट अपलोड गर्नुहोस्','Upload from USB')}
                <span style={{ fontWeight:400, color:'#9ca3af', marginLeft:6 }}>
                  ({L('नेटवर्क/SDK जडान नभएको डिभाइसका लागि','for devices with no usable network/SDK connection')})
                </span>
              </div>
              <input ref={usbInputRef} type="file" accept=".dat,.txt,.csv,.log" style={{ display:'none' }}
                onChange={e => {
                  const f = e.target.files?.[0]; if (!f) return;
                  const r = new FileReader();
                  r.onload = ev => setUsbFile({ name: f.name, content: ev.target.result });
                  r.readAsText(f, 'utf-8');
                }} />
              {!usbFile ? (
                <button onClick={() => usbInputRef.current?.click()}
                  style={{ width:'100%', padding:'10px', background:'white', border:'2px dashed #93c5fd',
                    borderRadius:8, color:'#0369a1', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  📁 {L('USB ड्राइवबाट .dat फाइल छान्नुहोस्','Choose .dat file from USB drive')}
                </button>
              ) : (
                <div>
                  <div style={{ background:'#1f2937', borderRadius:6, padding:'8px 12px', marginBottom:8,
                    display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div>
                      <div style={{ color:'#d1fae5', fontSize:12, fontWeight:700 }}>💾 {usbFile.name}</div>
                      <div style={{ color:'#9ca3af', fontSize:11 }}>{usbFile.content.split('\n').filter(l => l.trim()).length} lines</div>
                    </div>
                    <button onClick={() => { setUsbFile(null); setUsbResult(null); if (usbInputRef.current) usbInputRef.current.value = ''; }}
                      style={{ background:'none', border:'none', color:'#9ca3af', cursor:'pointer', fontSize:14 }}>✕</button>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <button className="btn btn-primary btn-sm" disabled={!!busy.usbUpload}
                      onClick={async () => {
                        setBusy(b => ({ ...b, usbUpload:true }));
                        try {
                          const r = await api.post(`/standalone/devices/${id}/usb-upload`, usbFile);
                          setUsbResult(r);
                          showToast?.(`✅ USB Import: ${r.inserted} new logs (${r.parsed} parsed)`, 'success');
                          onRefresh?.();
                        } catch (err) { showToast?.(`❌ ${err.message}`, 'error'); }
                        finally { setBusy(b => ({ ...b, usbUpload:false })); }
                      }}>
                      {busy.usbUpload ? '⏳' : '📤'} {L('इम्पोर्ट','Import')}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => usbInputRef.current?.click()}>📁 {L('परिवर्तन','Change')}</button>
                    <button className="btn btn-outline btn-sm" onClick={() => { setUsbFile(null); setUsbResult(null); }}>{L('बन्द','Close')}</button>
                  </div>
                  {usbResult && (
                    <div style={{ marginTop:8, background:'#d1fae5', border:'1px solid #6ee7b7', borderRadius:6, padding:'8px 12px', fontSize:12, color:'#065f46' }}>
                      ✅ {usbResult.parsed} {L('रेकर्ड पार्स गरियो','records parsed')} · {usbResult.inserted} {L('नयाँ थपियो','newly inserted')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {result && (
            <div style={{ background: result.ok ? '#f0fdf4' : '#fef2f2', border:`1px solid ${result.ok?'#bbf7d0':'#fecaca'}`,
              borderRadius:8, padding:'8px 12px', marginBottom:14, fontSize:11, fontFamily:'monospace', wordBreak:'break-all' }}>
              {result.ok ? JSON.stringify(result.data) : `Error: ${result.error}`}
            </div>
          )}

          {/* ── Always-visible generic Send Command (long tail of SDK methods) ── */}
          <div style={{ border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden' }}>
            <div style={{ background:'#f9fafb', padding:'8px 14px', borderBottom:'1px solid #e5e7eb',
              fontSize:12, fontWeight:700, color:'#374151' }}>
              ⚡ {L('कमान्ड पठाउनुहोस्','Send Command')}
              <span style={{ fontWeight:400, color:'#9ca3af', marginLeft:6 }}>
                (LCD, voice, work codes, daylight saving, holidays, etc.)
              </span>
            </div>
            <div style={{ padding:'12px 14px' }}>
              <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                <input
                  list="standalone-known-commands"
                  className="form-control"
                  placeholder="Method name, e.g. WriteLCD"
                  value={cmdMethod}
                  onChange={e => setCmdMethod(e.target.value)}
                  style={{ flex:1 }}
                />
                <datalist id="standalone-known-commands">
                  {KNOWN_COMMANDS.map(m => <option key={m} value={m} />)}
                </datalist>
                <button className="btn btn-primary btn-sm" disabled={!cmdMethod || busy.command} onClick={sendCommand}>
                  {busy.command ? '⏳' : '▶'} Send
                </button>
              </div>
              <textarea
                className="form-control"
                rows={2}
                placeholder='Args as a JSON array, e.g. [0, 0, "Hello"]'
                value={cmdArgs}
                onChange={e => setCmdArgs(e.target.value)}
                style={{ fontFamily:'monospace', fontSize:12, marginBottom:8 }}
              />
              {cmdResult && (
                <div style={{ background: cmdResult.ok ? '#f0fdf4' : '#fef2f2', border:`1px solid ${cmdResult.ok?'#bbf7d0':'#fecaca'}`,
                  borderRadius:8, padding:'8px 12px', fontSize:11, fontFamily:'monospace', wordBreak:'break-all' }}>
                  {cmdResult.ok ? JSON.stringify(cmdResult.data) : `Error: ${cmdResult.error}`}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>{L('बन्द गर्नुहोस्','Close')}</button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   Add / Edit Device Modal
═══════════════════════════════════════════════════════════ */
const DeviceFormModal = ({ device, onClose, onSaved, showToast }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const isEdit = !!device;
  const [form, setForm] = useState(device
    ? { name:device.name, ipAddress:device.ip_address, port:device.port, commPassword:device.comm_password||'', model:device.model||'', location:device.location||'', active:device.active }
    : emptyDevice);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const save = async () => {
    const errs = {};
    if (!form.name) errs.name = 'Required';
    if (!form.ipAddress) errs.ipAddress = 'Required';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      if (isEdit) await api.put(`/standalone/devices/${device.id}`, form);
      else        await api.post('/standalone/devices', form);
      showToast?.('✅ Device saved', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast?.(`❌ ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  /* Ctrl+S saves — this component only exists while its modal is open */
  useSaveShortcut(true, save);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? L('डिभाइस सम्पादन','Edit Device') : L('डिभाइस थप्नुहोस्','Add StandAlone Device')}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">{L('नाम','Name')}<span style={{color:'#ef4444'}}>*</span></label>
            <input className={`form-control ${errors.name?'error':''}`} value={form.name}
              onChange={e => setForm({ ...form, name:e.target.value })} />
            {errors.name && <div className="form-error">{errors.name}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">{L('IP ठेगाना','IP Address')}<span style={{color:'#ef4444'}}>*</span></label>
            <input className={`form-control ${errors.ipAddress?'error':''}`} value={form.ipAddress}
              onChange={e => setForm({ ...form, ipAddress:e.target.value })} placeholder="192.168.1.201" />
            {errors.ipAddress && <div className="form-error">{errors.ipAddress}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">{L('पोर्ट','Port')}</label>
            <input type="number" className="form-control" value={form.port}
              onChange={e => setForm({ ...form, port:parseInt(e.target.value)||4370 })} />
          </div>
          <div className="form-group">
            <label className="form-label">{L('कम्युनिकेशन पासवर्ड','Comm Password')}</label>
            <input className="form-control" value={form.commPassword}
              onChange={e => setForm({ ...form, commPassword:e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{L('मोडेल','Model')}</label>
            <input className="form-control" value={form.model}
              onChange={e => setForm({ ...form, model:e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">{L('स्थान','Location')}</label>
            <input className="form-control" value={form.location}
              onChange={e => setForm({ ...form, location:e.target.value })} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>{L('रद्द','Cancel')}</button>
          <button className="btn btn-primary" disabled={saving} onClick={save} title="Ctrl+S">
            {saving ? '⏳' : '💾'} {language === 'np' ? 'सेभ' : <><u>S</u>ave</>}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   Time Schedule tab — weekly punch-acceptance windows (Sun..Sat),
   pushed to a device's TZIndex slot then applied to a user group so it
   actually gates punches. Shares zkteco_timezones with the ADMS pipeline
   so a schedule is defined once and reusable either way.
═══════════════════════════════════════════════════════════ */
const TimeScheduleTab = ({ devices, showToast }) => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;

  const [timezones, setTimezones] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState(defaultWeekSchedule());
  const [saving, setSaving] = useState(false);

  const [targetDevice, setTargetDevice] = useState('');
  const [tzIndex, setTzIndex] = useState('2');
  const [groupNo, setGroupNo] = useState('1');
  const [busy, setBusy] = useState({});

  const loadTimezones = useCallback(async () => {
    try { setTimezones(await api.get('/zkteco/timezones') || []); } catch {}
  }, []);
  useEffect(() => { loadTimezones(); }, [loadTimezones]);

  const loadIntoEditor = (tz) => {
    setSelectedId(String(tz.id));
    setName(tz.name);
    const s = typeof tz.schedule === 'string' ? JSON.parse(tz.schedule) : tz.schedule;
    const merged = defaultWeekSchedule();
    for (const day of WEEK_DAYS) {
      if (s?.[day.key]?.[0]) {
        const iv = s[day.key][0];
        merged[day.key] = [{ s: iv.s || '00:00', e: iv.e || '23:59', closed: iv.closed || (iv.s === '00:00' && iv.e === '00:00') }];
      }
    }
    setSchedule(merged);
  };

  const setDay = (dayKey, field, value) => {
    setSchedule(prev => ({ ...prev, [dayKey]: [{ ...prev[dayKey][0], [field]: value }] }));
  };

  const saveSchedule = async () => {
    if (!name.trim()) { showToast('❌ Name is required', 'error'); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), schedule };
      const saved = selectedId
        ? await api.put(`/zkteco/timezones/${selectedId}`, payload)
        : await api.post('/zkteco/timezones', payload);
      showToast('✅ Schedule saved', 'success');
      setSelectedId(String(saved.id));
      await loadTimezones();
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    finally { setSaving(false); }
  };

  /* Ctrl+S saves — this tab only exists while it's the active sub-tab */
  useSaveShortcut(true, saveSchedule);

  const pushToDevice = async () => {
    if (!targetDevice || !tzIndex) { showToast('❌ Select a device and slot number first', 'error'); return; }
    setBusy(b => ({ ...b, push:true }));
    try {
      await api.post(`/standalone/devices/${targetDevice}/timezones/${tzIndex}`, { schedule });
      showToast('✅ Schedule pushed to device', 'success');
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    finally { setBusy(b => ({ ...b, push:false })); }
  };

  const applyToGroup = async () => {
    if (!targetDevice || !tzIndex || !groupNo) { showToast('❌ Select device, slot and group first', 'error'); return; }
    setBusy(b => ({ ...b, apply:true }));
    try {
      await api.post(`/standalone/devices/${targetDevice}/groups/${groupNo}/timezone`, { tzIndex: parseInt(tzIndex) });
      showToast(`✅ Group ${groupNo} now gated to this schedule — its users can only punch in the allowed windows`, 'success');
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    finally { setBusy(b => ({ ...b, apply:false })); }
  };

  return (
    <div>
      <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12, color:'#1e40af' }}>
        ℹ️ {L(
          'यो SDK ले प्रत्येक दिन एउटा मात्र समय श्रेणी (शुरु–अन्त्य) समर्थन गर्छ। "बन्द" चिन्ह लगाएको दिनमा पञ्च स्वीकार हुँदैन।',
          'This SDK supports one start/end window per day. Days marked "Closed" reject punches entirely that day.'
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        {/* ── Schedule editor ── */}
        <div style={{ border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden' }}>
          <div style={{ background:'#f9fafb', padding:'8px 14px', borderBottom:'1px solid #e5e7eb', fontSize:12, fontWeight:700, color:'#374151' }}>
            📅 {L('साप्ताहिक तालिका','Weekly Schedule')}
          </div>
          <div style={{ padding:'12px 14px' }}>
            <div className="form-group">
              <label className="form-label">{L('लोड गर्नुहोस्','Load existing')}</label>
              <select className="form-control" value={selectedId} onChange={e => {
                const tz = timezones.find(t => String(t.id) === e.target.value);
                if (tz) loadIntoEditor(tz); else { setSelectedId(''); setName(''); setSchedule(defaultWeekSchedule()); }
              }}>
                <option value="">{L('-- नयाँ तालिका --','-- New schedule --')}</option>
                {timezones.map(tz => <option key={tz.id} value={tz.id}>{tz.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{L('नाम','Name')}</label>
              <input className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Office Hours" />
            </div>

            {WEEK_DAYS.map(day => {
              const iv = schedule[day.key][0];
              return (
                <div key={day.key} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <span style={{ width:80, fontSize:12, fontWeight:600, color:'#374151' }}>{L(day.np, day.en)}</span>
                  <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'#6b7280' }}>
                    <input type="checkbox" checked={!!iv.closed} onChange={e => setDay(day.key, 'closed', e.target.checked)} />
                    {L('बन्द','Closed')}
                  </label>
                  <input type="time" className="form-control" style={{ flex:1 }} value={iv.s} disabled={iv.closed}
                    onChange={e => setDay(day.key, 's', e.target.value)} />
                  <span style={{ fontSize:11, color:'#9ca3af' }}>—</span>
                  <input type="time" className="form-control" style={{ flex:1 }} value={iv.e} disabled={iv.closed}
                    onChange={e => setDay(day.key, 'e', e.target.value)} />
                </div>
              );
            })}

            <button className="btn btn-primary btn-sm" disabled={saving} onClick={saveSchedule} title="Ctrl+S" style={{ marginTop:8 }}>
              {saving ? '⏳' : '💾'} {selectedId ? L('अपडेट','Update') : (language === 'np' ? 'सेभ' : <><u>S</u>ave</>)}
            </button>
          </div>
        </div>

        {/* ── Push to device + apply to group ── */}
        <div style={{ border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden', alignSelf:'start' }}>
          <div style={{ background:'#f9fafb', padding:'8px 14px', borderBottom:'1px solid #e5e7eb', fontSize:12, fontWeight:700, color:'#374151' }}>
            📤 {L('डिभाइसमा लागू गर्नुहोस्','Apply to Device')}
          </div>
          <div style={{ padding:'12px 14px' }}>
            <div className="form-group">
              <label className="form-label">{L('डिभाइस','Device')}</label>
              <select className="form-control" value={targetDevice} onChange={e => setTargetDevice(e.target.value)}>
                <option value="">{L('डिभाइस छान्नुहोस्','Select device')}</option>
                {(devices || []).map(d => <option key={d.id} value={d.id}>{d.name} ({d.ip_address}:{d.port})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{L('समय क्षेत्र स्लट (1-50)','Time-zone slot (1-50)')}</label>
              <input type="number" min="1" max="50" className="form-control" value={tzIndex} onChange={e => setTzIndex(e.target.value)} />
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>
                {L('स्लट १ प्राय: फ्याक्ट्री "सधैं खुला" हुन्छ — २ वा माथि प्रयोग गर्नुहोस्।','Slot 1 is usually the factory "always open" default — use 2 or higher.')}
              </div>
            </div>
            <ActionBtn icon="📤" label="Push Schedule to Device" loading={busy.push} disabled={!targetDevice}
              onClick={pushToDevice} />

            <div style={{ borderTop:'1px solid #e5e7eb', margin:'14px 0', paddingTop:14 }}>
              <div className="form-group">
                <label className="form-label">{L('समूह नम्बर','Group Number')}</label>
                <input type="number" min="1" className="form-control" value={groupNo} onChange={e => setGroupNo(e.target.value)} />
                <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>
                  {L('धेरै डिभाइसमा सबै सामान्य प्रयोगकर्ता समूह १ मा हुन्छन्।','Most devices default every normal user to group 1.')}
                </div>
              </div>
              <ActionBtn icon="🔒" label="Apply Slot to Group (gates punches)" loading={busy.apply} disabled={!targetDevice} danger
                onClick={() => window.confirm(`Gate group ${groupNo} on this device to time-zone slot ${tzIndex}? Users in that group will only be able to punch within the configured windows.`)
                  && applyToGroup()} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   Main component
═══════════════════════════════════════════════════════════ */
const StandAloneDeviceSettings = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const { isAdmin } = useAuth();

  const [subTab, setSubTab] = useState('devices');
  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [fingerprints, setFingerprints] = useState([]);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deletingAllLogs, setDeletingAllLogs] = useState(false);
  const [deletingAllUsers, setDeletingAllUsers] = useState(false);
  const [toast, setToast] = useState(null);
  const [formDevice, setFormDevice] = useState(null);  // null=closed, {}=add, {...}=edit
  const [controlDevice, setControlDevice] = useState(null);

  const showToast = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try { setDevices(await api.get('/standalone/devices') || []); }
    catch { /* ignore — backend/bridge may not be running */ }
    finally { setLoading(false); }
  }, []);

  const loadLogs        = useCallback(async () => { try { setLogs(await api.get('/standalone/logs') || []); } catch {} }, []);
  const loadUsers       = useCallback(async () => { try { setUsers(await api.get('/standalone/device-users') || []); } catch {} }, []);
  const loadFingerprints= useCallback(async () => { try { setFingerprints(await api.get('/standalone/fingerprints') || []); } catch {} }, []);
  const loadBackups      = useCallback(async () => { try { setBackups(await api.get('/standalone/backups') || []); } catch {} }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);
  useEffect(() => {
    if (subTab === 'logs')         loadLogs();
    if (subTab === 'users')        loadUsers();
    if (subTab === 'fingerprints') loadFingerprints();
    if (subTab === 'backups')      loadBackups();
  }, [subTab, loadLogs, loadUsers, loadFingerprints, loadBackups]);

  const deleteAllLogs = async () => {
    if (!window.confirm('Permanently delete ALL stored attendance log history for every StandAlone device? (the devices themselves are untouched). This cannot be undone.')) return;
    setDeletingAllLogs(true);
    try {
      const r = await api.delete('/standalone/logs');
      showToast(`✅ ${r.deleted} log(s) deleted`, 'success');
      loadLogs();
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    finally { setDeletingAllLogs(false); }
  };

  const deleteAllUsers = async () => {
    if (!window.confirm('Delete EVERY user, fingerprint and face template from ALL StandAlone devices — on the devices themselves and in eHajiri? This cannot be undone.')) return;
    setDeletingAllUsers(true);
    try {
      for (const d of devices) {
        await api.post(`/standalone/devices/${d.id}/users/clear-all`);
      }
      showToast('✅ All users deleted from every device', 'success');
      loadUsers();
      loadFingerprints();
      loadDevices();
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
    finally { setDeletingAllUsers(false); }
  };

  const deleteDevice = async (row) => {
    if (!window.confirm(`Delete device "${row.name}"? This removes it from eHajiri only.`)) return;
    try {
      await api.delete(`/standalone/devices/${row.id}`);
      showToast('✅ Device deleted', 'success');
      loadDevices();
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  };

  const deleteUser = async (row) => {
    if (!window.confirm(`Delete user ${row.enroll_number} from the device and eHajiri?`)) return;
    try {
      await api.delete(`/standalone/devices/${row.device_id}/users/${row.enroll_number}`);
      showToast('✅ User deleted', 'success');
      loadUsers();
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  };

  const deleteSample = async (row) => {
    const kind = row.template_type === 'face' ? 'face' : 'fingerprint';
    if (!window.confirm(`Delete this ${kind} sample (enroll #${row.enroll_number}) from the device and eHajiri?`)) return;
    try {
      const path = row.template_type === 'face'
        ? `/standalone/devices/${row.device_id}/users/${row.enroll_number}/face/${row.finger_index}`
        : `/standalone/devices/${row.device_id}/users/${row.enroll_number}/fingerprints/${row.finger_index}`;
      await api.delete(path);
      showToast('✅ Sample deleted', 'success');
      loadFingerprints();
    } catch (err) { showToast(`❌ ${err.message}`, 'error'); }
  };

  /* ── columns ── */
  const deviceColumns = [
    { field:'name', header:L('नाम','Name'), render:(v,row) => (
      <div>
        <div style={{ fontWeight:600 }}>{v}</div>
        {row.location && <div style={{ fontSize:11, color:'#9ca3af' }}>{row.location}</div>}
      </div>
    )},
    { field:'ip_address', header:'IP : Port', render:(v,row) => <span style={{ fontFamily:'monospace', fontSize:12 }}>{v}:{row.port}</span> },
    { field:'serial_number', header:'Serial Number', render:v => v || '—' },
    { field:'connection_status', header:L('स्थिति','Status'), render:v => <ConnectionDot status={v} /> },
    { field:'firmware_ver', header:'Firmware', render:v => v || '—' },
    { field:'log_count', header:L('लग','Logs'), width:70 },
    { field:'user_count', header:L('प्रयोगकर्ता','Users'), width:80 },
    { field:'active', header:L('सक्रिय','Active'), width:70, render:v => v
      ? <Badge color="#059669" bg="#d1fae5" border="#6ee7b7">Active</Badge>
      : <Badge color="#9ca3af" bg="#f3f4f6" border="#e5e7eb">Inactive</Badge> },
    { field:'_actions', header:'', width:170, render:(_, row) => (
      <div style={{ display:'flex', gap:6 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setControlDevice(row)}>🖥️ Control</button>
        <button className="btn btn-outline btn-sm" onClick={() => setFormDevice(row)}>✏️</button>
        <button className="btn btn-outline btn-sm" onClick={() => deleteDevice(row)} style={{ color:'#ef4444' }}>🗑</button>
      </div>
    )},
  ];

  // These logs are read straight from zkteco_attendance_logs (the same table
  // the ADMS-push pipeline writes to), filtered to standalone devices — so
  // field names follow that table's convention (pin/check_type/verify_type).
  const logColumns = [
    { field:'device_name',  header:L('डिभाइस','Device') },
    { field:'pin',          header:'Enroll #', width:90 },
    { field:'check_time',   header:L('समय','Time'), render:v => v ? new Date(v).toLocaleString() : '—' },
    { field:'verify_type',  header:'Verify', width:100, render:v => <Badge>{VERIFY_LABELS[v] || v}</Badge> },
    { field:'check_type',   header:'In/Out', width:100, render:v => <Badge color="#7c3aed" bg="#f3e8ff" border="#d8b4fe">{INOUT_LABELS[v] || v}</Badge> },
    { field:'work_code',    header:'Work Code', width:90 },
  ];

  const userColumns = [
    { field:'device_name',   header:L('डिभाइस','Device') },
    { field:'enroll_number', header:'PIN', width:80, render:v => <strong style={{ fontFamily:'monospace' }}>{v}</strong> },
    { field:'name',          header:L('नाम','Name') },
    { field:'privilege',     header:'Privilege', render:v => <Badge>{PRIV_LABELS[v] || v}</Badge> },
    { field:'card_no',       header:'Card No', render:v => (!v || v === '0') ? '—' : v },
    { field:'fp_count', header:'🖐️ Fingers', width:90, render:v => v > 0
      ? <Badge color="#1a56db" bg="#eff6ff" border="#bfdbfe">🖐️ {v}</Badge>
      : <span style={{ color:'#9ca3af' }}>—</span> },
    { field:'face_count', header:'🙂 Face', width:80, render:v => v > 0
      ? <Badge color="#7c3aed" bg="#f3e8ff" border="#d8b4fe">🙂 {v}</Badge>
      : <span style={{ color:'#9ca3af' }}>—</span> },
    { field:'enabled',       header:L('सक्रिय','Enabled'), width:80, render:v => v ? '✅' : '⛔' },
    { field:'_actions', header:'', width:60, render:(_, row) => (
      <button className="btn btn-outline btn-sm" onClick={() => deleteUser(row)} style={{ color:'#ef4444' }}>🗑</button>
    )},
  ];

  const fingerprintColumns = [
    { field:'device_name',   header:L('डिभाइस','Device') },
    { field:'enroll_number', header:'Enroll #', width:90 },
    { field:'template_type', header:'Type', width:70, render:v => v === 'face'
      ? <Badge color="#7c3aed" bg="#f3e8ff" border="#d8b4fe">Face</Badge>
      : <Badge color="#1a56db" bg="#eff6ff" border="#bfdbfe">Fingerprint</Badge> },
    { field:'finger_index',  header:'Finger/Face #', render:(v,row) => row.template_type === 'face' ? v : (FINGER_LABELS[v] || v) },
    { field:'template_size', header:'Template Size', width:110 },
    { field:'enrolled_at',   header:L('मिति','Enrolled'), render:v => v ? new Date(v).toLocaleString() : '—' },
    { field:'_actions', header:'', width:60, render:(_, row) => (
      <button className="btn btn-outline btn-sm" onClick={() => deleteSample(row)} style={{ color:'#ef4444' }}>🗑</button>
    )},
  ];

  const backupColumns = [
    { field:'device_name', header:L('डिभाइस','Device') },
    { field:'file_path',   header:L('फाइल','File'), render:v => <code style={{ fontSize:11, wordBreak:'break-all' }}>{v}</code> },
    { field:'created_at',  header:L('मिति','Taken'), render:v => v ? new Date(v).toLocaleString() : '—' },
  ];

  const subTabs = [
    { key:'devices',      icon:'🖥️', label:L('डिभाइस','Devices') },
    { key:'logs',         icon:'📋', label:L('लग','Logs') },
    { key:'users',        icon:'👥', label:L('प्रयोगकर्ता','Users') },
    { key:'fingerprints', icon:'🖐️', label:L('फिंगरप्रिन्ट/फेस','Fingerprints/Face') },
    { key:'backups',      icon:'💾', label:L('ब्याकअप','Backups') },
    { key:'schedule',     icon:'📅', label:L('समय तालिका','Time Schedule') },
  ];

  return (
    <div>
      {toast && (
        <div style={{ position:'fixed', top:20, right:20, zIndex:2000,
          background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
          border:`1px solid ${toast.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
          borderRadius:8, padding:'10px 16px', fontSize:13, fontWeight:600,
          color: toast.type === 'error' ? '#991b1b' : '#065f46' }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e5e7eb', marginBottom:14 }}>
        {subTabs.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{
            padding:'8px 14px', background:'none', border:'none',
            borderBottom: subTab === t.key ? '2px solid #1a56db' : '2px solid transparent',
            color:        subTab === t.key ? '#1a56db' : '#6b7280',
            fontWeight:   subTab === t.key ? 700 : 400,
            cursor:'pointer', fontSize:12.5, display:'flex', alignItems:'center', gap:5, marginBottom:-2,
          }}>
            {t.icon} {t.label}
          </button>
        ))}
        {subTab === 'devices' && (
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, paddingRight:4 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setFormDevice({})}>+ {L('डिभाइस थप्नुहोस्','Add Device')}</button>
            <button className="btn btn-outline btn-sm" onClick={loadDevices}>🔃</button>
          </div>
        )}
        {subTab === 'logs' && isAdmin && (
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, paddingRight:4 }}>
            <button className="btn btn-outline btn-sm" disabled={deletingAllLogs} onClick={deleteAllLogs} style={{ color:'#ef4444' }}>
              {deletingAllLogs ? '⏳' : '🗑'} {L('सबै लग मेट्नुहोस्','Delete All Logs')}
            </button>
          </div>
        )}
        {subTab === 'users' && isAdmin && (
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, paddingRight:4 }}>
            <button className="btn btn-outline btn-sm" disabled={deletingAllUsers} onClick={deleteAllUsers} style={{ color:'#ef4444' }}>
              {deletingAllUsers ? '⏳' : '🗑'} {L('सबै प्रयोगकर्ता मेट्नुहोस्','Delete All Users')}
            </button>
          </div>
        )}
      </div>

      {subTab === 'devices' && (
        <DataGrid columns={deviceColumns} data={devices} defaultPageSize={10} showSearch compact loading={loading}
          onRowDoubleClick={row => setControlDevice(row)} />
      )}
      {subTab === 'logs' && (
        <DataGrid columns={logColumns} data={logs} defaultPageSize={20} showSearch compact />
      )}
      {subTab === 'users' && (
        <DataGrid columns={userColumns} data={users} defaultPageSize={20} showSearch compact />
      )}
      {subTab === 'fingerprints' && (
        <DataGrid columns={fingerprintColumns} data={fingerprints} defaultPageSize={20} showSearch compact />
      )}
      {subTab === 'backups' && (
        <DataGrid columns={backupColumns} data={backups} defaultPageSize={20} showSearch compact />
      )}
      {subTab === 'schedule' && (
        <TimeScheduleTab devices={devices} showToast={showToast} />
      )}

      {formDevice && (
        <DeviceFormModal
          device={formDevice.id ? formDevice : null}
          onClose={() => setFormDevice(null)}
          onSaved={loadDevices}
          showToast={showToast}
        />
      )}

      {controlDevice && (
        <DeviceControlModal
          device={controlDevice}
          allDevices={devices}
          onClose={() => setControlDevice(null)}
          onRefresh={() => {
            // Control-modal actions (fetch logs/users/biometrics, backup, clone,
            // clear-all) can change any of these — refresh them all so whichever
            // grid the admin switches to next is already up to date.
            loadDevices();
            loadLogs();
            loadUsers();
            loadFingerprints();
            loadBackups();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
};

export default StandAloneDeviceSettings;
