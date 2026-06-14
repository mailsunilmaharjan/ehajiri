import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useOfficeVisitApply } from '../../context/OfficeVisitApplyContext.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';

/* ── Searchable single-select dropdown ── */
const SearchSelect = ({ value, onChange, options, placeholder, error }) => {
  const [open, setOpen] = useState(false);
  const [srch, setSrch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = srch ? options.filter(o => o.toLowerCase().includes(srch.toLowerCase())) : options;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div tabIndex={0} onClick={() => setOpen(p => !p)}
        onKeyDown={e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setOpen(p=>!p); } if (e.key==='Escape') setOpen(false); }}
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
          boxShadow: '0 8px 24px rgba(0,0,0,.18)', maxHeight: 220, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
            <input autoFocus type="text" value={srch}
              onChange={e => setSrch(e.target.value)}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
              placeholder="Search..."
              style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 5,
                padding: '6px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(opt => (
              <div key={opt}
                onMouseDown={e => { e.preventDefault(); onChange(opt); setOpen(false); setSrch(''); }}
                style={{
                  padding: '9px 12px', fontSize: 13, cursor: 'pointer',
                  borderBottom: '1px solid #f3f4f6',
                  background: value === opt ? '#eff6ff' : 'white',
                  color: value === opt ? '#1e40af' : '#374151',
                  fontWeight: value === opt ? 700 : 400,
                }}
                onMouseEnter={e => { if (value !== opt) e.currentTarget.style.background = '#f8fafc'; }}
                onMouseLeave={e => { if (value !== opt) e.currentTarget.style.background = value===opt?'#eff6ff':'white'; }}>
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

const loadRecoApproval = () => {
  try { return JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}'); } catch { return {}; }
};

const VisitDateInput = ({ value, onChange, min, error, settings }) => {
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} error={error} maxToday={false} />;
  }
  return (
    <input type="date"
      className={`form-control ${error ? 'error' : ''}`}
      value={value} min={min}
      onChange={e => onChange(e.target.value)}
      style={{ fontSize: 13 }} />
  );
};

const Lbl = ({ children, required }) => (
  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
    {children}{required && <span style={{ color: '#dc2626', marginLeft: 2 }}>*</span>}
  </div>
);
const Err = ({ msg }) => msg
  ? <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{msg}</div>
  : null;

