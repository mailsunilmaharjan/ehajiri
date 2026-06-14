import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '../../context/LanguageContext.jsx';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import ImportDeviceUsersModal from '../Common/ImportDeviceUsersModal.jsx';
import ZKTecoAreaTab          from './ZKTecoAreaTab.jsx';
import ZKTecoAccessTab        from './ZKTecoAccessTab.jsx';

/* ═══ constants ══════════════════════════════════════════════ */
const DEVICE_MODELS = ['M2F','SenseFace','ZKTeco K40 Pro','MB2000','SenseFace 4A','SenseFace 7A','Other'];
const DEVICE_TYPES  = [
  { value:'fingerprint', label:'Fingerprint'                          },
  { value:'face',        label:'Face Recognition'                     },
  { value:'multi',       label:'Multi-Biometric (Face + Fingerprint)' },
  { value:'card',        label:'Card + Fingerprint'                   },
];
const CHECK_LABELS   = { 0:'Check In',1:'Check Out',2:'Break Out',3:'Break In',4:'OT In',5:'OT Out' };
const VERIFY_LABELS  = { 1:'Fingerprint',2:'Password',3:'Card',15:'Face' };
const PRIV_LABELS    = { 0:'User',1:'Enroller',2:'Manager',6:'Admin',14:'Super Admin' };
const FINGER_LABELS  = ['Right Pinky','Right Ring','Right Middle','Right Index','Right Thumb',
                        'Left Thumb','Left Index','Left Middle','Left Ring','Left Pinky'];

const modelType = (m = '') => {
  const l = m.toLowerCase();
  if (l.includes('senseface')) return 'face';
  if (l.includes('mb2000') || l.includes('k40')) return 'multi';
  return 'fingerprint';
};
const cleanIp = (raw) => raw ? raw.replace(/^::ffff:/i,'').replace(/^::1$/,'localhost') : '—';

/* ═══ tiny atoms ═════════════════════════════════════════════ */
const Badge = ({ children, color='#1a56db', bg='#eff6ff', border='#bfdbfe', style={} }) => (
  <span style={{ background:bg,color,border:`1px solid ${border}`,borderRadius:10,
    padding:'2px 9px',fontSize:11,fontWeight:700,display:'inline-block',...style }}>
    {children}
  </span>
);

const OnlineDot = ({ ts }) => {
  if (!ts) return <span style={{ color:'#9ca3af',fontSize:12 }}>Never</span>;
  const mins   = Math.floor((Date.now()-new Date(ts).getTime())/60000);
  const online = mins < 15;
  return (
    <div style={{ display:'flex',alignItems:'center',gap:6 }}>
      <span style={{ width:8,height:8,borderRadius:'50%',flexShrink:0,
        background:online?'#10b981':'#d1d5db',
        boxShadow:online?'0 0 0 2px #d1fae5':'none' }} />
      <span style={{ fontSize:11,color:'#6b7280' }}>
        {online ? 'Online' : mins<1440 ? `${mins}m ago` : 'Offline'}
      </span>
    </div>
  );
};

const ActionBtn = ({ icon, label, color='#1a56db', bg='#eff6ff', border='#bfdbfe',
  onClick, loading=false, disabled=false, danger=false }) => (
  <button
    disabled={disabled || loading}
    onClick={onClick}
    style={{
      display:'flex',alignItems:'center',gap:6,
      background: danger ? '#fef2f2' : bg,
      color:      danger ? '#ef4444' : color,
      border:`1px solid ${danger ? '#fca5a5' : border}`,
      borderRadius:8, padding:'8px 14px', fontSize:13, fontWeight:600,
      cursor: disabled||loading ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition:'all .15s', whiteSpace:'nowrap',
    }}
  >
    <span style={{ fontSize:16 }}>{loading ? '⏳' : icon}</span>
    {label}
  </button>
);

const SectionCard = ({ title, icon, children }) => (
  <div style={{ border:'1px solid #e5e7eb',borderRadius:10,overflow:'hidden',marginBottom:12 }}>
    <div style={{ background:'#f9fafb',padding:'8px 14px',borderBottom:'1px solid #e5e7eb',
      fontSize:12,fontWeight:700,color:'#374151',display:'flex',alignItems:'center',gap:6 }}>
      {icon} {title}
    </div>
    <div style={{ padding:'14px 16px' }}>{children}</div>
  </div>
);

