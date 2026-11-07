import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage }  from '../../context/LanguageContext.jsx';
import api              from '../../api/client.js';
import DataGrid         from '../DataGrid/DataGrid.jsx';
import CompanyTaskLedger from './CompanyTaskLedger.jsx';
import ContactFormModal, { CONTACT_EMPTY as EMPTY } from './ContactFormModal.jsx';

// ── helpers ──────────────────────────────────────────────────────────────────

const displayName    = (row) => row.contactInfo === 'company' ? (row.companyName    || '—') : (row.personName || '—');
const displayPost    = (row) => row.contactInfo === 'company' ? '—'                         : (row.office     || '—');
const displayMob1    = (row) => row.contactInfo === 'company' ? (row.companyPhone   || '—') : (row.mobile1    || '—');
const displayEmail   = (row) => row.contactInfo === 'company' ? (row.companyEmail   || '—') : (row.email      || '—');
const displayAddress = (row) => row.contactInfo === 'company' ? (row.companyAddress || '—') : (row.address    || '—');

// ── Share to WhatsApp ─────────────────────────────────────────────────────────
// Builds a WhatsApp-formatted (*bold*) text card of the contact and opens the
// wa.me share sheet so the user picks the recipient in WhatsApp itself.

const buildShareText = (c, persons = []) => {
  const lines = [`*${displayName(c)}*`];
  if (c.contactInfo === 'personal') {
    if (c.office)      lines.push(`Office: ${c.office}`);
    if (c.mobile1)     lines.push(`Mobile 1: ${c.mobile1}`);
    if (c.mobile2)     lines.push(`Mobile 2: ${c.mobile2}`);
    if (c.officePhone) lines.push(`Office Phone: ${c.officePhone}`);
    if (c.email)       lines.push(`Email: ${c.email}`);
    if (c.address)     lines.push(`Address: ${c.address}`);
  } else {
    if (c.companyPhone)   lines.push(`Phone: ${c.companyPhone}`);
    if (c.companyEmail)   lines.push(`Email: ${c.companyEmail}`);
    if (c.companyAddress) lines.push(`Address: ${c.companyAddress}`);
  }
  if (c.workScope) lines.push(`Work Scope: ${c.workScope}`);
  if (persons.length) {
    lines.push('', '*Contact Persons:*');
    persons.forEach((p, i) => {
      const bits = [p.post, p.mobile1, p.mobile2, p.email].filter(Boolean).join(' · ');
      lines.push(`${i + 1}. ${p.name}${bits ? ' — ' + bits : ''}`);
    });
  }
  return lines.join('\n');
};

const openWhatsAppShare = (text) =>
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');

// Context-menu path: persons aren't loaded with the grid rows, so fetch them
// for company contacts before building the message.
const shareContactOnWhatsApp = async (contact) => {
  let persons = [];
  if (contact.contactInfo === 'company' && contact.id) {
    try { persons = await api.get(`/contacts/${contact.id}/persons`); } catch { /* share without persons */ }
  }
  openWhatsAppShare(buildShareText(contact, persons));
};

// ── Badges ────────────────────────────────────────────────────────────────────

const TypeBadge = ({ type }) => (
  <span title={type==='private' ? 'Private' : 'Public'} style={{
    display:'inline-block', padding:'1px 6px', borderRadius:8, fontSize:9, fontWeight:700, whiteSpace:'nowrap',
    background: type==='private' ? '#fde8ef' : '#d1fae5',
    color:      type==='private' ? '#be185d'  : '#065f46',
  }}>
    {type==='private' ? '🔒 Priv' : '🌐 Pub'}
  </span>
);

const InfoBadge = ({ info }) => (
  <span title={info==='company' ? 'Company' : 'Personal'} style={{
    display:'inline-block', padding:'1px 6px', borderRadius:8, fontSize:9, fontWeight:700, whiteSpace:'nowrap',
    background: info==='company' ? '#dbeafe' : '#ede9fe',
    color:      info==='company' ? '#1e40af'  : '#5b21b6',
  }}>
    {info==='company' ? '🏢 Co' : '👤 Pers'}
  </span>
);

// Short labels for the Contact grid's single-row Type column — full name always in the tooltip.
const CATEGORY_SHORT = {
  'Suppliers'                  : 'Splr',
  'Dealers Inside Valley'      : 'Deal-IV',
  'Dealer Outside Valley'      : 'Deal-OV',
  'Bank & Finance'             : 'Bank',
  'Government'                 : 'Govt',
  'Hotel & Restaurant, Travel' : 'Hotel',
  'Factory & Industry'         : 'Factory',
  'IT Company'                 : 'IT',
  'INGO & NGO'                 : 'NGO',
  'Health Club'                : 'Health',
  'Hospitals & Clinic'         : 'Hosp',
  'Manpower & Orientation'     : 'Manpower',
  'Other'                      : 'Other',
};

