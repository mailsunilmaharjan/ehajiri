import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useLeaveApply } from '../../context/LeaveApplyContext.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import { getNepalTodayISO } from '../../utils/dateUtils.js';

/* ── load saved reco/approval ── */
const loadRecoApproval = () => {
  try { return JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}'); } catch { return {}; }
};

/* ── Date input that respects calendar setting ── */
const LeaveDateInput = ({ value, onChange, error, settings }) => {
  const blockPast = settings.leaveBackdateEnabled === false;
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} error={error} maxToday={false} minToday={blockPast} />;
  }
  return (
    <input type="date" className={`form-control ${error ? 'error' : ''}`}
      value={value} min={blockPast ? getNepalTodayISO() : undefined}
      onChange={e => onChange(e.target.value)}
      style={{ fontSize: 13 }} />
  );
};

/* ── Small helpers ── */
const Lbl = ({ children, required }) => (
  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
    {children}{required && <span style={{ color: '#dc2626', marginLeft: 2 }}>*</span>}
  </div>
);
const Err = ({ msg }) => msg
  ? <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{msg}</div>
  : null;

/* ════════════════════════════════════════════════
   LeaveApplyModal — globally rendered modal
════════════════════════════════════════════════ */
const LeaveApplyModal = () => {
  const { isOpen, close, targetEmployeeId, prefillDates } = useLeaveApply();
  const { currentUser }   = useAuth();
  const navigate          = useNavigate();
  const { t }             = useLanguage();
  const { settings, refreshSettings } = useSettings();

  // This modal stays mounted for the whole session (see Layout.jsx), so a
  // long-open tab would otherwise keep enforcing whatever
  // leaveBackdateEnabled was when it first logged in — refetch right as it
  // opens so a Super Admin flipping the toggle takes effect immediately for
  // everyone, not just after their next full page reload.
  useEffect(() => { if (isOpen) refreshSettings(); }, [isOpen]);
  const {
    filteredLeaves: leaves, addLeave,
    leaveTypes, getLeaveBalance, refreshLeaveBalances,
    employees: allEmployees,
  } = useData();

  // Same reasoning as the settings refetch above — leaveBalances is normally
  // fetched once at login, so a credit granted elsewhere (e.g. an OT-to-leave
  // grant on the Overtime Approval page) wouldn't show up in "days remaining"
  // here without this.
  useEffect(() => { if (isOpen) refreshLeaveBalances(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // When opened from daily attendance context menu, use target employee; else current user
  const activeUser = useMemo(() => {
    if (!targetEmployeeId) return currentUser;
    return allEmployees.find(e => String(e.id) === String(targetEmployeeId)) || currentUser;
  }, [targetEmployeeId, allEmployees, currentUser]);

  const today = getNepalTodayISO();
  const emptyForm = {
    leaveTypeCode: '', fromDate: today, toDate: today,
    halfDay: false, reason: '', reco: [], approval: [], document: null,
  };

  const [form,            setForm]           = useState(emptyForm);
  const [errors,          setErrors]         = useState({});
  const [success,         setSuccess]        = useState(false);
  const [submitting,      setSubmitting]     = useState(false);
  const [selectedReco,    setSelectedReco]   = useState('');
  const [selectedApproval,setSelectedApproval] = useState('');
  const [submittedInfo,   setSubmittedInfo]  = useState(null); // { recoName, approvalName }

  /* ── Leave type configs ── */
  const ltConfigs = useMemo(() => settings.leaveTypeConfigs || [], [settings.leaveTypeConfigs]);
  const selectedLtConfig = useMemo(() =>
    ltConfigs.find(lt => lt.shortName === form.leaveTypeCode),
  [ltConfigs, form.leaveTypeCode]);

  /* ── Weekend & holiday sets ── */
  const weekendDays = useMemo(() => {
    const ws  = settings.defaultWeekends || ['Sat'];
    const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    return ws.map(d => map[d]).filter(n => n !== undefined);
  }, [settings.defaultWeekends]);

  const holidaySet = useMemo(() => {
    const s = new Set();
    (settings.publicHolidays || []).forEach(h => { if (h.date) s.add(h.date.split('T')[0]); });
    return s;
  }, [settings.publicHolidays]);

  /* ── Balance from Leave Calculation (ls_leaveOpening) for current fiscal year ──
     prevYear + currYear - usedDays for each leave type config.
     Falls back to the old leaveBalances system if opening data is unavailable.        */
  const balance = useMemo(() => {
    try {
      const opening  = JSON.parse(localStorage.getItem('ls_leaveOpening') || '{}');
      const defaultFY = (settings.fiscalYears || []).find(f => f.isDefault) || (settings.fiscalYears || [])[0];
      if (!defaultFY || !currentUser?.id) return getLeaveBalance(currentUser?.id);

      const fyId         = String(defaultFY.id);
      const prevKey      = 'prev_' + fyId;
      const empId        = String(activeUser.id);

      const result = {};
      ltConfigs.forEach(lt => {
        const prevYear = Number(opening[prevKey]?.[empId]?.[lt.shortName] ?? 0);
        const currYear = Number(opening[fyId]?.[empId]?.[lt.shortName]    ?? 0);
        const used     = (leaves || [])
          .filter(l => String(l.employeeId) === empId
                    && l.leaveTypeCode === lt.shortName
                    && l.status === 'approved')
          .reduce((s, l) => s + Number(l.days || 0), 0);
        // Server-side credits (e.g. OT-to-leave grants from the Overtime
        // Approval page) live in leave_balances, not the opening/used math
        // above — add them in so a granted day actually shows up here.
        const credited = Number(getLeaveBalance(empId)?.[lt.shortName] || 0);
        result[lt.shortName] = Math.max(0, prevYear + currYear + credited - used);
      });
      return result;
    } catch {
      return getLeaveBalance(activeUser?.id);
    }
  }, [settings.fiscalYears, activeUser?.id, ltConfigs, leaves, getLeaveBalance]);

  /* ── Reco/Approval from localStorage ── */
  const getMyRecoApproval = useCallback(() => {
    const saved = loadRecoApproval();
    const r = saved[activeUser?.id]?.reco;
    const a = saved[activeUser?.id]?.approval;
    return {
      reco:     Array.isArray(r) ? r : (r ? [r] : []),
      approval: Array.isArray(a) ? a : (a ? [a] : []),
    };
  }, [activeUser?.id]);

  /* use full employees list so reco/approval from any branch/dept resolves correctly */
  const getEmpName = useCallback((id) =>
    (allEmployees || []).find(e => String(e.id) === String(id))?.fullName || `#${id}`,
  [allEmployees]);

  /* ── Day calculator ── */
  const calcDays = useCallback(() => {
    if (form.halfDay) return 0.5;
    if (!form.fromDate || !form.toDate) return 0;
    const from = new Date(form.fromDate + 'T00:00:00');
    const to   = new Date(form.toDate   + 'T00:00:00');
    if (to < from) return 0;
    let count = 0;
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (selectedLtConfig?.reduceWeekend && weekendDays.includes(d.getDay())) continue;
      const ds = d.toISOString().split('T')[0];
      if (selectedLtConfig?.reducePublicHoliday && holidaySet.has(ds)) continue;
      count++;
    }
    return count;
  }, [form.fromDate, form.toDate, form.halfDay, selectedLtConfig, weekendDays, holidaySet]);

  /* ── Service period check ── */
  const timesAlreadyTaken = useMemo(() => {
    if (!form.leaveTypeCode || !selectedLtConfig?.isServicePeriod) return 0;
    return (leaves || []).filter(l =>
      String(l.employeeId) === String(activeUser?.id) &&
      l.leaveTypeCode === form.leaveTypeCode &&
      l.status === 'approved'
    ).length;
  }, [leaves, activeUser?.id, form.leaveTypeCode, selectedLtConfig]);

  /* ── Validate ── */
  const validate = () => {
    const e = {};
    const days = calcDays();
    if (!form.leaveTypeCode) e.leaveTypeCode = t('Required field');
    if (!form.halfDay) {
      if (!form.fromDate) e.fromDate = t('Required field');
      if (!form.toDate)   e.toDate   = t('Required field');
      if (form.fromDate && form.toDate && form.toDate < form.fromDate)
        e.toDate = 'To Date must be after From Date';
    }
    if (!form.reason.trim())           e.reason = t('Required field');
    if (form.reason.trim().length < 5) e.reason = 'Minimum 5 characters required';
    if (form.reco.length > 1 && !selectedReco)     e.selectedReco     = 'Please select a Recommendator';
    if (form.approval.length > 1 && !selectedApproval) e.selectedApproval = 'Please select an Approval Authority';
    if (form.leaveTypeCode && days > 0) {
      if (selectedLtConfig?.provideOnlyOnBalance) {
        const avail = balance[form.leaveTypeCode] || 0;
        if (days > avail) e.days = `Insufficient balance (available: ${avail} days)`;
      }
      if (selectedLtConfig?.isServicePeriod && selectedLtConfig?.timesPerService) {
        if (timesAlreadyTaken >= selectedLtConfig.timesPerService)
          e.days = `This leave can only be taken ${selectedLtConfig.timesPerService} time(s). Already used: ${timesAlreadyTaken}`;
      }
    }
    return e;
  };

  /* ── Field change ── */
  const handleChange = (field, val) => {
    setForm(p => {
      const next = { ...p, [field]: val };
      if (field === 'halfDay' && val) { next.fromDate = today; next.toDate = today; }
      if (field === 'fromDate' && p.halfDay) { next.toDate = val; }
      return next;
    });
    setErrors(p => ({ ...p, [field]: '', days: '' }));
  };

  /* ── Submit ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 500));
    const finalReco     = selectedReco     ? [selectedReco]     : form.reco;
    const finalApproval = selectedApproval ? [selectedApproval] : form.approval;

    await addLeave({
      employeeId:    activeUser.id,
      leaveTypeCode: form.leaveTypeCode,
      fromDate:      form.fromDate,
      toDate:        form.toDate,
      halfDay:       form.halfDay,
      days:          calcDays(),
      reason:        form.reason,
      reco:          finalReco,
      approval:      finalApproval,
    });

    /* capture reco/approval names for success message */
    setSubmittedInfo({
      recoNames:     finalReco.map(id     => getEmpName(id)),
      approvalNames: finalApproval.map(id => getEmpName(id)),
      leaveName:     ltConfigs.find(lt => lt.shortName === form.leaveTypeCode)?.name || form.leaveTypeCode,
      days:          calcDays(),
    });

    setSubmitting(false);
    setSuccess(true);
    /* no auto-close — user reads the message and clicks "View Applications" or × */
  };

  const handleClose = () => {
    close();
    setForm(emptyForm);
    setErrors({});
    setSuccess(false);
    setSubmitting(false);
    setSubmittedInfo(null);
    setSelectedReco('');
    setSelectedApproval('');
  };

  /* ── Open: load fresh reco/approval ── */
  const initForm = () => {
    const { reco, approval } = getMyRecoApproval();
    const fromDate = prefillDates?.fromDate || today;
    const toDate   = prefillDates?.toDate   || fromDate;
    setForm({ ...emptyForm, fromDate, toDate, reco, approval });
    setSelectedReco(reco.length === 1 ? String(reco[0]) : '');
    setSelectedApproval(approval.length === 1 ? String(approval[0]) : '');
    setErrors({}); setSuccess(false);
  };

  /* Initialise form whenever modal opens */
  const [prevOpen, setPrevOpen] = useState(false);
  if (isOpen && !prevOpen) { setPrevOpen(true); initForm(); }
  if (!isOpen && prevOpen)  { setPrevOpen(false); }

  if (!isOpen || !activeUser) return null;

  const days      = calcDays();
  const avail     = balance[form.leaveTypeCode] || 0;
  const remaining = avail - days;
  const ltc       = selectedLtConfig;

  return (
    <div className="modal-overlay" style={{ zIndex: 10000 }}>
      <div className="modal modal-lg"
        style={{ maxWidth: 680, maxHeight: '92vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header"
          style={{ position: 'sticky', top: 0, zIndex: 10 }}>
          <h2>📝 {t('Apply for Leave')}</h2>
          <button className="modal-close" onClick={handleClose}>✕</button>
        </div>

        <div className="modal-body">
          {success && submittedInfo && (
            <div style={{ marginBottom: 14 }}>
              {/* Success header */}
              <div style={{ background:'#d1fae5', border:'1px solid #6ee7b7', borderRadius:10,
                padding:'14px 16px', marginBottom:12, display:'flex', alignItems:'flex-start', gap:12 }}>
                <span style={{ fontSize:28, flexShrink:0 }}>✅</span>
                <div>
                  <div style={{ fontSize:15, fontWeight:800, color:'#065f46', marginBottom:4 }}>
                    Leave Application Submitted Successfully!
                  </div>
                  <div style={{ fontSize:13, color:'#047857' }}>
                    <strong>{submittedInfo.leaveName}</strong> — {submittedInfo.days} day{submittedInfo.days !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>

              {/* Workflow steps */}
              <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, padding:'14px 16px', fontSize:13 }}>
                <div style={{ fontWeight:700, color:'#92400e', marginBottom:10, fontSize:14 }}>
                  📋 Approval Workflow
                </div>

                {/* Step 1: Recommendation */}
                <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:12 }}>
                  <div style={{ width:26, height:26, borderRadius:'50%', background:'#eff6ff', border:'2px solid #1a56db',
                    color:'#1a56db', display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:12, fontWeight:800, flexShrink:0 }}>1</div>
                  <div>
                    <div style={{ fontWeight:700, color:'#1e40af', fontSize:13 }}>
                      🔖 Recommendation Required
                    </div>
                    {submittedInfo.recoNames.length > 0 ? (
                      <>
                        <div style={{ color:'#374151', marginTop:3, fontSize:12 }}>
                          Please ask the following to log in and recommend:
                        </div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:5 }}>
                          {submittedInfo.recoNames.map((n, i) => (
                            <span key={i} style={{ background:'#dbeafe', color:'#1e40af',
                              borderRadius:10, padding:'3px 12px', fontSize:13, fontWeight:700 }}>
                              👤 {n}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={{ color:'#9ca3af', fontSize:12, marginTop:3 }}>No recommendator configured</div>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div style={{ borderLeft:'2px dashed #d1d5db', marginLeft:12, height:12, marginBottom:12 }} />

                {/* Step 2: Approval */}
                <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                  <div style={{ width:26, height:26, borderRadius:'50%', background:'#f0fdf4', border:'2px solid #059669',
                    color:'#059669', display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:12, fontWeight:800, flexShrink:0 }}>2</div>
                  <div>
                    <div style={{ fontWeight:700, color:'#065f46', fontSize:13 }}>
                      ✅ Approval Required
                    </div>
                    {submittedInfo.approvalNames.length > 0 ? (
                      <>
                        <div style={{ color:'#374151', marginTop:3, fontSize:12 }}>
                          After recommendation, the following will approve:
                        </div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:5 }}>
                          {submittedInfo.approvalNames.map((n, i) => (
                            <span key={i} style={{ background:'#d1fae5', color:'#065f46',
                              borderRadius:10, padding:'3px 12px', fontSize:13, fontWeight:700 }}>
                              👤 {n}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={{ color:'#9ca3af', fontSize:12, marginTop:3 }}>No approval authority configured</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display:'flex', gap:10, marginTop:14, justifyContent:'flex-end' }}>
                <button onClick={handleClose} className="btn btn-outline" style={{ fontSize:13 }}>
                  Close
                </button>
                <button onClick={() => { handleClose(); navigate('/leave'); }}
                  className="btn btn-primary" style={{ fontSize:13 }}>
                  📋 View Leave Applications
                </button>
              </div>
            </div>
          )}

          {/* Form — hidden after successful submission */}
          {!success && <><div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
            padding: '12px 16px', marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
              letterSpacing: '.5px', marginBottom: 10 }}>
              👤 Staff Information
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
              {[
                ['Name',       activeUser.fullName],
                ['Staff ID',   activeUser.employeeId],
                ['Post',       activeUser.position   || '—'],
                ['Department', activeUser.department || '—'],
                ['Branch',     activeUser.branch     || '—'],
              ].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>{l}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit}>

            {/* Leave type */}
            <div className="form-group">
              <Lbl required>Leave</Lbl>
              <select className={`form-control ${errors.leaveTypeCode ? 'error' : ''}`}
                value={form.leaveTypeCode}
                onChange={e => handleChange('leaveTypeCode', e.target.value)}
                style={{ fontSize: 13 }}>
                <option value="">— Select Leave Type —</option>
                {ltConfigs.map(lt => (
                  <option key={lt.shortName} value={lt.shortName}>
                    {lt.name} — {balance[lt.shortName] || 0} days remaining
                  </option>
                ))}
              </select>
              <Err msg={errors.leaveTypeCode} />
              {ltc && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                    background: ltc.carryForward ? '#d1fae5' : '#f3f4f6',
                    color: ltc.carryForward ? '#065f46' : '#6b7280' }}>
                    {ltc.carryForward ? '✓ Accumulated' : 'Non Accumulated'}
                  </span>
                  {ltc.reduceWeekend      && <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10, background:'#fef3c7', color:'#92400e' }}>Weekends deducted</span>}
                  {ltc.reducePublicHoliday && <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10, background:'#fef3c7', color:'#92400e' }}>Holidays deducted</span>}
                  {ltc.provideOnlyOnBalance && <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10, background:'#eff6ff', color:'#1a56db' }}>Balance required</span>}
                  {ltc.isServicePeriod && ltc.timesPerService && (
                    <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10,
                      background: timesAlreadyTaken >= ltc.timesPerService ? '#fff1f2' : '#f5f3ff',
                      color: timesAlreadyTaken >= ltc.timesPerService ? '#be123c' : '#6d28d9' }}>
                      Service: {timesAlreadyTaken}/{ltc.timesPerService} uses
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Half Day */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={form.halfDay}
                  onChange={e => handleChange('halfDay', e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: '#1a56db' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Half Day</span>
                {form.halfDay && <span style={{ fontSize: 11, color: '#6b7280' }}>(0.5 days will be deducted)</span>}
              </label>
            </div>

            {/* Dates */}
            {form.halfDay ? (
              <div className="form-group">
                <Lbl required>Date</Lbl>
                <LeaveDateInput value={form.fromDate} error={!!errors.fromDate}
                  settings={settings} onChange={v => handleChange('fromDate', v)} />
                <Err msg={errors.fromDate} />
              </div>
            ) : (
              <div className="form-row">
                <div className="form-group">
                  <Lbl required>From Date</Lbl>
                  <LeaveDateInput value={form.fromDate} error={!!errors.fromDate}
                    min={today} settings={settings} onChange={v => handleChange('fromDate', v)} />
                  <Err msg={errors.fromDate} />
                </div>
                <div className="form-group">
                  <Lbl required>To Date</Lbl>
                  <LeaveDateInput value={form.toDate} error={!!errors.toDate}
                    min={form.fromDate || today} settings={settings} onChange={v => handleChange('toDate', v)} />
                  <Err msg={errors.toDate} />
                </div>
              </div>
            )}

            {/* Days + Balance summary */}
            {(form.halfDay || (form.fromDate && form.toDate)) && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 120, background: '#eff6ff', border: '1px solid #bfdbfe',
                  borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#1e40af', fontWeight: 600 }}>📅 No. of Days</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#1a56db' }}>{days}</span>
                </div>
                {form.leaveTypeCode && (
                  <div style={{ flex: 1, minWidth: 120,
                    background: remaining >= 0 ? '#f0fdf4' : '#fff5f5',
                    border: `1px solid ${remaining >= 0 ? '#86efac' : '#fca5a5'}`,
                    borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Balance After</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: remaining >= 0 ? '#065f46' : '#dc2626' }}>
                      {remaining}
                    </span>
                  </div>
                )}
              </div>
            )}
            {errors.days && (
              <div className="alert alert-danger" style={{ marginBottom: 12, fontSize: 13 }}>
                ⚠️ {errors.days}
              </div>
            )}

            {/* Recommendator & Approval */}
            <div className="form-row" style={{ marginBottom: 14 }}>
              {/* ── Recommendator ── */}
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
                      className={`form-control ${errors.selectedReco ? 'error' : ''}`}
                      style={{ fontSize:13, minHeight:42 }}>
                      <option value="">— Select Recommendator —</option>
                      {form.reco.map(id => (
                        <option key={id} value={String(id)}>{getEmpName(id)}</option>
                      ))}
                    </select>
                    {errors.selectedReco && <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{errors.selectedReco}</div>}
                  </>
                )}
              </div>

              {/* ── Approval Authority ── */}
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
                      className={`form-control ${errors.selectedApproval ? 'error' : ''}`}
                      style={{ fontSize:13, minHeight:42 }}>
                      <option value="">— Select Approval Authority —</option>
                      {form.approval.map(id => (
                        <option key={id} value={String(id)}>{getEmpName(id)}</option>
                      ))}
                    </select>
                    {errors.selectedApproval && <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{errors.selectedApproval}</div>}
                  </>
                )}
              </div>
            </div>

            {/* Remarks */}
            <div className="form-group">
              <Lbl required>Remarks</Lbl>
              <textarea className={`form-control ${errors.reason ? 'error' : ''}`}
                rows={3} placeholder="Enter reason for leave..."
                value={form.reason}
                onChange={e => handleChange('reason', e.target.value)}
                style={{ fontSize: 13 }} />
              <Err msg={errors.reason} />
            </div>

            {/* Document */}
            <div className="form-group">
              <Lbl>Document / Attachment</Lbl>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                border: '1.5px dashed #d1d5db', borderRadius: 8, cursor: 'pointer',
                background: form.document ? '#f0fdf4' : '#fafafa', transition: 'border .15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#1a56db'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#d1d5db'}>
                <input type="file" accept="image/*,.pdf,.doc,.docx" style={{ display: 'none' }}
                  onChange={e => handleChange('document', e.target.files[0] || null)} />
                <span style={{ fontSize: 20 }}>{form.document ? '📎' : '📄'}</span>
                <div>
                  {form.document
                    ? <><div style={{ fontSize: 13, fontWeight: 600, color: '#065f46' }}>{form.document.name}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>{(form.document.size / 1024).toFixed(1)} KB</div></>
                    : <><div style={{ fontSize: 13, color: '#374151' }}>Click to upload document</div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>PDF, Word, Image — optional</div></>
                  }
                </div>
                {form.document && (
                  <button type="button" onClick={e => { e.preventDefault(); handleChange('document', null); }}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none',
                      cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>✕</button>
                )}
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
              <button type="button" className="btn btn-outline" onClick={handleClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting || success}>
                {submitting ? '⏳ Please wait...' : '📤 Submit Application'}
              </button>
            </div>
          </form>
          </>}
        </div>
      </div>
    </div>
  );
};

export default LeaveApplyModal;
