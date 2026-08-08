import React, { useState, useMemo, useEffect } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useManualPostingApply } from '../../context/ManualPostingApplyContext.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';

/* Same shape as ManualPostings.jsx's inline Add form — this is the FAB's
   instant-popup entry point into the same POST /attendance/manual-postings
   backend, mirroring how LeaveApplyModal/OfficeVisitApplyModal/
   MissingAttendanceApplyModal each give the FAB its own global popup.
   Admins keep the original free-pick-any-staff, instantly-approved behavior
   (this is still their manual-correction tool). A non-admin can only ever
   post about themselves, and it always lands as a pending request — like
   Leave/Office Visit — that sits until their configured recommender/approver
   accepts it, rather than writing straight into real attendance data. */
const empty = { employeeId: '', date: '', checkIn: '', checkOut: '', remark: '', recommendedBy: '', approvedBy: '' };

const loadRecoApproval = () => {
  try { return JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}'); } catch { return {}; }
};
const getRecoIds = (empId) => {
  if (!empId) return [];
  const r = loadRecoApproval()[String(empId)]?.reco;
  return Array.isArray(r) ? r.map(String) : (r ? [String(r)] : []);
};
const getApprovalIds = (empId) => {
  if (!empId) return [];
  const a = loadRecoApproval()[String(empId)]?.approval;
  return Array.isArray(a) ? a.map(String) : (a ? [String(a)] : []);
};

const TimeInput = ({ value, onChange }) => (
  <input type="time" value={value} onChange={e => onChange(e.target.value)}
    style={{ height:36, width:'100%', border:'1px solid #d1d5db', borderRadius:7, padding:'0 10px', fontSize:13, boxSizing:'border-box', outline:'none' }} />
);

const DateInput = ({ value, onChange }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') return <NepaliDatePicker value={value} onChange={onChange} />;
  return (
    <input type="date" value={value} onChange={e => onChange(e.target.value)}
      style={{ height:36, width:'100%', border:'1px solid #d1d5db', borderRadius:7, padding:'0 10px', fontSize:13, boxSizing:'border-box', outline:'none' }} />
  );
};

const field = (label, required, err, children) => (
  <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
    <label style={{ fontSize:12, fontWeight:600, color:'#374151' }}>
      {label}{required && <span style={{ color:'#dc2626' }}> *</span>}
    </label>
    {children}
    {err && <span style={{ fontSize:11, color:'#dc2626' }}>{err}</span>}
  </div>
);

