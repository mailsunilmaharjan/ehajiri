/**
 * ImportDeviceUsersModal
 * Shared by Staff Detail page and Device Users tab.
 * Calls POST /api/zkteco/import-to-staff to create/update staff from device users.
 */
import React, { useState, useEffect } from 'react';
import api from '../../api/client.js';

const ImportDeviceUsersModal = ({ onClose, onDone }) => {
  const [emailDomain,  setEmailDomain]  = useState('planetinfosys.com.np');
  const [deviceUsers,  setDeviceUsers]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [running,      setRunning]      = useState(false);
  const [result,       setResult]       = useState(null);

  useEffect(() => {
    api.get('/zkteco/device-users')
      .then(rows => setDeviceUsers(rows || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleRun = async () => {
    setRunning(true);
    try {
      const r = await api.post('/zkteco/import-to-staff', { emailDomain });
      setResult(r);
      if (onDone) await onDone();
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setRunning(false);
    }
  };

  const unlinked = deviceUsers.filter(u => !u.employee_id);
  const linked   = deviceUsers.filter(u =>  u.employee_id);
  const validDomain = emailDomain.trim().length > 3 && emailDomain.includes('.');

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth:580, maxHeight:'92vh', overflowY:'auto' }}
           onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header"
             style={{ background:'linear-gradient(135deg,#1e3a5f,#1a56db)', color:'white', position:'sticky', top:0, zIndex:10 }}>
          <div>
            <h2 style={{ color:'white', margin:0 }}>📥 Import Device Users to Staff</h2>
            <div style={{ fontSize:12, color:'#bfdbfe', marginTop:2 }}>
              Device Users → Staff Detail table
            </div>
          </div>
          <button className="modal-close" style={{ color:'white' }} onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">

          {/* Result view — shown after import runs */}
          {result && !result.error && (
            <div>
              <div style={{ background:'#d1fae5', border:'1px solid #6ee7b7', borderRadius:10, padding:'16px', marginBottom:16, textAlign:'center' }}>
                <div style={{ fontSize:32, marginBottom:6 }}>✅</div>
                <div style={{ fontWeight:800, fontSize:18, color:'#065f46', marginBottom:4 }}>Import Complete</div>
                <div style={{ display:'flex', justifyContent:'center', gap:24, fontSize:14, color:'#047857', marginTop:8 }}>
                  <div><strong style={{ fontSize:24 }}>{result.created}</strong><br/>New Staff Created</div>
                  <div style={{ borderLeft:'2px solid #6ee7b7' }}/>
                  <div><strong style={{ fontSize:24 }}>{result.updated}</strong><br/>Updated</div>
                  <div style={{ borderLeft:'2px solid #6ee7b7' }}/>
                  <div><strong style={{ fontSize:24 }}>{result.skipped}</strong><br/>Skipped</div>
                </div>
              </div>

              {/* Per-row results */}
              {result.results?.length > 0 && (
                <div style={{ border:'1px solid #e5e7eb', borderRadius:8, overflow:'hidden', marginBottom:12 }}>
                  <div style={{ background:'#f9fafb', padding:'8px 14px', fontSize:12, fontWeight:700, color:'#374151', borderBottom:'1px solid #e5e7eb' }}>
                    Detail ({result.total} device users processed)
                  </div>
                  <div style={{ maxHeight:220, overflowY:'auto' }}>
                    <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse' }}>
                      <thead>
                        <tr style={{ background:'#f3f4f6', position:'sticky', top:0 }}>
                          <th style={{ padding:'6px 10px', textAlign:'left', borderBottom:'1px solid #e5e7eb' }}>PIN</th>
                          <th style={{ padding:'6px 10px', textAlign:'left', borderBottom:'1px solid #e5e7eb' }}>Name</th>
                          <th style={{ padding:'6px 10px', textAlign:'left', borderBottom:'1px solid #e5e7eb' }}>Email</th>
                          <th style={{ padding:'6px 10px', textAlign:'center', borderBottom:'1px solid #e5e7eb' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.results.map((r, i) => {
                          const colors = {
                            created: { bg:'#d1fae5', color:'#065f46' },
                            updated: { bg:'#dbeafe', color:'#1e40af' },
                            linked:  { bg:'#e0f2fe', color:'#0369a1' },
                            error:   { bg:'#fee2e2', color:'#991b1b' },
                          };
                          const c = colors[r.action] || { bg:'#f3f4f6', color:'#374151' };
                          return (
                            <tr key={i} style={{ borderBottom:'1px solid #f3f4f6', background: i%2===0?'white':'#fafafa' }}>
                              <td style={{ padding:'5px 10px', fontFamily:'monospace', fontWeight:700, color:'#1a56db' }}>{r.pin}</td>
                              <td style={{ padding:'5px 10px', fontWeight:600 }}>{r.name}</td>
                              <td style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:11, color:'#6b7280' }}>{r.email}</td>
                              <td style={{ padding:'5px 10px', textAlign:'center' }}>
                                <span style={{ background:c.bg, color:c.color, borderRadius:4, padding:'1px 8px', fontSize:11, fontWeight:700, textTransform:'uppercase' }}>
                                  {r.action}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button className="btn btn-primary" style={{ width:'100%' }} onClick={onClose}>
                ✓ Close — View Staff Detail
              </button>
            </div>
          )}

          {result?.error && (
            <div style={{ background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:8, padding:'12px 16px', marginBottom:12, color:'#991b1b' }}>
              ❌ {result.error}
            </div>
          )}

          {/* Setup form — shown before import runs */}
          {!result && (
            <>
              {/* Stats */}
              {!loading && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:16 }}>
                  {[
                    { label:'Total Device Users', value:deviceUsers.length,     color:'#1a56db', bg:'#eff6ff' },
                    { label:'Will Create (new)',  value:unlinked.length,         color:'#059669', bg:'#d1fae5' },
                    { label:'Will Update (linked)',value:linked.length,          color:'#0369a1', bg:'#e0f2fe' },
                  ].map(s => (
                    <div key={s.label} style={{ background:s.bg, borderRadius:8, padding:'10px 14px', textAlign:'center' }}>
                      <div style={{ fontSize:24, fontWeight:800, color:s.color }}>{s.value}</div>
                      <div style={{ fontSize:11, color:'#6b7280', marginTop:2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
              {loading && <div style={{ textAlign:'center', padding:'20px', color:'#6b7280' }}>Loading device users…</div>}

              {/* What this does */}
              <div style={{ background:'#f9fafb', borderRadius:10, padding:'12px 16px', marginBottom:14, border:'1px solid #e5e7eb' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:10, textTransform:'uppercase', letterSpacing:'.4px' }}>
                  What gets transferred
                </div>
                <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ padding:'4px 8px', textAlign:'left', color:'#6b7280', fontWeight:600, fontSize:11 }}>Device Users Field</th>
                      <th style={{ padding:'4px 8px', textAlign:'center', color:'#9ca3af', fontSize:16 }}>→</th>
                      <th style={{ padding:'4px 8px', textAlign:'left', color:'#6b7280', fontWeight:600, fontSize:11 }}>Staff Detail Field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { from:'PIN',       to:'Attendance Device ID', fromColor:'#1a56db', toColor:'#059669' },
                      { from:'Name',      to:'Staff Name (Full Name)',fromColor:'#374151', toColor:'#374151' },
                      { from:'auto-gen',  to:`Email  (PIN@${emailDomain||'domain'})`, fromColor:'#6b7280', toColor:'#7c3aed' },
                    ].map(row => (
                      <tr key={row.from} style={{ borderTop:'1px solid #f3f4f6' }}>
                        <td style={{ padding:'8px', fontWeight:700, color:row.fromColor }}>{row.from}</td>
                        <td style={{ padding:'8px', textAlign:'center', color:'#9ca3af', fontSize:18 }}>→</td>
                        <td style={{ padding:'8px', fontWeight:600, color:row.toColor }}>{row.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Email domain */}
              <div className="form-group" style={{ marginBottom:14 }}>
                <label className="form-label" style={{ fontWeight:700 }}>📧 Email Domain</label>
                <div style={{ display:'flex', alignItems:'center', gap:0 }}>
                  <span style={{ background:'#f3f4f6', border:'1px solid #d1d5db', borderRight:'none', borderRadius:'6px 0 0 6px', padding:'9px 12px', fontSize:13, color:'#6b7280', whiteSpace:'nowrap' }}>
                    PIN @
                  </span>
                  <input className="form-control"
                    style={{ borderRadius:'0 6px 6px 0', borderLeft:'none', fontSize:14 }}
                    value={emailDomain}
                    placeholder="planetinfosys.com.np"
                    onChange={e => setEmailDomain(e.target.value.trim())} />
                </div>
                <div style={{ fontSize:12, color:'#6b7280', marginTop:4 }}>
                  Example: PIN = <strong>8</strong> → email = <code>8@{emailDomain||'planetinfosys.com.np'}</code>
                </div>
              </div>

              {/* Preview table */}
              {!loading && deviceUsers.length > 0 && (
                <div style={{ border:'1px solid #e5e7eb', borderRadius:8, overflow:'hidden', marginBottom:4 }}>
                  <div style={{ background:'#f9fafb', padding:'8px 14px', fontSize:12, fontWeight:700, color:'#374151', borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between' }}>
                    <span>Preview — {deviceUsers.length} Device Users</span>
                    <span style={{ color:'#6b7280', fontWeight:400 }}>Showing all {deviceUsers.length}</span>
                  </div>
                  <div style={{ maxHeight:200, overflowY:'auto' }}>
                    <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse' }}>
                      <thead>
                        <tr style={{ background:'#f3f4f6', position:'sticky', top:0 }}>
                          <th style={{ padding:'5px 10px', textAlign:'left', borderBottom:'1px solid #e5e7eb' }}>PIN → Device ID</th>
                          <th style={{ padding:'5px 10px', textAlign:'left', borderBottom:'1px solid #e5e7eb' }}>Name → Staff Name</th>
                          <th style={{ padding:'5px 10px', textAlign:'left', borderBottom:'1px solid #e5e7eb' }}>Email</th>
                          <th style={{ padding:'5px 10px', textAlign:'center', borderBottom:'1px solid #e5e7eb' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deviceUsers.map((u, i) => (
                          <tr key={u.id} style={{ borderBottom:'1px solid #f3f4f6', background: i%2===0?'white':'#fafafa' }}>
                            <td style={{ padding:'5px 10px', fontFamily:'monospace', fontWeight:700, color:'#1a56db' }}>{u.pin}</td>
                            <td style={{ padding:'5px 10px', fontWeight:600 }}>{u.name || `Staff ${u.pin}`}</td>
                            <td style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:11, color:'#059669' }}>
                              {u.pin}@{emailDomain||'planetinfosys.com.np'}
                            </td>
                            <td style={{ padding:'5px 10px', textAlign:'center' }}>
                              {u.employee_id
                                ? <span style={{ background:'#dbeafe', color:'#1e40af', borderRadius:4, padding:'1px 8px', fontSize:11, fontWeight:700 }}>UPDATE</span>
                                : <span style={{ background:'#d1fae5', color:'#065f46', borderRadius:4, padding:'1px 8px', fontSize:11, fontWeight:700 }}>CREATE</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {deviceUsers.length === 0 && !loading && (
                <div style={{ textAlign:'center', padding:'20px', color:'#9ca3af', fontSize:13 }}>
                  No device users found. Go to Settings → Attendance Device → ⚙️ Control → Get All Users first.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="modal-footer" style={{ position:'sticky', bottom:0, background:'white', borderTop:'1px solid #e5e7eb' }}>
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={running || loading || !validDomain || deviceUsers.length === 0}
              style={{ background:'#059669', borderColor:'#059669', display:'flex', alignItems:'center', gap:8, fontSize:14, padding:'9px 22px' }}
              onClick={handleRun}
            >
              {running ? '⏳ Importing…' : `📥 Import ${deviceUsers.length} Users to Staff`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportDeviceUsersModal;
