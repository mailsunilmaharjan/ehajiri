import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import EnglishDatePicker from '../Common/EnglishDatePicker.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import Avatar from '../Common/Avatar.jsx';
import { getNepalTodayISO } from '../../utils/dateUtils.js';
import useRecoApproval from '../../hooks/useRecoApproval.js';
import AlertPopup, { alertFromSaveError } from '../Common/AlertPopup.jsx';
import { makeDateFormatter } from '../../utils/dateUtils.js';

/* ── Searchable single-select dropdown ── */
const SearchSelect = ({ value, onChange, options, placeholder, error }) => {
  const [open, setOpen] = useState(false);
  const [srch, setSrch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = srch ? options.filter(o => o.toLowerCase().includes(srch.toLowerCase())) : options;
  itemRefs.current = [];

  const select = (v) => { onChange(v); setOpen(false); setSrch(''); setActiveIndex(-1); };
  const openWithHighlight = () => {
    const idx = filtered.indexOf(value);
    setActiveIndex(idx >= 0 ? idx : (filtered.length ? 0 : -1));
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
      setActiveIndex(i => (filtered.length ? (i + 1) % filtered.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (filtered.length ? (i - 1 + filtered.length) % filtered.length : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex] !== undefined) select(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };
  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);
  useEffect(() => { if (open) setActiveIndex(filtered.length ? 0 : -1); }, [srch]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div tabIndex={0} onClick={() => { open ? setOpen(false) : openWithHighlight(); }}
        onKeyDown={handleTriggerKeyDown}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 12px', border: `1.5px solid ${error ? '#f87171' : open ? '#1a56db' : '#d1d5db'}`,
          borderRadius: 7, background: 'white', cursor: 'pointer', fontSize: 13, minHeight: 42,
          color: value ? '#1f2937' : '#9ca3af', fontWeight: value ? 600 : 400,
          boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none', outline: 'none', userSelect: 'none',
        }}>
        <span>{value || placeholder}</span>
        <span style={{ fontSize: 9, color: '#9ca3af', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, zIndex: 9999,
          background: 'white', border: '1.5px solid #1a56db', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,.18)', maxHeight: 260, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
            <input autoFocus type="text" value={srch}
              onChange={e => setSrch(e.target.value)}
              onClick={e => e.stopPropagation()}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search..."
              style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 5,
                padding: '6px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map((opt, i) => (
              <div key={opt} ref={el => itemRefs.current[i] = el}
                onMouseDown={e => { e.preventDefault(); select(opt); }}
                onMouseEnter={() => setActiveIndex(i)}
                style={{
                  padding: '9px 12px', fontSize: 13, cursor: 'pointer',
                  borderBottom: '1px solid #f3f4f6',
                  background: value === opt ? '#eff6ff' : (i === activeIndex ? '#f8fafc' : 'white'),
                  color: value === opt ? '#1e40af' : '#374151',
                  fontWeight: value === opt ? 700 : 400,
                }}>
                {opt}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                No results found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Date input respecting company calendar setting ── */
const VisitDateInput = ({ value, onChange, error, settings, minDate }) => {
  const blockPast = settings.leaveBackdateEnabled === false;
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} error={error} maxToday={false} minToday={blockPast} minDate={minDate} />;
  }
  return <EnglishDatePicker value={value} onChange={onChange} error={error} maxToday={false} minToday={blockPast} minDate={minDate} />;
};

/* ── Label / Error helpers ── */
const Lbl = ({ children, required }) => (
  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
    {children}{required && <span style={{ color: '#dc2626', marginLeft: 2 }}>*</span>}
  </div>
);
const Err = ({ msg }) => msg
  ? <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{msg}</div>
  : null;

/* ─────────────────────────────────────────────────── */
const OfficeVisitApplication = () => {
  const { currentUser } = useAuth();
  const { t }           = useLanguage();
  const { settings, refreshSettings } = useSettings();
  const { addVisit, employees } = useData(); /* employees = full unfiltered list for reco/approval name lookup */
  const { getRecoIds, getApprovalIds, assignments: recoAssignments } = useRecoApproval();
  const navigate = useNavigate();

  // Refetch on mount so a Super Admin toggling Leave/Visit backdating takes
  // effect immediately for a session that navigated here from an already-open tab.
  useEffect(() => { refreshSettings(); }, []);

  const today = getNepalTodayISO();

  /* Office visit types from settings */
  const visitTypeOptions = useMemo(() =>
    (settings.officeVisitTypes || []).map(v => v.name || v).filter(Boolean),
  [settings.officeVisitTypes]);

  /* Reco/Approval — live from the API */
  const myReco     = getRecoIds(currentUser?.id);
  const myApproval = getApprovalIds(currentUser?.id);

  const getEmp = useCallback((id) =>
    (employees || []).find(e => String(e.id) === String(id)),
  [employees]);
  const getEmpName = useCallback((id) => getEmp(id)?.fullName || `#${id}`, [getEmp]);

  const [form, setForm] = useState({
    officialVisit: '',    // official visit name from settings
    visitType:     'National', // National | International
    country:       '',    // shown only when International
    address:       '',    // replaces location
    description:   '',    // replaces reason
    fromDate:      today,
    toDate:        today,
    reco:          myReco,
    approval:      myApproval,
    document:      null,
  });
  const [errors,     setErrors]     = useState({});
  const [success,    setSuccess]    = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedReco,     setSelectedReco]     = useState(myReco.length === 1 ? String(myReco[0]) : '');
  const [selectedApproval, setSelectedApproval] = useState(myApproval.length === 1 ? String(myApproval[0]) : '');

  // useRecoApproval() fetches asynchronously on its own mount — the `form`
  // initializer above only ever sees whatever it returned on the very first
  // render (still empty at that point), and never picks up the real data
  // once that fetch resolves. Without this, Recommendator/Approval Authority
  // showed "Not configured" on every load of this page regardless of what
  // was actually configured, since nothing re-synced form.reco/form.approval
  // after the fetch completed.
  useEffect(() => {
    const reco     = getRecoIds(currentUser?.id);
    const approval = getApprovalIds(currentUser?.id);
    setForm(p => ({ ...p, reco, approval }));
    setSelectedReco(prev => prev || (reco.length === 1 ? String(reco[0]) : ''));
    setSelectedApproval(prev => prev || (approval.length === 1 ? String(approval[0]) : ''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoAssignments]);

  const handleChange = (field, val) => {
    // picking From Date copies it into To Date
    setForm(p => ({ ...p, [field]: val, ...(field === 'fromDate' ? { toDate: val } : {}) }));
    setErrors(p => ({ ...p, [field]: '' }));
  };

  const validate = () => {
    const e = {};
    if (!form.officialVisit.trim()) e.officialVisit = t('Required field');
    if (!form.address.trim())       e.address       = t('Required field');
    if (!form.description.trim())   e.description   = t('Required field');
    if (!form.fromDate)             e.fromDate      = t('Required field');
    if (!form.toDate)               e.toDate        = t('Required field');
    if (form.fromDate && form.toDate && form.toDate < form.fromDate)
      e.toDate = 'To Date must be on or after From Date';
    if (form.visitType === 'International' && !form.country.trim())
      e.country = t('Required field');
    if (form.reco.length > 1 && !selectedReco)         e.selectedReco     = 'Please select a Recommendator';
    if (form.approval.length > 1 && !selectedApproval) e.selectedApproval = 'Please select an Approval Authority';
    // Approval Authority is compulsory — an application with nobody to approve
    // it just sits Pending forever (and shows a blank Approval column).
    if (form.approval.length === 0) e.selectedApproval = 'No Approval Authority is set for you — ask Admin to set it (Staff Detail → Set Recommendator & Approval).';
    return e;
  };

  // Server-refused save (e.g. "Already Posted leave on that day.") → popup.
  const [saveAlert, setSaveAlert] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSubmitting(true);
    try {
      await addVisit({
        employeeId:    currentUser.id,
        purpose:       form.officialVisit,  // keep 'purpose' key for compatibility
        officialVisit: form.officialVisit,
        visitType:     form.visitType,
        country:       form.visitType === 'International' ? form.country : '',
        address:       form.address,
        location:      form.address,         // keep 'location' key for compatibility
        description:   form.description,
        reason:        form.description,     // keep 'reason' key for compatibility
        fromDate:      form.fromDate,
        toDate:        form.toDate,
        reco:          selectedReco     ? [selectedReco]     : form.reco,
        approval:      selectedApproval ? [selectedApproval] : form.approval,
      }, { throwOnReject: true });
    } catch (err) {
      setSubmitting(false);
      setSaveAlert(alertFromSaveError(err, makeDateFormatter(settings)));
      return;
    }
    setSubmitting(false);
    setSuccess(true);
    setTimeout(() => navigate('/office-visit'), 1800);
  };

  return (
    <div className="page-container">
      <AlertPopup alert={saveAlert} onClose={() => setSaveAlert(null)} />
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <div className="breadcrumb-item">
              <a href="#" onClick={e => { e.preventDefault(); navigate('/office-visit'); }}>
                {t('Office Visit')}
              </a>
            </div>
            <div className="breadcrumb-item active">{t('Apply for Office Visit')}</div>
          </div>
          <h1 className="page-title">🏢 {t('Apply for Office Visit')}</h1>
        </div>
      </div>

      <div style={{ maxWidth: 720 }}>
        <div className="card">
          <div className="card-header">
            <h3>{t('Office Visit Application')}</h3>
          </div>
          <div className="card-body">
            {success && (
              <div className="alert alert-success">
                <span>✅</span> {t('Application submitted successfully')}
              </div>
            )}

            {/* ── Staff Information ── */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
              padding: '12px 16px', marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
                letterSpacing: '.5px', marginBottom: 10 }}>
                👤 Staff Information
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                {[
                  ['Name',       currentUser.fullName],
                  ['Staff ID',   currentUser.employeeId],
                  ['Post',       currentUser.position   || '—'],
                  ['Department', currentUser.department || '—'],
                  ['Branch',     currentUser.branch     || '—'],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleSubmit}>

              {/* ── Official Visit — searchable dropdown from settings ── */}
              <div className="form-group">
                <Lbl required>Official Visit</Lbl>
                {visitTypeOptions.length > 0 ? (
                  <SearchSelect
                    value={form.officialVisit}
                    onChange={v => handleChange('officialVisit', v)}
                    options={visitTypeOptions}
                    placeholder="— Select Official Visit Type —"
                    error={!!errors.officialVisit}
                  />
                ) : (
                  <input type="text"
                    className={`form-control ${errors.officialVisit ? 'error' : ''}`}
                    placeholder="Enter official visit name (no types configured in Settings)..."
                    value={form.officialVisit}
                    onChange={e => handleChange('officialVisit', e.target.value)}
                    style={{ fontSize: 13 }} />
                )}
                <Err msg={errors.officialVisit} />
              </div>

              {/* ── Visit Type: National / International ── */}
              <div className="form-group">
                <Lbl required>Visit Type</Lbl>
                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  {['National', 'International'].map(vt => (
                    <label key={vt} style={{ display: 'flex', alignItems: 'center', gap: 8,
                      cursor: 'pointer', userSelect: 'none', padding: '8px 18px',
                      border: `1.5px solid ${form.visitType === vt ? '#1a56db' : '#d1d5db'}`,
                      borderRadius: 8, background: form.visitType === vt ? '#eff6ff' : 'white',
                      fontSize: 13, fontWeight: form.visitType === vt ? 700 : 400,
                      color: form.visitType === vt ? '#1a56db' : '#374151', transition: 'all .12s' }}>
                      <input type="radio" name="visitType" value={vt}
                        checked={form.visitType === vt}
                        onChange={() => handleChange('visitType', vt)}
                        style={{ accentColor: '#1a56db', width: 14, height: 14 }} />
                      {vt === 'National' ? '🇳🇵 National' : '🌍 International'}
                    </label>
                  ))}
                </div>
              </div>

              {/* ── Country — only if International ── */}
              {form.visitType === 'International' && (
                <div className="form-group">
                  <Lbl required>Country</Lbl>
                  <input type="text"
                    className={`form-control ${errors.country ? 'error' : ''}`}
                    placeholder="Enter country name..."
                    value={form.country}
                    onChange={e => handleChange('country', e.target.value)}
                    style={{ fontSize: 13 }}
                    autoFocus />
                  <Err msg={errors.country} />
                </div>
              )}

              {/* ── Address ── */}
              <div className="form-group">
                <Lbl required>Address</Lbl>
                <input type="text"
                  className={`form-control ${errors.address ? 'error' : ''}`}
                  placeholder="Enter visit address / location..."
                  value={form.address}
                  onChange={e => handleChange('address', e.target.value)}
                  style={{ fontSize: 13 }} />
                <Err msg={errors.address} />
              </div>

              {/* ── Description ── */}
              <div className="form-group">
                <Lbl required>Description</Lbl>
                <textarea
                  className={`form-control ${errors.description ? 'error' : ''}`}
                  rows={3}
                  placeholder="Enter description / purpose of the visit..."
                  value={form.description}
                  onChange={e => handleChange('description', e.target.value)}
                  style={{ fontSize: 13 }} />
                <Err msg={errors.description} />
              </div>

              {/* ── From Date / To Date ── */}
              <div className="form-row">
                <div className="form-group">
                  <Lbl required>From Date</Lbl>
                  <VisitDateInput value={form.fromDate}
                    error={!!errors.fromDate} settings={settings}
                    onChange={v => handleChange('fromDate', v)} />
                  <Err msg={errors.fromDate} />
                </div>
                <div className="form-group">
                  <Lbl required>To Date</Lbl>
                  <VisitDateInput value={form.toDate} minDate={form.fromDate}
                    error={!!errors.toDate} settings={settings}
                    onChange={v => handleChange('toDate', v)} />
                  <Err msg={errors.toDate} />
                </div>
              </div>

              {/* ── Recommendator & Approval (side by side) ── */}
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group">
                  <Lbl required={form.reco.length > 1}>Recommendator</Lbl>
                  {form.reco.length === 0 && (
                    <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'9px 12px', minHeight:40 }}>
                      <span style={{ fontSize:13, color:'#9ca3af' }}>— Not configured —</span>
                    </div>
                  )}
                  {form.reco.length === 1 && (
                    <div style={{ background:'#f0f9ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'9px 12px', minHeight:40, display:'flex', alignItems:'center' }}>
                      <span style={{ background:'#eff6ff', color:'#1a56db', borderRadius:10, padding:'2px 12px 2px 6px', fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>
                        <Avatar photo={getEmp(form.reco[0])?.profilePhoto} name={getEmpName(form.reco[0])} size={20} />
                        {getEmpName(form.reco[0])}
                      </span>
                    </div>
                  )}
                  {form.reco.length > 1 && (
                    <>
                      <SearchableSelect value={selectedReco} onChange={setSelectedReco}
                        className={`form-control ${errors.selectedReco ? 'error' : ''}`}
                        options={form.reco.map(id => ({ value: String(id), label: getEmpName(id), sub: [getEmp(id)?.employeeId, getEmp(id)?.position].filter(Boolean).join(' - '), photo: getEmp(id)?.profilePhoto }))}
                        placeholder="— Select Recommendator —"
                        showAvatar
                      />
                      <Err msg={errors.selectedReco} />
                    </>
                  )}
                </div>
                <div className="form-group">
                  <Lbl required>Approval Authority</Lbl>
                  {form.approval.length === 0 && (
                    <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'9px 12px', minHeight:40 }}>
                      <span style={{ fontSize:13, color:'#9ca3af' }}>— Not configured —</span>
                    </div>
                  )}
                  {form.approval.length === 0 && <Err msg={errors.selectedApproval} />}
                  {form.approval.length === 1 && (
                    <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'9px 12px', minHeight:40, display:'flex', alignItems:'center' }}>
                      <span style={{ background:'#d1fae5', color:'#065f46', borderRadius:10, padding:'2px 12px 2px 6px', fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:6 }}>
                        <Avatar photo={getEmp(form.approval[0])?.profilePhoto} name={getEmpName(form.approval[0])} size={20} />
                        {getEmpName(form.approval[0])}
                      </span>
                    </div>
                  )}
                  {form.approval.length > 1 && (
                    <>
                      <SearchableSelect value={selectedApproval} onChange={setSelectedApproval}
                        className={`form-control ${errors.selectedApproval ? 'error' : ''}`}
                        options={form.approval.map(id => ({ value: String(id), label: getEmpName(id), sub: [getEmp(id)?.employeeId, getEmp(id)?.position].filter(Boolean).join(' - '), photo: getEmp(id)?.profilePhoto }))}
                        placeholder="— Select Approval Authority —"
                        showAvatar
                      />
                      <Err msg={errors.selectedApproval} />
                    </>
                  )}
                </div>
              </div>

              {/* ── Summary preview ── */}
              {form.officialVisit && form.address && (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe',
                  borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: '#1e40af', marginBottom: 8 }}>📋 Summary</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, color: '#374151' }}>
                    <div><span style={{ color: '#6b7280' }}>Official Visit:</span> <strong>{form.officialVisit}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>Visit Type:</span>
                      <strong style={{ color: form.visitType === 'International' ? '#7c3aed' : '#059669' }}>
                        {' '}{form.visitType === 'International' ? '🌍' : '🇳🇵'} {form.visitType}
                      </strong>
                    </div>
                    {form.country && <div><span style={{ color: '#6b7280' }}>Country:</span> <strong>{form.country}</strong></div>}
                    <div><span style={{ color: '#6b7280' }}>Address:</span> <strong>{form.address}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>From:</span> <strong>{form.fromDate}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>To:</span> <strong>{form.toDate}</strong></div>
                  </div>
                </div>
              )}

              {/* ── Document Upload ── */}
              <div className="form-group">
                <Lbl>Document / Attachment</Lbl>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  border: '1.5px dashed #d1d5db', borderRadius: 8, cursor: 'pointer',
                  background: form.document ? '#f0fdf4' : '#fafafa', transition: 'border .15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#0d9488'}
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
                    <button type="button"
                      onClick={e => { e.preventDefault(); handleChange('document', null); }}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>
                      ✕
                    </button>
                  )}
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button type="button" className="btn btn-outline"
                  onClick={() => navigate('/office-visit')}>
                  {t('Cancel')}
                </button>
                <button type="submit" className="btn btn-primary"
                  disabled={submitting || success}>
                  {submitting ? `⏳ ${t('Please wait...')}` : `📤 ${t('Submit')}`}
                </button>
              </div>

            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OfficeVisitApplication;