const CategoryBadge = ({ category }) => {
  if (!category) return null;
  const isSupplier = category === 'Suppliers';
  return (
    <span title={category} style={{
      display:'inline-flex', alignItems:'center', gap:3, whiteSpace:'nowrap',
      padding:'1px 6px', borderRadius:8, fontSize:9, fontWeight:700,
      background: isSupplier ? '#fef3c7' : '#d1fae5',
      color:      isSupplier ? '#92400e'  : '#065f46',
    }}>
      {isSupplier ? '📦' : '🤝'} {CATEGORY_SHORT[category] || category}
    </span>
  );
};

// ── Detail label row ──────────────────────────────────────────────────────────

const DRow = ({ icon, label, value }) => {
  if (!value) return null;
  return (
    <div style={{ display:'flex', gap:10, padding:'7px 0', borderBottom:'1px solid #f3f4f6' }}>
      <span style={{ fontSize:15, width:20, flexShrink:0, textAlign:'center' }}>{icon}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:10, fontWeight:700, color:'#9ca3af', textTransform:'uppercase',
          letterSpacing:'.5px', marginBottom:1 }}>{label}</div>
        <div style={{ fontSize:13, color:'#1f2937', wordBreak:'break-word' }}>{value}</div>
      </div>
    </div>
  );
};

// ── Right-side detail panel ───────────────────────────────────────────────────

