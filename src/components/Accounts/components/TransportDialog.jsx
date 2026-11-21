import { useRef, useState } from 'react';
import { useApp } from '../context';
import { api } from '../lib/api';
import { useShortcuts } from '../lib/keys';
import { shortDocNo } from '../lib/docs';
import { Kbd } from './inputs';

/** "Via Transport" on a purchase / sales bill: transporter, its bill (bilty) no. and a scan of the transport bill. */
export default function TransportDialog({ doc, onClose, onSaved }) {
  const { notify } = useApp();
  const fileRef = useRef(null);
  // a new entry starts with the party's recommended transport
  const [name, setName] = useState(doc.transport_name || (!doc.transport_bill_no ? doc.party_transport_name || '' : ''));
  const rec = doc.party_transport_name ? [doc.party_transport_name, doc.party_transport_phone, doc.party_transport_address].filter(Boolean).join(' · ') : '';
  const [billNo, setBillNo] = useState(doc.transport_bill_no || '');
  const [file, setFile] = useState(null);          // { data, name } newly picked
  const [removeOld, setRemoveOld] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasOld = !!doc.transport_file && !removeOld;

  const pick = (f) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { notify('Transport bill is larger than 5 MB.', 'err'); return; }
    const rd = new FileReader();
    rd.onload = () => setFile({ data: rd.result, name: f.name });
    rd.readAsDataURL(f);
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api.post(`/docs/${doc.id}/transport`, {
        transport_name: name, transport_bill_no: billNo, file_data: file?.data || null, remove_file: removeOld && !file,
      });
      notify(`Transport saved for ${shortDocNo(doc.doc_no)}`);
      onSaved(d);
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };
  useShortcuts({ save, close: onClose });

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card form two transport-dlg">
        <h2>🚚 Via Transport — {shortDocNo(doc.doc_no)}</h2>
        <label>Party Name<input value={doc.party_name || ''} readOnly className="ro-in" tabIndex={-1} /></label>
        <label>Address<input value={doc.party_address || ''} readOnly className="ro-in" tabIndex={-1} placeholder="—" /></label>
        <label>Transport Name<input autoFocus value={name} placeholder="e.g. Sajha Yatayat Cargo" onChange={(e) => setName(e.target.value)} />
          {rec && <small className="muted">Recommended: {rec}{name !== doc.party_transport_name && <> · <a onClick={() => setName(doc.party_transport_name)}>use it</a></>}</small>}</label>
        <label>Transport Bill No.<input data-nocap value={billNo} placeholder="Bilty / consignment no." onChange={(e) => setBillNo(e.target.value)} /></label>
        <label className="full">Upload Bill
          <span className="proof-box">
            <button type="button" className="ghost proof-btn" onClick={() => fileRef.current?.click()}>📎 {file || hasOld ? 'Change' : 'Upload'}</button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden
              onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
            {file ? <span className="proof-name" title={file.name}>{file.name}</span>
              : hasOld ? <a className="proof-name" href={`/api/accounts/docs/${doc.id}/transport-file`} target="_blank" rel="noopener">View saved bill</a>
                : <span className="muted small">Photo or PDF of the transport bill, up to 5 MB</span>}
            {(file || hasOld) && <button type="button" className="link del-x" title="Remove" onClick={() => { setFile(null); setRemoveOld(!!doc.transport_file); }}>✕</button>}
          </span>
        </label>
        <div className="actions full">
          <button type="button" className="ghost" onClick={onClose}>Cancel <Kbd>Esc</Kbd></button>
          <span className="spacer" />
          <button type="button" data-save disabled={busy} onClick={save}>Save <Kbd>Ctrl+S</Kbd></button>
        </div>
      </div>
    </div>
  );
}
