import { Pic } from '../components/AuthImg';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { RemarksRow, UpdatedBy, useGrid } from '../components/DataGrid';
import { Kbd } from '../components/inputs';
import { api, fmtStamp } from '../lib/api';
import { useShortcuts } from '../lib/keys';

const PICS = [
  ['logo', 'logo_file', 'Company Logo', 'Top of every page'],
  ['cover', 'cover_file', 'Cover Photo', 'Right side of the cover page'],
  ['sign', 'sign_file', 'Signature', 'Proposal, terms & thank-you pages'],
  ['stamp', 'stamp_file', 'Company Stamp', 'Next to the grand total & signature'],
  ['brand_zk', 'brand_zk_file', 'ZKTeco Logo', 'Cover page & footer of pages 2+'],
  ['brand_yoi', 'brand_yoi_file', 'YOI Logo', 'Cover page & footer of pages 2+'],
];
const PAPERS = [['A4', 'A4 Portrait (print)'], ['WIDE', 'Widescreen 16:9 (presentation)']];
const blank = (company) => ({
  name: '', is_default: false, paper: 'A4', color1: '#2E7D32', color2: '#6CBE45', color3: '#0B6FB8',
  website: '', phones: company.phone || '', address: company.address || '',
  prepared_name: '', prepared_post: '', prepared_phone: '', prepared_email: company.email || '',
  validity: '15 days from date of issue', terms_list: [['Warranty', 'One year warranty'], ['Payment Terms', 'Online or Cheque']], notes: '',
  profile_list: [],
});
const readFile = (file) => new Promise((ok, fail) => {
  const rd = new FileReader();
  rd.onload = () => ok(rd.result);
  rd.onerror = () => fail(new Error('Could not read the file.'));
  rd.readAsDataURL(file);
});

/** Sales › Quotation Templates: the look and the standard content of the quotation PDF. */
export default function QuoteTemplates() {
  const { company, notify, canEdit } = useApp();
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => api.get('/quote-templates').then(setRows).catch((e) => notify(e.message, 'err'));
  useEffect(() => { load(); }, []);
  const open = (t) => setEdit(t ? { ...t, terms_list: t.terms_list.length ? t.terms_list.map((r) => [...r]) : [['', '']] } : blank(company));
  const g = useGrid({ rows, onOpen: (t) => canEdit && open(t) });

  return (
    <>
      <header className="page-head">
        <h1>🎨 Quotation Templates</h1>
        <span className="muted">Logo, cover photo, company profile pages, signature, stamp and standard terms for the Sales Quotation PDF</span>
        <span className="spacer" />
        <button className="edit-only" data-new title="F1 / Alt+N" onClick={() => open(null)}>＋ New template <kbd className="kbd">F1</kbd></button>
      </header>
      <section className="card">
        <table ref={g.gridRef} className="grid dg-soft">
          <thead><tr>{g.tickTh}<th className="sn">SN</th><th>Template</th><th>Paper</th><th>Colours</th><th>Pictures</th><th className="num">Profile Pages</th>
            <th className="num">Terms</th><th className="num">Quotations</th><th>Validity</th><th className="nowrap">Updated By</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="muted">No templates. Press <kbd className="kbd">F1</kbd> to add one.</td></tr>}
            {rows.map((t, i) => (
              <tr key={t.id} {...g.rowProps(t)}>
                {g.tickTd(t)}<td className="sn">{i + 1}</td>
                <td className="pname">{t.name}{t.is_default && <span className="tag st-posted">default</span>}</td>
                <td className="nowrap">{t.paper === 'WIDE' ? '16:9 Widescreen' : 'A4 Portrait'}</td>
                <td><span className="qt-swatches">{[t.color1, t.color2, t.color3].map((c) => <i key={c} style={{ background: c }} />)}</span></td>
                <td className="small">{PICS.filter(([, col]) => t[col]).map(([, , label]) => label.replace('Company ', '')).join(', ') || <span className="muted">none yet</span>}</td>
                <td className="num">{t.profile_list.reduce((s, p) => s + (p.used_pages || 0), 0)}</td>
                <td className="num">{t.terms_list.length}</td>
                <td className="num">{t.uses}</td>
                <td className="small">{t.validity}</td>
                <td className="nowrap">{t.updated_by || t.created_by}</td>
              </tr>
            ))}
            {g.blankRows(11)}
            <RemarksRow g={g} cols={11} right={g.curRow && <UpdatedBy name={g.curRow.updated_by} when={fmtStamp(g.curRow.updated_at)} />}>
              {g.curRow && <>
                <div><b>{g.curRow.name}</b> — double-click or Enter to edit ·{' '}
                  <a href={`/api/accounts/quote-templates/${g.curRow.id}/preview`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>👁 Preview sample PDF</a></div>
                <div className="rm-pay"><b>Prepared by:</b> {[g.curRow.prepared_name, g.curRow.prepared_post, g.curRow.prepared_phone, g.curRow.prepared_email].filter(Boolean).join(' · ') || '—'}</div>
                <div className="rm-pay"><b>Profile pages:</b> {g.curRow.profile_list.map((p) => p.label || (p.file.endsWith('.pdf') ? `PDF pages ${p.pages || 'all'}` : 'image')).join(', ') || '—'}</div>
              </>}
            </RemarksRow>
          </tbody>
        </table>
      </section>
      <StaffSigners />
      {edit && <TemplateForm value={edit} busy={busy} setBusy={setBusy}
        onClose={() => setEdit(null)} onSaved={(t, close) => { load(); if (close) setEdit(null); else open(t); }} />}
    </>
  );
}

