import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/client.js';
import { useModalDrag } from '../../hooks/useModalDrag.js';

/* The actual "New Contact" form used on the Contact page (Staff > Contact),
   extracted so it can also be reused as a popup elsewhere — e.g. the
   "+ Add New" button next to Customer Name on the Task form (TaskList.jsx).
   Saves to the exact same /api/contacts backend (staff_contacts table) as
   the main Contact page, so a contact created from either place shows up
   in both immediately. */

export const CUSTOMER_TYPES = [
  'Dealers', 'Partners Dealer', 'Government', 'Banks',
  'Finance', 'Hotel & Restaurant', 'Factories', 'IT Industries', 'Other',
];

export const CONTACT_EMPTY = {
  contactType      : 'public',
  contactInfo      : 'company',
  personName       : '',
  office           : '',
  mobile1          : '',
  mobile2          : '',
  officePhone      : '',
  email            : '',
  address          : '',
  companyName      : '',
  companyPhone     : '',
  companyEmail     : '',
  companyAddress   : '',
  workScope        : '',
  customerCategory : '',
  customerType     : '',
};

const EMPTY_PERSON = { name: '', post: '', department: '', mobile1: '', mobile2: '', email: '', ext: '' };

let _tempId = 0;
const tempId = () => `_t${++_tempId}`;

// ── Shared form primitives ────────────────────────────────────────────────────

const RadioGroup = ({ label, name, value, onChange, options }) => (
  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap' }}>
    <span style={{ fontSize:11.5, fontWeight:600, color:'#374151', flexShrink:0 }}>{label}:</span>
    <div style={{ display:'flex', gap:6 }}>
      {options.map(opt => (
        <label key={opt.value} style={{
          display:'flex', alignItems:'center', gap:4, cursor:'pointer',
          padding:'3px 10px', borderRadius:6, fontSize:11.5, fontWeight:500,
          border:`1.5px solid ${value===opt.value ? '#1a56db' : '#d1d5db'}`,
          background: value===opt.value ? '#eff6ff' : '#fff',
          color:      value===opt.value ? '#1a56db'  : '#374151',
          transition:'all .15s',
        }}>
          <input type="radio" name={name} value={opt.value} checked={value===opt.value}
            onChange={() => onChange(opt.value)} style={{ display:'none' }} />
          {opt.icon} {opt.label}
        </label>
      ))}
    </div>
  </div>
);

// Move focus to the next focusable element inside the nearest .modal on Enter
const onEnterTab = (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const modal = e.target.closest('.modal') || e.target.closest('[role="dialog"]') || document;
  const focusables = [...modal.querySelectorAll(
    'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])'
  )];
  const idx = focusables.indexOf(e.target);
  if (idx >= 0 && idx < focusables.length - 1) focusables[idx + 1].focus();
};

const FInput = ({ value, onChange, placeholder, type='text', hasError=false }) => (
  <input type={type} value={value} onChange={e => onChange(e.target.value)}
    onKeyDown={onEnterTab}
    placeholder={placeholder} className="form-control"
    style={{ fontSize:13, width:'100%', borderColor: hasError ? '#f05252' : undefined,
      boxShadow: hasError ? '0 0 0 2px rgba(240,82,82,.15)' : undefined }} />
);

// Phone input — only allows digits, +, -, spaces, (, )
const FPhoneInput = ({ value, onChange, placeholder, hasError=false }) => {
  const handleChange = (e) => {
    const filtered = e.target.value.replace(/[^\d\s+\-(). ]/g, '');
    onChange(filtered);
  };
  return (
    <input type="tel" value={value} onChange={handleChange} onKeyDown={onEnterTab}
      placeholder={placeholder} className="form-control"
      style={{ fontSize:13, width:'100%', borderColor: hasError ? '#f05252' : undefined,
        boxShadow: hasError ? '0 0 0 2px rgba(240,82,82,.15)' : undefined }} />
  );
};

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
const isValidPhone = (v) => /^[\d\s+\-(). ]{6,}$/.test(v.trim());

const FTextarea = ({ value, onChange, placeholder, rows=2 }) => (
  <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    rows={rows} className="form-control" style={{ fontSize:13, width:'100%', resize:'vertical' }} />
);

