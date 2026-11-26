import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { Kbd } from './inputs';
import { copyPhoto, openProductChat, productPhoto, productShareText } from '../lib/productShare';

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Share a product on WhatsApp with its photo. A phone hands photo + message to WhatsApp in one go; a computer
 *  browser can't attach a file to a chat link, so the photo is copied for the user to paste (Ctrl+V). */
export default function ProductShareDialog({ item, onClose }) {
  const { notify, company } = useApp();
  const [photo, setPhoto] = useState(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(!!item.has_image);
  const text = productShareText(item, company);

  useEffect(() => {
    let dead = false;
    let made = '';
    productPhoto(item)
      .then((f) => {
        if (dead || !f) return;
        made = URL.createObjectURL(f); setPhoto(f); setUrl(made);
      })
      .catch(() => {})
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [item]);

  const canAttach = !!photo && !!navigator.canShare?.({ files: [photo] });
  const phone = isPhone() && canAttach;
  const attach = async () => {
    try { await navigator.share({ files: [photo], text }); onClose(); }
    catch (e) { if (e.name !== 'AbortError') notify('Could not open the share window.', 'err'); }
  };
  const open = async () => {
    if (photo) {
      try { await copyPhoto(photo); notify('Photo copied — in the WhatsApp chat press Ctrl+V, then Send.'); }
      catch {
        const a = document.createElement('a');
        a.href = url; a.download = photo.name; a.click();
        notify('Photo downloaded — attach it in the WhatsApp chat.');
      }
    }
    openProductChat(item, company);
    onClose();
  };

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card form narrow">
        <h2 className="acc-head"><span className="acc-head-ic">💬</span><span className="acc-head-txt">Share on WhatsApp<small>{item.name}</small></span></h2>
        <div className="ps-body">
          {url && <img className="ps-photo" src={url} alt={item.name} />}
          {loading && <p className="muted small">Loading photo…</p>}
          {!loading && !photo && <p className="muted small">This product has no photo — only the message will be sent.</p>}
          <pre className="ps-text">{text}</pre>
          {photo && !phone && <p className="ps-hint">1. Click <b>Open WhatsApp</b> (the photo is copied). 2. Pick the chat. 3. Press <b>Ctrl+V</b> to add the photo, then Send.</p>}
        </div>
        <div className="actions"><span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Close <Kbd>Esc</Kbd></button>
          {canAttach && !phone && <button type="button" className="ghost" onClick={attach} title="Windows share window — choose the WhatsApp app">📎 Share via app…</button>}
          <button type="button" autoFocus disabled={loading} onClick={phone ? attach : open}>{phone ? '💬 Share photo & details' : '💬 Open WhatsApp'}</button>
        </div>
      </div>
    </div>
  );
}