function TemplateForm({ value, onClose, onSaved, busy, setBusy }) {
  const { company, notify } = useApp();
  const [f, setF] = useState(value);
  const picRef = useRef(null);
  const pageRef = useRef(null);
  const [picSlot, setPicSlot] = useState(null);
  useEffect(() => setF(value), [value]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const fileUrl = (name) => `/quote-templates/${f.id}/file/${encodeURIComponent(name)}`;
  const fileHref = (name) => `/api/accounts${fileUrl(name)}`;

  const body = () => ({ ...f, terms: f.terms_list, profile_list: f.profile_list.map(({ file, pages, label }) => ({ file, pages, label })) });
  const save = async (close = true) => {
    setBusy('save');
    try {
      const t = f.id ? await api.put(`/quote-templates/${f.id}`, body()) : await api.post('/quote-templates', body());
      notify(f.id ? 'Template saved' : 'Template added — now upload the logo, cover photo and pages');
      onSaved(t, close && !!f.id);
    } catch (e) { notify(e.message, 'err'); }
    setBusy('');
  };
  const remove = async () => {
    if (!f.id || !confirm(`Delete template “${f.name}”?`)) return;
    try { await api.del(`/quote-templates/${f.id}`); notify('Template deleted'); onSaved(null, true); }
    catch (e) { notify(e.message, 'err'); }
  };
  useShortcuts({ save: () => save(true), close: onClose, del: f.id ? remove : undefined });

  /** Uploads go straight to the server; typed (unsaved) changes in the form are kept. */
  const upload = async (slot, file, extra = {}) => {
    if (!file) return;
    const isPdf = file.type === 'application/pdf';
    if (slot !== 'profile' && !/^image\/(png|jpeg|webp)$/.test(file.type)) { notify('Use a PNG, JPG or WEBP picture.', 'err'); return; }
    if (slot === 'profile' && !isPdf && !/^image\/(png|jpeg|webp)$/.test(file.type)) { notify('Use a PDF, or a PNG / JPG picture of the page.', 'err'); return; }
    if (file.size > (isPdf ? 25 : 5) * 1024 * 1024) { notify(`File is larger than ${isPdf ? 25 : 5} MB.`, 'err'); return; }
    setBusy(slot);
    try {
      const t = await api.post(`/quote-templates/${f.id}/upload`, { slot, data: await readFile(file), ...extra });
      setF((x) => {
        const known = new Set(x.profile_list.map((p) => p.file));
        return { ...x, logo_file: t.logo_file, cover_file: t.cover_file, sign_file: t.sign_file, stamp_file: t.stamp_file, brand_zk_file: t.brand_zk_file, brand_yoi_file: t.brand_yoi_file,
          profile_list: [...x.profile_list, ...t.profile_list.filter((p) => !known.has(p.file))] };
      });
      notify(slot === 'profile' ? `${file.name} added${isPdf ? ' — set which pages to use, then Save' : ''}` : 'Picture saved');
    } catch (e) { notify(e.message, 'err'); }
    setBusy('');
  };
  const removePic = async (slot, col) => {
    try { await api.del(`/quote-templates/${f.id}/upload/${slot}`); setF((x) => ({ ...x, [col]: null })); }
    catch (e) { notify(e.message, 'err'); }
  };
  const setPage = (i, patch) => setF({ ...f, profile_list: f.profile_list.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const movePage = (i, d) => {
    const l = [...f.profile_list];
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    setF({ ...f, profile_list: l });
  };
  const terms = f.terms_list.length ? f.terms_list : [['', '']];
  const setTerm = (i, k, v) => {
    const next = terms.map((r, j) => (j === i ? (k === 0 ? [v, r[1]] : [r[0], v]) : r));
    if (i === next.length - 1 && v.trim()) next.push(['', '']);
    setF({ ...f, terms_list: next });
  };

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card party-full qt-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(true); }}>
        <div className="pf-title">
          <h2>{f.id ? `✏️ ${f.name}` : '➕ New Quotation Template'}</h2>
          {f.is_default && <span className="tag st-posted">default</span>}
          <span className="spacer" />
          {f.id && <a className="btn ghost btn-sm" href={`/api/accounts/quote-templates/${f.id}/preview`} target="_blank" rel="noopener" tabIndex={-1}
            title="Sample quotation with this template (save first to see your latest changes)">👁 Preview PDF</a>}
        </div>

        <div className="doc-form pf-top">
          <div className="acc-step"><i>1</i>Template details</div>
          <label className="pf-wide">Template Name *<input autoFocus value={f.name} onChange={set('name')} placeholder="e.g. Attendance & Access Control" required /></label>
          <label>Paper Size
            <select value={f.paper || 'A4'} onChange={set('paper')}>
              {PAPERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>Heading Colour<span className="qt-color"><input type="color" value={f.color1} onChange={set('color1')} /><code>{f.color1}</code></span></label>
          <label>Accent Colour<span className="qt-color"><input type="color" value={f.color2} onChange={set('color2')} /><code>{f.color2}</code></span></label>
          <label>Grand Total Colour<span className="qt-color"><input type="color" value={f.color3} onChange={set('color3')} /><code>{f.color3}</code></span></label>
          <label className="check"><input type="checkbox" checked={f.is_default} onChange={set('is_default')} /> Default for new quotations</label>
        </div>

        <div className="acc-step acc-step-out"><i>2</i>Contact lines on the quotation</div>
        <div className="doc-form pf-trans">
          <label>Website<input data-nocap value={f.website || ''} onChange={set('website')} placeholder="www.yourcompany.com.np" /></label>
          <label>Phone Numbers<input value={f.phones || ''} onChange={set('phones')} placeholder={company.phone || '01-5xxxxxx | 98xxxxxxxx'} /></label>
          <label>Address<input value={f.address || ''} onChange={set('address')} placeholder={company.address || 'Office address'} /></label>
        </div>

        <div className="acc-step acc-step-out"><i>3</i>Prepared by (thank-you page)</div>
        <div className="doc-form pf-top">
          <label>Name<input value={f.prepared_name || ''} onChange={set('prepared_name')} placeholder="e.g. Sales Manager's name" /></label>
          <label>Post / Designation<input value={f.prepared_post || ''} onChange={set('prepared_post')} placeholder={`e.g. CEO, ${company.name}`} /></label>
          <label>Phone<input value={f.prepared_phone || ''} onChange={set('prepared_phone')} /></label>
          <label>Email<input data-nocap value={f.prepared_email || ''} onChange={set('prepared_email')} /></label>
        </div>
        <p className="muted small qt-help">Used only when the quotation's creator has no details of their own. Set each person's name, phone and signature below.</p>
        <StaffSigners inForm />

        <div className="acc-step acc-step-out"><i>4</i>Pictures</div>
        {!f.id ? <p className="muted">Save the template first, then upload the logo, cover photo, signature and stamp.</p> : (
          <div className="qt-pics">
            {PICS.map(([slot, col, label, hint]) => (
              <div key={slot} className="qt-pic">
                <div className="qt-pic-img">{f[col] ? <Pic src={fileUrl(f[col])} alt={label} /> : <span className="muted">No picture</span>}</div>
                <b>{label}</b><small className="muted">{hint}</small>
                <span>
                  <button type="button" className="ghost btn-sm" tabIndex={-1} disabled={!!busy}
                    onClick={() => { setPicSlot(slot); picRef.current?.click(); }}>{busy === slot ? 'Uploading…' : f[col] ? 'Change' : 'Upload'}</button>
                  {f[col] && <button type="button" className="link del-x" tabIndex={-1} title="Remove" onClick={() => removePic(slot, col)}>✕</button>}
                </span>
              </div>
            ))}
            <input ref={picRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange={(e) => { upload(picSlot, e.target.files[0]); e.target.value = ''; }} />
          </div>
        )}

        <div className="pf-contacts-head">
          <span className="acc-step"><i>5</i>Company profile pages — template upload <span className="tag">{f.profile_list.length}</span></span>
          <span className="spacer" />
          {f.id && <button type="button" className="ghost add-line" tabIndex={-1} disabled={!!busy} onClick={() => pageRef.current?.click()}>
            {busy === 'profile' ? 'Uploading…' : '＋ Upload PDF / Image'}</button>}
          <input ref={pageRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden
            onChange={(e) => { const fl = e.target.files[0]; upload('profile', fl, { label: fl?.name.replace(/\.[^.]+$/, '') }); e.target.value = ''; }} />
        </div>
        <p className="muted small qt-help">Pages placed after the cover — e.g. company introduction, authorization certificate, clients.
          Upload your existing quotation PDF (PowerPoint › File › Export › PDF) and type which pages to use, e.g. <b>2-5, 7</b>. Images are used as one full page each.</p>
        {f.profile_list.length > 0 && (
          <table className="grid entry bill-grid qt-pages">
            <thead><tr><th className="sn">SN</th><th style={{ width: 70 }}>FILE</th><th>LABEL</th><th style={{ width: 180 }}>PAGES TO USE</th><th style={{ width: 110 }}>PAGES</th><th style={{ width: 90 }} /></tr></thead>
            <tbody>{f.profile_list.map((p, i) => {
              const isPdf = p.file.toLowerCase().endsWith('.pdf');
              return (
                <tr key={p.file}>
                  <td className="sn">{i + 1}</td>
                  <td>{isPdf ? <a href={fileHref(p.file)} target="_blank" rel="noopener" tabIndex={-1}>📄 PDF</a>
                    : <Pic className="qt-page-thumb" src={fileUrl(p.file)} />}</td>
                  <td><input value={p.label || ''} placeholder="e.g. ZKTeco authorization" onChange={(e) => setPage(i, { label: e.target.value })} /></td>
                  <td>{isPdf ? <input data-nocap value={p.pages || ''} placeholder="all pages" onChange={(e) => setPage(i, { pages: e.target.value })} />
                    : <span className="muted small">1 page (image)</span>}</td>
                  <td className="small muted">{isPdf ? `of ${p.page_count ?? '?'} in file` : ''}</td>
                  <td className="nowrap">
                    <button type="button" className="link" tabIndex={-1} title="Move up" disabled={i === 0} onClick={() => movePage(i, -1)}>▲</button>
                    <button type="button" className="link" tabIndex={-1} title="Move down" disabled={i === f.profile_list.length - 1} onClick={() => movePage(i, 1)}>▼</button>
                    <button type="button" className="link del-x" tabIndex={-1} title="Remove (on Save)"
                      onClick={() => setF({ ...f, profile_list: f.profile_list.filter((_, j) => j !== i) })}>✕</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}

        <div className="acc-step acc-step-out"><i>6</i>Defaults for new quotations</div>
        <div className="doc-form pf-trans">
          <label className="pf-wide">Validity<input value={f.validity || ''} onChange={set('validity')} placeholder="15 days from date of issue" /></label>
        </div>
        <table className="grid entry bill-grid qt-terms">
          <thead><tr><th className="sn">SN</th><th style={{ width: '28%' }}>TERM</th><th>DETAILS</th><th style={{ width: 30 }} /></tr></thead>
          <tbody>{terms.map((r, i) => (
            <tr key={i}>
              <td className="sn">{i + 1}</td>
              <td><input value={r[0]} placeholder="e.g. Warranty" onChange={(e) => setTerm(i, 0, e.target.value)} /></td>
              <td><input value={r[1]} placeholder="e.g. One year warranty" onChange={(e) => setTerm(i, 1, e.target.value)} /></td>
              <td>{terms.length > 1 && <button type="button" className="link del-x" tabIndex={-1} onClick={() => setF({ ...f, terms_list: terms.filter((_, j) => j !== i) })}>✕</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        <label className="qt-notes">Notes (bottom of the terms page)
          <textarea rows={2} value={f.notes || ''} onChange={set('notes')} placeholder="e.g. Electric wire and CAT 6 cables are not included…" />
        </label>

        <div className="actions pf-actions">
          {f.id && <button type="button" className="danger edit-only" onClick={remove}>Delete <kbd className="kbd">Ctrl+Del</kbd></button>}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Close <Kbd>Esc</Kbd></button>
          {!f.id && <button type="button" disabled={!!busy} onClick={() => save(false)}>Save &amp; add pictures</button>}
          {f.id && <button data-save disabled={!!busy}>💾 Save template <Kbd>Ctrl+S</Kbd></button>}
        </div>
      </form>
    </div>
  );
}

/** Staff-wise "Prepared by" details + signature: used for the quotations that person creates. */
function StaffSigners({ inForm = false }) {
  const { notify, canEdit } = useApp();
  const [data, setData] = useState({ signers: [], users: [] });
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);
  const [sigFor, setSigFor] = useState(null);
  const load = () => api.get('/quote-signers').then((d) => { setData(d); setRows(d.signers); }).catch((e) => notify(e.message, 'err'));
  useEffect(() => { load(); }, []);
  const userOf = (u) => data.users.find((x) => x.username === u);
  const free = data.users.filter((u) => !rows.some((r) => r.username === u.username));
  const patch = (u, k, v) => setRows((rs) => rs.map((r) => (r.username === u ? { ...r, [k]: v } : r)));
  const add = (u) => { const x = userOf(u); if (x) setRows((rs) => [...rs, { username: u, name: x.full_name || '', post: x.position || '', phone: x.phone || '', email: x.email || '', sign_file: null, _new: true }]); };
  const save = async (r) => {
    setBusy(r.username);
    try { await api.put(`/quote-signers/${encodeURIComponent(r.username)}`, { name: r.name, post: r.post, phone: r.phone, email: r.email }); notify('Saved'); await load(); }
    catch (e) { notify(e.message, 'err'); }
    setBusy('');
  };
  const remove = async (r) => {
    if (!r._new && !confirm(`Remove the saved details and signature of ${r.name || r.username}?`)) return;
    try { if (!r._new) await api.del(`/quote-signers/${encodeURIComponent(r.username)}`); await load(); } catch (e) { notify(e.message, 'err'); }
  };
  const upload = async (u, file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { notify('Use a PNG, JPG or WEBP picture.', 'err'); return; }
    if (file.size > 2* 1024 * 1024) { notify('Signature is larger than 2 MB.', 'err'); return; }
    setBusy(u);
    try { await api.post(`/quote-signers/${encodeURIComponent(u)}/signature`, { data: await readFile(file) }); notify('Signature saved'); await load(); }
    catch (e) { notify(e.message, 'err'); }
    setBusy('');
  };
  const dropSig = async (u) => { try { await api.del(`/quote-signers/${encodeURIComponent(u)}/signature`); await load(); } catch (e) { notify(e.message, 'err'); } };

  return (
    <section className={inForm ? 'qt-signers' : 'card'} onKeyDown={(e) => { if (inForm && e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); }}>
      <header className="page-head">
        <h2>✍️ Staff signatories</h2>
        <span className="muted">Name, phone and signature printed on the quotations each person creates. Anything left blank comes from the user's profile.</span>
      </header>
      <table className="grid entry bill-grid">
        <thead><tr><th className="sn">SN</th><th>STAFF (LOGIN)</th><th>NAME</th><th>POST</th><th>PHONE</th><th>EMAIL</th><th style={{ width: 150 }}>SIGNATURE</th><th style={{ width: 90 }} /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="muted">No staff added yet — quotations use each user's profile and the template signature.</td></tr>}
          {rows.map((r, i) => (
            <tr key={r.username}>
              <td className="sn">{i + 1}</td>
              <td className="nowrap">{userOf(r.username)?.full_name || r.username}<br /><small className="muted">{r.username}</small></td>
              <td><input value={r.name || ''} disabled={!canEdit} onChange={(e) => patch(r.username, 'name', e.target.value)} /></td>
              <td><input value={r.post || ''} disabled={!canEdit} onChange={(e) => patch(r.username, 'post', e.target.value)} /></td>
              <td><input value={r.phone || ''} disabled={!canEdit} onChange={(e) => patch(r.username, 'phone', e.target.value)} /></td>
              <td><input data-nocap value={r.email || ''} disabled={!canEdit} onChange={(e) => patch(r.username, 'email', e.target.value)} /></td>
              <td>
                {r.sign_file && <Pic className="qt-page-thumb" src={`/quote-signers/${encodeURIComponent(r.username)}/file/${encodeURIComponent(r.sign_file)}`} />}
                {canEdit && (r._new ? <small className="muted">Save first</small> : <>
                  <button type="button" className="ghost btn-sm" tabIndex={-1} disabled={!!busy} onClick={() => { setSigFor(r.username); fileRef.current?.click(); }}>{r.sign_file ? 'Change' : 'Upload'}</button>
                  {r.sign_file && <button type="button" className="link del-x" tabIndex={-1} title="Remove signature" onClick={() => dropSig(r.username)}>✕</button>}
                </>)}
              </td>
              <td className="nowrap">{canEdit && <>
                <button type="button" className="ghost btn-sm" disabled={busy === r.username} onClick={() => save(r)}>Save</button>
                <button type="button" className="link del-x" tabIndex={-1} title="Remove" onClick={() => remove(r)}>✕</button></>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && free.length > 0 && (
        <p><select value="" onChange={(e) => e.target.value && add(e.target.value)}>
          <option value="">＋ Add a staff member…</option>
          {free.map((u) => <option key={u.username} value={u.username}>{u.full_name || u.username} ({u.username})</option>)}
        </select></p>
      )}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { upload(sigFor, e.target.files[0]); e.target.value = ''; }} />
    </section>
  );
}