/* ════════════════════════════════════════════════
   OfficeVisitApplyModal — globally rendered modal
════════════════════════════════════════════════ */
const OfficeVisitApplyModal = () => {
  const { isOpen, close, targetEmployeeId } = useOfficeVisitApply();
  const { currentUser }   = useAuth();
  const { t }             = useLanguage();
  const { settings }      = useSettings();
  const { addVisit, employees } = useData();

  // When opened from daily attendance context menu, use target employee; else current user
  const activeUser = useMemo(() => {
    if (!targetEmployeeId) return currentUser;
    return (employees || []).find(e => String(e.id) === String(targetEmployeeId)) || currentUser;
  }, [targetEmployeeId, employees, currentUser]);

  const today = new Date().toISOString().split('T')[0];

  const visitTypeOptions = useMemo(() =>
    (settings.officeVisitTypes || []).map(v => v.name || v).filter(Boolean),
  [settings.officeVisitTypes]);

  const { reco: myReco, approval: myApproval } = useMemo(() => {
    const saved = loadRecoApproval();
    const r = saved[activeUser?.id]?.reco;
    const a = saved[activeUser?.id]?.approval;
    return {
      reco:     Array.isArray(r) ? r : (r ? [r] : []),
      approval: Array.isArray(a) ? a : (a ? [a] : []),
    };
  }, [activeUser?.id]);

  const getEmpName = useCallback((id) =>
    (employees || []).find(e => String(e.id) === String(id))?.fullName || `#${id}`,
  [employees]);

  const emptyForm = {
    officialVisit: '', visitType: 'National', country: '',
    address: '', description: '', fromDate: today, toDate: today,
    reco: myReco, approval: myApproval, document: null,
  };

  const [form,       setForm]       = useState(emptyForm);
  const [errors,     setErrors]     = useState({});
  const [success,    setSuccess]    = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /* Reset form each time modal opens */
  useEffect(() => {
    if (isOpen) {
      setForm({ ...emptyForm, reco: myReco, approval: myApproval });
      setErrors({});
      setSuccess(false);
      setSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen || !activeUser) return null;

  const handleChange = (field, val) => {
    setForm(p => ({ ...p, [field]: val }));
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
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSubmitting(true);
    await addVisit({
      employeeId:    activeUser.id,
      purpose:       form.officialVisit,
      officialVisit: form.officialVisit,
      visitType:     form.visitType,
      country:       form.visitType === 'International' ? form.country : '',
      address:       form.address,
      location:      form.address,
      description:   form.description,
      reason:        form.description,
      fromDate:      form.fromDate,
      toDate:        form.toDate,
      reco:          form.reco,
      approval:      form.approval,
    });
    setSubmitting(false);
    setSuccess(true);
    setTimeout(() => close(), 1800);
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 10000 }}>
      <div className="modal modal-lg" style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header" style={{ background: 'linear-gradient(135deg,#f0fdfa,#e0f2fe)', flexShrink: 0 }}>
          <h2>🏢 {t('Apply for Visit')}</h2>
          <button className="modal-close" onClick={close}>✕</button>
        </div>

        {/* Scrollable body */}
        <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>

          {success && (
            <div className="alert alert-success" style={{ marginBottom: 16 }}>
              <span>✅</span> {t('Application submitted successfully')}
            </div>
          )}

          {/* Staff Info */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
            padding: '12px 16px', marginBottom: 20 }}>
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

            {/* Official Visit */}
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

            {/* Visit Type */}
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

            {/* Country — International only */}
            {form.visitType === 'International' && (
              <div className="form-group">
                <Lbl required>Country</Lbl>
                <input type="text"
                  className={`form-control ${errors.country ? 'error' : ''}`}
                  placeholder="Enter country name..."
                  value={form.country}
                  onChange={e => handleChange('country', e.target.value)}
                  style={{ fontSize: 13 }} autoFocus />
                <Err msg={errors.country} />
              </div>
            )}

            {/* Address */}
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

            {/* Description */}
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

            {/* Dates */}
            <div className="form-row">
              <div className="form-group">
                <Lbl required>From Date</Lbl>
                <VisitDateInput value={form.fromDate} min={today}
                  error={!!errors.fromDate} settings={settings}
                  onChange={v => handleChange('fromDate', v)} />
                <Err msg={errors.fromDate} />
              </div>
              <div className="form-group">
                <Lbl required>To Date</Lbl>
                <VisitDateInput value={form.toDate} min={form.fromDate || today}
                  error={!!errors.toDate} settings={settings}
                  onChange={v => handleChange('toDate', v)} />
                <Err msg={errors.toDate} />
              </div>
            </div>

            {/* Reco / Approval */}
            <div className="form-row" style={{ marginBottom: 14 }}>
              <div className="form-group">
                <Lbl>Recommendator</Lbl>
                <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb',
                  borderRadius: 8, padding: '9px 12px', minHeight: 40 }}>
                  {form.reco.length > 0
                    ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {form.reco.map(id => (
                          <span key={id} style={{ background: '#eff6ff', color: '#1a56db',
                            borderRadius: 10, padding: '2px 11px', fontSize: 13, fontWeight: 600 }}>
                            {getEmpName(id)}
                          </span>
                        ))}
                      </div>
                    : <span style={{ fontSize: 13, color: '#9ca3af' }}>— Not configured —</span>
                  }
                </div>
              </div>
              <div className="form-group">
                <Lbl>Approval Authority</Lbl>
                <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb',
                  borderRadius: 8, padding: '9px 12px', minHeight: 40 }}>
                  {form.approval.length > 0
                    ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {form.approval.map(id => (
                          <span key={id} style={{ background: '#d1fae5', color: '#065f46',
                            borderRadius: 10, padding: '2px 11px', fontSize: 13, fontWeight: 600 }}>
                            {getEmpName(id)}
                          </span>
                        ))}
                      </div>
                    : <span style={{ fontSize: 13, color: '#9ca3af' }}>— Not configured —</span>
                  }
                </div>
              </div>
            </div>

            {/* Summary preview */}
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

            {/* Document Upload */}
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

            {/* Footer inside form so Enter submits */}
            <div style={{ display: 'none' }}>
              <button type="submit" />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ flexShrink: 0 }}>
          <button className="btn btn-outline" onClick={close}>{t('Cancel')}</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || success}>
            {submitting ? `⏳ ${t('Please wait...')}` : `📤 ${t('Submit')}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OfficeVisitApplyModal;
