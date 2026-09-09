import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client.js';

// Landed here by scanning a "Scan to Check In" QR shown in the Add/Edit
// Guest form (Staff → Visitor Registration) for one specific company at one
// specific event. No eHajiri login involved — the guest taps their own name
// from the list already added for their company, and that's it.
const fmtDateTime = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleString('en-US', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
};

// Fixed vendor branding, not per-tenant event data — shows on every screen of
// this page (guest list / check-in, and the Lucky Draw coupon confirmation),
// so it's rendered once here in Shell rather than duplicated per state.
const DistributorFooter = () => (
  <div style={{ padding:'14px 22px', borderTop:'1px solid #f1f5f9', textAlign:'center', background:'#fafafa' }}>
    <div style={{ fontSize:11, fontWeight:700, color:'#374151' }}>ZKTECO Authorized Distributor for Nepal</div>
    <div style={{ fontSize:12.5, fontWeight:800, color:'#111827', marginTop:2 }}>Planet Infosys Pvt. Ltd</div>
    <div style={{ fontSize:10.5, color:'#6b7280', marginTop:3, lineHeight:1.5 }}>
      Chakupath, Lalitpur Nepal<br />
      www.planetinfosys.com.np<br />
      Ph: 01-5269837
    </div>
  </div>
);

const Shell = ({ children }) => (
  <div style={{
    minHeight:'100vh', background:'#f3f4f6', display:'flex', alignItems:'center',
    justifyContent:'center', padding:16, fontFamily:'inherit',
  }}>
    <div style={{
      width:'100%', maxWidth:440, background:'#fff', borderRadius:16,
      boxShadow:'0 8px 30px rgba(0,0,0,.1)', overflow:'hidden',
    }}>
      {children}
      <DistributorFooter />
    </div>
  </div>
);