const ManualPostingApplyModal = () => {
  const { isOpen, close, prefillDate } = useManualPostingApply();
  const { filteredEmployees } = useData();
  const { currentUser, canManageSystem } = useAuth();
  const isAdmin = canManageSystem;

  const [form,    setForm]    = useState(empty);
  const [errors,  setErrors]  = useState({});
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);

  // Non-admin: always about themselves, pre-filled and locked the moment the
  // popup opens — a raw API call ignoring this is separately rejected server-side.
  useEffect(() => {
    if (!isOpen) return;
    const base = isAdmin ? empty : { ...empty, employeeId: String(currentUser?.id || '') };
    setForm(prefillDate ? { ...base, date: prefillDate } : base);
    setErrors({});
    setSuccess(false);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const recoIds     = useMemo(() => getRecoIds(form.employeeId),     [form.employeeId]);
  const approvalIds = useMemo(() => getApprovalIds(form.employeeId), [form.employeeId]);
  const recoOptions     = useMemo(() => filteredEmployees.filter(e => recoIds.includes(String(e.id))),     [filteredEmployees, recoIds]);
  const approvalOptions = useMemo(() => filteredEmployees.filter(e => approvalIds.includes(String(e.id))), [filteredEmployees, approvalIds]);

  const handleClose = () => {
    close();
    setForm(empty);
    setErrors({});
    setSuccess(false);
    setSaving(false);
  };

  const validate = () => {
    const e = {};
    if (!form.employeeId) e.employeeId = 'Staff is required';
    if (!form.date)       e.date       = 'Date is required';
    return e;
  };

  const save = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      await api.post('/attendance/manual-postings', {
        employeeId    : Number(form.employeeId),
        date          : form.date,
        checkIn       : form.checkIn       || null,
        checkOut      : form.checkOut      || null,
        remark        : form.remark        || null,
        recommendedBy : form.recommendedBy ? Number(form.recommendedBy) : null,
        approvedBy    : form.approvedBy    ? Number(form.approvedBy)    : null,
      });
      setSaving(false);
      setSuccess(true);
    } catch (err) {
      setErrors({ _submit: err.message || 'Save failed' });
      setSaving(false);
    }
  };

  useSaveShortcut(isOpen && !success, save);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth:520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⏱️ Inform Late In / Early Out</h2>
          <button className="modal-close" onClick={handleClose}>✕</button>
        </div>

        {success ? (
          <>
            <div className="modal-body" style={{ textAlign:'center', padding:'32px 24px' }}>
              <div style={{ fontSize:40, marginBottom:10 }}>{isAdmin ? '✅' : '📤'}</div>
              <div style={{ fontSize:15, fontWeight:700, color:'#111827', marginBottom:6 }}>
                {isAdmin ? 'Entry posted successfully' : 'Request submitted — pending approval'}
              </div>
              <div style={{ fontSize:12, color:'#6b7280' }}>
                {isAdmin
                  ? ((form.recommendedBy || form.approvedBy)
                      ? 'The recommender/approver has been notified.'
                      : 'No recommender/approver was configured for this staff member.')
                  : ((form.recommendedBy || form.approvedBy)
                      ? 'Your recommender/approver has been notified. This will only appear in your attendance once approved.'
                      : 'No recommender/approver is configured for you — ask your admin to set one so this can be approved.')}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {errors._submit && (
                <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#991b1b' }}>
                  {errors._submit}
                </div>
              )}

              {isAdmin ? (
                field('Staff', true, errors.employeeId,
                  <div style={{ outline: errors.employeeId ? '1.5px solid #dc2626' : 'none', borderRadius:7 }}>
                    <SearchableSelect
                      value={form.employeeId}
                      onChange={v => setForm(p => ({ ...p, employeeId:v, recommendedBy:'', approvedBy:'' }))}
                      options={filteredEmployees.map(e => ({ value:String(e.id), label:`${e.fullName} (${e.employeeId})` }))}
                      placeholder="— Select Staff —"
                    />
                  </div>
                )
              ) : (
                <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 12px' }}>
                  <div style={{ fontSize:10, color:'#9ca3af', marginBottom:2 }}>Staff</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#1f2937' }}>
                    {currentUser?.fullName} {currentUser?.employeeId ? `(${currentUser.employeeId})` : ''}
                  </div>
                </div>
              )}

              {field('Date', true, errors.date,
                <DateInput value={form.date} onChange={v => setForm(p => ({ ...p, date:v }))} />
              )}

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                {field('Check In Time', false, null,
                  <TimeInput value={form.checkIn} onChange={v => setForm(p => ({ ...p, checkIn:v }))} />
                )}
                {field('Check Out Time', false, null,
                  <TimeInput value={form.checkOut} onChange={v => setForm(p => ({ ...p, checkOut:v }))} />
                )}
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                {field('Recommended By', false, null,
                  <SearchableSelect
                    value={form.recommendedBy}
                    onChange={v => setForm(p => ({ ...p, recommendedBy:v }))}
                    options={recoOptions.map(e => ({ value:String(e.id), label:e.fullName }))}
                    placeholder={!form.employeeId ? '— Select staff first —' : recoOptions.length === 0 ? 'No recommendator configured' : '— Select —'}
                    disabled={!form.employeeId || recoOptions.length === 0}
                  />
                )}
                {field('Approved By', false, null,
                  <SearchableSelect
                    value={form.approvedBy}
                    onChange={v => setForm(p => ({ ...p, approvedBy:v }))}
                    options={approvalOptions.map(e => ({ value:String(e.id), label:e.fullName }))}
                    placeholder={!form.employeeId ? '— Select staff first —' : approvalOptions.length === 0 ? 'No approver configured' : '— Select —'}
                    disabled={!form.employeeId || approvalOptions.length === 0}
                  />
                )}
              </div>

              {field('Remark / Reason', false, null,
                <textarea
                  value={form.remark}
                  onChange={e => setForm(p => ({ ...p, remark:e.target.value }))}
                  rows={3}
                  placeholder="Optional note or reason for manual posting..."
                  style={{ border:'1px solid #d1d5db', borderRadius:7, padding:'8px 10px', fontSize:13, resize:'vertical', outline:'none', fontFamily:'inherit' }}
                />
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={handleClose}>Cancel</button>
              <SaveButton onClick={save} disabled={saving}
                icon={saving ? '⏳' : isAdmin ? '💾' : '📤'}
                label={saving ? 'Saving…' : isAdmin ? 'Save' : 'Submit'} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ManualPostingApplyModal;
