import React, { useState, useEffect } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useManualPostingApply } from '../../context/ManualPostingApplyContext.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import EnglishDatePicker from '../Common/EnglishDatePicker.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import useRecoApproval from '../../hooks/useRecoApproval.js';
import { getNepalTodayISO } from '../../utils/dateUtils.js';

/* "Inform Late In / Early Out" (FAB popup) → POST /attendance/manual-postings.
   The staff ticks Late In and/or Early Out; the shift's check-in / check-out time is shown
   (read-only) and they say by how much (HH:MM) they will be late / leave early, plus a reason.
   The server works out the punch time that is recorded once approved
   (shift check-in + late-by, shift check-out − early-by).
   Admins keep the free "pick any staff, instantly approved" behaviour; a non-admin can only
   ever post about themselves and it always lands as a pending request that sits until their
   configured recommender/approver accepts it. */
const makeEmpty = () => ({
  employeeId: '', date: getNepalTodayISO(),
  lateIn: false, lateBy: '00:00', earlyOut: false, earlyBy: '00:00',
  remark: '', recommendedBy: '', approvedBy: '',
});

const inputBase = { height:36, width:'100%', border:'1px solid #d1d5db', borderRadius:7, padding:'0 10px', fontSize:13, boxSizing:'border-box', outline:'none' };
const readOnlyBox = { ...inputBase, background:'#f3f4f6', color:'#374151', display:'flex', alignItems:'center', cursor:'default' };

