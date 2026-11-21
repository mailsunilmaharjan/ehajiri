import AuthImg from './AuthImg';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { api, fmtStamp } from '../lib/api';
import { addToCart } from '../lib/cart';
import { focusNext } from '../lib/keys';

const rs = (n) => `Rs.${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Right-side product detail: photo, MRP / dealer / partner rates, VAT type, website, cart, features, specifications. */
export default function ProductPanel({ item, onEdit, onClose, onChanged }) {
  const { notify, canEdit } = useApp();
  const [qty, setQty] = useState(1);
  const [imgV, setImgV] = useState(0);
  const [broken, setBroken] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { setQty(1); setBroken(false); }, [item.id, imgV]);

  const upload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { notify('Image is larger than 3 MB.', 'err'); return; }
    const data_url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    try { await api.post(`/items/${item.id}/image`, { data_url }); setImgV((v) => v + 1); notify('Photo saved'); onChanged?.(); }
    catch (err) { notify(err.message, 'err'); }
  };
  const add = () => { addToCart(item, Number(qty) || 1); notify(`${item.name} × ${qty} added to cart`); };
  const isService = item.item_type === 'service';

  return (
    <aside className="pp">
      <div className="pp-head">
        <span className="pp-ico">📦</span><b>{item.name}</b>
        <span className="spacer" />
        {canEdit && <button className="btn-sm" onClick={onEdit}>✏️ Edit</button>}
        <button className="link pp-x" onClick={onClose} title="Close (Esc)">✕</button>
      </div>
      <div className="pp-body">
        <div className="pp-top">
          <div className="pp-img" onClick={() => canEdit && fileRef.current?.click()} title={canEdit ? 'Click to upload a photo' : ''}>
            {(item.has_image || imgV) && !broken
              ? <AuthImg src={`/items/${item.id}/image?v=${imgV}${item.updated_at || ''}`} alt={item.name} onError={() => setBroken(true)} />
              : <span className="muted small">{canEdit ? '📷 Click to add a photo' : 'No photo'}</span>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload} />
          </div>
          <div className="pp-rates">
            <div className="rc mrp"><span>MRP</span><b>{rs(item.mrp)}</b></div>
            <div className="rc dealer"><span>DEALER RATE</span><b>{rs(item.dealer_price)}</b>{item.dealer_pct > 0 && <small>−{item.dealer_pct}%</small>}</div>
            <div className="rc partner"><span>PARTNER RATE</span><b>{rs(item.partner_price)}</b>{item.partner_pct > 0 && <small>−{item.partner_pct}%</small>}</div>
            <div className="rc vat"><span>VAT TYPE</span><i>{item.vat_applicable ? (item.vat_type === 'exclusive' ? 'Exclusive' : 'Inclusive') : 'VAT exempt'}</i></div>
          </div>
        </div>
        <div className="pp-meta">
          {item.website
            ? <a className="pp-web" href={item.website} target="_blank" rel="noreferrer" title={item.website}>🌐 View in Website</a>
            : <span className="pp-web off">🌐 No website</span>}
          <span className="pp-upd">Rate last updated: <b>{item.rate_updated_at ? fmtStamp(item.rate_updated_at).split(',')[0] : '—'}</b></span>
        </div>
        <div className="pp-cart">
          <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); focusNext(e.currentTarget); } }} />
          <button onClick={add}>🛒 Add to Cart</button>
        </div>
        <div className="pp-facts">
          <span>Code <b>{item.code}</b></span>
          {!isService && <span>Stock <b className={item.stock > 0 ? 'pos' : 'neg'}>{item.stock} {item.unit}</b></span>}
          {item.hs_code && <span>HS <b>{item.hs_code}</b></span>}
          {item.warranty_months > 0 && <span>Warranty <b>{item.warranty_months} m</b></span>}
          {isService && item.service_months > 0 && <span>Period <b>{item.service_months} m</b></span>}
          {!!item.track_serial && <span><b>S/N tracked</b></span>}
        </div>
        {item.features && (
          <section><h4>FEATURES / DETAILS</h4>
            <div className="pp-features">{item.features.split('\n').filter((l) => l.trim()).map((l, i) => (i === 0 ? <b key={i}>{l}</b> : <div key={i}>{l}</div>))}</div>
          </section>
        )}
        {item.specs?.length > 0 && (
          <section><h4>SPECIFICATIONS</h4>
            <table className="pp-specs"><tbody>
              {item.specs.map(([k, v], i) => <tr key={i}><td>{k}</td><td>{v}</td></tr>)}
            </tbody></table>
          </section>
        )}
        {!item.features && !item.specs?.length && <p className="muted small pp-empty">No features or specifications yet — click Edit to add them.</p>}
      </div>
    </aside>
  );
}
