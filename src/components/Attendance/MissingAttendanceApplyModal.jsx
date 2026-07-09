import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useMissingAttendanceApply } from '../../context/MissingAttendanceApplyContext.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import api from '../../api/client.js';

/* ── load saved reco/approval (same store used by Leave/Office Visit apply) ── */
const loadRecoApproval = () => {
  try { return JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}'); } catch { return {}; }
};

const DateInput = ({ value, onChange, max }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} maxToday={true} />;
  }
  return (
    <input type="date" className="form-control" value={value} max={max}
      onChange={e => onChange(e.target.value)} style={{ fontSize: 13 }} />
  );
};

const TimeInput = ({ value, onChange }) => (
  <input type="time" className="form-control" value={value || ''}
    onChange={e => onChange(e.target.value)} style={{ fontSize: 13 }} />
);

const Lbl = ({ children, required }) => (
  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
    {children}{required && <span style={{ color: '#dc2626', marginLeft: 2 }}>*</span>}
  </div>
);
const Err = ({ msg }) => msg ? <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{msg}</div> : null;

/* ════════════════════════════════════════════════
   MissingAttendanceApplyModal — globally rendered modal
════════════════════════════════════════════════ */
const MissingAttendanceApplyModal = () => {
  const { isOpen, close, targetEmployeeId, targetDate } = useMissingAttendanceApply();
  const { currentUser } = useAuth();
  const navigate         = useNavigate();
  const { employees: allEmployees } = useData();

  const today = new Date().toISOString().split('T')[0];

  const activeUser = useMemo(() => {
    if (!targetEmployeeId) return currentUser;
    return allEmployees.find(e => String(e.id) === String(targetEmployeeId)) || currentUser;
  }, [targetEmployeeId, allEmployees, currentUser]);

  const emptyForm = { date: targetDate || today, checkIn: '', checkOut: '', reason: '', reco: [], approval: [] };

  const [form,             setForm]             = useState(emptyForm);
  const [errors,           setErrors]           = useState({});
  const [success,          setSuccess]          = useState(false);
  const [submitting,       setSubmitting]       = useState(false);
  const [submitError,      setSubmitError]      = useState('');
  const [selectedReco,     setSelectedReco]     = useState('');
  const [selectedApproval, setSelectedApproval] = useState('');

  const getEmpName = useCallback((id) =>
    (allEmployees || []).find(e => String(e.id) === String(id))?.fullName || `#${id}`,
  [allEmployees]);

  const getMyRecoApproval = useCallback(() => {
    const saved = loadRecoApproval();
    const r = saved[activeUser?.id]?.reco;
    const a = saved[activeUser?.id]?.approval;
    return {
      reco:     Array.isArray(r) ? r : (r ? [r] : []),
      approval: Array.isArray(a) ? a : (a ? [a] : []),
    };
  }, [activeUser?.id]);

  const validate = () => {
    const e = {};
    if (!form.date) e.date = 'Required field';
    if (form.date && form.date > today) e.date = 'Date cannot be in the future';
    if (!form.reason.trim()) e.reason = 'Required field';
    if (form.reason.trim().length < 5) e.reason = 'Minimum 5 characters required';
    if (form.reco.length > 1 && !selectedReco) e.selectedReco = 'Please select a Recommendator';
    if (form.approval.length > 1 && !selectedApproval) e.selectedApproval = 'Please select an Approval Authority';
    return e;
  };

  const handleChange = (field, val) => {
    setForm(p => ({ ...p, [field]: val }));
    setErrors(p => ({ ...p, [field]: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSubmitting(true);
    setSubmitError('');
    const finalReco     = selectedReco     ? [selectedReco]     : form.reco;
    const finalApproval = selectedApproval ? [selectedApproval] : form.approval;
    try {
      await api.post('/attendance/missing-requests', {
        date: form.date,
        checkIn: form.checkIn || null,
        checkOut: form.checkOut || null,
        reason: form.reason.trim(),
        recommendedBy: finalReco[0]     || null,
        approvedBy:    finalApproval[0] || null,
      });
      setSuccess(true);
    } catch (err) {
      setSubmitError(err.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    close();
    setForm(emptyForm);
    setErrors({});
    setSuccess(false);
    setSubmitting(false);
    setSubmitError('');
    setSelectedReco('');
    setSelectedApproval('');
  };

  const initForm = () => {
    const { reco, approval } = getMyRecoApproval();
    setForm({ date: targetDate || today, checkIn: '', checkOut: '', reason: '', reco, approval });
    setSelectedReco(reco.length === 1 ? String(reco[0]) : '');
    setSelectedApproval(approval.length === 1 ? String(approval[0]) : '');
    setErrors({}); setSuccess(false); setSubmitError('');
  };

  const [prevOpen, setPrevOpen] = useState(false);
  if (isOpen && !prevOpen) { setPrevOpen(true); initForm(); }
  if (!isOpen && prevOpen)  { setPrevOpen(false); }

  if (!isOpen || !activeUser) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 10000 }}>
      <div className="modal modal-lg" style={{ maxWidth: 620, maxHeight: '92vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        <div className="modal-header" style={{ background: 'linear-gradient(135deg,#eff6ff,#e0e7ff)', position: 'sticky', top: 0, zIndex: 10 }}>
          <h2>📩 Request for Missing Attendance</h2>
          <button className="modal-close" onClick={handleClose}>✕</button>
        </div>

        <div className="modal-body">
          {success ? (
            <div>
              <div style={{ background:'#d1fae5', border:'1px solid #6ee7b7', borderRadius:10,
                padding:'14px 16px', marginBottom:12, display:'flex', alignItems:'flex-start', gap:12 }}>
                <span style={{ fontSize:28, flexShrink:0 }}>✅</span>
                <div>
                  <div style={{ fontSize:15, fontWeight:800, color:'#065f46', marginBottom:4 }}>
                    Request Submitted Successfully!
                  </div>
                  <div style={{ fontSize:13, color:'#047857' }}>
                    Missing attendance for <strong>{form.date}</strong> has been requested.
                  </div>
                </div>
              </div>

              <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, padding:'14px 16px', fontSize:13 }}>
                <div style={{ fontWeight:700, color:'#92400e', marginBottom:10, fontSize:14 }}>
                  📋 Approval Workflow
                </div>
                <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:12 }}>
                  <div style={{ width:26, height:26, borderRadius:'50%', background:'#eff6ff', border:'2px solid #1a56db',
                    color:'#1a56db', display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:12, fontWeight:800, flexShrink:0 }}>1</div>
                  <div>
                    <div style={{ fontWeight:700, color:'#1e40af', fontSize:13 }}>🔖 Recommendation</div>
                    {selectedReco || form.reco[0] ? (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:5 }}>
                        <span style={{ background:'#dbeafe', color:'#1e40af', borderRadius:10, padding:'3px 12px', fontSize:13, fontWeight:700 }}>
                          👤 {getEmpName(selectedReco || form.reco[0])}
                        </span>
                      </div>
                    ) : <div style={{ color:'#9ca3af', fontSize:12, marginTop:3 }}>No recommendator configured</div>}
                  </div>
                </div>
                <div style={{ borderLeft:'2px dashed #d1d5db', marginLeft:12, height:12, marginBottom:12 }} />
                <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                  <div style={{ width:26, height:26, borderRadius:'50%', background:'#f0fdf4', border:'2px solid #059669',
                    color:'#059669', display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:12, fontWeight:800, flexShrink:0 }}>2</div>
                  <div>
                    <div style={{ fontWeight:700, color:'#065f46', fontSize:13 }}>✅ Approval</div>
                    {selectedApproval || form.approval[0] ? (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:5 }}>
                        <span style={{ background:'#d1fae5', color:'#065f46', borderRadius:10, padding:'3px 12px', fontSize:13, fontWeight:700 }}>
                          👤 {getEmpName(selectedApproval || form.approval[0])}
                        </span>
                      </div>
                    ) : <div style={{ color:'#9ca3af', fontSize:12, marginTop:3 }}>No approval authority configured</div>}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
                <button onClick={handleClose} className="btn btn-outline" style={{ fontSize:13 }}>Close</button>
                <button onClick={() => { handleClose(); navigate('/attendance/missing-requests'); }}
                  className="btn btn-primary" style={{ fontSize:13 }}>
                  📋 View My Requests
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
                padding: '12px 16px', marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
                  letterSpacing: '.5px', marginBottom: 10 }}>
                  👤 Staff Information
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                  {[
                    ['Name',       activeUser.fullName],
                    ['Staff ID',   activeUser.employeeId],
                    ['Department', activeUser.department || '—'],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <Lbl required>Date</Lbl>
                <DateInput value={form.date} max={today} onChange={v => handleChange('date', v)} />
                <Err msg={errors.date} />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <Lbl>Check In</Lbl>
                  <TimeInput value={form.checkIn} onChange={v => handleChange('checkIn', v)} />
                </div>
                <div className="form-group">
                  <Lbl>Check Out</Lbl>
                  <TimeInput value={form.checkOut} onChange={v => handleChange('checkOut', v)} />
                </div>
              </div>

              <div className="form-row" style={{ marginBottom: 14 }}>
                <div>
                  <Lbl required={form.reco.length > 1}>Recommendator</Lbl>
                  {form.reco.length === 0 && (
                    <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 12px', minHeight:36 }}>
                      <span style={{ fontSize:13, color:'#9ca3af' }}>— Not configured —</span>
                    </div>
                  )}
                  {form.reco.length === 1 && (
                    <div style={{ background:'#f0f9ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'8px 12px', minHeight:36, display:'flex', alignItems:'center' }}>
                      <span style={{ background:'#eff6ff', color:'#1a56db', borderRadius:10, padding:'2px 12px', fontSize:13, fontWeight:600 }}>
                        {getEmpName(form.reco[0])}
                      </span>
                    </div>
                  )}
                  {form.reco.length > 1 && (
                    <>
                      <select value={selectedReco} onChange={e => setSelectedReco(e.target.value)}
                        className={`form-control ${errors.selectedReco ? 'error' : ''}`} style={{ fontSize:13, minHeight:42 }}>
                        <option value="">— Select Recommendator —</option>
                        {form.reco.map(id => <option key={id} value={String(id)}>{getEmpName(id)}</option>)}
                      </select>
                      <Err msg={errors.selectedReco} />
                    </>
                  )}
                </div>

                <div>
                  <Lbl required={form.approval.length > 1}>Approval Authority</Lbl>
                  {form.approval.length === 0 && (
                    <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 12px', minHeight:36 }}>
                      <span style={{ fontSize:13, color:'#9ca3af' }}>— Not configured —</span>
                    </div>
                  )}
                  {form.approval.length === 1 && (
                    <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'8px 12px', minHeight:36, display:'flex', alignItems:'center' }}>
                      <span style={{ background:'#d1fae5', color:'#065f46', borderRadius:10, padding:'2px 12px', fontSize:13, fontWeight:600 }}>
                        {getEmpName(form.approval[0])}
                      </span>
                    </div>
                  )}
                  {form.approval.length > 1 && (
                    <>
                      <select value={selectedApproval} onChange={e => setSelectedApproval(e.target.value)}
                        className={`form-control ${errors.selectedApproval ? 'error' : ''}`} style={{ fontSize:13, minHeight:42 }}>
                        <option value="">— Select Approval Authority —</option>
                        {form.approval.map(id => <option key={id} value={String(id)}>{getEmpName(id)}</option>)}
                      </select>
                      <Err msg={errors.selectedApproval} />
                    </>
                  )}
                </div>
              </div>

              <div className="form-group">
                <Lbl required>Reason</Lbl>
                <textarea className={`form-control ${errors.reason ? 'error' : ''}`}
                  rows={3} placeholder="Explain why attendance is missing for this date..."
                  value={form.reason} onChange={e => handleChange('reason', e.target.value)}
                  style={{ fontSize: 13 }} />
                <Err msg={errors.reason} />
              </div>

              {submitError && (
                <div className="alert alert-danger" style={{ marginBottom: 12, fontSize: 13 }}>⚠️ {submitError}</div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
                <button type="button" className="btn btn-outline" onClick={handleClose}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? '⏳ Please wait...' : '📤 Submit Request'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default MissingAttendanceApplyModal;
