import { Pic } from './AuthImg';
import { useRef } from 'react';
import { Link } from '../lib/router';
import { useApp } from '../context';

const VALIDITY = ['7 days from date of issue', '15 days from date of issue', '30 days from date of issue', '2 weeks from date of issue'];

/** New-quotation defaults from a template (validity, terms & conditions, notes). */
export const quoteDefaults = (t) => ({
  qt_subject: '', qt_attn: '', qt_template_id: t?.id || null, qt_validity: t?.validity || '',
  qt_terms: (t?.terms_list || []).map((r) => [r[0] || '', r[1] || '']), qt_notes: t?.notes || '',
  qt_client_logo: null, qt_client_logo_data: null, qt_client_logo_name: '', qt_terms_touched: false,
});

/** Fields of a quotation being edited, from the saved document. */
export const quoteFromDoc = (d) => ({
  qt_subject: d.qt_subject || '', qt_attn: d.qt_attn || '', qt_template_id: d.qt_template_id || null,
  qt_validity: d.qt_validity || '', qt_terms: (d.qt_terms_list || []).map((r) => [r[0] || '', r[1] || '']),
  qt_notes: d.qt_notes || '', qt_client_logo: d.qt_client_logo || null, qt_client_logo_data: null, qt_client_logo_name: '',
  qt_terms_touched: true,
});

/** Subject, Attn, validity, template and the client's logo — shown instead of the payment row. */
export function QuoteTop({ f, setF, templates, docId, party }) {
  const { notify } = useApp();
  const logoRef = useRef(null);
  const pickTemplate = (id) => setF((x) => {
    const t = templates.find((y) => y.id === id);
    // terms not changed by hand yet: take the new template's validity, terms and notes
    return { ...x, qt_template_id: id, ...(t && !x.qt_terms_touched
      ? { qt_validity: t.validity || x.qt_validity, qt_terms: t.terms_list.map((r) => [...r]), qt_notes: t.notes || '' } : {}) };
  });
  const pickLogo = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { notify('Use a PNG, JPG or WEBP picture for the logo.', 'err'); return; }
    if (file.size > 3 * 1024 * 1024) { notify('Logo is larger than 3 MB.', 'err'); return; }
    const rd = new FileReader();
    rd.onload = () => setF((x) => ({ ...x, qt_client_logo_data: rd.result, qt_client_logo_name: file.name }));
    rd.readAsDataURL(file);
  };
  const logoSrc = f.qt_client_logo_data || (f.qt_client_logo && docId ? `/docs/${docId}/client-logo` : null);
  const contacts = String(party?.contact_names || party?.contact_person || '').split('\n').map((s) => s.trim()).filter(Boolean);

  return (
    <>
      <div className="acc-step acc-step-out"><i>2</i>Quotation details</div>
      <div className="doc-form qt-top">
        <label className="qt-subject">Subject / Title *
          <input value={f.qt_subject} maxLength={160} placeholder="e.g. Attendance Device with Software"
            onChange={(e) => setF({ ...f, qt_subject: e.target.value })} />
        </label>
        <label>Attn. (Contact Person)
          <input list="qt-attn" value={f.qt_attn} maxLength={120} placeholder="e.g. Anita Baidhya"
            onChange={(e) => setF({ ...f, qt_attn: e.target.value })} />
          <datalist id="qt-attn">{contacts.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label>Validity
          <input list="qt-valid" value={f.qt_validity} maxLength={160} placeholder="15 days from date of issue"
            onChange={(e) => setF({ ...f, qt_validity: e.target.value })} />
          <datalist id="qt-valid">{VALIDITY.map((v) => <option key={v} value={v} />)}</datalist>
        </label>
        <label>Template
          <span className="inline">
            <select value={f.qt_template_id || ''} onChange={(e) => pickTemplate(Number(e.target.value))}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>)}
            </select>
            <Link className="btn ghost add-btn" tabIndex={-1} to="/quote-templates" target="_blank" title="Logo, cover photo, profile pages, signature…">🎨</Link>
          </span>
        </label>
        <label>Client Logo
          <span className="proof-box">
            {logoSrc && <Pic className="qt-logo-thumb" src={logoSrc} />}
            <button type="button" className="ghost proof-btn" tabIndex={-1} onClick={() => logoRef.current?.click()}>
              🖼 {logoSrc ? 'Change' : 'Upload'}</button>
            <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange={(e) => { pickLogo(e.target.files[0]); e.target.value = ''; }} />
            {!logoSrc && <span className="muted small">optional · on the cover</span>}
            {logoSrc && <button type="button" className="link del-x" tabIndex={-1} title="Remove"
              onClick={() => setF({ ...f, qt_client_logo: null, qt_client_logo_data: null, qt_client_logo_name: '' })}>✕</button>}
          </span>
        </label>
      </div>
    </>
  );
}

/** Terms & Conditions (Term | Details) typed for this quotation, plus the notes line. */
export function QuoteTerms({ f, setF, templates }) {
  const rows = f.qt_terms.length ? f.qt_terms : [['', '']];
  const put = (terms) => setF((x) => ({ ...x, qt_terms: terms, qt_terms_touched: true }));
  const setCell = (i, k, v) => {
    const next = rows.map((r, j) => (j === i ? (k === 0 ? [v, r[1]] : [r[0], v]) : r));
    if (i === next.length - 1 && v.trim()) next.push(['', '']);   // a fresh row appears as you type in the last one
    put(next);
  };
  const tpl = templates.find((t) => t.id === f.qt_template_id);
  return (
    <div className="qt-terms-wrap">
      <div className="pf-contacts-head">
        <span className="acc-step"><i>4</i>Terms &amp; conditions <span className="muted small" style={{ fontWeight: 400 }}>— printed on the quotation's terms page</span></span>
        <span className="spacer" />
        {tpl && <button type="button" className="ghost btn-sm" tabIndex={-1} title={`Replace with the terms of “${tpl.name}”`}
          onClick={() => { if (confirm(`Replace these terms with the “${tpl.name}” template terms?`)) setF((x) => ({ ...x, qt_terms: tpl.terms_list.map((r) => [...r]), qt_notes: tpl.notes || x.qt_notes, qt_terms_touched: false })); }}>
          ↺ Template terms</button>}
        <button type="button" className="ghost add-line" tabIndex={-1} onClick={() => put([...rows, ['', '']])}>＋ Add Term</button>
      </div>
      <table className="grid entry bill-grid qt-terms">
        <thead><tr><th className="sn">SN</th><th style={{ width: '28%' }}>TERM</th><th>DETAILS</th><th style={{ width: 30 }} /></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>
            <td className="sn">{i + 1}</td>
            <td><input value={r[0]} maxLength={80} placeholder="e.g. Warranty" onChange={(e) => setCell(i, 0, e.target.value)} /></td>
            <td><input value={r[1]} maxLength={600} placeholder="e.g. One year warranty" onChange={(e) => setCell(i, 1, e.target.value)} /></td>
            <td>{rows.length > 1 && <button type="button" className="link del-x" tabIndex={-1} title="Remove"
              onClick={() => put(rows.filter((_, j) => j !== i))}>✕</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      <label className="qt-notes">Notes (bottom of the terms page)
        <textarea rows={2} maxLength={1500} value={f.qt_notes} placeholder="e.g. Electric wire and CAT 6 cables are not included…"
          onChange={(e) => setF({ ...f, qt_notes: e.target.value, qt_terms_touched: true })} />
      </label>
    </div>
  );
}