const GuestCheckin = () => {
  const { token } = useParams();
  const [state, setState] = useState({ loading:true, error:'', data:null });
  const [checkingInId, setCheckingInId] = useState(null);
  const [result, setResult] = useState(null); // { guest, message } once checked in
  const [showAddForm, setShowAddForm] = useState(false);
  const [selfForm, setSelfForm] = useState({ name:'', post:'', department:'', mobile1:'', mobile2:'', email:'' });
  const [registering, setRegistering] = useState(false);
  const [registerErr, setRegisterErr] = useState('');
  const setSelfField = (key) => (e) => setSelfForm(f => ({ ...f, [key]: e.target.value }));

  // Self-service "fix my own info" — separate from the Add New Guest form
  // above, opened per-guest by tapping ✏️ next to their name.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name:'', post:'', department:'', mobile1:'', mobile2:'', email:'' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState('');
  const setEditField = (key) => (e) => setEditForm(f => ({ ...f, [key]: e.target.value }));
  const openEdit = (g) => {
    setEditingId(g.id);
    setEditErr('');
    setEditForm({ name:g.name||'', post:g.post||'', department:g.department||'',
      mobile1:g.mobile1||'', mobile2:g.mobile2||'', email:g.email||'' });
  };
  const saveEdit = async (guestId) => {
    if (!editForm.name.trim()) { setEditErr('Please enter your name'); return; }
    setEditErr('');
    setSavingEdit(true);
    try {
      const res = await api.put('/guest-checkin/guest', {
        token, guestId,
        name: editForm.name.trim(), post: editForm.post.trim(), department: editForm.department.trim(),
        mobile1: editForm.mobile1.trim(), mobile2: editForm.mobile2.trim(), email: editForm.email.trim(),
      });
      setState(s => ({ ...s, data: { ...s.data, guests: s.data.guests.map(g => g.id === guestId ? { ...g, ...res.guest } : g) } }));
      setEditingId(null);
    } catch (err) {
      setEditErr(err?.data?.error || err?.message || 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  useEffect(() => {
    if (!token) { setState({ loading:false, error:'Missing check-in link', data:null }); return; }
    api.get(`/guest-checkin/verify?token=${encodeURIComponent(token)}`)
      .then(data => setState({ loading:false, error:'', data }))
      .catch(err => setState({ loading:false, error: err?.data?.error || err?.message || 'This link is invalid or has expired', data:null }));
  }, [token]);

  const checkIn = async (guest) => {
    setCheckingInId(guest.id);
    try {
      const res = await api.post('/guest-checkin/checkin', { token, guestId: guest.id });
      setResult(res);
    } catch (err) {
      setState(s => ({ ...s, error: err?.data?.error || err?.message || 'Check-in failed' }));
    } finally {
      setCheckingInId(null);
    }
  };

  const registerSelf = async () => {
    if (!selfForm.name.trim()) { setRegisterErr('Please enter your name'); return; }
    setRegisterErr('');
    setRegistering(true);
    try {
      const res = await api.post('/guest-checkin/register', {
        token,
        name: selfForm.name.trim(), post: selfForm.post.trim(), department: selfForm.department.trim(),
        mobile1: selfForm.mobile1.trim(), mobile2: selfForm.mobile2.trim(), email: selfForm.email.trim(),
      });
      setResult(res);
    } catch (err) {
      setRegisterErr(err?.data?.error || err?.message || 'Check-in failed');
    } finally {
      setRegistering(false);
    }
  };

  if (state.loading) {
    return <Shell><div style={{ padding:40, textAlign:'center', color:'#9ca3af' }}>Loading…</div></Shell>;
  }

  if (state.error) {
    return (
      <Shell>
        <div style={{ padding:32, textAlign:'center' }}>
          <div style={{ fontSize:36, marginBottom:10 }}>⚠️</div>
          <div style={{ fontSize:15, fontWeight:700, color:'#374151' }}>{state.error}</div>
        </div>
      </Shell>
    );
  }

  // Post-checkin confirmation — thank-you message + the event's invitation image.
  if (result) {
    return (
      <Shell>
        <div style={{ padding:'32px 28px', textAlign:'center' }}>
          <div style={{ fontSize:44, marginBottom:12 }}>✅</div>
          <div style={{ fontSize:17, fontWeight:800, color:'#111827', marginBottom:4 }}>
            {result.guest?.name}
          </div>
          <div style={{ fontSize:13, color:'#059669', fontWeight:700, marginBottom:18 }}>
            Checked in at {fmtDateTime(result.guest?.checkedInAt)}
          </div>
          <div style={{ fontSize:14, color:'#374151', lineHeight:1.5, marginBottom:18 }}>
            {result.message}
          </div>
          {result.guest?.luckyDrawNo != null && (
            <div style={{ background:'#fffbeb', border:'1.5px dashed #fbbf24', borderRadius:12,
              padding:'14px 10px', marginBottom: result.event?.invitationImage ? 18 : 0 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'.5px' }}>
                🎟️ Lucky Draw Number
              </div>
              <div style={{ fontSize:32, fontWeight:800, color:'#92400e', letterSpacing:'1px', marginTop:2 }}>
                #{String(result.guest.luckyDrawNo).padStart(3, '0')}
              </div>
            </div>
          )}
          {result.event?.invitationImage && (
            <img src={result.event.invitationImage} alt="Event Invitation"
              style={{ width:'100%', borderRadius:10, border:'1px solid #e5e7eb', display:'block' }} />
          )}
        </div>
      </Shell>
    );
  }

  const { event, company, guests } = state.data;
  const { isEventDay, isUpcoming } = event;

  const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { day:'2-digit', month:'short', year:'numeric' }) : '';

  return (
    <Shell>
      <div style={{ padding:'24px 22px 8px', textAlign:'center', borderBottom:'1px solid #f1f5f9' }}>
        <div style={{ fontSize:26, marginBottom:6 }}>🎪</div>
        <div style={{ fontSize:17, fontWeight:800, color:'#111827' }}>{event.name}</div>
        {event.venue && <div style={{ fontSize:12.5, color:'#6b7280', marginTop:3 }}>📍 {event.venue}</div>}
        {isEventDay && (
          <div style={{ fontSize:12.5, color:'#6b7280', marginTop:8, marginBottom:16 }}>
            {company.companyName} — tap your name to check in
          </div>
        )}
      </div>
      {!isEventDay && (
        <div style={{ padding:'28px 24px 32px', textAlign:'center' }}>
          <div style={{ fontSize:34, marginBottom:10 }}>{isUpcoming ? '📅' : '🕓'}</div>
          <div style={{ fontSize:14.5, fontWeight:700, color:'#374151', marginBottom:4 }}>
            {isUpcoming ? 'Check-in has not opened yet' : 'This event has already taken place'}
          </div>
          <div style={{ fontSize:13, color:'#6b7280' }}>
            {isUpcoming
              ? `Check-in opens on ${fmtDate(event.eventDate)}.`
              : `Check-in was only available on ${fmtDate(event.eventDate)}.`}
          </div>
        </div>
      )}
      {isEventDay && <div style={{ padding:'14px 18px 22px', display:'flex', flexDirection:'column', gap:8 }}>
        {guests.length === 0 && !showAddForm && (
          <div style={{ padding:'8px 4px 16px', textAlign:'center', color:'#9ca3af', fontSize:13 }}>
            No guests have been added for {company.companyName} yet.
          </div>
        )}

        {guests.map(g => (
          <div key={g.id} style={{
            borderRadius:10, border: g.attended ? '1px solid #bbf7d0' : '1px solid #e5e7eb',
            background: g.attended ? '#f0fdf4' : '#fff', overflow:'hidden',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 8px 8px 16px' }}>
              <button onClick={() => !g.attended && checkIn(g)} disabled={g.attended || checkingInId === g.id}
                style={{
                  flex:1, minWidth:0, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
                  padding:'4px 0', border:'none', background:'none', cursor: g.attended ? 'default' : 'pointer',
                  fontSize:14, fontWeight:700, color: g.attended ? '#065f46' : '#111827', textAlign:'left',
                }}>
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.name}</span>
                {g.attended
                  ? <span style={{ fontSize:11.5, fontWeight:700, flexShrink:0 }}>✓ Checked In</span>
                  : <span style={{ fontSize:12, fontWeight:700, color:'#1a56db', flexShrink:0 }}>
                      {checkingInId === g.id ? 'Checking in…' : 'Check In →'}
                    </span>}
              </button>
              <button onClick={() => editingId === g.id ? setEditingId(null) : openEdit(g)}
                title="Fix my info" style={{
                  flexShrink:0, width:30, height:30, borderRadius:8, border:'1px solid #e5e7eb',
                  background:'#fff', color:'#6b7280', cursor:'pointer', fontSize:13,
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                ✏️
              </button>
            </div>
            {editingId === g.id && (
              <div style={{ padding:'4px 16px 14px', display:'flex', flexDirection:'column', gap:8,
                borderTop:'1px solid #f1f5f9' }}>
                <div style={{ fontSize:11.5, fontWeight:700, color:'#374151', marginTop:8 }}>
                  ✏️ Fix your information
                </div>
                <input value={editForm.name} onChange={setEditField('name')} placeholder="Name *"
                  style={{ padding:'10px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:13.5 }} />
                <div style={{ display:'flex', gap:8 }}>
                  <input value={editForm.post} onChange={setEditField('post')} placeholder="Post / Position"
                    style={{ flex:1, minWidth:0, padding:'10px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:13.5 }} />
                  <input value={editForm.department} onChange={setEditField('department')} placeholder="Department"
                    style={{ flex:1, minWidth:0, padding:'10px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:13.5 }} />
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <input value={editForm.mobile1} onChange={setEditField('mobile1')} placeholder="Mobile 1"
                    style={{ flex:1, minWidth:0, padding:'10px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:13.5 }} />
                  <input value={editForm.mobile2} onChange={setEditField('mobile2')} placeholder="Mobile 2"
                    style={{ flex:1, minWidth:0, padding:'10px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:13.5 }} />
                </div>
                <input value={editForm.email} onChange={setEditField('email')} placeholder="Email" type="email"
                  style={{ padding:'10px 12px', borderRadius:8, border:'1px solid #d1d5db', fontSize:13.5 }} />
                {editErr && <div style={{ color:'#dc2626', fontSize:12 }}>{editErr}</div>}
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => setEditingId(null)}
                    style={{ padding:'9px 14px', borderRadius:8, border:'1px solid #d1d5db', background:'#fff',
                      color:'#374151', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={() => saveEdit(g.id)} disabled={savingEdit}
                    style={{ flex:1, padding:'9px 0', borderRadius:8, border:'none', background:'#1a56db', color:'#fff',
                      fontSize:13, fontWeight:700, cursor: savingEdit ? 'default' : 'pointer', opacity: savingEdit ? .7 : 1 }}>
                    {savingEdit ? 'Saving…' : '💾 Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {showAddForm ? (
          <div style={{ marginTop: guests.length ? 8 : 0, paddingTop: guests.length ? 14 : 0,
            borderTop: guests.length ? '1px solid #f1f5f9' : 'none', display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:'#374151' }}>+ Add New Guest</div>
            <input value={selfForm.name} onChange={setSelfField('name')} placeholder="Name *" autoFocus
              style={{ padding:'11px 14px', borderRadius:10, border:'1px solid #d1d5db', fontSize:14 }} />
            <div style={{ display:'flex', gap:8 }}>
              <input value={selfForm.post} onChange={setSelfField('post')} placeholder="Post / Position"
                style={{ flex:1, minWidth:0, padding:'11px 14px', borderRadius:10, border:'1px solid #d1d5db', fontSize:14 }} />
              <input value={selfForm.department} onChange={setSelfField('department')} placeholder="Department"
                style={{ flex:1, minWidth:0, padding:'11px 14px', borderRadius:10, border:'1px solid #d1d5db', fontSize:14 }} />
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <input value={selfForm.mobile1} onChange={setSelfField('mobile1')} placeholder="Mobile 1"
                style={{ flex:1, minWidth:0, padding:'11px 14px', borderRadius:10, border:'1px solid #d1d5db', fontSize:14 }} />
              <input value={selfForm.mobile2} onChange={setSelfField('mobile2')} placeholder="Mobile 2"
                style={{ flex:1, minWidth:0, padding:'11px 14px', borderRadius:10, border:'1px solid #d1d5db', fontSize:14 }} />
            </div>
            <input value={selfForm.email} onChange={setSelfField('email')} placeholder="Email" type="email"
              style={{ padding:'11px 14px', borderRadius:10, border:'1px solid #d1d5db', fontSize:14 }} />
            {registerErr && <div style={{ color:'#dc2626', fontSize:12.5 }}>{registerErr}</div>}
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => { setShowAddForm(false); setRegisterErr(''); setSelfForm({ name:'', post:'', department:'', mobile1:'', mobile2:'', email:'' }); }}
                style={{ padding:'12px 16px', borderRadius:10, border:'1px solid #d1d5db', background:'#fff',
                  color:'#374151', fontSize:14, fontWeight:700, cursor:'pointer' }}>
                Cancel
              </button>
              <button onClick={registerSelf} disabled={registering}
                style={{ flex:1, padding:'12px 0', borderRadius:10, border:'none', background:'#1a56db', color:'#fff',
                  fontSize:14, fontWeight:700, cursor: registering ? 'default' : 'pointer', opacity: registering ? .7 : 1 }}>
                {registering ? 'Checking in…' : '+ Add & Check In'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddForm(true)}
            style={{ marginTop: guests.length ? 4 : 0, padding:'12px 0', borderRadius:10,
              border:'1.5px dashed #93c5fd', background:'#eff6ff', color:'#1d4ed8',
              fontSize:13.5, fontWeight:700, cursor:'pointer' }}>
            + Add New Guest
          </button>
        )}
      </div>}
    </Shell>
  );
};

export default GuestCheckin;