/* HH:MM text box — digits only, colon inserted automatically, normalised on blur. */
const DurationInput = ({ value, onChange, invalid }) => {
  const fmt = (raw) => {
    const d = String(raw).replace(/\D/g, '').slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
  };
  const normalise = () => {
    const [h = '0', m = '0'] = String(value).split(':');
    const mm = Math.min(59, parseInt(m || '0', 10) || 0);
    onChange(`${String(parseInt(h || '0', 10) || 0).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  };
  return (
    <input type="text" inputMode="numeric" value={value} placeholder="00:00" maxLength={5}
      onChange={e => onChange(fmt(e.target.value))} onBlur={normalise} onFocus={e => e.target.select()}
      style={{ ...inputBase, borderColor: invalid ? '#dc2626' : '#d1d5db', fontVariantNumeric:'tabular-nums' }} />
  );
};

const DateInput = ({ value, onChange }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') return <NepaliDatePicker value={value} onChange={onChange} />;
  return <EnglishDatePicker value={value} onChange={onChange} />;
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

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const toHHMM = (mins) => { const x = ((mins % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

const ManualPostingApplyModal = () => {
  const { isOpen, close, prefillDate } = useManualPostingApply();
  const { filteredEmployees, employees: allEmployees } = useData();
  const { currentUser, canManageSystem } = useAuth();
  const isAdmin = canManageSystem;
  const { getRecoIds, getApprovalIds, refresh: refreshRecoApproval } = useRecoApproval();

  const [form,    setForm]    = useState(makeEmpty);
  const [errors,  setErrors]  = useState({});
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);
  const [shift,   setShift]   = useState(null);      // { shiftName, start, end, isOff } for the chosen staff + date

  // Non-admin: always about themselves, pre-filled and locked the moment the
  // popup opens — a raw API call ignoring this is separately rejected server-side.
  // This modal is rendered globally and stays mounted for the whole session
  // (see Layout.jsx), so useRecoApproval's own mount-time fetch would go
  // stale forever the moment someone edits the config after login — refetch
  // every time the popup actually opens instead.
  useEffect(() => {
    if (!isOpen) return;
    const base = { ...makeEmpty(), employeeId: isAdmin ? '' : String(currentUser?.id || '') };
    setForm(prefillDate ? { ...base, date: prefillDate } : base);
    setErrors({});
    setSuccess(false);
    setShift(null);
    refreshRecoApproval();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // The shift's check-in / check-out time for that staff member on that date.
  useEffect(() => {
    if (!isOpen || !form.date || !form.employeeId) { setShift(null); return undefined; }
    let alive = true;
    api.get(`/attendance/shift-for?date=${encodeURIComponent(form.date)}&employeeId=${encodeURIComponent(form.employeeId)}`)
      .then(s => { if (alive) setShift(s || null); })
      .catch(() => { if (alive) setShift(null); });
    return () => { alive = false; };
  }, [isOpen, form.date, form.employeeId]);

  const recoIds     = getRecoIds(form.employeeId);
  const approvalIds = getApprovalIds(form.employeeId);
  // Full employee list, not filteredEmployees — the configured recommender/
  // approver may be outside the current viewer's branch/dept scope, and
  // filteredEmployees silently dropping them is exactly what made this show
  // "— Not configured —" even when an assignment existed (same fix already
  // applied in LeaveApplyModal.jsx).
  const recoOptions     = allEmployees.filter(e => recoIds.includes(String(e.id)));
  const approvalOptions = allEmployees.filter(e => approvalIds.includes(String(e.id)));

  const handleClose = () => {
    close();
    setForm(makeEmpty());
    setErrors({});
    setSuccess(false);
    setSaving(false);
  };

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErrors(p => ({ ...p, [k]: '', _submit: '' })); };

  const lateMin  = toMin(form.lateBy)  || 0;
  const earlyMin = toMin(form.earlyBy) || 0;
  const expectedIn  = shift?.start && form.lateIn   && lateMin  ? toHHMM(toMin(shift.start) + lateMin)  : null;
  const expectedOut = shift?.end   && form.earlyOut && earlyMin ? toHHMM(toMin(shift.end)   - earlyMin) : null;

  const validate = () => {
    const e = {};
    if (!form.employeeId) e.employeeId = 'Staff is required';
    if (!form.date)       e.date       = 'Date is required';
    if (!form.lateIn && !form.earlyOut) e.option = 'Tick Late In and/or Early Out';
    if (form.lateIn   && !lateMin)  e.lateBy  = 'Enter the late time (HH:MM)';
    if (form.earlyOut && !earlyMin) e.earlyBy = 'Enter the early-out time (HH:MM)';
    if (!form.remark.trim()) e.remark = 'Reason is required';
    if (form.employeeId && form.date && shift && (!shift.start || !shift.end)) e._submit = 'No shift is assigned for this date.';
    if (shift?.isOff) e._submit = 'That date is a day off — there is no shift to be late for.';
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
        lateIn        : form.lateIn,
        lateBy        : form.lateIn   ? form.lateBy  : null,
        earlyOut      : form.earlyOut,
        earlyBy       : form.earlyOut ? form.earlyBy : null,
        remark        : form.remark.trim(),
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

  const personOption = e => ({
    value: String(e.id), label: e.fullName,
    sub: [e.employeeId, e.position].filter(Boolean).join(' - '), photo: e.profilePhoto,
  });

  // One block per kind (Late In / Early Out) — same layout, so both read the same.
  const kindBlock = ({ on, label, timeLabel, time, byLabel, by, onBy, byErr, expected, expectedLabel }) => on && (
    <div style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:'12px 14px', background:'#fafafa', display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ fontSize:12, fontWeight:700, color:'#1a56db' }}>{label}</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        {field(timeLabel, false, null,
          <div style={readOnlyBox} title={shift?.shiftName || ''}>
            {time ? <><strong>{time}</strong>{shift?.shiftName && <span style={{ color:'#9ca3af', marginLeft:8, fontSize:11, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{shift.shiftName}</span>}</>
                  : <span style={{ color:'#9ca3af' }}>{form.employeeId && form.date ? 'No shift found' : '—'}</span>}
          </div>
        )}
        {field(byLabel, true, byErr, <DurationInput value={by} onChange={onBy} invalid={!!byErr} />)}
      </div>
      {expected && <div style={{ fontSize:11, color:'#6b7280' }}>{expectedLabel} <strong style={{ color:'#111827' }}>{expected}</strong></div>}
    </div>
  );

  return (
    <div className="modal-overlay">
      <div className="modal glm-form glm-plain" style={{ maxWidth:560 }} onClick={e => e.stopPropagation()}>
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
                  ? 'Recorded as approved.'
                  : ((form.recommendedBy || form.approvedBy || recoOptions.length || approvalOptions.length)
                      ? 'Your recommender/approver has been notified (bell icon and Message inbox). This will only appear in your attendance once approved.'
                      : 'No recommender/approver is configured for you — admins were notified instead.')}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:14 }}>
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
                      options={filteredEmployees.map(personOption)}
                      placeholder="— Select Staff —"
                      showAvatar
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
                <DateInput value={form.date} onChange={v => set('date', v)} />
              )}

              {/* Inform & take approval on … */}
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:6 }}>
                  Inform &amp; take approval on <span style={{ color:'#dc2626' }}>*</span>
                </div>
                <div style={{ display:'flex', gap:22, flexWrap:'wrap' }}>
                  {[['lateIn', 'Late In'], ['earlyOut', 'Early Out']].map(([k, lbl]) => (
                    <label key={k} style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, fontWeight:600, color:'#111827', cursor:'pointer' }}>
                      <input type="checkbox" checked={form[k]} onChange={e => set(k, e.target.checked)} style={{ width:16, height:16, cursor:'pointer' }} />
                      {lbl}
                    </label>
                  ))}
                </div>
                {errors.option && <span style={{ fontSize:11, color:'#dc2626' }}>{errors.option}</span>}
              </div>

              {kindBlock({ on: form.lateIn, label: 'Late In', timeLabel: 'Check In Time', time: shift?.start,
                byLabel: 'Inform Late by (HH:MM)', by: form.lateBy, onBy: v => set('lateBy', v), byErr: errors.lateBy,
                expected: expectedIn, expectedLabel: 'You will check in at about' })}
              {kindBlock({ on: form.earlyOut, label: 'Early Out', timeLabel: 'Check Out Time', time: shift?.end,
                byLabel: 'Inform Early by (HH:MM)', by: form.earlyBy, onBy: v => set('earlyBy', v), byErr: errors.earlyBy,
                expected: expectedOut, expectedLabel: 'You will check out at about' })}

              {field('Reason', true, errors.remark,
                <textarea
                  value={form.remark}
                  onChange={e => set('remark', e.target.value)}
                  rows={3}
                  placeholder="Why will you be late / leave early?"
                  style={{ border:`1px solid ${errors.remark ? '#dc2626' : '#d1d5db'}`, borderRadius:7, padding:'8px 10px', fontSize:13, resize:'vertical', outline:'none', fontFamily:'inherit' }}
                />
              )}

              {/* Recommendator + date, Approval + date — the dates fill in when that person acts */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 150px', gap:12, alignItems:'end' }}>
                {field('Recommendator', false, null,
                  <SearchableSelect
                    value={form.recommendedBy}
                    onChange={v => set('recommendedBy', v)}
                    options={recoOptions.map(personOption)}
                    placeholder={!form.employeeId ? '— Select staff first —' : recoOptions.length === 0 ? 'No recommendator configured' : '— Select —'}
                    disabled={!form.employeeId || recoOptions.length === 0}
                    showAvatar
                  />
                )}
                {field('Recommendator Date', false, null, <div style={readOnlyBox}><span style={{ color:'#9ca3af' }}>On recommendation</span></div>)}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 150px', gap:12, alignItems:'end' }}>
                {field('Approval', false, null,
                  <SearchableSelect
                    value={form.approvedBy}
                    onChange={v => set('approvedBy', v)}
                    options={approvalOptions.map(personOption)}
                    placeholder={!form.employeeId ? '— Select staff first —' : approvalOptions.length === 0 ? 'No approver configured' : '— Select —'}
                    showAvatar
                    disabled={!form.employeeId || approvalOptions.length === 0}
                  />
                )}
                {field('Approval Date', false, null, <div style={readOnlyBox}><span style={{ color:'#9ca3af' }}>On approval</span></div>)}
              </div>
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