const DetailPanel = ({ contact, onEdit, onDelete, onClose }) => {
  const isPersonal  = contact.contactInfo === 'personal';
  const avatar      = isPersonal ? contact.personName?.charAt(0)?.toUpperCase()||'?' : contact.companyName?.charAt(0)?.toUpperCase()||'?';
  const avatarBg    = isPersonal ? '#ede9fe' : '#dbeafe';
  const avatarColor = isPersonal ? '#7c3aed' : '#1e40af';

  // Company contacts can hold multiple contact persons — show them here too.
  const [persons, setPersons] = useState([]);
  useEffect(() => {
    setPersons([]);
    if (isPersonal || !contact.id) return;
    api.get(`/contacts/${contact.id}/persons`).then(setPersons).catch(() => {});
  }, [contact.id, isPersonal]);

  // Full-viewport-height overlay drawer (fixed, not a flex sibling) — same
  // convention as the Task page's Followup History panel, so the grid stays
  // full width and never has to shrink/scroll to make room for it.
  return (
    <div style={{
      position:'fixed', top:60, right:0, bottom:0, width:380, zIndex:51,
      background:'#fff', boxShadow:'-6px 0 24px rgba(0,0,0,.15)', borderLeft:'1px solid #dedede',
      display:'flex', flexDirection:'column', overflow:'hidden',
    }}>
      {/* Panel header */}
      <div style={{
        background:'#ffffff', flexShrink:0,
        padding:'16px 16px 14px', borderBottom:'1px solid #e5e7eb', position:'relative',
      }}>
        <button onClick={onClose}
          style={{ position:'absolute', top:10, right:10, background:'rgba(0,0,0,.06)',
            border:'none', borderRadius:6, width:26, height:26, cursor:'pointer',
            fontSize:14, color:'#6b7280', display:'flex', alignItems:'center', justifyContent:'center' }}>
          ✕
        </button>
        <button onClick={() => openWhatsAppShare(buildShareText(contact, persons))}
          title="Share this contact on WhatsApp"
          style={{ position:'absolute', top:10, right:44, background:'#25D366',
            border:'none', borderRadius:6, height:26, padding:'0 10px', cursor:'pointer',
            fontSize:11.5, fontWeight:700, color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          📤 Share
        </button>
        <div style={{
          width:52, height:52, borderRadius:14, background:avatarBg, color:avatarColor,
          fontSize:22, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center',
          marginBottom:10, boxShadow:'0 2px 8px rgba(0,0,0,.08)',
        }}>{avatar}</div>
        <div style={{ fontSize:15, fontWeight:700, color:'#111827', lineHeight:1.3 }}>
          {displayName(contact)}
        </div>
        {displayPost(contact) !== '—' && (
          <div style={{ fontSize:12, color:'#6b7280', marginTop:3 }}>{displayPost(contact)}</div>
        )}
        <div style={{ display:'flex', gap:6, marginTop:8, flexWrap:'wrap' }}>
          <InfoBadge info={contact.contactInfo} />
          <TypeBadge type={contact.contactType} />
          {contact.customerCategory && (
            <CategoryBadge category={contact.customerCategory} />
          )}
        </div>
      </div>

      {/* Detail rows */}
      <div style={{ flex:1, overflowY:'auto', padding:'12px 16px' }}>
        {isPersonal ? (
          <>
            <DRow icon="📱" label="Mobile 1"    value={contact.mobile1} />
            <DRow icon="📱" label="Mobile 2"    value={contact.mobile2} />
            <DRow icon="☎️"  label="Office Phone" value={contact.officePhone} />
            <DRow icon="✉️"  label="Email"       value={contact.email} />
            <DRow icon="📍" label="Address"      value={contact.address} />
          </>
        ) : (
          <>
            <DRow icon="☎️"  label="Company Phone" value={contact.companyPhone} />
            <DRow icon="✉️"  label="Company Email" value={contact.companyEmail} />
            <DRow icon="📍" label="Address"        value={contact.companyAddress} />
          </>
        )}
        <DRow icon="🗺️" label="District" value={contact.district} />

        {/* Multiple contact persons under a company contact */}
        {!isPersonal && persons.length > 0 && (
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af',
              textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6 }}>
              👥 Contact Persons ({persons.length})
            </div>
            {persons.map(p => (
              <div key={p.id} style={{ background:'#f9fafb', border:'1px solid #e5e7eb',
                borderRadius:10, padding:'8px 12px', marginBottom:8 }}>
                <div style={{ fontSize:13, fontWeight:700, color:'#111827' }}>{p.name}</div>
                {(p.post || p.department) && (
                  <div style={{ fontSize:11, color:'#6b7280', marginTop:1 }}>
                    {[p.post, p.department].filter(Boolean).join(' · ')}
                  </div>
                )}
                {(p.mobile1 || p.mobile2) && (
                  <div style={{ fontSize:12.5, color:'#1f2937', marginTop:3 }}>
                    📱 {[p.mobile1, p.mobile2].filter(Boolean).join(', ')}
                  </div>
                )}
                {(p.email || p.ext) && (
                  <div style={{ fontSize:12.5, color:'#4b5563', marginTop:2, wordBreak:'break-word' }}>
                    {p.email ? `✉️ ${p.email}` : ''}{p.email && p.ext ? ' · ' : ''}{p.ext ? `Ext ${p.ext}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {contact.workScope && (
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af',
              textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6 }}>
              💼 Work Scope with Us
            </div>
            <div style={{
              background:'linear-gradient(135deg,#f0f9ff,#e0f2fe)',
              border:'1px solid #bae6fd', borderRadius:10, padding:'10px 14px',
              fontSize:13, color:'#0369a1', lineHeight:1.6,
            }}>{contact.workScope}</div>
          </div>
        )}
        {!contact.workScope && (
          <div style={{ marginTop:14, padding:'10px 14px', background:'#f9fafb',
            border:'1px dashed #d1d5db', borderRadius:10, fontSize:12, color:'#9ca3af', textAlign:'center' }}>
            No work scope added
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding:'10px 16px', borderTop:'1px solid #f3f4f6', display:'flex', gap:8, flexShrink:0 }}>
        <button onClick={() => onEdit(contact)}
          style={{ flex:1, padding:'7px 0', borderRadius:8, border:'1px solid #d1d5db',
            background:'#fff', color:'#374151', fontSize:12, fontWeight:600, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
          ✏️ Edit
        </button>
        <button onClick={() => onDelete(contact)}
          style={{ flex:1, padding:'7px 0', borderRadius:8, border:'1px solid #fecaca',
            background:'#fff5f5', color:'#dc2626', fontSize:12, fontWeight:600, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
          🗑️ Delete
        </button>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
//  Main StaffContact page
// ══════════════════════════════════════════════════════════════════════════════

const StaffContact = () => {
  const { t } = useLanguage();

  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null);
  const [selected, setSelected] = useState(null);
  const [ledger,   setLedger]   = useState(null);   // contact whose Task Ledger popup is open
  const [toast,    setToast]    = useState(null);

  const showToast = (msg, color='#059669') => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.get('/contacts')); }
    catch (e) { showToast(e.message||'Failed to load', '#dc2626'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (contact, isEdit) => {
    if (isEdit) {
      setRows(p => p.map(r => r.id===contact.id ? contact : r));
      setSelected(contact);
      showToast('Contact updated');
    } else {
      setRows(p => [contact, ...p]);
      setSelected(contact);
      showToast('Contact added');
    }
    setModal(null);
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete contact "${displayName(row)}"?`)) return;
    try {
      await api.delete(`/contacts/${row.id}`);
      setRows(p => p.filter(r => r.id!==row.id));
      if (selected?.id===row.id) setSelected(null);
      showToast('Contact deleted');
    } catch (e) { showToast(e.message||'Delete failed', '#dc2626'); }
  };

  const columns = [
    {
      field:'name', header:'Name', width:180,
      render:(_,row) => (
        <span onClick={(e) => { e.stopPropagation(); setLedger(row); }}
          title="Open Task Ledger"
          style={{ fontWeight:600, color:'#1f2937', cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted', textUnderlineOffset:3 }}>
          {displayName(row)}
        </span>
      ),
    },
    {
      field:'mobile1', header:'Mobile 1', width:130,
      render:(_,row) => <span style={{ color:'#1a56db', fontWeight:700 }}>{displayMob1(row)}</span>,
    },
    {
      field:'address', header:'Address', width:180,
      render:(_,row) => <span style={{ color:'#4b5563' }}>{displayAddress(row)}</span>,
    },
    {
      field:'mobile2', header:'Mobile 2', width:120,
      render:(_,row) => <span>{row.mobile2||'—'}</span>,
    },
    {
      field:'email', header:'Email', width:200,
      render:(_,row) => <span style={{ color:'#4b5563' }}>{displayEmail(row)}</span>,
    },
    {
      field:'contactInfo', header:'Type', width:230,
      render:(_,row) => (
        <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'nowrap' }}>
          <InfoBadge info={row.contactInfo} />
          <TypeBadge type={row.contactType} />
          {row.customerCategory && (
            <CategoryBadge category={row.customerCategory} />
          )}
        </div>
      ),
    },
  ];

  const contextMenu = [
    { label:'Add New', icon:'➕', onClick:() => setModal({ initial:EMPTY }) },
    { label:'Edit',    icon:'✏️', onClick:(row) => setModal({ initial:row }) },
    { label:'Task Ledger', icon:'📒', onClick:(row) => setLedger(row) },
    { label:'Share',   icon:'📤', onClick:shareContactOnWhatsApp },
    { label:'Delete',  icon:'🗑️', className:'danger', onClick:handleDelete },
  ];

  const toolbar = (
    <button onClick={() => setModal({ initial:EMPTY })}
      style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px',
        borderRadius:8, border:'none', background:'#1a56db', color:'#fff',
        fontSize:13, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 8px rgba(26,86,219,.25)' }}
      onMouseEnter={e => e.currentTarget.style.background='#1e40af'}
      onMouseLeave={e => e.currentTarget.style.background='#1a56db'}>
      <span style={{ fontSize:16, lineHeight:1 }}>+</span> Add New
    </button>
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">📞 {t('Contact')}</h1>
        </div>
      </div>

      <div style={{ paddingBottom:24 }}>
        {loading ? (
          <div style={{ padding:40, textAlign:'center', color:'#9ca3af', fontSize:14 }}>
            Loading contacts…
          </div>
        ) : (
          <DataGrid
            columns={columns} data={rows} rowKey="id" title="Contacts"
            toolbar={toolbar} contextMenu={contextMenu}
            onRowClick={(row) => setSelected(s => s?.id===row.id ? null : row)}
            onRowDoubleClick={(row) => setModal({ initial:row })}
            defaultPageSize={15} striped
            // None of the grid's own column `field`s (name/mobile1/email/address)
            // exist as raw row properties — displayName/displayMob1/etc. above
            // compute them on the fly from personName-vs-companyName and
            // mobile1-vs-companyPhone depending on contactInfo. DataGrid's search
            // only ever reads row[col.field] directly, so without listing every
            // real underlying field here, searching by name/phone/email matched
            // nothing at all (silently) for either contact type.
            extraSearchFields={['personName', 'companyName', 'mobile1', 'mobile2', 'companyPhone',
              'email', 'companyEmail', 'workScope', 'address', 'companyAddress']}
          />
        )}
      </div>

      {/* Full-height overlay drawer — see DetailPanel, doesn't shrink the grid above */}
      {selected && (
        <DetailPanel
          contact={selected}
          onEdit={(row) => setModal({ initial:row })}
          onDelete={handleDelete}
          onClose={() => setSelected(null)}
        />
      )}

      {ledger && (
        <CompanyTaskLedger contactId={ledger.id} name={displayName(ledger)} subtitle={displayMob1(ledger) !== '—' ? displayMob1(ledger) : ''} onClose={() => setLedger(null)} />
      )}

      {modal && (
        <ContactFormModal
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {toast && (
        <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999,
          background:toast.color, color:'#fff', padding:'10px 20px', borderRadius:10,
          fontSize:13, fontWeight:600, boxShadow:'0 4px 16px rgba(0,0,0,.2)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default StaffContact;
