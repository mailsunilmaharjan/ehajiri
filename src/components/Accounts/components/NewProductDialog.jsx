import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { api } from '../lib/api';
import { useShortcuts } from '../lib/keys';
import { Kbd } from './inputs';

/** Quick "New Product" from a bill's product grid (F1 / Alt+N in the product box).
 *  Saves to Products and hands the new item back so the line can select it. */
export default function NewProductDialog({ typed = '', onSaved, onClose }) {
  const { notify } = useApp();
  const [units, setUnits] = useState([]);
  const [cats, setCats] = useState([]);
  const [f, setF] = useState({ name: typed, hs_code: '', unit_id: '', category_id: '', item_type: 'goods', purchase_price: '', mrp: '', vat_type: 'inclusive' });
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([api.get('/units'), api.get('/categories')]).then(([u, c]) => {
      setUnits(u); setCats(c);
      setF((x) => ({ ...x, unit_id: x.unit_id || String((u.find((y) => y.name === 'Pcs') || u[0] || {}).id || '') }));
    }).catch((e) => notify(e.message, 'err'));
    setTimeout(() => { nameRef.current?.focus(); nameRef.current?.select(); }, 30);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (busy) return;
    if (!f.name.trim()) { notify('Enter the product name.', 'err'); return; }
    if (!f.unit_id) { notify('Choose a unit.', 'err'); return; }
    setBusy(true);
    try {
      const it = await api.post('/items', { ...f, name: f.name.trim(), hs_code: f.hs_code.trim(), unit_id: Number(f.unit_id),
        category_id: f.category_id ? Number(f.category_id) : null, purchase_price: f.purchase_price || 0, mrp: f.mrp || 0 });
      notify(`Product ${it.name} added`);
      onSaved(it);
    } catch (e) { notify(e.message, 'err'); setBusy(false); }
  };
  useShortcuts({ save, close: onClose }, true);

  return (
    <div className="imp-ov imp-ov2" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="imp-win imp-win-sm" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT' && !e.shiftKey) { e.preventDefault(); save(); } }}>
        <div className="imp-win-h"><div className="imp-win-ic">📦</div>
          <div className="imp-win-t"><h2>New Product</h2><p>Added to Products and selected on this line</p></div>
          <button type="button" className="imp-x" onClick={onClose}>✕</button></div>
        <div className="imp-win-b">
          <div className="doc-form" style={{ margin: 0, gridTemplateColumns: '1fr 1fr' }}>
            <label style={{ gridColumn: '1 / -1' }}>Product Name *<input ref={nameRef} data-nocap value={f.name} onChange={set('name')} /></label>
            <label>Type<select value={f.item_type} onChange={set('item_type')}><option value="goods">Goods</option><option value="service">Service</option></select></label>
            <label>HS Code<input data-nocap value={f.hs_code} onChange={set('hs_code')} /></label>
            <label>Unit *<select value={f.unit_id} onChange={set('unit_id')}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <label>Category<select value={f.category_id} onChange={set('category_id')}><option value="">— none —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.parent_name ? `${c.parent_name} › ` : ''}{c.name}</option>)}</select></label>
            <label>Purchase Rate<input type="number" min="0" step="any" value={f.purchase_price} onChange={set('purchase_price')} /></label>
            <label>MRP (selling)<input type="number" min="0" step="any" value={f.mrp} onChange={set('mrp')} /></label>
            <label style={{ gridColumn: '1 / -1' }}>VAT<select value={f.vat_type} onChange={set('vat_type')}><option value="inclusive">MRP includes VAT</option><option value="exclusive">MRP excludes VAT</option></select></label>
          </div>
        </div>
        <div className="imp-win-f"><span className="muted small">More details (dealer price, serials, photo…) can be added later in Products.</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel <Kbd>Esc</Kbd></button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>💾 Save Product</button>
          </div></div>
      </div>
    </div>
  );
}