const FF = ({ label, required, error, children }) => (
  <div style={{ marginBottom:12 }}>
    <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:5 }}>
      {label}{required && <span style={{ color:'#ef4444', marginLeft:2 }}>*</span>}
    </div>
    {children}
    {error && <div style={{ fontSize:11, color:'#f05252', marginTop:3 }}>⚠ {error}</div>}
  </div>
);

const Row2 = ({ children }) => (
  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>{children}</div>
);

const Row3 = ({ children }) => (
  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0 14px' }}>{children}</div>
);

// ── Mini table that matches DataGrid header style ─────────────────────────────

const TH = ({ children, w }) => (
  <th style={{
    padding:'4px 8px', background:'#efefef', color:'#374151', fontSize:12.5, fontWeight:700,
    borderBottom:'2px solid #dedede', borderRight:'1px solid #dedede', textAlign:'left',
    whiteSpace:'nowrap', minWidth:w, position:'sticky', top:0, zIndex:2,
  }}>{children}</th>
);

const PersonsGrid = ({ persons, onAdd, onEdit, onDelete }) => {
  const [sel,     setSel]     = useState(new Set());
  const [ctxMenu, setCtxMenu] = useState(null);   // {x,y,person}
  const ctxRef = useRef(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e) => { if (!ctxRef.current?.contains(e.target)) setCtxMenu(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  const toggle = (id) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (checked) => setSel(checked ? new Set(persons.map(p => p.id)) : new Set());
  const selPersons = persons.filter(p => sel.has(p.id));

  const TD = ({ children, style: s }) => (
    <td style={{ padding:'3px 8px', fontSize:12.5, borderBottom:'1px solid #f1f5f9',
      borderRight:'1px solid #f1f5f9', ...s }}>{children}</td>
  );

  return (
    <div style={{ position:'relative' }}>
      {/* sub-header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:13, fontWeight:700, color:'#374151' }}>
            👥 Contact Persons
          </span>
          {persons.length > 0 && (
            <span style={{ background:'#e0e7ff', color:'#3730a3', borderRadius:10,
              fontSize:11, fontWeight:700, padding:'1px 8px' }}>{persons.length}</span>
          )}
          {/* selection action bar */}
          {sel.size > 0 && (
            <div style={{ display:'flex', gap:6, marginLeft:6 }}>
              {sel.size === 1 && (
                <button onClick={() => { onEdit(selPersons[0]); setSel(new Set()); }}
                  style={{ padding:'3px 11px', borderRadius:6, border:'1px solid #d1d5db',
                    background:'#fff', color:'#374151', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  ✏️ Edit
                </button>
              )}
              <button onClick={() => {
                if (!window.confirm(`Delete ${sel.size} person(s)?`)) return;
                selPersons.forEach(p => onDelete(p));
                setSel(new Set());
              }}
                style={{ padding:'3px 11px', borderRadius:6, border:'1px solid #fecaca',
                  background:'#fff5f5', color:'#dc2626', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                🗑️ Delete ({sel.size})
              </button>
              <button onClick={() => setSel(new Set())}
                style={{ padding:'3px 9px', borderRadius:6, border:'1px solid #e5e7eb',
                  background:'#f9fafb', color:'#6b7280', fontSize:12, cursor:'pointer' }}>
                ✕
              </button>
            </div>
          )}
        </div>
        <button onClick={onAdd}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 13px',
            borderRadius:7, border:'none', background:'#1a56db', color:'#fff',
            fontSize:12, fontWeight:700, cursor:'pointer', boxShadow:'0 1px 4px rgba(26,86,219,.25)' }}>
          + Add New
        </button>
      </div>

      {persons.length === 0 ? (
        <div style={{ padding:'18px', textAlign:'center', color:'#9ca3af', fontSize:13,
          background:'#f9fafb', border:'1px dashed #d1d5db', borderRadius:8 }}>
          No persons added yet — click <strong>+ Add New</strong> to add
        </div>
      ) : (
        <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
            <thead>
              <tr>
                <TH w={32}>
                  <input type="checkbox"
                    checked={sel.size === persons.length && persons.length > 0}
                    onChange={e => toggleAll(e.target.checked)}
                    style={{ cursor:'pointer' }} />
                </TH>
                <TH w={32}>SN</TH>
                <TH w={140}>Name</TH>
                <TH w={110}>Post</TH>
                <TH w={110}>Dept</TH>
                <TH w={110}>Mobile 1</TH>
                <TH w={110}>Mobile 2</TH>
                <TH w={170}>Email</TH>
                <TH w={70}>Ext</TH>
              </tr>
            </thead>
            <tbody>
              {persons.map((p, idx) => {
                const isSelected = sel.has(p.id);
                const rowBg = isSelected ? '#eff6ff' : idx%2===0 ? '#fff' : '#f3f4f6';
                return (
                  <tr key={p.id}
                    style={{ background:rowBg, cursor:'pointer', userSelect:'none' }}
                    onDoubleClick={() => onEdit(p)}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({x:e.clientX, y:e.clientY, person:p}); }}>
                    <TD>
                      <input type="checkbox" checked={isSelected}
                        onChange={() => toggle(p.id)}
                        onClick={e => e.stopPropagation()}
                        style={{ cursor:'pointer' }} />
                    </TD>
                    {/* SN — same bg as DataGrid heading */}
                    <TD style={{ background:'#efefef', color:'#374151', fontWeight:600,
                      textAlign:'center' }}>{idx+1}</TD>
                    <TD style={{ fontWeight:600, color:'#111827' }}>{p.name}</TD>
                    <TD style={{ color:'#4b5563' }}>{p.post||'—'}</TD>
                    <TD style={{ color:'#4b5563' }}>{p.department||'—'}</TD>
                    <TD>{p.mobile1||'—'}</TD>
                    <TD>{p.mobile2||'—'}</TD>
                    <TD style={{ color:'#4b5563' }}>{p.email||'—'}</TD>
                    <TD>{p.ext||'—'}</TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <div ref={ctxRef} style={{
          position:'fixed', top:ctxMenu.y, left:ctxMenu.x, zIndex:9999,
          background:'#fff', border:'1px solid #e5e7eb', borderRadius:10,
          boxShadow:'0 4px 20px rgba(0,0,0,.15)', minWidth:160, overflow:'hidden',
        }}>
          {[
            { icon:'➕', label:'Add New',  action:() => { onAdd();                       setCtxMenu(null); } },
            { icon:'✏️', label:'Edit',     action:() => { onEdit(ctxMenu.person);         setCtxMenu(null); } },
            { icon:'🗑️', label:'Delete',  action:() => { onDelete(ctxMenu.person);        setCtxMenu(null); }, danger:true },
          ].map(item => (
            <div key={item.label} onClick={item.action}
              style={{
                display:'flex', alignItems:'center', gap:10, padding:'8px 16px',
                fontSize:13, cursor:'pointer', color: item.danger ? '#dc2626' : '#374151',
                borderLeft:'3px solid transparent',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = item.danger ? '#fff5f5' : '#f0f7ff';
                e.currentTarget.style.borderLeftColor = item.danger ? '#dc2626' : '#1a56db';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderLeftColor = 'transparent';
              }}>
              {item.icon} {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Person sub-form modal ─────────────────────────────────────────────────────

const PersonModal = ({ initial, onClose, onSaved }) => {
  const [form, setForm] = useState({ ...EMPTY_PERSON, ...initial });
  const [fe,   setFe]   = useState({});  // field errors
  const { overlayProps, modalProps } = useModalDrag(onClose);
  const set    = key => val => { setForm(p => ({ ...p, [key]: val })); setFe(p => ({ ...p, [key]: '' })); };
  const isEdit = !!(initial?.id && !String(initial.id).startsWith('_t'));

  const save = () => {
    const errs = {};
    if (!form.name.trim())                              errs.name    = 'Name is required';
    if (form.mobile1 && !isValidPhone(form.mobile1))    errs.mobile1 = 'Enter a valid phone number';
    if (form.mobile2 && !isValidPhone(form.mobile2))    errs.mobile2 = 'Enter a valid phone number';
    if (form.email   && !isValidEmail(form.email))      errs.email   = 'Enter a valid email address';
    if (Object.keys(errs).length) { setFe(errs); return; }
    setFe({});
    onSaved({ ...form }, isEdit);
  };

  return (
    <div className="modal-overlay" style={{ zIndex:1100 }} {...overlayProps}>
      <div className="modal" style={{ maxWidth:720, width:'95vw' }} {...modalProps}>
        <div className="modal-header">
          <h2>{isEdit ? '✏️ Edit Person' : '👤 Add Contact Person'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <Row3>
            <FF label="Name" required error={fe.name}>
              <FInput value={form.name} onChange={set('name')} placeholder="Full name" hasError={!!fe.name} />
            </FF>
            <FF label="Post / Position">
              <FInput value={form.post} onChange={set('post')} placeholder="Job title / designation" />
            </FF>
            <FF label="Department">
              <FInput value={form.department} onChange={set('department')} placeholder="Department" />
            </FF>
          </Row3>
          <Row3>
            <FF label="Mobile 1" error={fe.mobile1}>
              <FPhoneInput value={form.mobile1} onChange={set('mobile1')} placeholder="+977 98XXXXXXXX" hasError={!!fe.mobile1} />
            </FF>
            <FF label="Mobile 2" error={fe.mobile2}>
              <FPhoneInput value={form.mobile2} onChange={set('mobile2')} placeholder="Secondary" hasError={!!fe.mobile2} />
            </FF>
            <FF label="Ext">
              <FInput value={form.ext} onChange={set('ext')} placeholder="Extension" />
            </FF>
          </Row3>
          <FF label="Email" error={fe.email}>
            <FInput value={form.email} onChange={set('email')} placeholder="email@example.com"
              type="email" hasError={!!fe.email} />
          </FF>
        </div>
        <div className="modal-footer" style={{ justifyContent:'flex-end', gap:10 }}>
          <button onClick={onClose}
            style={{ padding:'8px 20px', borderRadius:8, border:'1px solid #d1d5db',
              background:'#fff', color:'#374151', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            Cancel
          </button>
          <button onClick={save}
            style={{ padding:'8px 24px', borderRadius:8, border:'none',
              background:'#1a56db', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            {isEdit ? 'Update' : 'Add Person'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Contact main form modal ───────────────────────────────────────────────────

const ContactFormModal = ({ initial, onClose, onSaved }) => {
  const [form,    setForm]    = useState({ ...CONTACT_EMPTY, ...initial });
  const [persons, setPersons] = useState([]);
  const [pModal,  setPModal]  = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');
  const [fe,      setFe]      = useState({});  // field errors
  const { overlayProps, modalProps } = useModalDrag(onClose);

  const set        = key => val => { setForm(p => ({ ...p, [key]: val })); setFe(p => ({ ...p, [key]:'' })); };
  const isPersonal = form.contactInfo === 'personal';
  const isPrivate  = form.contactType === 'private';
  const isEdit     = !!initial?.id;

  // Load persons when editing an existing contact
  useEffect(() => {
    if (!initial?.id) return;
    api.get(`/contacts/${initial.id}/persons`)
      .then(data => setPersons(data))
      .catch(() => {});
  }, [initial?.id]);

  // ── Person handlers ────────────────────────────────────────────────────────

  const handlePersonSaved = async (person, isPersonEdit) => {
    if (!isEdit) {
      // New contact — buffer locally
      if (isPersonEdit) {
        setPersons(p => p.map(x => x.id === person.id ? person : x));
      } else {
        setPersons(p => [...p, { ...person, id: tempId() }]);
      }
      setPModal(null);
      return;
    }
    // Existing contact — live API
    try {
      const result = isPersonEdit
        ? await api.put(`/contacts/${initial.id}/persons/${person.id}`, person)
        : await api.post(`/contacts/${initial.id}/persons`, person);
      if (isPersonEdit) {
        setPersons(p => p.map(x => x.id === result.id ? result : x));
      } else {
        setPersons(p => [...p, result]);
      }
      setPModal(null);
    } catch (e) {
      setErr(e.message || 'Failed to save person');
    }
  };

  const handlePersonDelete = async (person) => {
    if (!window.confirm(`Remove "${person.name}" from this contact?`)) return;
    if (!isEdit || String(person.id).startsWith('_t')) {
      setPersons(p => p.filter(x => x.id !== person.id));
      return;
    }
    try {
      await api.delete(`/contacts/${initial.id}/persons/${person.id}`);
      setPersons(p => p.filter(x => x.id !== person.id));
    } catch (e) {
      setErr(e.message || 'Failed to delete person');
    }
  };

  // ── Save main contact ──────────────────────────────────────────────────────

  const save = async () => {
    setErr(''); setFe({});
    const errs = {};
    if (isPersonal  && !form.personName.trim())                    errs.personName  = 'Person Name is required';
    if (!isPersonal && !form.companyName.trim())                   errs.companyName = 'Company Name is required';
    if (form.mobile1     && !isValidPhone(form.mobile1))           errs.mobile1     = 'Enter a valid phone number';
    if (form.mobile2     && !isValidPhone(form.mobile2))           errs.mobile2     = 'Enter a valid phone number';
    if (form.officePhone && !isValidPhone(form.officePhone))       errs.officePhone = 'Enter a valid phone number';
    if (form.email       && !isValidEmail(form.email))             errs.email       = 'Enter a valid email address';
    if (form.companyPhone && !isValidPhone(form.companyPhone))     errs.companyPhone = 'Enter a valid phone number';
    if (form.companyEmail && !isValidEmail(form.companyEmail))     errs.companyEmail = 'Enter a valid email address';
    if (Object.keys(errs).length) { setFe(errs); return; }
    setSaving(true);
    try {
      const result = isEdit
        ? await api.put(`/contacts/${initial.id}`, { ...form })
        : await api.post('/contacts', { ...form });

      // Save buffered persons for new contacts
      if (!isEdit && persons.length > 0) {
        for (const p of persons) {
          const { id: _id, ...body } = p;
          await api.post(`/contacts/${result.id}/persons`, body);
        }
      }
      onSaved(result, isEdit);
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="modal-overlay" {...overlayProps}>
        <div className="modal" style={{ maxWidth:920, width:'96vw' }} {...modalProps}>

          {/* Animated header */}
          <div className="modal-header">
            <h2>{isEdit ? '✏️ Edit Contact' : '📞 New Contact'}</h2>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>

          {/* Scrollable body */}
          <div className="modal-body" style={{ overflowY:'auto', maxHeight:'calc(92vh - 120px)' }}>

            {/* Type + Info toggles */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 24px', marginBottom:4 }}>
              <RadioGroup label="Contact Type" name="contactType" value={form.contactType}
                onChange={set('contactType')}
                options={[
                  { value:'public',  icon:'🌐', label:'Public'  },
                  { value:'private', icon:'🔒', label:'Private' },
                ]} />
              <RadioGroup label="Contact Info" name="contactInfo" value={form.contactInfo}
                onChange={v => setForm(p => ({ ...p, contactInfo:v }))}
                options={[
                  { value:'personal', icon:'👤', label:'Personal' },
                  { value:'company',  icon:'🏢', label:'Company'  },
                ]} />
            </div>

            {/* Privacy hint */}
            {isPrivate ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px',
                borderRadius:8, marginBottom:12, background:'#fdf4ff', border:'1px solid #e9d5ff',
                fontSize:12, color:'#7c3aed' }}>
                🔒 <strong>Private</strong> — only visible to you. Other users cannot see this contact.
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px',
                borderRadius:8, marginBottom:12, background:'#f0fdf4', border:'1px solid #bbf7d0',
                fontSize:12, color:'#059669' }}>
                🌐 <strong>Public</strong> — visible to all staff members.
              </div>
            )}

            <div style={{ borderTop:'1px solid #f3f4f6', margin:'0 0 14px' }} />

            {/* Personal fields */}
            {isPersonal && (
              <>
                <Row2>
                  <FF label="Person Name" required error={fe.personName}>
                    <FInput value={form.personName} onChange={set('personName')} placeholder="Full name" hasError={!!fe.personName} />
                  </FF>
                  <FF label="Office">
                    <FInput value={form.office} onChange={set('office')} placeholder="Company / organisation" />
                  </FF>
                </Row2>
                <Row2>
                  <FF label="Mobile 1" error={fe.mobile1}>
                    <FPhoneInput value={form.mobile1} onChange={set('mobile1')} placeholder="e.g. +977 98XXXXXXXX" hasError={!!fe.mobile1} />
                  </FF>
                  <FF label="Mobile 2" error={fe.mobile2}>
                    <FPhoneInput value={form.mobile2} onChange={set('mobile2')} placeholder="Secondary mobile" hasError={!!fe.mobile2} />
                  </FF>
                </Row2>
                <Row2>
                  <FF label="Office Phone" error={fe.officePhone}>
                    <FPhoneInput value={form.officePhone} onChange={set('officePhone')} placeholder="Landline / ext" hasError={!!fe.officePhone} />
                  </FF>
                  <FF label="Email" error={fe.email}>
                    <FInput value={form.email} onChange={set('email')} placeholder="email@example.com"
                      type="email" hasError={!!fe.email} />
                  </FF>
                </Row2>
                <FF label="Address">
                  <FInput value={form.address} onChange={set('address')} placeholder="Home or office address" />
                </FF>
              </>
            )}

            {/* Company fields */}
            {!isPersonal && (
              <>
                <Row2>
                  <FF label="Company Name" required error={fe.companyName}>
                    <FInput value={form.companyName} onChange={set('companyName')} placeholder="Company / organisation name" hasError={!!fe.companyName} />
                  </FF>
                  <FF label="Company Phone" error={fe.companyPhone}>
                    <FPhoneInput value={form.companyPhone} onChange={set('companyPhone')} placeholder="Main phone number" hasError={!!fe.companyPhone} />
                  </FF>
                </Row2>
                <Row2>
                  <FF label="Company Email" error={fe.companyEmail}>
                    <FInput value={form.companyEmail} onChange={set('companyEmail')} placeholder="info@company.com"
                      type="email" hasError={!!fe.companyEmail} />
                  </FF>
                  <FF label="Company Address">
                    <FInput value={form.companyAddress} onChange={set('companyAddress')} placeholder="Registered address" />
                  </FF>
                </Row2>
              </>
            )}

            {/* Work Scope */}
            <FF label="Work Scope with Us">
              <FTextarea value={form.workScope} onChange={set('workScope')}
                placeholder="Describe work relationship, services, or scope…" rows={2} />
            </FF>

            {/* Customer Category + Type */}
            <div style={{ display:'grid', gridTemplateColumns: form.customerCategory === 'customer' ? '1fr 1fr' : '1fr', gap:'0 16px' }}>
              <FF label="Customer Category">
                <select value={form.customerCategory} onChange={e => {
                  setForm(p => ({ ...p, customerCategory: e.target.value, customerType: '' }));
                }} className="form-control" style={{ fontSize:13 }}>
                  <option value="">— Select —</option>
                  <option value="supplier">Supplier</option>
                  <option value="customer">Customer</option>
                </select>
              </FF>
              {form.customerCategory === 'customer' && (
                <FF label="Customer Type">
                  <select value={form.customerType} onChange={e => set('customerType')(e.target.value)}
                    className="form-control" style={{ fontSize:13 }}>
                    <option value="">— Select —</option>
                    {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </FF>
              )}
            </div>

            {/* ── Persons DataGrid — Company only ── */}
            {!isPersonal && (
              <div style={{ borderTop:'2px solid #e5e7eb', margin:'16px 0 14px', paddingTop:16 }}>
                <PersonsGrid
                  persons={persons}
                  onAdd={() => setPModal({ initial: EMPTY_PERSON })}
                  onEdit={(p) => setPModal({ initial: p })}
                  onDelete={handlePersonDelete}
                />
              </div>
            )}

            {err && (
              <div style={{ padding:'8px 12px', background:'#fef2f2', border:'1px solid #fecaca',
                borderRadius:8, color:'#dc2626', fontSize:13, marginTop:8 }}>{err}</div>
            )}
          </div>

          {/* Footer */}
          <div className="modal-footer" style={{ justifyContent:'flex-end', gap:10 }}>
            <button onClick={onClose}
              style={{ padding:'8px 20px', borderRadius:8, border:'1px solid #d1d5db',
                background:'#fff', color:'#374151', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              style={{ padding:'8px 24px', borderRadius:8, border:'none',
                background: saving ? '#93c5fd' : '#1a56db', color:'#fff',
                fontSize:13, fontWeight:700, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : isEdit ? 'Update' : 'Save Contact'}
            </button>
          </div>
        </div>
      </div>

      {/* Person sub-modal — higher z-index */}
      {pModal && (
        <PersonModal
          initial={pModal.initial}
          onClose={() => setPModal(null)}
          onSaved={handlePersonSaved}
        />
      )}
    </>
  );
};

export default ContactFormModal;