/* ── AD (Gregorian) Date Picker — clean styled wrapper around native input ── */
const ADDatePicker = ({ value, onChange, placeholder = 'yyyy-mm-dd', label }) => {
  const [focused, setFocused] = React.useState(false);
  return (
    <div style={{ position:'relative', display:'inline-flex', flexDirection:'column', width:'100%' }}>
      {label && (
        <span style={{ fontSize:11, fontWeight:600, color:'#6b7280', marginBottom:4, textTransform:'uppercase', letterSpacing:'.3px' }}>
          {label}
        </span>
      )}
      <div style={{
        position:'relative', display:'flex', alignItems:'center',
        border:`1.5px solid ${focused ? '#1a56db' : value ? '#1a56db' : '#d1d5db'}`,
        borderRadius:8, background:'white', overflow:'hidden',
        boxShadow: focused ? '0 0 0 3px rgba(26,86,219,.1)' : 'none',
        transition:'border-color .15s, box-shadow .15s',
        height:38,
      }}>
        {/* Calendar icon */}
        <span style={{ padding:'0 8px', color: value ? '#1a56db' : '#9ca3af', fontSize:16, flexShrink:0, lineHeight:1 }}>
          📅
        </span>
        <input
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex:1, border:'none', outline:'none', padding:'0 8px 0 0',
            fontSize:13, color: value ? '#1f2937' : '#9ca3af',
            background:'transparent', cursor:'pointer', height:'100%',
            fontFamily:'inherit', minWidth:0,
          }}
        />
        {/* Clear button */}
        {value && (
          <button
            onMouseDown={e => { e.preventDefault(); onChange(''); }}
            style={{ padding:'0 8px', background:'none', border:'none', cursor:'pointer',
              color:'#9ca3af', fontSize:14, flexShrink:0, lineHeight:1 }}
            tabIndex={-1}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
};

const emptyDevice = { name:'',serialNumber:'',ipAddress:'',port:4370,model:'SenseFace',deviceType:'face',location:'',communicationKey:'0',timezoneOffset:345,areaId:'' };
const emptyUpload = { pin:'',name:'',privilege:0,card:'0' };
const emptyEnroll = { pin:'',name:'',fingerId:0 };

/* ═══════════════════════════════════════════════════════════
   Device Control Modal — 3-group accordion layout
═══════════════════════════════════════════════════════════ */
const DeviceControlModal = ({ device, onClose, showToast, onRefreshDevices, onSwitchTab }) => {
  const { language } = useLanguage();
  const L = (np,en) => language==='np' ? np : en;

  const [busy,         setBusy]         = useState({});
  const [openGroup,    setOpenGroup]    = useState('device-info'); // active horizontal tab
  const [activeItem,   setActiveItem]   = useState(null);  // which sub-item form is open
  const [formData,     setFormData]     = useState({});
  // Enroll
  const [enrollType,   setEnrollType]   = useState(null);  // null | 'fp' | 'face'
  // USB
  const [usbFile,      setUsbFile]      = useState(null);
  const [usbResult,    setUsbResult]    = useState(null);
  const usbInputRef = useRef(null);
  // JSON import (users + FP templates from another device/server)
  const [importJson,     setImportJson]     = useState(null); // { name, users[] }
  const [importJsonResult, setImportJsonResult] = useState(null);
  const importJsonRef = useRef(null);

  const id  = device.id;
  const sn  = device.serial_number;
  const fpMinus1 = device.fp_count === -1;

  // Device offline detection (same threshold as OnlineDot: >15 min since last_seen)
  const isOffline = !device.last_seen ||
    Math.floor((Date.now() - new Date(device.last_seen).getTime()) / 60000) >= 15;

  /* Generic command runner */
  const run = async (key, apiFn, successMsg) => {
    setBusy(p=>({...p,[key]:true}));
    try {
      const r = await apiFn();
      showToast(successMsg || `✅ ${key} queued → ${r?.command||r?.message||''}`, 'success');
      if (key==='info')     onRefreshDevices();
      if (key==='get-users'){ onClose(); onSwitchTab('users'); }
      return r;
    } catch(err) { showToast(err.message||'Error','danger'); }
    finally { setBusy(p=>({...p,[key]:false})); }
  };

  /* Horizontal tab container — replaces accordion */
  const Group = ({ gKey, icon, title, children }) => {
    if (openGroup !== gKey) return null; // only render active tab's content
    return <div style={{ padding:'12px 0 4px' }}>{children}</div>;
  };

  /* Horizontal card button — replaces vertical row Item */
  const Item = ({ iKey, icon, label, onClick, danger=false, disabled=false, desc }) => {
    const isActive  = activeItem === iKey;
    const isBusy    = !!busy[iKey];
    const isDisabled = disabled || isBusy || isOffline;
    return (
      <button
        disabled={isDisabled}
        onClick={() => { if (!isOffline) onClick?.(); }}
        title={isOffline ? 'Device is offline — commands disabled' : undefined}
        style={{
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          gap:6, padding:'12px 10px', minWidth:100, flex:'1 1 100px', maxWidth:140,
          background: isOffline ? '#f9fafb' : isActive ? '#eff6ff' : danger ? '#fff5f5' : 'white',
          border: `1.5px solid ${isOffline ? '#e5e7eb' : isActive ? '#93c5fd' : danger ? '#fca5a5' : '#e5e7eb'}`,
          borderRadius:10, cursor: isDisabled ? 'not-allowed' : 'pointer',
          textAlign:'center', opacity: isOffline ? 0.4 : isDisabled ? 0.5 : 1, transition:'background .1s',
          boxShadow: isActive && !isOffline ? '0 0 0 2px #bfdbfe' : 'none',
        }}
        onMouseEnter={e=>{ if (!isDisabled) e.currentTarget.style.background = isActive?'#dbeafe': danger?'#fee2e2':'#f0f9ff'; }}
        onMouseLeave={e=>{ if (!isOffline) e.currentTarget.style.background = isActive?'#eff6ff': danger?'#fff5f5':'white'; }}>
        <span style={{ fontSize:20 }}>{isBusy ? '⏳' : isOffline ? '🚫' : icon}</span>
        <div style={{ fontSize:11, fontWeight:700, color: isOffline?'#9ca3af': danger?'#dc2626': isActive?'#1e40af':'#374151',
          lineHeight:1.3, maxWidth:110, wordBreak:'break-word' }}>{label}</div>
      </button>
    );
  };

  /* Inline form panel that slides in below an item */
  const FormPanel = ({ children }) => (
    <div style={{ margin:'4px 12px 8px', background:'#f9fafb', borderRadius:8,
      border:'1px solid #e5e7eb', padding:'14px 16px' }}>
      {children}
    </div>
  );

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth:560, maxHeight:'92vh', overflowY:'auto' }}
           onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header"
          style={{ background:'linear-gradient(135deg,#eff6ff,#dbeafe)', position:'sticky', top:0, zIndex:10 }}>
          <div>
            <h2 style={{ color:'#1e40af', margin:0 }}>⚙️ Device Control — {device.name}</h2>
            <div style={{ fontSize:11, color:'#6b7280', marginTop:2 }}>
              SN: {sn||'—'} &nbsp;·&nbsp; {cleanIp(device.last_ip)}{device.port?`:${device.port}`:''}
              &nbsp;·&nbsp; <OnlineDot ts={device.last_seen} />
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Capacity bar */}
        {device.user_count != null && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, padding:'10px 14px', background:'#f8fafc', borderBottom:'1px solid #e5e7eb' }}>
            {[
              { label:'Users',    value:`${device.user_count}/${device.max_user||'?'}`, color:'#1a56db' },
              { label:'FP Slots', value:`${device.fp_count??'?'}`, color:fpMinus1?'#dc2626':'#7c3aed' },
              { label:'Firmware', value:device.info_firmware||device.firmware_ver||'—', color:'#374151' },
              { label:'Platform', value:device.info_platform||device.platform||'—',     color:'#374151' },
            ].map(s=>(
              <div key={s.label} style={{ textAlign:'center' }}>
                <div style={{ fontSize:13, fontWeight:700, color:s.color }}>{s.value}</div>
                <div style={{ fontSize:10, color:'#9ca3af' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
        {fpMinus1 && (
          <div style={{ background:'#fee2e2', borderBottom:'1px solid #fca5a5', padding:'6px 14px', fontSize:11, color:'#991b1b' }}>
            ⚠️ FPCount=-1 — hardware does not support fingerprint template export
          </div>
        )}

        <div className="modal-body" style={{ padding:'12px 14px' }}>

          {/* ─── Offline banner ─── */}
          {isOffline && (
            <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8,
              padding:'10px 14px', marginBottom:12, display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:18 }}>📡</span>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:'#c2410c' }}>Device is Offline</div>
                <div style={{ fontSize:11, color:'#9a3412' }}>
                  Commands cannot be sent until the device reconnects. Last seen:{' '}
                  {device.last_seen
                    ? `${Math.floor((Date.now()-new Date(device.last_seen).getTime())/60000)} min ago`
                    : 'never'}
                </div>
              </div>
            </div>
          )}

          {/* ─── Horizontal tab bar ─── */}
          <div style={{ display:'flex', gap:0, marginBottom:14, border:'1px solid #e5e7eb',
            borderRadius:8, overflow:'hidden', width:'100%',
            opacity: isOffline ? 0.5 : 1, pointerEvents: isOffline ? 'none' : 'auto' }}>
            {[
              { key:'device-info', icon:'📊', label:'Device Info'     },
              { key:'data-ops',    icon:'📋', label:'Data Operations'  },
              { key:'device-cmd',  icon:'⚡', label:'Device Command'  },
            ].map(({ key, icon, label }) => (
              <button key={key}
                onClick={() => { if (!isOffline) { setOpenGroup(key); setActiveItem(null); setEnrollType(null); } }}
                style={{ flex:1, padding:'9px 6px', border:'none', cursor: isOffline ? 'not-allowed' : 'pointer',
                  fontSize:12, fontWeight:700, textAlign:'center',
                  background: openGroup === key ? '#1a56db' : 'white',
                  color:      openGroup === key ? 'white'   : '#6b7280',
                  borderRight: key !== 'device-cmd' ? '1px solid #e5e7eb' : 'none',
                  transition:'background .15s' }}>
                <span style={{ fontSize:14, display:'block' }}>{icon}</span>
                {label}
              </button>
            ))}
          </div>

          {/* ━━━ 1. DEVICE INFO ━━━ */}
          <Group gKey="device-info" icon="📊" title="Device Info">

            {/* Inline capacity display — populated from getrequest?INFO= (no command needed) */}
            {device.user_count != null && (
              <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6,padding:'10px 16px',
                background:'#f8fafc',borderBottom:'1px solid #f3f4f6' }}>
                {[
                  {l:'Users',    v:`${device.user_count||0}/${device.max_user||'?'}`, c:'#1a56db'},
                  {l:'FP Slots', v:`${device.fp_count??'?'}`,                         c:fpMinus1?'#dc2626':'#7c3aed'},
                  {l:'Firmware', v:device.info_firmware||device.firmware_ver||'—',    c:'#374151'},
                  {l:'Platform', v:device.info_platform||device.platform||'—',        c:'#374151'},
                ].map(s=>(
                  <div key={s.l} style={{ textAlign:'center' }}>
                    <div style={{ fontSize:12,fontWeight:700,color:s.c }}>{s.v}</div>
                    <div style={{ fontSize:10,color:'#9ca3af' }}>{s.l}</div>
                  </div>
                ))}
              </div>
            )}
            {fpMinus1 && (
              <div style={{ padding:'6px 16px',background:'#fee2e2',borderBottom:'1px solid #fca5a5',
                fontSize:11,color:'#991b1b' }}>
                ⚠️ FPCount=-1 — hardware does not support FP template export (firmware upgrade required)
              </div>
            )}

            {/* Card grid — horizontal */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
              <Item iKey="time" icon="⏰" label="Sync Time to Now"
                desc={`SET OPTION ServerLocalTime=${new Date().toLocaleString()} (guide §14)`}
                onClick={()=>run('time',()=>api.post(`/zkteco/devices/${id}/set-time`,{}),'✅ Time sync queued — SET OPTION ServerLocalTime=...')} />
              <Item iKey="set-tz" icon="🌐" label="Set Timezone"
                desc="MachineTZFunOn=0 · MachineTZ=+0545 · RELOAD OPTIONS (Nepal UTC+5:45)"
                onClick={()=>run('set-tz',()=>api.post(`/zkteco/devices/${id}/set-timezone`,{}),'✅ MachineTZFunOn=0 + MachineTZ=+0545 queued')} />
              <Item iKey="reload" icon="🔃" label="Reload Options"
                desc="RELOAD OPTIONS — re-handshake, timezone + stamp (guide §13)"
                onClick={()=>run('reload',()=>api.post(`/zkteco/devices/${id}/reload-options`,{}),'✅ RELOAD OPTIONS queued')} />
              <Item iKey="reboot" icon="🔁" label="Restart Device ⚠️" danger
                desc="RESTART — wipes FP templates from RAM (guide §17)"
                onClick={()=>{
                  if(!window.confirm(
                    '⚠️ WARNING (ZKTeco ADMS Guide §17):\n\n' +
                    '"Never send RESTART — restarting the device wipes all\n' +
                    'fingerprint templates from device RAM."\n\n' +
                    'Stored templates will auto-restore on next handshake.\n\n' +
                    'Continue?'
                  )) return;
                  run('reboot',()=>api.post(`/zkteco/devices/${id}/reboot`,{}),'⚠️ RESTART queued — FP templates will be wiped from RAM');
                }} />
            </div>
          </Group>

          {/* ━━━ 2. DATA OPERATIONS ━━━ */}
          <Group gKey="data-ops" icon="📋" title="Data Operations">
            <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            <Item iKey="get-logs" icon="📋" label="Get All Logs"
              desc="ATTLOGStamp=None + RELOAD OPTIONS → device re-pushes all attendance history (guide §1)"
              onClick={()=>run('get-logs',()=>api.post(`/zkteco/devices/${id}/sync`,{}),'✅ Stamp=None + RELOAD OPTIONS queued')} />
            {/* Guide §8: DATA QUERY USERINFO */}
            <Item iKey="get-users" icon="👥" label="Get All Users"
              desc="DATA QUERY USERINFO → USER rows pushed via OPERLOG (guide §8)"
              onClick={()=>run('get-users',()=>api.post(`/zkteco/devices/${id}/get-users`,{}),'✅ DATA QUERY USERINFO queued')} />
            {/* Guide §6: DATA UPDATE FINGERTMP — also runs automatically on every handshake */}
            <Item iKey="restore" icon="🔄" label="Restore FP Templates"
              desc="DATA UPDATE FINGERTMP per slot — guide §6 says run on every handshake after reboot"
              disabled={fpMinus1}
              onClick={()=>run('restore',()=>api.post(`/zkteco/devices/${id}/restore-templates`,{}),'✅ DATA UPDATE FINGERTMP queued')} />
            {device.area_id && (
              <Item iKey="syncArea" icon="🗺️" label={`Sync Area: ${device.area_name||'Area'}`}
                desc="Push all area users + FP templates to this device"
                onClick={()=>run('syncArea',()=>api.post(`/zkteco/devices/${id}/sync-area`,{}),'✅ Area sync queued')} />
            )}
            <Item iKey="clear-admin" icon="🚫" label="Clear Admin"
              desc="Downgrade all admin users (Pri≥6) to regular user (Pri=0)"
              onClick={()=>{ setActiveItem(activeItem==='clear-admin'?null:'clear-admin'); }} />
            <Item iKey="clear-attlog" icon="🗑️" label="Clear Att Logs" danger
              desc="DATA CLEAR tableName=attlog — wipe all attendance records from device memory"
              onClick={()=>{ if(!window.confirm('Delete ALL attendance logs from device?\nThis removes records from the device only — eHajiri logs are unaffected.')) return; run('clear-attlog',()=>api.post(`/zkteco/devices/${id}/clear-attlog`,{}),'✅ Clear attlog queued'); }} />
            {/* Guide §12: AC_UNLOCK — fires door relay */}
            <Item iKey="unlock" icon="🚪" label="Unlock Door"
              desc="AC_UNLOCK — fires the door relay once (guide §12)"
              onClick={()=>run('unlock',()=>api.post(`/zkteco/devices/${id}/unlock`,{}),'✅ AC_UNLOCK queued')} />
            {/* Java: cancelAlarm(deviceSN) */}
            <Item iKey="cancel-alarm" icon="🔔" label="Cancel Alarm"
              desc="AC_ALARM_CANCEL — cancels active alarm on device"
              onClick={()=>run('cancel-alarm',()=>api.post(`/zkteco/devices/${id}/cancel-alarm`,{}),'✅ AC_ALARM_CANCEL queued')} />
            <Item iKey="usb-upload" icon="💾" label="USB Upload"
              desc="Import attlog.dat / user.dat exported from device USB"
              onClick={()=>setActiveItem(activeItem==='usb-upload'?null:'usb-upload')} />
            {/* Export stored users + FP templates as JSON for migration */}
            <Item iKey="export-users" icon="⬇️" label="Export Users (JSON)"
              desc="Download all users + FP templates stored in DB for this device as a JSON file"
              onClick={()=>window.open(`/api/zkteco/export-users?sn=${encodeURIComponent(sn)}`, '_blank')} />
            {/* Push all users already stored in DB back to this device */}
            <Item iKey="push-stored" icon="📤" label="Push Stored Users"
              desc="Re-push all users + FP templates already in eHajiri DB to this device (after device reset / new device)"
              onClick={()=>run('push-stored',()=>api.post(`/zkteco/devices/${id}/push-stored-users`,{}),
                '✅ Stored users + FP templates queued for push')} />
            {/* Import users from JSON file (exported from another device/server) */}
            <Item iKey="import-json" icon="📥" label="Import Users (JSON)"
              desc="Import users + FP templates from a JSON file exported from another device or server"
              onClick={()=>setActiveItem(activeItem==='import-json'?null:'import-json')} />
            </div>{/* end card grid */}
            {activeItem==='clear-admin' && (
              <FormPanel>
                <div style={{ fontSize:12,color:'#6b7280',marginBottom:8 }}>
                  Leave PIN blank to clear ALL admin users, or enter a specific PIN.
                </div>
                <div style={{ display:'flex',gap:8,alignItems:'flex-end' }}>
                  <div className="form-group" style={{ marginBottom:0,flex:1 }}>
                    <label className="form-label" style={{ fontSize:11 }}>PIN (optional)</label>
                    <input className="form-control" placeholder="All admins" value={formData.clearPin||''}
                      onChange={e=>setFormData(p=>({...p,clearPin:e.target.value}))} />
                  </div>
                  <button className="btn btn-primary btn-sm" style={{ background:'#dc2626',borderColor:'#dc2626' }}
                    disabled={!!busy['clear-admin']}
                    onClick={async()=>{
                      const msg = formData.clearPin ? `Clear admin from PIN ${formData.clearPin}?` : 'Clear ALL admin users?';
                      if (!window.confirm(msg)) return;
                      const r = await run('clear-admin',()=>api.post(`/zkteco/devices/${id}/clear-admin`,formData.clearPin?{pin:formData.clearPin}:{}),'');
                      if (r) showToast(r.message || '✅ Clear Admin queued', r.queued > 0 ? 'success' : 'warning');
                      setFormData(p=>({...p,clearPin:''})); setActiveItem(null);
                    }}>
                    {busy['clear-admin']?'⏳':'🚫'} Clear
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={()=>setActiveItem(null)}>✕</button>
                </div>
              </FormPanel>
            )}
            {activeItem==='usb-upload' && (
              <FormPanel>
                <input ref={usbInputRef} type="file" accept=".dat,.txt,.csv,.log" style={{ display:'none' }}
                  onChange={e=>{
                    const f=e.target.files?.[0]; if(!f) return;
                    const r=new FileReader(); r.onload=ev=>setUsbFile({name:f.name,content:ev.target.result}); r.readAsText(f,'utf-8');
                  }} />
                {!usbFile ? (
                  <button onClick={()=>usbInputRef.current?.click()}
                    style={{ width:'100%',padding:'10px',background:'white',border:'2px dashed #93c5fd',
                      borderRadius:8,color:'#0369a1',fontSize:13,fontWeight:600,cursor:'pointer' }}>
                    📁 Choose .dat file from USB drive
                  </button>
                ) : (
                  <div>
                    <div style={{ background:'#1f2937',borderRadius:6,padding:'8px 12px',marginBottom:8,
                      display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                      <div>
                        <div style={{ color:'#d1fae5',fontSize:12,fontWeight:700 }}>💾 {usbFile.name}</div>
                        <div style={{ color:'#9ca3af',fontSize:11 }}>{usbFile.content.split('\n').filter(l=>l.trim()).length} lines</div>
                      </div>
                      <button onClick={()=>{setUsbFile(null);setUsbResult(null);if(usbInputRef.current)usbInputRef.current.value='';}}
                        style={{ background:'none',border:'none',color:'#9ca3af',cursor:'pointer',fontSize:14 }}>✕</button>
                    </div>
                    <div style={{ display:'flex',gap:6 }}>
                      <button className="btn btn-primary btn-sm" disabled={!!busy['usb-upload']}
                        onClick={async()=>{
                          setBusy(p=>({...p,'usb-upload':true}));
                          try{
                            const r=await api.post(`/zkteco/devices/${id}/usb-upload`,usbFile);
                            setUsbResult(r);
                            showToast(`✅ USB Import: ${r.attInserted} logs + ${r.usersUpserted} users`,'success');
                          }catch(err){showToast(err.message,'danger');}
                          finally{setBusy(p=>({...p,'usb-upload':false}));}
                        }}>
                        {busy['usb-upload']?'⏳':'📤'} Import
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={()=>usbInputRef.current?.click()}>📁 Change</button>
                      <button className="btn btn-outline btn-sm" onClick={()=>{setActiveItem(null);setUsbFile(null);setUsbResult(null);}}>Close</button>
                    </div>
                    {usbResult && (
                      <div style={{ marginTop:8,background:'#d1fae5',border:'1px solid #6ee7b7',borderRadius:6,padding:'8px 12px',fontSize:12,color:'#065f46' }}>
                        ✅ {usbResult.attInserted} att records · {usbResult.usersUpserted} users · {usbResult.skipped} skipped
                      </div>
                    )}
                  </div>
                )}
              </FormPanel>
            )}
            {activeItem==='import-json' && (
              <FormPanel>
                <input ref={importJsonRef} type="file" accept=".json" style={{ display:'none' }}
                  onChange={e=>{
                    const f=e.target.files?.[0]; if(!f) return;
                    const r=new FileReader();
                    r.onload=ev=>{
                      try{
                        const data=JSON.parse(ev.target.result);
                        setImportJson({ name:f.name, users:data.users||[], total:data.userCount });
                        setImportJsonResult(null);
                      }catch{ showToast('Invalid JSON file','danger'); }
                    };
                    r.readAsText(f,'utf-8');
                  }} />
                {!importJson ? (
                  <div>
                    <div style={{ fontSize:12,color:'#6b7280',marginBottom:8 }}>
                      Load a <code>.json</code> file exported from another device or eHajiri server.
                      Users + fingerprint templates will be stored in DB and pushed to this device.
                    </div>
                    <button onClick={()=>importJsonRef.current?.click()}
                      style={{ width:'100%',padding:'10px',background:'white',border:'2px dashed #93c5fd',
                        borderRadius:8,color:'#0369a1',fontSize:13,fontWeight:600,cursor:'pointer' }}>
                      📁 Choose users JSON file
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ background:'#1f2937',borderRadius:6,padding:'8px 12px',marginBottom:8,
                      display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                      <div>
                        <div style={{ color:'#d1fae5',fontSize:12,fontWeight:700 }}>📥 {importJson.name}</div>
                        <div style={{ color:'#9ca3af',fontSize:11 }}>
                          {importJson.users.length} users
                          {' · '}{importJson.users.reduce((s,u)=>s+(u.fpTemplates?.filter(f=>f.template)?.length||0),0)} FP templates
                        </div>
                      </div>
                      <button onClick={()=>{setImportJson(null);setImportJsonResult(null);if(importJsonRef.current)importJsonRef.current.value='';}}
                        style={{ background:'none',border:'none',color:'#9ca3af',cursor:'pointer',fontSize:14 }}>✕</button>
                    </div>
                    <div style={{ display:'flex',gap:6,marginBottom:8 }}>
                      <button className="btn btn-primary btn-sm" disabled={!!busy['import-json']}
                        style={{ background:'#059669',borderColor:'#059669' }}
                        onClick={async()=>{
                          setBusy(p=>({...p,'import-json':true}));
                          try{
                            const r=await api.post(`/zkteco/devices/${id}/import-users`,{ users:importJson.users });
                            setImportJsonResult(r);
                            showToast(`✅ ${r.userCount} users + ${r.fpCount} FP templates queued`,'success');
                          }catch(err){showToast(err.message,'danger');}
                          finally{setBusy(p=>({...p,'import-json':false}));}
                        }}>
                        {busy['import-json']?'⏳':'📥'} Import & Push to Device
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={()=>importJsonRef.current?.click()}>📁 Change</button>
                      <button className="btn btn-outline btn-sm" onClick={()=>{setActiveItem(null);setImportJson(null);setImportJsonResult(null);}}>Close</button>
                    </div>
                    {importJsonResult && (
                      <div style={{ background:'#d1fae5',border:'1px solid #6ee7b7',borderRadius:6,padding:'8px 12px',fontSize:12,color:'#065f46' }}>
                        ✅ {importJsonResult.userCount} users + {importJsonResult.fpCount} FP templates queued for device
                      </div>
                    )}
                  </div>
                )}
              </FormPanel>
            )}
          </Group>

          {/* ━━━ 3. DEVICE COMMAND ━━━ */}
          <Group gKey="device-cmd" icon="⚡" title="Device Command">
            <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            <Item iKey="upload-user" icon="📤" label="Upload User to Device"
              desc="DATA UPDATE USERINFO (guide §3)"
              onClick={()=>setActiveItem(activeItem==='upload-user'?null:'upload-user')} />
            </div>{/* end card grid */}
            {activeItem==='upload-user' && (
              <FormPanel>
                <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10 }}>
                  {[
                    { key:'pin',  label:'PIN *',  ph:'e.g. 42' },
                    { key:'name', label:'Name *', ph:'Full name' },
                  ].map(f=>(
                    <div key={f.key} className="form-group" style={{ marginBottom:0 }}>
                      <label className="form-label" style={{ fontSize:11 }}>{f.label}</label>
                      <input className="form-control" placeholder={f.ph} value={formData[f.key]||''}
                        onChange={e=>setFormData(p=>({...p,[f.key]:e.target.value}))} />
                    </div>
                  ))}
                  <div className="form-group" style={{ marginBottom:0 }}>
                    <label className="form-label" style={{ fontSize:11 }}>Privilege</label>
                    <select className="form-control" value={formData.privilege||0}
                      onChange={e=>setFormData(p=>({...p,privilege:+e.target.value}))}>
                      {Object.entries(PRIV_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom:0 }}>
                    <label className="form-label" style={{ fontSize:11 }}>Card No.</label>
                    <input className="form-control" placeholder="0" value={formData.card||''}
                      onChange={e=>setFormData(p=>({...p,card:e.target.value}))} />
                  </div>
                </div>
                <div style={{ display:'flex',gap:6 }}>
                  <button className="btn btn-primary btn-sm" disabled={!formData.pin||!formData.name||!!busy['upload-user']}
                    onClick={async()=>{
                      await run('upload-user',()=>api.post(`/zkteco/devices/${id}/upload-user`,{
                        pin:formData.pin,name:formData.name,privilege:formData.privilege||0,card:formData.card||'0'
                      }),'✅ User upload queued');
                      setFormData(p=>({...p,pin:'',name:'',privilege:0,card:''}));
                      setActiveItem(null);
                    }}>
                    {busy['upload-user']?'⏳':'📤'} Upload
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={()=>setActiveItem(null)}>Cancel</button>
                </div>
              </FormPanel>
            )}

            {/* Secondary items in a card grid */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginTop: activeItem==='upload-user'?10:0 }}>
            <Item iKey="delete-user" icon="🗑" label="Delete User" danger
              desc="DATA DELETE USERINFO (guide §4)"
              onClick={()=>setActiveItem(activeItem==='delete-user'?null:'delete-user')} />
            {/* Java: enrollCard(deviceSN, userPin, retry) → ENROLL_ID */}
            <Item iKey="enroll-card" icon="💳" label="Enroll Card (RFID)"
              desc="ENROLL_ID PIN=X\tRETRY=3 — prompts user to scan RFID card on device"
              onClick={()=>setActiveItem(activeItem==='enroll-card'?null:'enroll-card')} />
            <Item iKey="enable-device" icon="✅" label="Enable Device"
              desc="ENABLE — re-enable device input (allow punches) after disabling"
              onClick={()=>run('enable-device',()=>api.post(`/zkteco/devices/${id}/enable`,{}),'✅ ENABLE queued')} />
            <Item iKey="disable-device" icon="⛔" label="Disable Device" danger
              desc="DISABLE — block all punches until re-enabled"
              onClick={()=>{ if(!window.confirm('Disable all input on device? Users will not be able to punch until re-enabled.')) return; run('disable-device',()=>api.post(`/zkteco/devices/${id}/disable`,{}),'✅ DISABLE queued'); }} />
            <Item iKey="delete-fp-slot" icon="🖐️" label="Delete FP Slot"
              desc="DATA DELETE FINGERTMP PIN=X FID=X — remove one fingerprint slot from device"
              onClick={()=>setActiveItem(activeItem==='delete-fp-slot'?null:'delete-fp-slot')} />
            {/* Guide §5: ENROLL_FP PIN\tName\tFID\tRETRY=3\tOVERWRITE=1 */}
            <Item iKey="enroll" icon="👆" label="Remote Enrollment (Finger/Face)"
              desc="ENROLL_FP PIN\tFID\tRETRY=3\tOVERWRITE=1 — device prompts user to scan (guide §5)"
              onClick={()=>{ setActiveItem(activeItem==='enroll'?null:'enroll'); setEnrollType(null); }} />
            <Item iKey="custom-cmd" icon="⌨️" label="Custom Command"
              desc="Send any raw ADMS command to this device"
              onClick={()=>setActiveItem(activeItem==='custom-cmd'?null:'custom-cmd')} />
            </div>{/* end secondary card grid */}

            {/* All form panels outside the flex grid so they render full-width with correct tab order */}
            {activeItem==='delete-user' && (
              <FormPanel>
                <div style={{ display:'flex',gap:8,alignItems:'flex-end',marginBottom:8 }}>
                  <div className="form-group" style={{ marginBottom:0,flex:1 }}>
                    <label className="form-label" style={{ fontSize:11 }}>Device PIN *</label>
                    <input className="form-control" placeholder="e.g. 42" value={formData.deletePin||''}
                      onChange={e=>setFormData(p=>({...p,deletePin:e.target.value}))} />
                  </div>
                  <button className="btn btn-primary btn-sm" style={{ background:'#dc2626',borderColor:'#dc2626' }}
                    disabled={!formData.deletePin||!!busy['delete-user']}
                    onClick={async()=>{
                      if(!window.confirm(`Delete PIN ${formData.deletePin} from device?\nPermanent — removes user + all FP templates.`)) return;
                      await run('delete-user',()=>api.post(`/zkteco/devices/${id}/delete-user`,{pin:formData.deletePin}),'✅ Delete queued');
                      setFormData(p=>({...p,deletePin:''})); setActiveItem(null);
                    }}>
                    {busy['delete-user']?'⏳':'🗑'} Delete
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={()=>setActiveItem(null)}>Cancel</button>
                </div>
                <div style={{ background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:6,padding:'6px 10px',fontSize:11,color:'#991b1b' }}>
                  ⚠️ Permanent — DATA DELETE USERINFO removes user + all FP templates from device
                </div>
              </FormPanel>
            )}
            {activeItem==='enroll-card' && (
              <FormPanel>
                <div style={{ display:'flex',gap:8,alignItems:'flex-end' }}>
                  <div className="form-group" style={{ marginBottom:0,flex:1 }}>
                    <label className="form-label" style={{ fontSize:11 }}>PIN *</label>
                    <input className="form-control" placeholder="Device PIN" value={formData.enrollCardPin||''}
                      onChange={e=>setFormData(p=>({...p,enrollCardPin:e.target.value}))} />
                  </div>
                  <button className="btn btn-primary btn-sm"
                    disabled={!formData.enrollCardPin||!!busy['enroll-card']}
                    onClick={async()=>{
                      await run('enroll-card',()=>api.post(`/zkteco/devices/${id}/enroll-card`,{pin:formData.enrollCardPin,retry:3}),'✅ Card enrollment queued — place card on device reader');
                      setFormData(p=>({...p,enrollCardPin:''})); setActiveItem(null);
                    }}>
                    {busy['enroll-card']?'⏳':'💳'} Start Card Enroll
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={()=>setActiveItem(null)}>Cancel</button>
                </div>
                <div style={{ fontSize:11,color:'#6b7280',marginTop:6 }}>
                  After queuing: place the card on the device reader when it prompts.
                </div>
              </FormPanel>
            )}
            {activeItem==='enroll' && (
              <FormPanel>
                {!enrollType ? (
                  /* Choose type */
                  <div>
                    <div style={{ fontWeight:700,fontSize:13,color:'#374151',marginBottom:10,textAlign:'center' }}>
                      Choose Enrollment Type
                    </div>
                    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
                      {[
                        { t:'fp',   icon:'👆', label:'Fingerprint', color:'#1a56db', bg:'#eff6ff', disabled:fpMinus1, note:fpMinus1?'Not supported (FPCount=-1)':'' },
                        { t:'face', icon:'👤', label:'Face',        color:'#7c3aed', bg:'#f5f3ff', disabled:false },
                      ].map(e=>(
                        <button key={e.t} disabled={e.disabled}
                          onClick={()=>setEnrollType(e.t)}
                          style={{ padding:'16px 10px',background:e.disabled?'#f9fafb':e.bg,
                            border:`2px solid ${e.disabled?'#e5e7eb':e.color}22`,borderRadius:10,
                            cursor:e.disabled?'not-allowed':'pointer',
                            opacity:e.disabled?0.5:1, textAlign:'center' }}>
                          <div style={{ fontSize:28,marginBottom:4 }}>{e.icon}</div>
                          <div style={{ fontWeight:700,fontSize:13,color:e.disabled?'#9ca3af':e.color }}>{e.label}</div>
                          {e.note&&<div style={{ fontSize:10,color:'#dc2626',marginTop:3 }}>{e.note}</div>}
                        </button>
                      ))}
                    </div>
                    <button className="btn btn-outline btn-sm" style={{ width:'100%',marginTop:8 }}
                      onClick={()=>setActiveItem(null)}>Cancel</button>
                  </div>
                ) : (
                  /* Enrollment form */
                  <div>
                    <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:10,fontWeight:700,fontSize:13,color:enrollType==='fp'?'#1a56db':'#7c3aed' }}>
                      {enrollType==='fp'?'👆 Fingerprint Enrollment':'👤 Face Enrollment'}
                      <button onClick={()=>setEnrollType(null)}
                        style={{ background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:12,marginLeft:'auto' }}>
                        ← Change type
                      </button>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns: enrollType==='fp'?'1fr 1fr 1fr':'1fr 1fr', gap:10, marginBottom:10 }}>
                      <div className="form-group" style={{ marginBottom:0 }}>
                        <label className="form-label" style={{ fontSize:11 }}>PIN *</label>
                        <input className="form-control" placeholder="Device PIN" value={formData.enrollPin||''}
                          onChange={e=>setFormData(p=>({...p,enrollPin:e.target.value}))} />
                      </div>
                      <div className="form-group" style={{ marginBottom:0 }}>
                        <label className="form-label" style={{ fontSize:11 }}>Name</label>
                        <input className="form-control" placeholder="(shown on device)" value={formData.enrollName||''}
                          onChange={e=>setFormData(p=>({...p,enrollName:e.target.value}))} />
                      </div>
                      {enrollType==='fp' && (
                        <div className="form-group" style={{ marginBottom:0 }}>
                          <label className="form-label" style={{ fontSize:11 }}>Finger Slot (FID)</label>
                          <select className="form-control" value={formData.enrollFid||0}
                            onChange={e=>setFormData(p=>({...p,enrollFid:+e.target.value}))}>
                            {FINGER_LABELS.map((l,i)=><option key={i} value={i}>{i}: {l}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    <div style={{ background:'#fef3c7',border:'1px solid #fcd34d',borderRadius:6,padding:'7px 10px',fontSize:11,color:'#92400e',marginBottom:10 }}>
                      After queuing: go to the device — it will prompt the user to scan (3 attempts). Template is returned via OPERLOG.
                    </div>
                    <div style={{ display:'flex',gap:6 }}>
                      <button className="btn btn-primary btn-sm"
                        style={{ background:enrollType==='fp'?'#1a56db':'#7c3aed', borderColor:enrollType==='fp'?'#1a56db':'#7c3aed' }}
                        disabled={!formData.enrollPin||!!busy['enroll']}
                        onClick={async()=>{
                          const ep = enrollType==='fp' ? `/zkteco/devices/${id}/enroll-fp` : `/zkteco/devices/${id}/enroll-face`;
                          const body = { pin:formData.enrollPin, name:formData.enrollName||'', fingerId:formData.enrollFid||0, retry:3, overwrite:1 };
                          await run('enroll',()=>api.post(ep,body),`✅ ${enrollType==='fp'?'Fingerprint':'Face'} enrollment queued`);
                          setFormData(p=>({...p,enrollPin:'',enrollName:'',enrollFid:0}));
                          setActiveItem(null); setEnrollType(null);
                        }}>
                        {busy['enroll']?'⏳':enrollType==='fp'?'👆':'👤'} Start Enrollment
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={()=>{setActiveItem(null);setEnrollType(null);}}>Cancel</button>
                    </div>
                  </div>
                )}
              </FormPanel>
            )}
            {activeItem==='delete-fp-slot' && (
              <FormPanel>
                <div style={{ fontSize:12,color:'#6b7280',marginBottom:8 }}>
                  Remove a single fingerprint slot from the device (0=right index … 9).
                </div>
                <div style={{ display:'flex',gap:8,alignItems:'flex-end' }}>
                  <div className="form-group" style={{ marginBottom:0,flex:1 }}>
                    <label className="form-label" style={{ fontSize:11 }}>Device PIN *</label>
                    <input className="form-control" placeholder="e.g. 42" value={formData.deleteFpPin||''}
                      onChange={e=>setFormData(p=>({...p,deleteFpPin:e.target.value}))} />
                  </div>
                  <div className="form-group" style={{ marginBottom:0,width:120 }}>
                    <label className="form-label" style={{ fontSize:11 }}>Finger Slot (FID)</label>
                    <select className="form-control" value={formData.deleteFpFid??0}
                      onChange={e=>setFormData(p=>({...p,deleteFpFid:+e.target.value}))}>
                      {FINGER_LABELS.map((l,i)=>(
                        <option key={i} value={i}>{i}: {l}</option>
                      ))}
                    </select>
                  </div>
                  <button className="btn btn-primary btn-sm" style={{ background:'#dc2626',borderColor:'#dc2626' }}
                    disabled={!formData.deleteFpPin||!!busy['delete-fp-slot']}
                    onClick={async()=>{
                      if(!window.confirm(`Delete finger slot ${formData.deleteFpFid??0} for PIN ${formData.deleteFpPin}?`)) return;
                      await run('delete-fp-slot',()=>api.post(`/zkteco/devices/${id}/delete-fp-slot`,{pin:formData.deleteFpPin,fid:formData.deleteFpFid??0}),'✅ Delete FP slot queued');
                      setFormData(p=>({...p,deleteFpPin:'',deleteFpFid:0})); setActiveItem(null);
                    }}>
                    {busy['delete-fp-slot']?'⏳':'🖐️'} Delete Slot
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={()=>setActiveItem(null)}>Cancel</button>
                </div>
              </FormPanel>
            )}
            {activeItem==='custom-cmd' && (
              <FormPanel>
                <div style={{ fontSize:12,fontWeight:700,color:'#374151',marginBottom:8 }}>⌨️ Custom ADMS Command</div>
                {/* Quick presets grouped by category */}
                {[
                  { label:'🕐 Time / Timezone', color:'#0369a1', bg:'#e0f2fe', border:'#bae6fd', cmds:[
                    'SET OPTION MachineTZFunOn=0',
                    'SET OPTION MachineTZ=+0545',
                    'RELOAD OPTIONS',
                  ]},
                  { label:'🔒 Time Schedule', color:'#7c3aed', bg:'#f5f3ff', border:'#ddd6fe', cmds:[
                    'SET OPTION LockFunOn=15',
                  ]},
                  { label:'✅ Expiry / Validity', color:'#065f46', bg:'#d1fae5', border:'#6ee7b7', cmds:[
                    'SET OPTION SupportUserValidateDate=1',
                    'SET OPTION UserValidTimeFun=1',
                  ]},
                  { label:'⚙️ General', color:'#374151', bg:'#f3f4f6', border:'#d1d5db', cmds:[
                    'CHECK',
                    'DATA QUERY USERINFO',
                    'DATA CLEAR tableName=attlog',
                    'ENABLE',
                    'DISABLE',
                  ]},
                ].map(group=>(
                  <div key={group.label} style={{ marginBottom:8 }}>
                    <div style={{ fontSize:10,fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4 }}>
                      {group.label}
                    </div>
                    <div style={{ display:'flex',flexWrap:'wrap',gap:5 }}>
                      {group.cmds.map(preset=>{
                        const active = formData.customCmd===preset;
                        return (
                          <button key={preset}
                            onClick={()=>setFormData(p=>({...p,customCmd:preset}))}
                            style={{ padding:'3px 10px',fontSize:11,fontFamily:'monospace',
                              background: active ? group.color : group.bg,
                              color:      active ? 'white'      : group.color,
                              border:`1px solid ${active ? group.color : group.border}`,
                              borderRadius:6,cursor:'pointer',whiteSpace:'nowrap',transition:'all .1s' }}>
                            {preset}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="form-group" style={{ marginBottom:10 }}>
                  <label className="form-label" style={{ fontSize:11 }}>Command *</label>
                  <input className="form-control" style={{ fontFamily:'monospace',fontSize:13 }}
                    placeholder="e.g. SET OPTION MachineTZ=+0545"
                    value={formData.customCmd||''}
                    onChange={e=>setFormData(p=>({...p,customCmd:e.target.value}))}
                    onKeyDown={e=>{ if(e.key==='Enter'&&formData.customCmd?.trim()) document.getElementById('custom-cmd-send')?.click(); }} />
                  <div style={{ fontSize:11,color:'#9ca3af',marginTop:4 }}>
                    Will be queued as <code style={{ background:'#f3f4f6',padding:'1px 4px',borderRadius:3 }}>C:ID:{formData.customCmd||'...'}</code>
                  </div>
                </div>
                <div style={{ display:'flex',gap:6 }}>
                  <button id="custom-cmd-send" className="btn btn-primary btn-sm"
                    disabled={!formData.customCmd?.trim()||!!busy['custom-cmd']}
                    onClick={async()=>{
                      const r = await run('custom-cmd',()=>api.post(`/zkteco/devices/${id}/custom-command`,{command:formData.customCmd.trim()}),`✅ Queued: ${formData.customCmd}`);
                      if(r) setFormData(p=>({...p,customCmd:''}));
                    }}>
                    {busy['custom-cmd']?'⏳':'⌨️'} Send Command
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={()=>{ setActiveItem(null); setFormData(p=>({...p,customCmd:''})); }}>Cancel</button>
                </div>
              </FormPanel>
            )}
          </Group>

        </div>

        <div className="modal-footer" style={{ position:'sticky',bottom:0,background:'white',borderTop:'1px solid #e5e7eb' }}>
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   Main Component
═══════════════════════════════════════════════════════════ */
const ZKTecoDeviceSettings = () => {
  const { language } = useLanguage();
  const L = (np,en) => language==='np' ? np : en;

  const [subTab,     setSubTab]     = useState('devices');
  const [devices,    setDevices]    = useState([]);
  const [logs,       setLogs]       = useState([]);
  const [devUsers,      setDevUsers]      = useState([]);
  const [usersLoading,  setUsersLoading]  = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState([]);  // checked rows in Device Users grid
  const [editingUserId,   setEditingUserId]   = useState(null); // ID of user being name-edited
  const [editName,        setEditName]        = useState('');
  const [userActionBusy,  setUserActionBusy]  = useState(false);
  const [syncing,         setSyncing]         = useState(false);
  const [syncResult,    setSyncResult]    = useState(null);
  const [importing,     setImporting]     = useState(false);
  const [importModal,   setImportModal]   = useState(false);
  const [importResult,  setImportResult]  = useState(null);
  const [emailDomain,   setEmailDomain]   = useState('planetinfosys.com.np');
  const [linkModal,     setLinkModal]     = useState(null);  // device user row being linked
  const [staffList,     setStaffList]     = useState([]);
  const [fingerprints,  setFingerprints]  = useState([]);
  const [areas,         setAreas]         = useState([]);
  const [areasLoading,  setAreasLoading]  = useState(false);
  const [areaModal,     setAreaModal]     = useState(false);
  const [areaEditId,    setAreaEditId]    = useState(null);
  const [areaForm,      setAreaForm]      = useState({ name:'', parentId:'', description:'' });
  const [areaErrors,    setAreaErrors]    = useState({});
  const [areaDelConfirm,setAreaDelConfirm]= useState(null);
  const [commands,   setCommands]   = useState([]);
  const [stats,      setStats]      = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [toast,      setToast]      = useState(null);
  const [syncingId,      setSyncingId]      = useState(null);
  const [controlDevice,  setControlDevice]  = useState(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([]);  // checked device IDs
  const [cmdMenuOpen,    setCmdMenuOpen]    = useState(false);      // command dropdown open
  const cmdMenuRef = useRef(null);

  const [modal,      setModal]      = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [form,       setForm]       = useState({ ...emptyDevice });
  const [errors,     setErrors]     = useState({});
  const [delConfirm, setDelConfirm] = useState(null);

  const [logFilter,    setLogFilter]    = useState(() => {
    // Default: From = 3 months ago, To = today
    const today = new Date();
    const fmt   = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const from3m = new Date(today); from3m.setMonth(from3m.getMonth() - 3);
    return { sn:'', pin:'', from: fmt(from3m), to: fmt(today) };
  });
  const [logPage,      setLogPage]      = useState(1);
  const [logTotal,     setLogTotal]     = useState(0);
  const [lastUpdated,  setLastUpdated]  = useState(null);
  const LOG_LIMIT = 50;

  const [cmdModal, setCmdModal] = useState(false);
  const [cmdForm,  setCmdForm]  = useState({ deviceSn:'',commandPayload:'' });

  const deviceTimer  = useRef(null);
  const logTimer     = useRef(null);
  const usersTimer   = useRef(null);
  const logFilterRef = useRef(logFilter);
  const logPageRef   = useRef(logPage);
  useEffect(() => { logFilterRef.current = logFilter; }, [logFilter]);
  useEffect(() => { logPageRef.current   = logPage;   }, [logPage]);

  // Close command dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (cmdMenuRef.current && !cmdMenuRef.current.contains(e.target)) setCmdMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const showToast = (msg,type='success') => { setToast({ msg,type }); setTimeout(()=>setToast(null),4000); };

  /* ── loaders ── */
  const loadDevices = useCallback(async (silent=false) => {
    if (!silent) setLoading(true);
    try {
      const [devs,st] = await Promise.all([
        api.get('/zkteco/devices'),
        api.get('/zkteco/stats').catch(()=>null),
      ]);
      setDevices(devs||[]);
      if (st) setStats(st);
    } catch {}
    finally { if (!silent) setLoading(false); }
  },[]);

  const fetchLogs = useCallback(async (page, silent=false) => {
    const f = logFilterRef.current;
    const p = page ?? logPageRef.current;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page:p, limit:LOG_LIMIT });
      if (f.sn)   params.set('sn',  f.sn);
      if (f.pin)  params.set('pin', f.pin);
      if (f.from) params.set('from',f.from);
      if (f.to)   params.set('to',  f.to);
      const data = await api.get(`/zkteco/logs?${params}`);
      setLogs(data?.rows||[]);
      setLogTotal(data?.total||0);
      setLogPage(p);
      setLastUpdated(new Date());
    } catch {}
    finally { if (!silent) setLoading(false); }
  },[]);

  const loadLogs     = useCallback((pg=1) => fetchLogs(pg,false),[fetchLogs]);
  const loadDevUsers = useCallback(async (silent = false) => {
    if (!silent) setUsersLoading(true);
    try { setDevUsers(await api.get('/zkteco/device-users') || []); } catch {}
    finally { if (!silent) setUsersLoading(false); }
  },[]);

  /** Silent auto-sync: runs in background, reloads users after match, no toast. */
  const autoSyncToStaff = useCallback(async () => {
    try {
      const r = await api.post('/zkteco/sync-to-staff', {});
      if (r.matched > 0) await loadDevUsers(true);   // refresh only if something changed
    } catch { /* ignore silently */ }
  },[loadDevUsers]);

  const loadStaff = useCallback(async () => {
    try { setStaffList(await api.get('/employees') || []); } catch {}
  },[]);
  const loadFingerprints = useCallback(async () => {
    try { setFingerprints(await api.get('/zkteco/fingerprints') || []); } catch {}
  },[]);
  const loadCommands = useCallback(async () => {
    try { setCommands(await api.get('/zkteco/commands') || []); } catch {}
  },[]);

  const loadAreas = useCallback(async (silent=false) => {
    if (!silent) setAreasLoading(true);
    try { setAreas(await api.get('/zkteco/areas') || []); } catch {}
    finally { if (!silent) setAreasLoading(false); }
  },[]);

  useEffect(() => {
    loadDevices();
    deviceTimer.current = setInterval(()=>loadDevices(true),15000);
    return ()=>clearInterval(deviceTimer.current);
  },[loadDevices]);

  useEffect(() => {
    clearInterval(logTimer.current);
    clearInterval(usersTimer.current);

    if (subTab==='logs') {
      fetchLogs(1,false);
      logTimer.current = setInterval(()=>fetchLogs(null,true),5000);
    }
    if (subTab==='users') {
      // Load users, then silently auto-sync PIN/Name → staff in background
      loadDevUsers(false).then(() => autoSyncToStaff());
      loadStaff();
      // Refresh every 3 s (picks up new device users + new links)
      usersTimer.current = setInterval(()=>{
        loadDevUsers(true).then(() => autoSyncToStaff());
      }, 3000);
    }
    if (subTab==='fingerprints') {
      // Fingerprints tab now shows per-user biometric summary from devUsers
      loadDevUsers(false);
      usersTimer.current = setInterval(()=>loadDevUsers(true), 5000);
    }
    if (subTab==='commands') loadCommands();
    if (subTab==='areas')    loadAreas();
    if (subTab==='devices')  loadAreas();  // pre-load areas for the Edit Device form

    return () => {
      clearInterval(logTimer.current);
      clearInterval(usersTimer.current);
    };
  },[subTab,fetchLogs,loadDevUsers,autoSyncToStaff,loadStaff,loadFingerprints,loadCommands,loadAreas]);

  /* ── device CRUD ── */
  const openAdd  = () => { setForm({...emptyDevice}); setErrors({}); setEditId(null); setModal(true); };
  const openEdit = (d) => {
    setForm({ name:d.name||'',serialNumber:d.serial_number||'',ipAddress:d.last_ip||d.ip_address||'',
      port:d.port||4370, model:d.model||'SenseFace', deviceType:d.device_type||'face',
      location:d.location||'', communicationKey:d.communication_key||'0',
      timezoneOffset: d.timezone_offset ?? 345,
      areaId: d.area_id ? String(d.area_id) : '' });
    setErrors({}); setEditId(d.id); setModal(true);
  };
  const handleSave = async () => {
    if (!form.name.trim()) { setErrors({name:'Required'}); return; }
    try {
      if (editId) await api.put(`/zkteco/devices/${editId}`, {
        name: form.name,
        location: form.location,
        communicationKey: form.communicationKey,
        timezoneOffset: form.timezoneOffset ?? 345,
        areaId: form.areaId || null,
      });
      else await api.post('/zkteco/devices', form);
      showToast(editId ? 'Device updated' : 'Device added');
      setModal(false);
      loadDevices();
    } catch (err) { showToast(err.message,'danger'); }
  };
  const handleDelete = async (id) => {
    try {
      await api.delete(`/zkteco/devices/${id}`);
      showToast('Device deleted');
      setDelConfirm(null);
      loadDevices();
    } catch (err) { showToast(err.message,'danger'); }
  };
  const handleSync = async (device) => {
    if (!device.serial_number) { showToast('No serial number yet','danger'); return; }
    setSyncingId(device.id);
    try {
      await api.post(`/zkteco/devices/${device.id}/sync`,{});
      showToast(`${device.name}: Full sync queued`,'success');
      loadDevices(true);
    } catch (err) { showToast(err.message,'danger'); }
    finally { setSyncingId(null); }
  };
  const handleImportToStaff = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const r = await api.post('/zkteco/import-to-staff', { emailDomain });
      setImportResult(r);
      await loadDevUsers(false);
      await loadStaff();
    } catch (err) { showToast(err.message, 'danger'); }
    finally { setImporting(false); }
  };

  const handleSyncToStaff = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await api.post('/zkteco/sync-to-staff', {});
      setSyncResult(r);
      await loadDevUsers(false);
      showToast(
        r.matched === 0
          ? L('मेल खाने कर्मचारी भेटिएन।','No new matches found.')
          : L(`${r.matched} Staff जोडियो (PIN: ${r.byPin}, नाम: ${r.byName})`,
              `${r.matched} staff linked (${r.byPin} by PIN, ${r.byName} by Name)`),
        r.matched > 0 ? 'success' : 'danger'
      );
    } catch (err) { showToast(err.message, 'danger'); }
    finally { setSyncing(false); }
  };

  /* ── Delete selected users from their device ── */
  const handleDeleteSelectedUsers = async () => {
    if (!selectedUserIds.length) return;
    const usersToDelete = devUsers.filter(u => selectedUserIds.includes(u.id));
    if (!window.confirm(
      `Delete ${usersToDelete.length} user(s) from their device(s)?\n` +
      usersToDelete.map(u => `• PIN ${u.pin} — ${u.name||'—'} (${u.device_sn})`).join('\n')
    )) return;
    setUserActionBusy(true);
    try {
      let deleted = 0;
      for (const user of usersToDelete) {
        const device = devices.find(d => d.serial_number === user.device_sn);
        if (device) {
          // Queue DATA DELETE USERINFO PIN=X on the device
          await api.post(`/zkteco/devices/${device.id}/delete-user`, { pin: user.pin });
        }
        // Remove from local DB
        await api.delete(`/zkteco/device-users/${user.id}`);
        deleted++;
      }
      showToast(`${deleted} user(s) deleted — device command queued`);
      setSelectedUserIds([]);
      await loadDevUsers(false);
    } catch (err) { showToast(err.message, 'danger'); }
    finally { setUserActionBusy(false); }
  };

  /* ── Save edited name to DB + queue device update ── */
  const handleSaveUserName = async () => {
    if (!editingUserId || !editName.trim()) return;
    const user = devUsers.find(u => u.id === editingUserId);
    if (!user) return;
    setUserActionBusy(true);
    try {
      // 1. Update name in DB
      await api.put(`/zkteco/device-users/${editingUserId}`, { name: editName.trim() });
      // 2. Queue DATA UPDATE USERINFO on the device (updates name on device screen)
      const device = devices.find(d => d.serial_number === user.device_sn);
      if (device) {
        await api.post(`/zkteco/devices/${device.id}/upload-user`, {
          pin      : user.pin,
          name     : editName.trim(),
          privilege: user.privilege || 0,
          card     : user.card_no   || '0',
        });
      }
      showToast(`Name updated${device ? ` — queued for device "${device.name}"` : ''}`);
      setEditingUserId(null);
      setEditName('');
      setSelectedUserIds([]);
      await loadDevUsers(false);
    } catch (err) { showToast(err.message, 'danger'); }
    finally { setUserActionBusy(false); }
  };

  const handleLinkUser = async (deviceUserId, employeeId) => {
    try {
      await api.post(`/zkteco/device-users/${deviceUserId}/link`, { employeeId });
      showToast(L('जोडियो', 'Linked successfully'));
      setLinkModal(null);
      loadDevUsers(false);
    } catch (err) { showToast(err.message, 'danger'); }
  };

  const handleUnlinkUser = async (deviceUserId) => {
    try {
      await api.post(`/zkteco/device-users/${deviceUserId}/unlink`, {});
      showToast(L('लिङ्क हटाइयो', 'Unlinked'));
      loadDevUsers(false);
    } catch (err) { showToast(err.message, 'danger'); }
  };

  const handleClearLogs = async () => {
    const sn = logFilterRef.current.sn;
    if (!window.confirm(sn ? `Delete logs for "${sn}"?` : 'Delete ALL attendance logs?')) return;
    try {
      await api.delete(`/zkteco/logs${sn?`?sn=${sn}`:''}`);
      showToast('Logs cleared');
      fetchLogs(1,false);
    } catch (err) { showToast(err.message,'danger'); }
  };

  /* ── badge helpers ── */
  const vBadge = (v) => {
    const m={1:['#1a56db','#eff6ff','#bfdbfe'],2:['#374151','#f3f4f6','#e5e7eb'],3:['#0369a1','#e0f2fe','#bae6fd'],15:['#7c3aed','#f5f3ff','#ddd6fe']};
    const [c,bg,b]=m[v]||['#374151','#f3f4f6','#e5e7eb'];
    return <Badge color={c} bg={bg} border={b}>{VERIFY_LABELS[v]||`V${v}`}</Badge>;
  };
  const cBadge = (t) => {
    const m={0:['#065f46','#d1fae5','#6ee7b7'],1:['#991b1b','#fee2e2','#fca5a5'],2:['#92400e','#fef3c7','#fcd34d'],3:['#1e40af','#dbeafe','#93c5fd'],4:['#5b21b6','#ede9fe','#c4b5fd'],5:['#9d174d','#fce7f3','#f9a8d4']};
    const [c,bg,b]=m[t]||['#374151','#f3f4f6','#e5e7eb'];
    return <Badge color={c} bg={bg} border={b}>{CHECK_LABELS[t]||`T${t}`}</Badge>;
  };

  /* ── SUB TABS ── */
  const subTabs = [
    { key:'devices',      icon:'📡', label:L('डिभाइस','Devices'),              count: devices.length },
    { key:'logs',         icon:'📋', label:L('हाजिरी लग','Att. Logs'),          count: logTotal||null },
    { key:'users',        icon:'👥', label:L('प्रयोगकर्ता','Device Users'),     count: devUsers.length||null },
    { key:'fingerprints', icon:'👆', label:L('बायोमेट्रिक','Biometrics'),
      count: devUsers.filter(u=>(u.fp_count||0)+(u.face_count||0)>0).length || null },
    { key:'areas',        icon:'🗺️', label:L('Area','Area'),                      count: areas.length||null },
    { key:'access',       icon:'🔐', label:L('Access Rule','Access Rule'),          count: null },
    { key:'commands',     icon:'⚡', label:L('कमान्डहरू','Commands'),            count: null },
    { key:'setup',        icon:'📖', label:L('गाइड','Setup Guide'),              count: null },
  ];

  /* ── device columns ── */
  const deviceColumns = [
    { field:'name', header:'Name | Location', width:175,
      render:(v,row) => (
        <span style={{ display:'inline-flex', alignItems:'center', gap:0 }}>
          <span style={{ fontWeight:700, color:'#1f2937', fontSize:13 }}>{v}</span>
          {row.location && (
            <>
              <span style={{ color:'#d1d5db', margin:'0 6px', fontWeight:300 }}>|</span>
              <span style={{ color:'#6b7280', fontSize:12 }}>{row.location}</span>
            </>
          )}
        </span>
      )
    },
    { field:'model', header:L('मोडल','Model'), width:120,
      render: v => <Badge color="#0369a1" bg="#e0f2fe" border="#bae6fd">{v||'Unknown'}</Badge>
    },
    { field:'serial_number', header:'S/N', width:130,
      render: v => v ? <span style={{ fontFamily:'monospace',fontSize:12 }}>{v}</span>
        : <span style={{ color:'#9ca3af',fontSize:11,fontStyle:'italic' }}>Pending connect</span>
    },
    { field:'last_ip', header:'IP', width:140,
      render:(v,row) => <span style={{ fontFamily:'monospace',fontSize:12 }}>{cleanIp(v)}{row.port?`:${row.port}`:''}</span>
    },
    { field:'user_count', header:L('Users','Users'), width:110, align:'center',
      render:(v,row) => {
        // Prefer actual_user_count (live DB count) — falls back to device CHECK result
        const dbCount  = parseInt(row.actual_user_count) || 0;
        const devCount = v != null ? parseInt(v) : null;
        // Show device count if it's larger (unsynchronised users on device not yet pulled)
        const display  = devCount != null && devCount > dbCount ? devCount : dbCount;
        const max      = row.max_user ? parseInt(row.max_user) : null;
        const mismatch = devCount != null && devCount !== dbCount;
        if (display === 0 && devCount == null) return <span style={{ color:'#d1d5db' }}>—</span>;
        return (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
            <span style={{ fontWeight:700, color:'#1a56db', fontFamily:'monospace' }}>
              {display}
              {max ? <span style={{ fontSize:10, color:'#9ca3af', fontWeight:400 }}>/{max}</span> : ''}
            </span>
            {mismatch && (
              <span style={{ fontSize:9, color:'#d97706', fontWeight:700, lineHeight:1 }}
                title={`DB has ${dbCount}, device reports ${devCount}. Run "Get All Users".`}>
                DB:{dbCount} Dev:{devCount}
              </span>
            )}
          </div>
        );
      }
    },
    { field:'total_logs', header:L('लग','Logs'), width:75, align:'center',
      render: v => <span style={{ fontWeight:700,color:'#7c3aed' }}>{v??0}</span>
    },
    { field:'last_seen', header:L('अन्तिम','Last Seen'), width:100, render: v => <OnlineDot ts={v} /> },
    { field:'area_name', header:L('Area','Area'), width:120,
      render: (v, row) => v
        ? <span style={{ background:'#fef3c7', color:'#92400e', border:'1px solid #fcd34d',
            borderRadius:10, padding:'2px 9px', fontSize:11, fontWeight:700 }}>
            🗺️ {v}
          </span>
        : <span style={{ color:'#d1d5db', fontSize:11 }}>—</span>,
    },
    { field:'active', header:'St.', width:90,
      render: (v, row) => {
        if (!v) return <Badge color="#6b7280" bg="#f3f4f6" border="#e5e7eb">Off</Badge>;
        const ts   = row.last_seen;
        const mins = ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 60000) : null;
        const isConnected = mins !== null && mins < 15;
        if (isConnected) {
          return (
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:'#10b981', flexShrink:0,
                boxShadow:'0 0 0 2px #d1fae5' }} />
              <span style={{ fontSize:12, fontWeight:700, color:'#065f46' }}>Online</span>
            </div>
          );
        }
        return (
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:'#ef4444', flexShrink:0 }} />
            <span style={{ fontSize:12, fontWeight:700, color:'#dc2626' }}>Offline</span>
          </div>
        );
      }
    },
    { field:'actions', header:L('कार्य','Actions'), width:75, sortable:false, filterable:false,
      render:(_,row) => (
        <div style={{ display:'flex',gap:4 }}>
          <button className="dg-action-btn edit" title="Edit"
            onClick={e=>{e.stopPropagation();openEdit(row);}}>✏</button>
          <button className="dg-action-btn delete" title="Delete"
            onClick={e=>{e.stopPropagation();setDelConfirm(row.id);}}>🗑</button>
        </div>
      )
    },
  ];

  /* ── log columns ── */
  const logColumns = [
    { field:'device_sn',    header:'Device SN', width:125, render:v=><span style={{ fontFamily:'monospace',fontSize:11 }}>{v||'—'}</span> },
    { field:'pin',          header:'PIN',        width:65,  render:v=><strong style={{ fontFamily:'monospace' }}>{v}</strong> },
    { field:'employee_name',header:L('कर्मचारी','Employee'), width:160,
      render:v=>v?<span style={{ fontWeight:600 }}>{v}</span>:<span style={{ color:'#9ca3af',fontSize:11,fontStyle:'italic' }}>Unlinked</span>
    },
    { field:'check_time', header:'Date | Time', width:175,
      render: v => {
        if (!v) return '—';
        const d    = new Date(v);
        const date = d.toLocaleDateString('en-US', { month:'numeric', day:'numeric', year:'numeric' });
        const time = d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', second:'2-digit', hour12:true });
        return (
          <span style={{ fontFamily:'monospace', fontSize:12, color:'#1f2937' }}>
            <span style={{ fontWeight:600 }}>{date}</span>
            <span style={{ color:'#9ca3af', margin:'0 5px', fontWeight:300 }}>|</span>
            <span style={{ color:'#374151' }}>{time}</span>
          </span>
        );
      }
    },
    { field:'check_type',  header:'Punch',  width:90,  render:v=>cBadge(v) },
    { field:'verify_type', header:'Verify', width:100, render:v=>vBadge(v) },
  ];

  /* ── device-users columns ── */
  const userColumns = [
    {
      field:'pin', header:'PIN', width:70, sortable:true,
      render: v => (
        <strong style={{ fontFamily:'monospace', color:'#1a56db', fontSize:14 }}>{v}</strong>
      ),
    },
    {
      field:'name', header:L('नाम','Name'), width:175,
      render: v => v && v !== '—'
        ? <span style={{ fontWeight:600, color:'#1f2937' }}>{v}</span>
        : <span style={{ color:'#d1d5db' }}>—</span>,
    },
    {
      field:'privilege', header:L('भूमिका','Role'), width:110,
      render: v => {
        const priv = parseInt(v)||0;
        const isAdmin = priv >= 6;
        return (
          <Badge
            color={isAdmin?'#0369a1':'#374151'}
            bg={isAdmin?'#e0f2fe':'#f3f4f6'}
            border={isAdmin?'#bae6fd':'#e5e7eb'}
          >
            {PRIV_LABELS[priv]||`P${v}`}
          </Badge>
        );
      },
    },
    {
      field:'card_no', header:L('कार्ड','Card'), width:100,
      render: v => v && v !== '0'
        ? <span style={{ fontFamily:'monospace', fontSize:12 }}>{v}</span>
        : <span style={{ color:'#d1d5db' }}>—</span>,
    },
    {
      field:'employee_name', header:L('eHajiri Staff','eHajiri Staff'), width:220,
      sortable:true,
      render: (v, row) => v ? (
        /* ── LINKED: green badge + ✕ unlink button ── */
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{
            display:'inline-flex', alignItems:'center', gap:5,
            background:'#d1fae5', color:'#065f46',
            border:'1px solid #6ee7b7', borderRadius:20,
            padding:'3px 12px', fontSize:12, fontWeight:700,
          }}>
            🔗 {v}
          </span>
          <button
            title={L('लिङ्क हटाउनुस','Remove link')}
            onClick={e=>{ e.stopPropagation(); handleUnlinkUser(row.id); }}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:14, lineHeight:1, padding:'2px 4px' }}
          >
            ✕
          </button>
        </div>
      ) : (
        /* ── NOT LINKED: "+ Link Staff" button ── */
        <button
          onClick={e=>{ e.stopPropagation(); setLinkModal(row); }}
          style={{
            background:'#eff6ff', color:'#1a56db',
            border:'1px solid #bfdbfe', borderRadius:20,
            padding:'4px 14px', fontSize:12, fontWeight:700, cursor:'pointer',
            transition:'all .15s',
          }}
        >
          + {L('Link Staff','Link Staff')}
        </button>
      ),
    },
    {
      field:'device_sn', header:'Device SN', width:135,
      render: v => <span style={{ fontFamily:'monospace', fontSize:11, color:'#9ca3af' }}>{v}</span>,
    },
    {
      field:'last_sync', header:L('सिंक','Synced'), width:100,
      render: v => v ? <span style={{ fontSize:12, color:'#6b7280' }}>{new Date(v).toLocaleDateString()}</span> : '—',
    },
  ];

  /* ── fingerprint / biometrics columns ─────────────────────────────────────
     One row per DEVICE USER showing all biometric data:
     • Finger slots (10 dots — green=enrolled, grey=empty)
     • Face count   (from FaceCount in USER row)
     • RFID card
     • Password     (from Passwd in USER row)
  ── */
  const TOTAL_FINGERS = 10;

  /* 10 finger-slot dots — green=enrolled+backup, amber=enrolled no backup, grey=empty */
  const FingerDots = ({ slots = [], slotsCount = 0 }) => {
    const slotMap = {};
    if (Array.isArray(slots)) slots.forEach(s => { slotMap[s.fid] = s; });
    const enrolledCount = Object.keys(slotMap).length;
    return (
      <div style={{ display:'flex', gap:3, alignItems:'center' }}>
        {Array.from({ length: TOTAL_FINGERS }, (_, i) => {
          const s = slotMap[i];
          const enrolled = !!s;
          const hasTemplate = s?.has_template;
          return (
            <span key={i}
              title={`Finger ${i}: ${FINGER_LABELS[i]}${enrolled ? (hasTemplate ? ' ✓ template backed up' : ' enrolled, no backup') : ' empty'}`}
              style={{
                width:13, height:13, borderRadius:'50%', display:'inline-block', flexShrink:0,
                background: enrolled ? (hasTemplate ? '#059669' : '#f59e0b') : '#e5e7eb',
                border:`1.5px solid ${enrolled ? (hasTemplate ? '#065f46' : '#d97706') : '#d1d5db'}`,
                cursor:'default',
              }}
            />
          );
        })}
        {enrolledCount > 0 && (
          <span style={{ fontSize:11, color:'#059669', fontWeight:700, marginLeft:4 }}>
            {enrolledCount}/{TOTAL_FINGERS}
          </span>
        )}
      </div>
    );
  };

  const fpColumns = [
    { field:'pin', header:'PIN',
      render: v => <strong style={{ fontFamily:'monospace', color:'#1a56db', fontSize:14 }}>{v}</strong>,
    },
    { field:'name', header:L('नाम','Name'),
      render: v => <span style={{ fontWeight:600 }}>{v && v !== '—' ? v : <span style={{ color:'#d1d5db' }}>—</span>}</span>,
    },
    { field:'employee_name', header:L('Staff','Staff'),
      render: v => v
        ? <span style={{ background:'#d1fae5', color:'#065f46', borderRadius:10, padding:'2px 9px', fontSize:11, fontWeight:700 }}>🔗 {v}</span>
        : <span style={{ color:'#9ca3af', fontSize:11 }}>Not linked</span>,
    },
    {
      field:'fp_slots', header:L('औँठाछाप','Fingerprints'), sortable:false,
      // Use fp_slots_count (from SQL COUNT) as fallback over fp_count (from USER row)
      render: (v, row) => <FingerDots slots={v || []} slotsCount={row.fp_slots_count || row.fp_count || 0} />,
    },
    {
      // Face column: show face icon + count when face templates exist on device
      field:'face_count', header:L('अनुहार','Face'), align:'center',
      render: v => {
        const count = parseInt(v) || 0;
        if (count <= 0) return <span style={{ color:'#d1d5db' }}>—</span>;
        return (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
            <span style={{ fontSize:20 }}>👤</span>
            <span style={{ fontSize:12, fontWeight:700, color:'#7c3aed',
              background:'#f5f3ff', borderRadius:10, padding:'1px 7px', border:'1px solid #ddd6fe' }}>
              {count}
            </span>
          </div>
        );
      },
    },
    {
      // RFID Card: show the actual card number when registered
      field:'card_no', header:L('RFID कार्ड','RFID Card'),
      render: v => {
        const card = (v || '').toString().trim();
        if (!card || card === '0') return <span style={{ color:'#d1d5db' }}>—</span>;
        return (
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:16 }}>💳</span>
            <span style={{ fontFamily:'monospace', fontSize:12, fontWeight:700, color:'#0369a1',
              background:'#e0f2fe', borderRadius:6, padding:'2px 8px', border:'1px solid #bae6fd' }}>
              {card}
            </span>
          </div>
        );
      },
    },
    {
      // Password/PIN: show actual value (device PIN used as keypad access)
      field:'passwd', header:L('पासवर्ड/PIN','Password / PIN'),
      render: v => {
        if (!v || v.toString().trim() === '') return <span style={{ color:'#d1d5db' }}>—</span>;
        return (
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:15 }}>🔑</span>
            <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:700, color:'#92400e',
              background:'#fef3c7', borderRadius:6, padding:'2px 8px', border:'1px solid #fcd34d' }}>
              {v}
            </span>
          </div>
        );
      },
    },
    {
      field:'last_sync', header:L('सिंक','Synced'),
      render: v => v ? <span style={{ fontSize:11, color:'#6b7280' }}>{new Date(v).toLocaleDateString()}</span> : '—',
    },
  ];

  /* ── command columns ── */
  const cmdColumns = [
    { field:'device_sn',       header:'Device SN',  width:130, render:v=><span style={{ fontFamily:'monospace',fontSize:11 }}>{v}</span> },
    { field:'command_payload', header:L('कमान्ड','Command'),
      render:v=><code style={{ fontSize:11,wordBreak:'break-all' }}>{v}</code>
    },
    { field:'status', header:'Status', width:90,
      render:v=>{ const m={PENDING:['#92400e','#fef3c7','#fcd34d'],SENT:['#1e40af','#dbeafe','#93c5fd'],DONE:['#065f46','#d1fae5','#6ee7b7']};
        const [c,bg,b]=m[v]||['#374151','#f3f4f6','#e5e7eb'];
        return <Badge color={c} bg={bg} border={b}>{v}</Badge>; }
    },
    { field:'created_at', header:L('सिर्जित','Created'), width:140, render:v=>v?new Date(v).toLocaleString():'—' },
    { field:'sent_at',    header:L('पठाइयो','Sent'),    width:140, render:v=>v?new Date(v).toLocaleString():'—' },
  ];

  return (
    <div>

      {/* Sub-tabs */}
      <div style={{ display:'flex',gap:0,borderBottom:'2px solid #e5e7eb',marginBottom:14 }}>
        {subTabs.map(t=>(
          <button key={t.key} onClick={()=>setSubTab(t.key)} style={{
            padding:'8px 14px',background:'none',border:'none',
            borderBottom:subTab===t.key?'2px solid #1a56db':'2px solid transparent',
            color:subTab===t.key?'#1a56db':'#6b7280',
            fontWeight:subTab===t.key?700:400,
            cursor:'pointer',fontSize:12.5,display:'flex',alignItems:'center',gap:5,marginBottom:-2,
          }}>
            {t.icon} {t.label}
            {t.count>0&&<span style={{ background:'#1a56db',color:'white',borderRadius:9,padding:'0px 5px',fontSize:10,fontWeight:700 }}>{t.count}</span>}
          </button>
        ))}
        {subTab==='devices'&&(
          <div style={{ marginLeft:'auto',display:'flex',alignItems:'center',gap:6,paddingRight:4 }}>
            <span style={{ fontSize:11,color:'#9ca3af' }}>Auto-refresh 15s</span>
            <button className="btn btn-outline btn-sm" onClick={()=>loadDevices()}>🔃</button>
          </div>
        )}
      </div>

      {/* ══════ DEVICES ══════ */}
      {subTab==='devices'&&(
        <DataGrid
          columns={deviceColumns}
          data={devices}
          defaultPageSize={10}
          showSearch
          compact
          loading={loading}
          onRowDoubleClick={row => setControlDevice(row)}
          onSelectionChange={ids => {
            setSelectedDeviceIds(ids);
            if (ids.length === 0) setCmdMenuOpen(false);
          }}
          toolbar={(() => {
            // Resolve the selected device object
            const selDev = selectedDeviceIds.length === 1
              ? devices.find(d => d.id === selectedDeviceIds[0])
              : null;
            const hasSN  = !!selDev?.serial_number;

            const runCmd = async (key, fn) => {
              setCmdMenuOpen(false);
              if (!hasSN) { showToast('Device has no serial number yet — wait for it to connect', 'danger'); return; }
              try {
                const r = await fn();
                showToast(`✅ ${key} queued → ${r?.command || r?.commands?.[0] || ''}`, 'success');
                if (key === 'Get All Users') { setSubTab('users'); loadDevUsers(false); }
              } catch (err) { showToast(err.message, 'danger'); }
            };

            const CMDS = [
              { icon:'📊', label:'Get Device Info',   fn: () => api.post(`/zkteco/devices/${selDev?.id}/get-info`,{}) },
              { icon:'👥', label:'Get All Users',     fn: () => api.post(`/zkteco/devices/${selDev?.id}/get-users`,{}) },
              { icon:'📋', label:'Get All Logs',      fn: () => api.post(`/zkteco/devices/${selDev?.id}/sync`,{}) },
              { icon:'🔄', label:'Restore Templates', fn: () => api.post(`/zkteco/devices/${selDev?.id}/restore-templates`,{}) },
              { icon:'⏰', label:'Sync Time',         fn: () => api.post(`/zkteco/devices/${selDev?.id}/set-time`,{}) },
              { icon:'🚪', label:'Unlock Door',       fn: () => api.post(`/zkteco/devices/${selDev?.id}/unlock`,{}) },
              { icon:'🔃', label:'Reload Options',    fn: () => api.post(`/zkteco/devices/${selDev?.id}/reload-options`,{}) },
              { icon:'🚫', label:'Clear Admin',       fn: () => api.post(`/zkteco/devices/${selDev?.id}/clear-admin`,{}) },
              ...(selDev?.area_id ? [{ icon:'🗺️', label:`Sync Area: ${selDev?.area_name||'Area'}`, fn: () => api.post(`/zkteco/devices/${selDev?.id}/sync-area`,{}) }] : []),
              { sep:true },
              { icon:'⚙️', label:'Open Full Control', fn: () => { setCmdMenuOpen(false); setControlDevice(selDev); return Promise.resolve({}); } },
              { icon:'✏️', label:'Edit Device',       fn: () => { setCmdMenuOpen(false); openEdit(selDev); return Promise.resolve({}); } },
            ];

            return (
              <div style={{ display:'flex',alignItems:'center',gap:8 }}>

                {/* ── Command menu (shown when ≥1 device selected) ── */}
                {selectedDeviceIds.length > 0 && (
                  <div ref={cmdMenuRef} style={{ position:'relative' }}>
                    <button
                      onClick={() => setCmdMenuOpen(p => !p)}
                      style={{
                        display:'flex',alignItems:'center',gap:7,
                        padding:'5px 14px',height:32,
                        background: hasSN ? '#1a56db' : '#6b7280',
                        color:'white',border:'none',borderRadius:6,
                        fontSize:13,fontWeight:700,cursor:'pointer',
                      }}>
                      ⚙️ {selDev ? selDev.name : `${selectedDeviceIds.length} selected`}
                      <svg viewBox="0 0 20 20" fill="white" width="12" height="12"
                        style={{ transform:cmdMenuOpen?'rotate(180deg)':'none',transition:'transform .2s' }}>
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                      </svg>
                    </button>

                    {cmdMenuOpen && (
                      <div style={{
                        position:'absolute',top:'calc(100% + 4px)',left:0,zIndex:500,
                        background:'white',border:'1px solid #e5e7eb',borderRadius:8,
                        boxShadow:'0 8px 24px rgba(0,0,0,.12)',minWidth:200,overflow:'hidden',
                      }}>
                        {/* Device name header */}
                        <div style={{ padding:'8px 14px',background:'#f9fafb',borderBottom:'1px solid #f3f4f6',
                          fontSize:11,fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'.5px' }}>
                          {selDev?.serial_number || 'No SN yet'}
                          {selDev?.last_ip && <span style={{ marginLeft:6,fontWeight:400 }}>{selDev.last_ip.replace(/^::ffff:/i,'')}</span>}
                        </div>
                        {CMDS.map((cmd, i) =>
                          cmd.sep ? (
                            <div key={`sep${i}`} style={{ height:1,background:'#f3f4f6',margin:'2px 0' }} />
                          ) : (
                            <button key={cmd.label}
                              disabled={!hasSN && cmd.label !== 'Edit Device'}
                              onClick={() => runCmd(cmd.label, cmd.fn)}
                              style={{
                                display:'flex',alignItems:'center',gap:10,
                                width:'100%',textAlign:'left',
                                padding:'8px 16px',background:'none',border:'none',
                                fontSize:13,color: hasSN || cmd.label==='Edit Device' ? '#374151' : '#d1d5db',
                                cursor: hasSN || cmd.label==='Edit Device' ? 'pointer' : 'not-allowed',
                                transition:'background .1s',
                              }}
                              onMouseEnter={e => { if (hasSN || cmd.label==='Edit Device') e.currentTarget.style.background='#f5f9ff'; }}
                              onMouseLeave={e => { e.currentTarget.style.background='none'; }}>
                              <span style={{ fontSize:16,flexShrink:0 }}>{cmd.icon}</span>
                              {cmd.label}
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                )}

                <button className="btn btn-primary btn-sm" onClick={openAdd}>
                  + {L('डिभाइस थप्नुस','Add Device')}
                </button>
              </div>
            );
          })()}
        />
      )}

      {/* ══════ ATTENDANCE LOGS ══════ */}
      {subTab==='logs'&&(
        <div>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <span style={{ position:'relative',display:'inline-flex',width:10,height:10 }}>
                <span style={{ position:'absolute',width:10,height:10,borderRadius:'50%',background:'#10b981',opacity:.75,animation:'ping 1.5s cubic-bezier(0,0,.2,1) infinite' }}/>
                <span style={{ position:'relative',width:10,height:10,borderRadius:'50%',background:'#10b981' }}/>
              </span>
              <span style={{ fontSize:12,fontWeight:700,color:'#059669' }}>LIVE</span>
              <span style={{ fontSize:11,color:'#9ca3af' }}>5s refresh</span>
            </div>
            <div style={{ display:'flex',gap:8,alignItems:'center' }}>
              {lastUpdated&&<span style={{ fontSize:11,color:'#9ca3af' }}>{L('अपडेट','Updated')}: {lastUpdated.toLocaleTimeString()}</span>}
              <span style={{ fontWeight:700,color:'#1a56db',fontSize:13 }}>{logTotal} records</span>
              <button className="btn btn-outline btn-sm" onClick={()=>loadLogs(1)}>🔃</button>
            </div>
          </div>
          {/* ── Filter bar ── */}
          <div style={{ display:'grid', gridTemplateColumns:'2fr 100px 1fr 1fr auto',
            gap:10, marginBottom:12, alignItems:'flex-end',
            background:'#f9fafb', padding:'12px 14px', borderRadius:8, border:'1px solid #e5e7eb' }}>

            {/* Device — wider dropdown */}
            <div>
              <div style={{ fontSize:11,fontWeight:600,color:'#6b7280',marginBottom:4,textTransform:'uppercase',letterSpacing:'.3px' }}>
                Device
              </div>
              <div style={{ position:'relative' }}>
                <select
                  style={{
                    width:'100%', height:38, padding:'0 32px 0 10px',
                    border:`1.5px solid ${logFilter.sn?'#1a56db':'#d1d5db'}`,
                    borderRadius:8, background:'white', fontSize:13,
                    color:logFilter.sn?'#1f2937':'#9ca3af',
                    cursor:'pointer', outline:'none', appearance:'none',
                    transition:'border-color .15s',
                  }}
                  value={logFilter.sn}
                  onChange={e=>setLogFilter(p=>({...p,sn:e.target.value}))}>
                  <option value="">{L('सबै','All Devices')}</option>
                  {devices.filter(d=>d.serial_number).map(d=>{
                    const parts = [
                      d.model && d.model !== 'Unknown' ? d.model : d.name,
                      d.serial_number,
                      d.location,
                    ].filter(Boolean);
                    return (
                      <option key={d.id} value={d.serial_number}>{parts.join(' | ')}</option>
                    );
                  })}
                </select>
                <svg viewBox="0 0 20 20" fill={logFilter.sn?'#1a56db':'#9ca3af'} width="14" height="14"
                  style={{ position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none' }}>
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </div>
            </div>

            {/* PIN */}
            <div>
              <div style={{ fontSize:11,fontWeight:600,color:'#6b7280',marginBottom:4,textTransform:'uppercase',letterSpacing:'.3px' }}>
                PIN
              </div>
              <input className="form-control" style={{ height:38,fontSize:13 }} placeholder="Any"
                value={logFilter.pin} onChange={e=>setLogFilter(p=>({...p,pin:e.target.value}))} />
            </div>

            {/* From date — AD picker */}
            <div>
              <div style={{ fontSize:11,fontWeight:600,color:'#6b7280',marginBottom:4,textTransform:'uppercase',letterSpacing:'.3px' }}>
                {L('देखि','From')}
              </div>
              <ADDatePicker value={logFilter.from} onChange={v=>setLogFilter(p=>({...p,from:v}))} />
            </div>

            {/* To date — AD picker */}
            <div>
              <div style={{ fontSize:11,fontWeight:600,color:'#6b7280',marginBottom:4,textTransform:'uppercase',letterSpacing:'.3px' }}>
                {L('सम्म','To')}
              </div>
              <ADDatePicker value={logFilter.to} onChange={v=>setLogFilter(p=>({...p,to:v}))} />
            </div>

            {/* Buttons */}
            <div style={{ display:'flex',gap:6,alignItems:'flex-end' }}>
              <button className="btn btn-primary btn-sm" style={{ height:38,padding:'0 16px',fontSize:12 }}
                onClick={()=>{ logFilterRef.current=logFilter; fetchLogs(1,false); }}>
                🔍 {L('Filter','Filter')}
              </button>
              <button className="btn btn-outline btn-sm" style={{ height:38,padding:'0 12px',fontSize:12 }}
                onClick={()=>{
                  const today = new Date();
                  const fmt  = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                  const from3m = new Date(today); from3m.setMonth(from3m.getMonth() - 3);
                  const cleared = { sn:'', pin:'', from: fmt(from3m), to: fmt(today) };
                  setLogFilter(cleared); logFilterRef.current=cleared; fetchLogs(1,false);
                }}>
                ✕
              </button>
            </div>
          </div>
          {!loading&&logs.length===0&&(
            <div style={{ textAlign:'center',padding:'36px 20px',color:'#6b7280' }}>
              <div style={{ fontSize:34,marginBottom:8 }}>📡</div>
              <div style={{ fontWeight:600,fontSize:14,marginBottom:4 }}>{L('लग उपलब्ध छैन','No attendance logs yet')}</div>
              <div style={{ fontSize:12,color:'#9ca3af',maxWidth:380,margin:'0 auto' }}>
                {L('डिभाइसले पठाउन सुरु गरेपछि यहाँ देखिनेछ।','Logs appear here automatically as devices push data. Use ⚙️ Control → Get All Logs to pull history.')}
              </div>
            </div>
          )}
          {(loading||logs.length>0)&&(
            <DataGrid columns={logColumns} data={logs} defaultPageSize={LOG_LIMIT}
              showSearch={false} compact loading={loading}
              showFilterButton={false} showCheckbox={false} />
          )}
          {logTotal>LOG_LIMIT&&(
            <div style={{ display:'flex',justifyContent:'center',alignItems:'center',gap:8,marginTop:10 }}>
              <button className="btn btn-outline btn-sm" disabled={logPage<=1} onClick={()=>loadLogs(logPage-1)}>← Prev</button>
              <span style={{ fontSize:13,color:'#374151' }}>Page {logPage}/{Math.ceil(logTotal/LOG_LIMIT)} · {logTotal} total</span>
              <button className="btn btn-outline btn-sm" disabled={logPage>=Math.ceil(logTotal/LOG_LIMIT)} onClick={()=>loadLogs(logPage+1)}>Next →</button>
            </div>
          )}
        </div>
      )}

      {/* ══════ DEVICE USERS ══════ */}
      {subTab==='users'&&(
        <div>
          {/* Toolbar */}
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,flexWrap:'wrap',gap:8 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <span style={{ position:'relative',display:'inline-flex',width:10,height:10 }}>
                <span style={{ position:'absolute',width:10,height:10,borderRadius:'50%',background:'#10b981',opacity:.75,animation:'ping 1.5s cubic-bezier(0,0,.2,1) infinite' }}/>
                <span style={{ position:'relative',width:10,height:10,borderRadius:'50%',background:'#10b981' }}/>
              </span>
              <span style={{ fontSize:12,fontWeight:700,color:'#059669' }}>LIVE</span>
              <span style={{ fontSize:11,color:'#9ca3af' }}>3s refresh</span>
              <span style={{ fontWeight:700,color:'#0369a1',fontSize:13 }}>
                {devUsers.length} {L('प्रयोगकर्ता','users')}
              </span>
              <span style={{ fontSize:11,color:'#059669',fontWeight:600 }}>
                · {devUsers.filter(u=>u.employee_id).length} {L('जोडिएको','linked')}
              </span>
              <span style={{ fontSize:11,color:'#9ca3af' }}>
                · {devUsers.filter(u=>!u.employee_id).length} {L('नजोडिएको','unlinked')}
              </span>
            </div>
            <div style={{ display:'flex',gap:8 }}>
              <button className="btn btn-outline btn-sm" onClick={()=>loadDevUsers(false)}>🔃</button>
              {/* Clear Users Logs — deletes all attendance logs for this device's users */}
              {devUsers.length > 0 && (
                <button
                  className="btn btn-outline btn-sm"
                  style={{ color:'#ef4444', borderColor:'#fca5a5' }}
                  onClick={async () => {
                    const sns = [...new Set(devUsers.map(u=>u.device_sn).filter(Boolean))];
                    if (!sns.length) { showToast('No device SN found','danger'); return; }
                    if (!window.confirm(
                      `Delete ALL attendance logs for ${devUsers.length} users on ${sns.length} device(s)?\n` +
                      `This also resets the sync stamp so next "Get All Logs" re-downloads everything.`
                    )) return;
                    try {
                      let deleted = 0;
                      for (const sn of sns) {
                        const r = await api.delete(`/zkteco/device-users/logs/${sn}`);
                        deleted += r.deleted || 0;
                      }
                      showToast(`✅ ${deleted} attendance logs cleared`);
                      loadDevUsers(false);
                    } catch(err) { showToast(err.message,'danger'); }
                  }}>
                  🗑 {L('Logs मेटाउनुस','Clear Users Logs')}
                </button>
              )}
              <button
                className="btn btn-outline btn-sm"
                disabled={syncing}
                onClick={handleSyncToStaff}
                style={{ display:'flex',alignItems:'center',gap:6 }}
              >
                {syncing?'⏳':'🔗'} {L('सिंक','Sync')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={()=>setImportModal(true)}
                style={{ display:'flex',alignItems:'center',gap:6,background:'#059669',borderColor:'#059669',fontWeight:700 }}
              >
                📥 {L('Staff मा Import','Import to Staff')}
              </button>
            </div>
          </div>

          {/* Sync result banner */}
          {syncResult && (
            <div style={{
              background: syncResult.matched>0?'#d1fae5':'#fef3c7',
              border:`1px solid ${syncResult.matched>0?'#6ee7b7':'#fcd34d'}`,
              borderRadius:8, padding:'10px 14px', marginBottom:12,
              fontSize:13, color: syncResult.matched>0?'#065f46':'#92400e',
              display:'flex', justifyContent:'space-between', alignItems:'center'
            }}>
              <div>
                {syncResult.matched>0
                  ? `✅ ${syncResult.matched} ${L('कर्मचारी जोडियो','staff linked')} — ${syncResult.byPin} ${L('PIN द्वारा','by PIN')}, ${syncResult.byName} ${L('नाम द्वारा','by Name')}`
                  : `⚠️ ${L('मेल खाने कर्मचारी भेटिएन। Staff को Attendance Device ID वा नाम जाँच्नुहोस्।','No matches found. Check staff Attendance Device ID or Name fields.')}`
                }
                {syncResult.staffUpdated > 0 &&
                  <span style={{ marginLeft:12,opacity:.8 }}>· {syncResult.staffUpdated} {L('Device ID अपडेट','Device ID updated')}</span>
                }
              </div>
              <button onClick={()=>setSyncResult(null)} style={{ background:'none',border:'none',cursor:'pointer',fontSize:16,color:'inherit' }}>✕</button>
            </div>
          )}

          {/* Import result banner */}
          {importResult && (
            <div style={{ background:'#d1fae5',border:'1px solid #6ee7b7',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:13,color:'#065f46' }}>
              <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
                <div>
                  <strong>✅ Import {L('सम्पन्न','Complete')}:</strong>
                  &nbsp;{importResult.created} {L('नयाँ Staff सिर्जित','new staff created')},
                  &nbsp;{importResult.updated} {L('अपडेट','updated')},
                  &nbsp;{importResult.skipped} {L('छोडियो','skipped')}
                  &nbsp;— {L('Email','Email')}: <code style={{ fontSize:12 }}>{emailDomain}</code>
                </div>
                <button onClick={()=>setImportResult(null)} style={{ background:'none',border:'none',cursor:'pointer',fontSize:16,color:'inherit' }}>✕</button>
              </div>
              {importResult.results?.length > 0 && (
                <div style={{ marginTop:8,maxHeight:120,overflowY:'auto',background:'#f0fdf4',borderRadius:6,padding:'6px 10px' }}>
                  {importResult.results.map((r,i)=>(
                    <div key={i} style={{ fontSize:11,display:'flex',gap:10,padding:'2px 0',borderBottom:'1px solid #bbf7d0' }}>
                      <span style={{ fontFamily:'monospace',fontWeight:700,minWidth:30 }}>{r.pin}</span>
                      <span style={{ flex:1 }}>{r.name}</span>
                      <span style={{ fontFamily:'monospace',color:'#6b7280' }}>{r.email}</span>
                      <span style={{
                        background:r.action==='created'?'#059669':r.action==='error'?'#ef4444':'#0369a1',
                        color:'white',borderRadius:4,padding:'0 6px',fontWeight:700,fontSize:10
                      }}>{r.action}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}


          {/* Empty state with instructions */}
          {!usersLoading && devUsers.length===0 && (
            <div style={{ textAlign:'center',padding:'36px 20px',color:'#6b7280' }}>
              <div style={{ fontSize:36,marginBottom:8 }}>👥</div>
              <div style={{ fontWeight:600,fontSize:14,marginBottom:8 }}>
                {L('डिभाइस प्रयोगकर्ता उपलब्ध छैनन्','No device users yet')}
              </div>
              <div style={{ fontSize:13,color:'#9ca3af',maxWidth:420,margin:'0 auto',lineHeight:1.6 }}>
                {L(
                  'डिभाइसको प्रयोगकर्ताहरू यहाँ देखाउन:',
                  'To load device users here:'
                )}
              </div>
              <ol style={{ textAlign:'left',maxWidth:420,margin:'12px auto 0',fontSize:13,color:'#374151',lineHeight:2 }}>
                <li>{L('Devices ट्याबमा जानुस','Go to Devices tab')}</li>
                <li>{L('डिभाइसको "⚙️ Control" बटन थिच्नुस','Click ⚙️ Control on the device')}</li>
                <li><strong>{L('"👥 सबै प्रयोगकर्ता लिनुस" बटन थिच्नुस','"👥 Get All Users" button')}</strong></li>
                <li>{L('डिभाइस (२ सेकेन्डमा) कमान्ड लिन्छ र यहाँ प्रयोगकर्ता देखिनेछन्','Device picks up the command (within ~2s) and users appear here automatically')}</li>
              </ol>
            </div>
          )}

          {/* ── Selection action bar — shown when rows are checked ── */}
          {selectedUserIds.length > 0 && (
            <div style={{
              display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
              background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8,
              marginBottom:10,
            }}>
              {/* Left — selection count */}
              <span style={{ fontWeight:700, color:'#1e40af', fontSize:13, flexShrink:0 }}>
                {selectedUserIds.length} {L('छानिएको','selected')}
              </span>

              {/* Spacer — pushes all actions to the right */}
              <div style={{ flex:1 }} />

              {/* RIGHT SIDE — Edit Name (single only) */}
              {selectedUserIds.length === 1 && !editingUserId && (
                <button
                  onClick={() => {
                    const u = devUsers.find(x => x.id === selectedUserIds[0]);
                    setEditingUserId(u?.id || null);
                    setEditName(u?.name || '');
                  }}
                  style={{ display:'flex',alignItems:'center',gap:6,
                    padding:'6px 16px',background:'white',
                    border:'1.5px solid #1a56db',borderRadius:7,
                    color:'#1a56db',fontSize:12,fontWeight:700,cursor:'pointer',
                    boxShadow:'0 1px 3px rgba(26,86,219,.1)' }}>
                  ✏️ {L('Edit Name','Edit Name')}
                </button>
              )}

              {/* RIGHT SIDE — Inline edit input + Save + Cancel */}
              {editingUserId && selectedUserIds.length === 1 && (
                <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                  <input
                    className="form-control"
                    style={{ width:220,height:34,fontSize:13 }}
                    placeholder={L('नयाँ नाम','New name')}
                    value={editName}
                    onChange={e=>setEditName(e.target.value)}
                    onKeyDown={e=>{
                      if(e.key==='Enter') handleSaveUserName();
                      if(e.key==='Escape'){setEditingUserId(null);setEditName('');}
                    }}
                    autoFocus
                  />
                  <button
                    disabled={!editName.trim()||userActionBusy}
                    onClick={handleSaveUserName}
                    style={{ display:'flex',alignItems:'center',gap:5,
                      padding:'6px 16px',background:'#059669',border:'none',
                      borderRadius:7,color:'white',fontSize:12,fontWeight:700,
                      cursor:!editName.trim()||userActionBusy?'not-allowed':'pointer',
                      opacity:!editName.trim()||userActionBusy?0.6:1 }}>
                    {userActionBusy?'⏳':'💾'} {L('Save to Device','Save to Device')}
                  </button>
                  <button
                    onClick={()=>{setEditingUserId(null);setEditName('');}}
                    style={{ padding:'6px 12px',background:'none',border:'1px solid #d1d5db',
                      borderRadius:7,color:'#6b7280',fontSize:12,cursor:'pointer' }}>
                    Cancel
                  </button>
                </div>
              )}

              {/* RIGHT SIDE — Delete from Device */}
              {!editingUserId && (
                <button
                  disabled={userActionBusy}
                  onClick={handleDeleteSelectedUsers}
                  style={{ display:'flex',alignItems:'center',gap:6,
                    padding:'6px 16px',background:'#fee2e2',
                    border:'1.5px solid #fca5a5',borderRadius:7,
                    color:'#dc2626',fontSize:12,fontWeight:700,
                    cursor:userActionBusy?'not-allowed':'pointer',
                    boxShadow:'0 1px 3px rgba(220,38,38,.1)' }}>
                  {userActionBusy?'⏳':'🗑'} {L('Delete from Device','Delete from Device')}
                  <span style={{ background:'#dc2626',color:'white',borderRadius:'50%',
                    width:18,height:18,fontSize:10,fontWeight:700,
                    display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                    {selectedUserIds.length}
                  </span>
                </button>
              )}
            </div>
          )}

          {(usersLoading || devUsers.length > 0) && (
            <DataGrid
              columns={userColumns}
              data={devUsers}
              defaultPageSize={20}
              showSearch
              compact
              loading={usersLoading}
              showCheckbox={true}
              onSelectionChange={ids => {
                setSelectedUserIds(ids);
                // clear edit state when selection changes
                if (!ids.includes(editingUserId)) { setEditingUserId(null); setEditName(''); }
              }}
            />
          )}
        </div>
      )}

      {/* ══════ FINGERPRINTS / BIOMETRICS ══════ */}
      {subTab==='fingerprints'&&(
        <div>
          {/* Header bar */}
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,flexWrap:'wrap',gap:8 }}>
            <div style={{ fontSize:13,color:'#374151',fontWeight:600 }}>
              {L('प्रति-कर्मचारी बायोमेट्रिक सारांश','Per-User Biometric Summary')}
              <span style={{ marginLeft:8,fontSize:11,color:'#9ca3af',fontWeight:400 }}>
                {L('"Get All Users" चलाएपछि यहाँ अपडेट हुन्छ','Updated after running "Get All Users" in ⚙️ Control')}
              </span>
            </div>
            <div style={{ display:'flex',gap:8 }}>
              {/* Export — downloads JSON with users+FP templates for any device */}
              {devUsers.length > 0 && (() => {
                const sns = [...new Set(devUsers.map(u=>u.device_sn).filter(Boolean))];
                return sns.map(sn => {
                  const devName = devices.find(d=>d.serial_number===sn)?.name || sn;
                  return (
                    <button key={sn} className="btn btn-outline btn-sm"
                      style={{ color:'#059669', borderColor:'#6ee7b7' }}
                      title={`Export all users + FP templates for ${devName} as JSON file (for migration to another device)`}
                      onClick={() => window.open(`/api/zkteco/export-users?sn=${encodeURIComponent(sn)}`, '_blank')}>
                      📥 Export {devName}
                    </button>
                  );
                });
              })()}
              <button className="btn btn-outline btn-sm" onClick={()=>loadDevUsers(false)}>
                🔃 {L('रिफ्रेस','Refresh')}
              </button>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display:'flex',gap:14,marginBottom:10,flexWrap:'wrap',fontSize:11,color:'#6b7280',
            padding:'7px 12px',background:'#f9fafb',borderRadius:8,border:'1px solid #e5e7eb' }}>
            <strong style={{ color:'#374151' }}>Legend:</strong>
            <span style={{ display:'flex',alignItems:'center',gap:5 }}>
              <span style={{ width:12,height:12,borderRadius:'50%',background:'#059669',border:'1.5px solid #065f46',display:'inline-block' }}/>
              Fingerprint enrolled + template backed up
            </span>
            <span style={{ display:'flex',alignItems:'center',gap:5 }}>
              <span style={{ width:12,height:12,borderRadius:'50%',background:'#f59e0b',border:'1.5px solid #d97706',display:'inline-block' }}/>
              Enrolled on device — no backup
            </span>
            <span style={{ display:'flex',alignItems:'center',gap:5 }}>
              <span style={{ width:12,height:12,borderRadius:'50%',background:'#e5e7eb',border:'1.5px solid #d1d5db',display:'inline-block' }}/>
              Empty slot
            </span>
            <span>👤 = Face templates &nbsp;·&nbsp; 💳 = RFID card &nbsp;·&nbsp; 🔑 = Password set</span>
          </div>

          {devUsers.length===0 && !usersLoading && (
            <div style={{ textAlign:'center',padding:'36px 20px',color:'#6b7280' }}>
              <div style={{ fontSize:32,marginBottom:8 }}>👆</div>
              <div style={{ fontWeight:600,marginBottom:4 }}>No biometric data yet</div>
              <div style={{ fontSize:12,color:'#9ca3af',maxWidth:380,margin:'0 auto' }}>
                Click ⚙️ Control → <strong>"Get All Users"</strong> to pull fingerprint/face/RFID/password data from the device.
              </div>
            </div>
          )}

          {devUsers.length > 0 && (
            <DataGrid
              columns={fpColumns}
              data={devUsers}
              defaultPageSize={20}
              showSearch
              compact={false}
              loading={usersLoading}
              showCheckbox={false}
              autoWidth={true}
            />
          )}
        </div>
      )}

      {/* ══════ AREAS ══════ */}
      {subTab==='areas'&&(
        <ZKTecoAreaTab
          areas={areas}
          loading={areasLoading}
          onRefresh={loadAreas}
          L={L}
          language={language}
          showToast={showToast}
        />
      )}

      {/* ══════ ACCESS RULE ══════ */}
      {subTab==='access'&&(
        <ZKTecoAccessTab
          L={L}
          language={language}
          showToast={showToast}
          areas={areas}
        />
      )}

      {/* ══════ COMMANDS ══════ */}
      {subTab==='commands'&&(
        <div>
          {/* Status + action bar — matches Att. Logs header row style */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:13, fontWeight:700, color:'#1f2937' }}>⚡ {L('कमान्ड इतिहास','Command History')}</span>
              {['PENDING','SENT','DONE','ERROR'].map(s=>{
                const count = commands.filter(c=>c.status===s).length;
                const colors = { PENDING:['#92400e','#fef3c7'], SENT:['#1e40af','#dbeafe'], DONE:['#065f46','#d1fae5'], ERROR:['#991b1b','#fee2e2'] };
                const [c,bg] = colors[s]||['#374151','#f3f4f6'];
                return count > 0 ? (
                  <span key={s} style={{ background:bg, color:c, borderRadius:10, padding:'2px 10px', fontSize:11, fontWeight:700 }}>
                    {s}: {count}
                  </span>
                ) : null;
              })}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <button className="btn btn-outline btn-sm" onClick={loadCommands}>🔃 {L('रिफ्रेस','Refresh')}</button>
              <button
                className="btn btn-outline btn-sm"
                style={{ color:'#d97706', borderColor:'#fcd34d' }}
                onClick={async () => {
                  if (!window.confirm(L('सबै PENDING कमान्डहरू मेटाउने?','Clear all PENDING commands? Sent/Done records are kept.'))) return;
                  try {
                    const r = await api.delete('/zkteco/commands?status=PENDING');
                    showToast(L(`${r.deleted} PENDING कमान्ड मेटाइयो`,`${r.deleted} PENDING commands cleared`));
                    loadCommands();
                  } catch (err) { showToast(err.message, 'danger'); }
                }}>
                🧹 {L('पेन्डिङ हटाउनुस','Clear Pending')}
              </button>
              <button
                className="btn btn-outline btn-sm"
                style={{ color:'#ef4444', borderColor:'#fca5a5' }}
                onClick={async () => {
                  if (!window.confirm(L('सबै कमान्डहरू मेटाउने?','Clear ALL commands (Pending + Sent + Done)? Cannot be undone.'))) return;
                  try {
                    const r = await api.delete('/zkteco/commands');
                    showToast(L(`${r.deleted} कमान्ड मेटाइयो`,`${r.deleted} commands cleared`));
                    loadCommands();
                  } catch (err) { showToast(err.message, 'danger'); }
                }}>
                🗑 {L('सबै हटाउनुस','Clear All')}
              </button>
              <button className="btn btn-primary btn-sm"
                onClick={()=>{ setCmdForm({deviceSn:devices[0]?.serial_number||'',commandPayload:''}); setCmdModal(true); }}>
                + {L('कमान्ड पठाउनुस','Send Command')}
              </button>
            </div>
          </div>
          <DataGrid
            columns={cmdColumns}
            data={commands}
            defaultPageSize={20}
            showSearch
            compact
            loading={loading}
            showCheckbox={false}
          />
        </div>
      )}

      {/* ══════ SETUP GUIDE ══════ */}
      {subTab==='setup'&&(
        <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
          <div className="card">
            <div className="card-header"><h3>⚙️ {L('कन्फिगरेसन','Configuration')}</h3></div>
            <div className="card-body">
              {[
                {step:'1',title:'Device ADMS Server',desc:'Menu → Communication → ADMS / Cloud / Push Server',code:`Server Address : <your server IP>\nServer Port    : 5000\nHTTPS          : Disabled`},
                {step:'2',title:'Employee Device ID',desc:'Set each employee\'s "Device ID" field in eHajiri to match their PIN on the device'},
                {step:'3',title:'Get All Data',desc:'Click ⚙️ Control → Get All Logs + Get All Users to pull device data into eHajiri'},
              ].map(s=>(
                <div key={s.step} style={{ display:'flex',gap:14,marginBottom:14 }}>
                  <div style={{ width:28,height:28,borderRadius:'50%',background:'#1a56db',color:'white',fontWeight:700,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>{s.step}</div>
                  <div>
                    <div style={{ fontWeight:600,color:'#1f2937',marginBottom:4 }}>{s.title}</div>
                    <div style={{ fontSize:13,color:'#6b7280' }}>{s.desc}</div>
                    {s.code&&<pre style={{ marginTop:8,background:'#1f2937',color:'#d1fae5',borderRadius:8,padding:'10px 14px',fontSize:12,fontFamily:'monospace',lineHeight:1.6 }}>{s.code}</pre>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ IMPORT TO STAFF MODAL (shared component) ══ */}
      {importModal && (
        <ImportDeviceUsersModal
          onClose={()=>setImportModal(false)}
          onDone={async()=>{ await loadDevUsers(false); await loadStaff(); }}
        />
      )}

      {/* ══ (old modal removed — shared ImportDeviceUsersModal used instead) ══ */}
      {false && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:520 }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#d1fae5,#eff6ff)' }}>
              <h2>📥 {L('Device Users → Staff मा Import','Import Device Users to Staff')}</h2>
              <button className="modal-close" onClick={()=>setImportModal(false)}>✕</button>
            </div>
            <div className="modal-body">

              {/* What will happen */}
              <div style={{ background:'#f9fafb',borderRadius:10,padding:'12px 16px',marginBottom:16,border:'1px solid #e5e7eb' }}>
                <div style={{ fontSize:12,fontWeight:700,color:'#374151',marginBottom:10,textTransform:'uppercase',letterSpacing:'.4px' }}>
                  {L('यसले के गर्छ','What this does')}
                </div>
                <div style={{ display:'flex',flexDirection:'column',gap:8,fontSize:13 }}>
                  {[
                    { icon:'🔢', field:L('Attendance Device ID','Attendance Device ID'), value:L('Device PIN नम्बर','Device User PIN') },
                    { icon:'👤', field:L('Staff Name','Staff Name'),                     value:L('Device User को नाम','Device User Name') },
                    { icon:'📧', field:L('Email','Email Address'),                       value:`{PIN}@${emailDomain}` },
                  ].map(row=>(
                    <div key={row.field} style={{ display:'grid',gridTemplateColumns:'28px 1fr 1fr',gap:8,alignItems:'center' }}>
                      <span>{row.icon}</span>
                      <span style={{ fontWeight:600,color:'#1f2937' }}>{row.field}</span>
                      <span style={{ color:'#059669',fontWeight:600 }}>← {row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Email domain */}
              <div className="form-group" style={{ marginBottom:14 }}>
                <label className="form-label" style={{ fontWeight:700 }}>
                  📧 {L('Email Domain','Email Domain')}
                </label>
                <div style={{ display:'flex',alignItems:'center',gap:0 }}>
                  <span style={{ background:'#f3f4f6',border:'1px solid #d1d5db',borderRight:'none',borderRadius:'6px 0 0 6px',padding:'8px 10px',fontSize:13,color:'#6b7280',whiteSpace:'nowrap' }}>
                    {L('PIN','PIN')} @
                  </span>
                  <input
                    className="form-control"
                    style={{ borderRadius:'0 6px 6px 0',borderLeft:'none' }}
                    value={emailDomain}
                    placeholder="planetinfosys.com.np"
                    onChange={e=>setEmailDomain(e.target.value.trim())}
                  />
                </div>
                <div style={{ fontSize:12,color:'#6b7280',marginTop:4 }}>
                  {L('उदाहरण','Example')}: PIN=5 → <code>5@{emailDomain||'planetinfosys.com.np'}</code>
                </div>
              </div>

              {/* Preview */}
              {devUsers.length > 0 && (
                <div style={{ background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,padding:'10px 14px',marginBottom:4 }}>
                  <div style={{ fontSize:12,fontWeight:700,color:'#1e40af',marginBottom:6 }}>
                    📋 {L('Preview','Preview')} ({devUsers.length} {L('Device Users','Device Users')})
                  </div>
                  <div style={{ maxHeight:130,overflowY:'auto' }}>
                    <table style={{ width:'100%',fontSize:12,borderCollapse:'collapse' }}>
                      <thead>
                        <tr style={{ background:'#dbeafe' }}>
                          <th style={{ padding:'3px 8px',textAlign:'left' }}>PIN</th>
                          <th style={{ padding:'3px 8px',textAlign:'left' }}>Name</th>
                          <th style={{ padding:'3px 8px',textAlign:'left' }}>Email</th>
                          <th style={{ padding:'3px 8px',textAlign:'left' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {devUsers.slice(0,10).map(u=>(
                          <tr key={u.id} style={{ borderBottom:'1px solid #bfdbfe' }}>
                            <td style={{ padding:'3px 8px',fontFamily:'monospace',fontWeight:700,color:'#1a56db' }}>{u.pin}</td>
                            <td style={{ padding:'3px 8px',fontWeight:600 }}>{u.name||`Staff ${u.pin}`}</td>
                            <td style={{ padding:'3px 8px',color:'#059669',fontFamily:'monospace',fontSize:11 }}>{u.pin}@{emailDomain||'planetinfosys.com.np'}</td>
                            <td style={{ padding:'3px 8px' }}>
                              {u.employee_id
                                ? <span style={{ background:'#dbeafe',color:'#1e40af',borderRadius:4,padding:'1px 6px',fontSize:10,fontWeight:700 }}>UPDATE</span>
                                : <span style={{ background:'#d1fae5',color:'#065f46',borderRadius:4,padding:'1px 6px',fontSize:10,fontWeight:700 }}>CREATE</span>
                              }
                            </td>
                          </tr>
                        ))}
                        {devUsers.length > 10 && (
                          <tr><td colSpan={4} style={{ padding:'4px 8px',color:'#6b7280',fontSize:11,textAlign:'center' }}>
                            + {devUsers.length - 10} {L('अरू','more')}...
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setImportModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={importing || !emailDomain}
                style={{ background:'#059669',borderColor:'#059669' }}
                onClick={()=>{
                  setImportModal(false);
                  handleImportToStaff();
                }}
              >
                {importing ? '⏳ ...' : `📥 ${L('Import गर्नुस','Run Import')}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ LINK STAFF MODAL ══ */}
      {linkModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:520 }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
              <h2>🔗 {L('Staff जोड्नुस','Link Device User to Staff')}</h2>
              <button className="modal-close" onClick={()=>setLinkModal(null)}>✕</button>
            </div>
            <div className="modal-body">

              {/* Device user info card */}
              <div style={{ background:'#1e3a5f',color:'white',borderRadius:10,padding:'12px 16px',marginBottom:14 }}>
                <div style={{ fontSize:11,opacity:.7,marginBottom:6,textTransform:'uppercase',letterSpacing:'.5px' }}>Device User</div>
                <div style={{ display:'grid',gridTemplateColumns:'auto 1fr',gap:'6px 16px',fontSize:14 }}>
                  <span style={{ opacity:.7 }}>PIN</span>
                  <strong style={{ fontFamily:'monospace',fontSize:16 }}>{linkModal.pin}</strong>
                  <span style={{ opacity:.7 }}>{L('नाम','Name')}</span>
                  <strong>{linkModal.name || '—'}</strong>
                  <span style={{ opacity:.7 }}>Device SN</span>
                  <span style={{ fontFamily:'monospace',fontSize:12,opacity:.8 }}>{linkModal.device_sn}</span>
                </div>
              </div>

              {/* Staff picker */}
              <div className="form-group" style={{ marginBottom:8 }}>
                <label className="form-label" style={{ fontWeight:700, fontSize:13 }}>
                  {L('Staff छान्नुस','Select Staff Member')}
                </label>
                <select
                  className="form-control"
                  defaultValue=""
                  style={{ fontSize:14, padding:'9px 10px', height:'auto' }}
                  onChange={e=>{ if(e.target.value) handleLinkUser(linkModal.id, parseInt(e.target.value)); }}
                >
                  <option value="">— {L('Staff खोज्नुस / छान्नुस','Search / select staff member')} —</option>
                  {staffList
                    .filter(s => s.active !== false)
                    .sort((a,b) => (a.fullName||'').localeCompare(b.fullName||''))
                    .map(s => {
                      const name   = s.fullName   || '(No name)';
                      const code   = s.employeeId ? ` · ID: ${s.employeeId}` : '';
                      const devPin = s.deviceId   ? ` · Device PIN: ${s.deviceId}` : '';
                      return (
                        <option key={s.id} value={s.id}>
                          {name}{code}{devPin}
                        </option>
                      );
                    })
                  }
                </select>
                <div style={{ fontSize:11, color:'#6b7280', marginTop:5 }}>
                  {L('Format','Format')}: <code>Staff Name · ID: xxx · Device PIN: yyy</code>
                </div>
              </div>

              <div style={{ background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,padding:'8px 14px',fontSize:12,color:'#1e40af' }}>
                ✅ {L(
                  'छानेपछि: यो Device PIN Staff को Attendance Device ID मा सेट हुन्छ र सबै हाजिरी लग पनि जोडिन्छ।',
                  'After selecting: this PIN is saved as the staff\'s Attendance Device ID, and all attendance logs are linked too.'
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setLinkModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ DEVICE CONTROL MODAL ══ */}
      {controlDevice && (
        <DeviceControlModal
          device={controlDevice}
          onClose={()=>setControlDevice(null)}
          showToast={showToast}
          onRefreshDevices={()=>{ loadDevices(true); setTimeout(()=>loadDevices(false),3000); }}
          onSwitchTab={tab=>{ setControlDevice(null); setSubTab(tab); }}
        />
      )}

      {/* ══ ADD/EDIT DEVICE MODAL ══ */}
      {modal&&(
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:520 }} onClick={e=>e.stopPropagation()}>
            <div className="modal-header" style={{ background:'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
              <h2>{editId?`✏️ ${L('डिभाइस सेटिङ','Device Settings')}`:`+ ${L('नयाँ डिभाइस','Add Device')}`}</h2>
              <button className="modal-close" onClick={()=>setModal(false)}>✕</button>
            </div>
            <div className="modal-body">

              {/* ── Read-only device identity (greyed out) ── */}
              {editId && (
                <div style={{ background:'#f9fafb',borderRadius:8,padding:'10px 14px',marginBottom:14,border:'1px solid #e5e7eb' }}>
                  <div style={{ fontSize:11,fontWeight:700,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'.4px',marginBottom:8 }}>
                    {L('डिभाइस पहिचान','Device Identity')} ({L('स्वतः भरिन्छ','auto-filled on connect')})
                  </div>
                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10 }}>
                    <div>
                      <div style={{ fontSize:11,color:'#9ca3af',marginBottom:3 }}>Serial Number</div>
                      <div style={{ fontFamily:'monospace',fontSize:13,fontWeight:700,color:'#374151' }}>
                        {form.serialNumber || <span style={{ color:'#d1d5db' }}>Pending</span>}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize:11,color:'#9ca3af',marginBottom:3 }}>IP Address</div>
                      <div style={{ fontFamily:'monospace',fontSize:13,fontWeight:700,color:'#374151' }}>
                        {form.ipAddress || <span style={{ color:'#d1d5db' }}>—</span>}
                        {form.port ? <span style={{ color:'#9ca3af' }}>:{form.port}</span> : ''}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize:11,color:'#9ca3af',marginBottom:3 }}>Port</div>
                      <div style={{ fontFamily:'monospace',fontSize:13,fontWeight:700,color:'#374151' }}>
                        {form.port || 4370}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Editable fields ── */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{L('नाम','Device Name')} <span style={{ color:'#ef4444' }}>*</span></label>
                  <input className={`form-control ${errors.name?'error':''}`} placeholder="e.g. Main Entrance"
                    value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} />
                  {errors.name&&<div className="form-error">{errors.name}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">{L('स्थान','Location')}</label>
                  <input className="form-control" placeholder="e.g. Main Gate"
                    value={form.location} onChange={e=>setForm(p=>({...p,location:e.target.value}))} />
                </div>
              </div>

              {/* ── Timezone — the most important setting ── */}
              <div className="form-group">
                <label className="form-label" style={{ fontWeight:700 }}>
                  🕐 {L('समय क्षेत्र','Timezone')}
                  <span style={{ marginLeft:6,fontSize:11,color:'#6b7280',fontWeight:400 }}>
                    {L('(डिभाइसको घडी यसैले सेट हुन्छ)','(controls device clock)')}
                  </span>
                </label>
                <select className="form-control"
                  value={form.timezoneOffset ?? 345}
                  onChange={e=>setForm(p=>({...p,timezoneOffset:parseInt(e.target.value)}))}>
                  <option value={345}>🇳🇵 Kathmandu (Nepal) — UTC+5:45</option>
                  <option value={330}>🇮🇳 Kolkata / New Delhi (India) — UTC+5:30</option>
                  <option value={360}>🇧🇩 Dhaka (Bangladesh) — UTC+6:00</option>
                  <option value={390}>🇲🇲 Yangon (Myanmar) — UTC+6:30</option>
                  <option value={420}>🇹🇭 Bangkok / Ho Chi Minh — UTC+7:00</option>
                  <option value={480}>🇨🇳 Beijing / Shanghai — UTC+8:00</option>
                  <option value={540}>🇯🇵 Tokyo — UTC+9:00</option>
                  <option value={0}>UTC+0:00</option>
                  <option value={60}>UTC+1:00</option>
                  <option value={120}>UTC+2:00</option>
                  <option value={180}>UTC+3:00</option>
                  <option value={240}>UTC+4:00</option>
                  <option value={300}>UTC+5:00</option>
                </select>
                {editId && (
                  <div style={{ fontSize:11,color:'#1a56db',marginTop:4 }}>
                    💡 {L('Timezone बदल्दा डिभाइसलाई RELOAD OPTIONS command पठाइन्छ','Changing timezone queues RELOAD OPTIONS — device updates on next poll')}
                  </div>
                )}
              </div>

              {/* ── Area assignment ── */}
              <div className="form-group" style={{ marginBottom:14 }}>
                <label className="form-label" style={{ fontWeight:700 }}>
                  🗺️ {L('Area','Area')}
                  <span style={{ marginLeft:6,fontSize:11,color:'#6b7280',fontWeight:400 }}>
                    {L('(यो device कुन area मा छ)','(which area this device belongs to)')}
                  </span>
                </label>
                <select className="form-control" value={form.areaId}
                  onChange={e=>setForm(p=>({...p,areaId:e.target.value}))}>
                  <option value="">— {L('कुनै Area छैन','No Area (Standalone)')} —</option>
                  {areas.map(a => (
                    <option key={a.id} value={String(a.id)}>
                      {'  '.repeat(a.depth || 0)}{a.depth > 0 ? '└─ ' : ''}{a.name}
                    </option>
                  ))}
                </select>
                {form.areaId && editId && (
                  <div style={{ marginTop:5,fontSize:11,color:'#059669',background:'#f0fdf4',
                    border:'1px solid #bbf7d0',borderRadius:6,padding:'5px 10px' }}>
                    ✅ {L(
                      'Save गर्दा यस device लाई area का सबै users र fingerprint templates push गरिन्छ',
                      'Saving will auto-push all area users + fingerprint templates to this device'
                    )}
                  </div>
                )}
              </div>

              {/* ── Communication Key ── */}
              <div className="form-group">
                <label className="form-label">Communication Key</label>
                <input className="form-control" placeholder="0 (default)"
                  value={form.communicationKey}
                  onChange={e=>setForm(p=>({...p,communicationKey:e.target.value}))} />
              </div>

              {/* ── For new device only: show IP / Port inputs ── */}
              {!editId && (
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">IP Address <span style={{ fontSize:11,color:'#9ca3af' }}>(optional)</span></label>
                    <input className="form-control" placeholder="192.168.1.100"
                      value={form.ipAddress} onChange={e=>setForm(p=>({...p,ipAddress:e.target.value}))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Serial Number <span style={{ fontSize:11,color:'#9ca3af' }}>(auto on connect)</span></label>
                    <input className="form-control" placeholder="Auto-filled"
                      value={form.serialNumber} onChange={e=>setForm(p=>({...p,serialNumber:e.target.value}))} />
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ SEND COMMAND MODAL ══ */}
      {cmdModal&&(
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h2>⚡ {L('कमान्ड पठाउनुस','Send Raw Command')}</h2>
              <button className="modal-close" onClick={()=>setCmdModal(false)}>✕</button></div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Device</label>
                <select className="form-control" value={cmdForm.deviceSn}
                  onChange={e=>setCmdForm(p=>({...p,deviceSn:e.target.value}))}>
                  <option value="">— Select —</option>
                  {devices.map(d=><option key={d.id} value={d.serial_number}>{d.name} ({d.serial_number||'no SN'})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">{L('कमान्ड','Command Payload')}</label>
                <input className="form-control" placeholder="C:1001:CHECK"
                  value={cmdForm.commandPayload} onChange={e=>setCmdForm(p=>({...p,commandPayload:e.target.value}))} />
              </div>
              <div style={{ fontSize:11,color:'#9ca3af' }}>Examples: <code>C:1001:CHECK</code>, <code>C:1002:REBOOT</code></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setCmdModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={async()=>{
                if(!cmdForm.deviceSn||!cmdForm.commandPayload) return;
                try { await api.post('/zkteco/commands',cmdForm); showToast('Command queued'); setCmdModal(false); loadCommands(); }
                catch(err) { showToast(err.message,'danger'); }
              }}>⚡ Send</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ DELETE CONFIRM ══ */}
      {delConfirm&&(
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ Delete Device</h2><button className="modal-close" onClick={()=>setDelConfirm(null)}>✕</button></div>
            <div className="modal-body"><p>Are you sure you want to delete this device?</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={()=>setDelConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={()=>handleDelete(delConfirm)}>🗑 Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast&&(
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            <span>{toast.type==='success'?'✅':'❌'}</span>
            <span style={{ fontSize:12 }}>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ZKTecoDeviceSettings;
