import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context';
import { Amount, Kbd, LastSaved } from '../components/inputs';
import SerialDialog from '../components/SerialDialog';
import ProductPanel from '../components/ProductPanel';
import ContextMenu from '../components/ContextMenu';
import { useGrid } from '../components/DataGrid';
import { api, fmtMoney } from '../lib/api';
import { addToCart } from '../lib/cart';
import { useShortcuts } from '../lib/keys';
import { shareProductEmail, shareProductWhatsApp } from '../lib/productShare';

const blank = (units) => ({
  name: '', code: '', name_np: '', item_type: 'goods', category_id: '', unit_id: units.find((u) => u.name === 'Pcs')?.id || units[0]?.id || '',
  barcode: '', hs_code: '', vat_applicable: true, vat_type: 'inclusive', purchase_price: '', mrp: '', dealer_price: '', partner_price: '',
  reorder_level: '', opening_qty: '', opening_rate: '', service_months: 12, warranty_months: '', track_serial: false,
  opening_serials: [], active: true, dealer_mode: 'pct', dealer_pct: '', partner_mode: 'pct', partner_pct: '',
  website: '', features: '', specs: [['', '']],
});
const rs = (n) => (n ? `Rs. ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—');
const TABS = [['detail', 'Products Detail'], ['category', 'Product Category'], ['sub', 'Sub Category'], ['rates', 'Dealer Rate Setting']];

export default function Products() {
  const { notify, reload, company, canEdit } = useApp();
  const [tab, setTab] = useState('detail');
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [units, setUnits] = useState([]);
  const [cat, setCat] = useState('');
  const [sub, setSub] = useState('');
  const [q, setQ] = useState('');
  const [qc, setQc] = useState('');               // Product Category search
  const [qs, setQs] = useState('');               // Sub Category search
  const [sel, setSel] = useState(null);            // product shown in the right panel
  const [edit, setEdit] = useState(null);
  const [catEdit, setCatEdit] = useState(null);
  const [serialDlg, setSerialDlg] = useState(false);
  const [menu, setMenu] = useState(null);          // right-click menu on a product row

  const load = async () => {
    const [i, c, u] = await Promise.all([api.get('/items', { include_inactive: true }), api.get('/categories'), api.get('/units')]);
    setItems(i); setCats(c); setUnits(u);
    setSel((s) => (s ? i.find((x) => x.id === s.id) || null : s));
  };
  useEffect(() => { load(); }, []);

  const mains = cats.filter((c) => !c.parent_id);
  const subsOf = (id) => cats.filter((c) => c.parent_id === Number(id));
  const catName = (i) => (i.parent_category ? i.parent_category : i.category);
  const subName = (i) => (i.parent_category ? i.category : null);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (!cat || i.category_id === Number(cat) || i.parent_category_id === Number(cat))
      && (!sub || i.category_id === Number(sub))
      && (!s || `${i.name} ${i.code} ${i.barcode || ''} ${i.hs_code || ''}`.toLowerCase().includes(s)));
  }, [items, q, cat, sub]);

  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const num = (v) => Number(v || 0);
  const isService = edit?.item_type === 'service';

  const openEdit = async (i) => {
    const full = await api.get(`/items/${i.id}`);
    setEdit({ ...full, category_id: full.category_id || '', vat_applicable: !!full.vat_applicable, active: !!full.active,
      track_serial: !!full.track_serial, warranty_months: full.warranty_months || '', service_months: full.service_months || '',
      dealer_mode: full.dealer_pct > 0 ? 'pct' : 'amt', partner_mode: full.partner_pct > 0 ? 'pct' : 'amt',
      dealer_pct: full.dealer_pct || '', partner_pct: full.partner_pct || '', website: full.website || '', features: full.features || '',
      specs: full.specs?.length ? full.specs : [['', '']] });
  };

  const save = async () => {
    if (!edit || !canEdit) return;
    const body = { ...edit, category_id: edit.category_id ? Number(edit.category_id) : null, unit_id: Number(edit.unit_id),
      purchase_price: num(edit.purchase_price), mrp: num(edit.mrp), dealer_price: num(edit.dealer_price), partner_price: num(edit.partner_price),
      reorder_level: num(edit.reorder_level), opening_qty: num(edit.opening_qty), opening_rate: num(edit.opening_rate),
      service_months: num(edit.service_months), warranty_months: num(edit.warranty_months),
      dealer_pct: edit.dealer_mode === 'pct' ? num(edit.dealer_pct) : 0, partner_pct: edit.partner_mode === 'pct' ? num(edit.partner_pct) : 0,
      specs: edit.specs.filter(([k]) => k.trim()) };
    try {
      const r = edit.id ? await api.put(`/items/${edit.id}`, body) : await api.post('/items', body);
      setEdit(null); await load(); await reload(); notify('Product saved');
      if (!edit.id) setSel({ ...r });
    } catch (err) { notify(err.message, 'err'); }
  };
  const remove = async () => {
    if (!edit?.id || !confirm(`Delete product "${edit.name}"?\nOnly possible if it was never used on a bill.`)) return;
    try { await api.del(`/items/${edit.id}`); setEdit(null); setSel(null); await load(); await reload(); notify('Product deleted'); }
    catch (err) { notify(err.message, 'err'); }
  };
  useShortcuts({ save, close: () => setEdit(null), del: remove }, !!edit && !serialDlg);
  useShortcuts({ close: () => setSel(null) }, !!sel && !edit);

  const saveCat = async () => {
    try {
      if (catEdit.id) await api.put(`/categories/${catEdit.id}`, catEdit); else await api.post('/categories', { ...catEdit, parent_id: catEdit.parent_id ? Number(catEdit.parent_id) : null });
      setCatEdit(null); await load(); notify('Saved');
    } catch (err) { notify(err.message, 'err'); }
  };
  const delCat = async (c) => {
    if (!confirm(`Delete "${c.name}"?`)) return;
    try { await api.del(`/categories/${c.id}`); setCatEdit(null); await load(); notify('Deleted'); }
    catch (err) { notify(err.message, 'err'); }
  };
  useShortcuts({ save: saveCat, close: () => setCatEdit(null) }, !!catEdit);

  const addUnit = async () => {
    const name = prompt('New unit name (e.g. Bag, Pair):');
    if (!name) return;
    try { const u = await api.post('/units', { name }); await load(); setEdit((x) => ({ ...x, unit_id: u.id })); }
    catch (err) { notify(err.message, 'err'); }
  };
  const exVat = (mrp) => (edit?.vat_applicable && company.vat_registered ? num(mrp) / (1 + company.vat_rate / 100) : num(mrp));
  const margin = (price) => {
    const cost = num(edit?.purchase_price);
    return cost && price ? `${(((price - cost) / cost) * 100).toFixed(1)}%` : '';
  };
  const rowMenu = (e, i) => {
    e.preventDefault(); g.setCur(i.id);
    setMenu({ x: e.clientX, y: e.clientY, title: i.name, items: [
      { label: 'Share on WhatsApp', icon: '💬', onClick: () => shareProductWhatsApp(i, company) },
      { label: 'Share by Email', icon: '✉️', onClick: () => shareProductEmail(i, company) },
      'divider',
      { label: 'View details', icon: '👁', onClick: () => setSel(i) },
      canEdit && { label: 'Edit', icon: '✏️', onClick: () => openEdit(i) },
      { label: 'Add to Cart', icon: '🛒', onClick: () => { addToCart(i, 1); notify(`${i.name} added to cart`); } },
    ].filter(Boolean) });
  };
  // standard grids: current row, ticks, ↑ / ↓ / Enter. Products: Enter shows the side panel, double-click edits.
  const g = useGrid({ rows: shown, onOpen: (i) => setSel(i) });
  const checked = g.sel; const setChecked = g.setSel;
  // while the side panel is open it follows the arrow keys
  useEffect(() => { if (sel && g.curRow && g.curRow.id !== sel.id) setSel(g.curRow); }, [g.cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const catRows = useMemo(() => {
    const t = qc.trim().toLowerCase();
    return mains.filter((c) => !t || `${c.name} ${c.hs_code || ''} ${c.effective_date || ''}`.toLowerCase().includes(t));
  }, [mains, qc]);
  const subRows = useMemo(() => {
    const t = qs.trim().toLowerCase();
    return cats.filter((c) => c.parent_id && (!cat || c.parent_id === Number(cat))
      && (!t || `${c.name} ${cats.find((p) => p.id === c.parent_id)?.name || ''}`.toLowerCase().includes(t)));
  }, [cats, cat, qs]);
  const gc = useGrid({ rows: catRows, onOpen: (c) => canEdit && setCatEdit({ ...c }) });
  const gs = useGrid({ rows: subRows, onOpen: (c) => canEdit && setCatEdit({ ...c }) });

  return (
    <div className={`products-page ${sel && tab === 'detail' ? 'with-panel' : ''}`}>
      <div className="tabs">
        {TABS.map(([k, l]) => <button key={k} className={`tab-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="tab-panel">

      {tab === 'detail' && (
        <div className="pp-wrap">
          <div className="pp-main">
            <header className="page-head">
              <h1>📋 Products</h1>
              <span className="spacer" />
              <select value={cat} onChange={(e) => { setCat(e.target.value); setSub(''); }}>
                <option value="">🔎 All Categories</option>{mains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={sub} onChange={(e) => setSub(e.target.value)}>
                <option value="">All Sub Categories</option>
                {(cat ? subsOf(cat) : cats.filter((c) => c.parent_id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {(cat || sub || q) && <button className="ghost" onClick={() => { setCat(''); setSub(''); setQ(''); }}>✕ Clear</button>}
              <button className="edit-only" data-new title="F1 / Alt+N" onClick={() => setEdit(blank(units))}>＋ Add Product <kbd className="kbd">F1</kbd></button>
            </header>
            <section className="card dg">
              <div className="dg-bar">
                <span className="muted">{shown.length ? `1–${shown.length}` : 0} / Total {items.length}</span>
                {checked.size > 0 && (
                  <span className="sel-bar">{checked.size} selected
                    <button className="btn-sm" onClick={() => { items.filter((i) => checked.has(i.id)).forEach((i) => addToCart(i, 1)); notify(`${checked.size} added to cart`); setChecked(new Set()); }}>🛒 Add to cart</button>
                    <button className="ghost btn-sm" onClick={() => setChecked(new Set())}>Clear</button></span>
                )}
                <span className="spacer" />
                <input className="dg-search" data-find title="Ctrl+F" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} onFocus={(e) => e.target.select()} />
              </div>
              <div className="dg-scroll">
                <table ref={g.gridRef} className="grid prod-grid dg-soft">
                  <thead><tr>
                    {g.tickTh}
                    <th className="sn">SN</th><th>Product Name</th><th>Category</th><th>Sub Category</th><th>HS Code</th><th>Stock</th>
                    <th className="num">MRP</th><th className="num">Dealer Rate</th><th className="num">Partner Rate</th><th>VAT Type</th><th>Website</th>
                  </tr></thead>
                  <tbody>
                    {shown.length === 0 && <tr><td colSpan={12} className="muted">No products.{canEdit && <> Press <kbd className="kbd">F1</kbd> to add a new product.</>}</td></tr>}
                    {shown.map((i, idx) => (
                      <tr key={i.id} {...g.rowProps(i, i.active ? '' : 'inactive-row')}
                        onClick={() => { g.rowProps(i).onClick(); setSel(i); }} onDoubleClick={() => canEdit && openEdit(i)} onContextMenu={(e) => rowMenu(e, i)}>
                        {g.tickTd(i)}
                        <td className="sn">{idx + 1}</td>
                        <td className="pname">{i.name}{i.track_serial ? <span className="tag">S/N</span> : null}{i.item_type === 'service' && <span className="tag st-open">service</span>}</td>
                        <td>{catName(i) || '—'}</td>
                        <td>{subName(i) || <span className="muted">—</span>}</td>
                        <td className="nowrap">{i.hs_code || <span className="muted">—</span>}</td>
                        <td>{i.item_type === 'service' ? <span className="muted">—</span> : i.stock > 0 ? <span title={`${i.stock} ${i.unit}`}>Yes</span> : <span className="stock-no">No</span>}</td>
                        <td className="num b">{rs(i.mrp)}</td>
                        <td className="num dealer">{rs(i.dealer_price)}</td>
                        <td className="num partner">{rs(i.partner_price)}</td>
                        <td className="small">{!i.vat_applicable ? 'Exempt' : i.vat_type === 'exclusive' ? 'Exclusive' : 'Inclusive'}</td>
                        <td>{i.website ? <a href={i.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>🌐 View</a> : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          {sel && <ProductPanel item={sel} onClose={() => setSel(null)} onEdit={() => openEdit(sel)} onChanged={load} />}
        </div>
      )}

      {tab === 'category' && (
        <>
          <header className="page-head"><h1>🏷️ Product Category</h1><span className="spacer" />
            <button className="edit-only" onClick={() => setCatEdit({ name: '', parent_id: null })}>＋ Add Category</button></header>
          <section className="card dg">
            <div className="dg-bar">
              <span className="muted">{catRows.length ? `1–${catRows.length}` : 0} / Total {mains.length}</span>
              <span className="spacer" />
              <input className="dg-search" data-find title="Ctrl+F" placeholder="Search..." value={qc} onChange={(e) => setQc(e.target.value)} onFocus={(e) => e.target.select()} />
            </div>
            <div className="dg-scroll">
            <table ref={gc.gridRef} className="grid dg-soft"><thead><tr>{gc.tickTh}<th className="sn">SN</th><th>Category</th><th>HS Code</th><th>Effective Date</th><th className="num">Sub categories</th><th className="num">Products</th><th className="edit-only">Action</th></tr></thead>
              <tbody>{catRows.map((c, i) => (
                <tr key={c.id} {...gc.rowProps(c)}>{gc.tickTd(c)}<td className="sn">{i + 1}</td><td className="pname">{c.name}</td><td className="nowrap">{c.hs_code || <span className="muted">—</span>}</td><td className="nowrap">{c.effective_date || <span className="muted">—</span>}</td><td className="num">{subsOf(c.id).length}</td>
                  <td className="num">{items.filter((x) => x.category_id === c.id || x.parent_category_id === c.id).length}</td>
                  <td className="edit-only"><button className="link" onClick={() => setCatEdit({ ...c })}>Rename</button> <button className="link" onClick={() => delCat(c)}>Delete</button></td></tr>
              ))}</tbody></table>
            </div>
          </section>
        </>
      )}

      {tab === 'sub' && (
        <>
          <header className="page-head"><h1>📁 Sub Category</h1><span className="spacer" />
            <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All Categories</option>{mains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className="edit-only" disabled={!mains.length} onClick={() => setCatEdit({ name: '', parent_id: cat || mains[0]?.id })}>＋ Add Sub Category</button></header>
          <section className="card dg">
            <div className="dg-bar">
              <span className="muted">{subRows.length ? `1–${subRows.length}` : 0} / Total {cats.filter((c) => c.parent_id).length}</span>
              <span className="spacer" />
              <input className="dg-search" data-find title="Ctrl+F" placeholder="Search..." value={qs} onChange={(e) => setQs(e.target.value)} onFocus={(e) => e.target.select()} />
            </div>
            <div className="dg-scroll">
            <table ref={gs.gridRef} className="grid dg-soft"><thead><tr>{gs.tickTh}<th className="sn">SN</th><th>Sub Category</th><th>Category</th><th className="num">Products</th><th className="edit-only">Action</th></tr></thead>
              <tbody>{subRows.map((c, i) => (
                <tr key={c.id} {...gs.rowProps(c)}>{gs.tickTd(c)}<td className="sn">{i + 1}</td><td className="pname">{c.name}</td><td>{cats.find((p) => p.id === c.parent_id)?.name}</td>
                  <td className="num">{c.items}</td>
                  <td className="edit-only"><button className="link" onClick={() => setCatEdit({ ...c })}>Rename</button> <button className="link" onClick={() => delCat(c)}>Delete</button></td></tr>
              ))}</tbody></table>
            </div>
          </section>
        </>
      )}

      {tab === 'rates' && <RateSetting mains={mains} items={items} onDone={load} />}
      </div>

      {edit && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setEdit(null)}>
          <form className="card party-full prod-full" onSubmit={(e) => { e.preventDefault(); save(); }} autoComplete="off">
            <div className="pf-title">
              <span className="acc-head-ic">{edit.id ? '✏️' : '＋'}</span>
              <span className="acc-head-txt"><h2>{edit.id ? 'Edit Product' : 'New Product'}</h2><small>{edit.id ? 'Update product details, rates and stock' : 'Add a product with rates, warranty and specifications'}</small></span>
              {edit.id && <span className="dt-no">{edit.code}</span>}
              {edit.id && !edit.active && <span className="tag">inactive</span>}
            </div>

            <div className="doc-form pf-top">
              <div className="acc-step"><i>1</i>Product details</div>
              <label className="pc4">Product Name *<input autoFocus name="name" autoComplete="nope" value={edit.name} onChange={set('name')} required placeholder="e.g. ZKTeco K40 Pro Attendance Device" /></label>
              <label className="pc2">Type
                <select value={edit.item_type} onChange={set('item_type')}>
                  <option value="goods">Goods (stock)</option><option value="service">Service (no stock)</option>
                </select>
              </label>
              <label className="pc2">Code<input data-nocap autoComplete="nope" value={edit.code} onChange={set('code')} placeholder="auto" /></label>
              <label className="pc2">Category
                <select value={mains.some((c) => c.id === Number(edit.category_id)) ? edit.category_id : cats.find((c) => c.id === Number(edit.category_id))?.parent_id || ''}
                  onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
                  <option value="">— none —</option>{mains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="pc2">Sub Category
                {(() => {
                  const parent = mains.some((c) => c.id === Number(edit.category_id)) ? Number(edit.category_id) : cats.find((c) => c.id === Number(edit.category_id))?.parent_id;
                  return (
                    <select value={cats.find((c) => c.id === Number(edit.category_id))?.parent_id ? edit.category_id : ''} disabled={!parent}
                      onChange={(e) => setEdit({ ...edit, category_id: e.target.value || parent })}>
                      <option value="">— none —</option>{subsOf(parent || 0).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  );
                })()}
              </label>
              <label className="pc2">Ranking Order
                <span className="inline">
                  <span className="muted" title="Category No. — set from the category's own Ranking Order (Product Category tab)" style={{ minWidth: 28, textAlign: 'center' }}>
                    {(() => { const c = cats.find((x) => x.id === Number(edit.category_id)); const m = c?.parent_id ? cats.find((x) => x.id === c.parent_id) : c; return m?.rank ?? '—'; })()} .
                  </span>
                  <input type="number" min="1" max="9999" step="1" value={edit.rank ?? ''} onChange={set('rank')} placeholder="e.g. 1" />
                </span>
              </label>
              <label className="pc2">Unit
                <span className="inline">
                  <select value={edit.unit_id} onChange={set('unit_id')}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                  <button type="button" className="ghost" tabIndex={-1} onClick={addUnit} title="Add a unit">＋</button>
                </span>
              </label>
              <label className="pc2">HS Code<input autoComplete="nope" value={edit.hs_code || ''} onChange={set('hs_code')} placeholder="910 610 00" /></label>
              {!isService && <label className="pc2">Barcode<input data-nocap autoComplete="nope" value={edit.barcode || ''} onChange={set('barcode')} /></label>}
              <label className={'pc4'}>Website / Product Link<input data-nocap autoComplete="nope" value={edit.website} onChange={set('website')} placeholder="https://…" /></label>
              {edit.id && <label className="check"><input type="checkbox" checked={edit.active} onChange={set('active')} /> Active</label>}
            </div>

            <div className="acc-step acc-step-out"><i>2</i>Rates</div>
            <div className="doc-form pay-row pf-rates">
              <label>MRP (Rs)<Amount type="number" step="0.01" min="0" autoComplete="nope" value={edit.mrp} onChange={set('mrp')} placeholder="0.00" /></label>
              <label>VAT Type
                <select value={edit.vat_applicable ? edit.vat_type : 'exempt'}
                  onChange={(e) => setEdit({ ...edit, vat_applicable: e.target.value !== 'exempt', vat_type: e.target.value === 'exempt' ? edit.vat_type : e.target.value })}>
                  <option value="inclusive">Inclusive (rates include 13% VAT)</option><option value="exclusive">Exclusive (VAT added on top)</option>
                  <option value="exempt">VAT exempt</option>
                </select>
              </label>
              {[['dealer', 'Dealer Rate'], ['partner', 'Partner Rate']].map(([k, label]) => {
                const pctMode = edit[`${k}_mode`] === 'pct';
                const pct = num(edit[`${k}_pct`]);
                const price = pctMode ? num(edit.mrp) * (1 - pct / 100) : num(edit[`${k}_price`]);
                return (
                  <label key={k}>{label}
                    <span className="inline">
                      <select value={pctMode ? 'pct' : 'amt'} tabIndex={-1} className="mode-sel"
                        onChange={(e) => setEdit({ ...edit, [`${k}_mode`]: e.target.value, [`${k}_pct`]: e.target.value === 'pct' ? edit[`${k}_pct`] || '' : 0 })}>
                        <option value="pct">% off MRP</option><option value="amt">Rs</option>
                      </select>
                      {pctMode
                        ? <input type="number" step="0.01" min="0" max="99.99" placeholder="e.g. 25" value={edit[`${k}_pct`]} onChange={set(`${k}_pct`)} />
                        : <Amount type="number" step="0.01" min="0" value={edit[`${k}_price`]} onChange={set(`${k}_price`)} />}
                    </span>
                    {pctMode && num(edit.mrp) > 0 && <small>= Rs {fmtMoney(price)} · margin {margin(exVat(price))}</small>}
                    {!pctMode && price > 0 && <small>Margin {margin(price)}</small>}
                  </label>
                );
              })}
              <label>Purchase Cost (excl. VAT)<Amount type="number" step="0.01" min="0" autoComplete="nope" value={edit.purchase_price} onChange={set('purchase_price')} placeholder="0.00" /></label>
            </div>

            <div className="acc-step acc-step-out"><i>3</i>{isService ? 'Service' : 'Warranty, serial numbers & stock'}</div>
            {isService ? (
              <div className="doc-form pf-top">
                <label>Service Period (months)
                  <input type="number" min="0" max="120" value={edit.service_months} onChange={set('service_months')} />
                  <small>Bills set the expiry: start date + period (e.g. AMC 12 months).</small>
                </label>
              </div>
            ) : (
              <div className="doc-form pf-top pf-stock">
                <label>Warranty (months)<input type="number" min="0" max="240" value={edit.warranty_months} onChange={set('warranty_months')} /></label>
                <label>Opening Quantity<input type="number" step={edit.track_serial ? 1 : 0.001} min="0" value={edit.opening_qty} onChange={set('opening_qty')} /></label>
                <label>Opening Rate (cost)<Amount type="number" step="0.01" min="0" value={edit.opening_rate} onChange={set('opening_rate')} /></label>
                <label>Re-order Level<input type="number" step="0.001" min="0" value={edit.reorder_level} onChange={set('reorder_level')} /></label>
                <label className="check"><input type="checkbox" checked={edit.track_serial} onChange={set('track_serial')} /> Track serial numbers (IMEI / S/N)</label>
                {edit.track_serial && (
                  <label>Opening Serial Numbers
                    <button type="button" className="ghost" onClick={() => setSerialDlg(true)}>
                      {edit.opening_serials?.length || 0} of {num(edit.opening_qty)} entered — edit / paste / import
                    </button>
                  </label>
                )}
              </div>
            )}

            <div className="acc-step acc-step-out"><i>4</i>Features / details</div>
            <label className="pf-features">
              <textarea rows={3} value={edit.features} onChange={set('features')}
                placeholder={'First line is shown in bold, e.g.\nBiometric Finger + RFID Card + PIN\nBattery Backup inbuilt 4 hours'} />
            </label>

            <div className="acc-step acc-step-out"><i>5</i>Specifications</div>
            <table className="spec-grid">
              <thead><tr><th>Attribute</th><th>Value</th><th /></tr></thead>
              <tbody>{edit.specs.map(([k, v], i) => (
                <tr key={i}>
                  <td><input placeholder="e.g. Fingerprint" value={k} onChange={(e) => setEdit({ ...edit, specs: edit.specs.map((s, j) => (j === i ? [e.target.value, s[1]] : s)) })} /></td>
                  <td><input placeholder="e.g. 3,000" value={v} onChange={(e) => setEdit({ ...edit, specs: edit.specs.map((s, j) => (j === i ? [s[0], e.target.value] : s)) })} /></td>
                  <td><button type="button" className="spec-x" tabIndex={-1} title="Remove"
                    onClick={() => setEdit({ ...edit, specs: edit.specs.length > 1 ? edit.specs.filter((_, j) => j !== i) : [['', '']] })}>✕</button></td>
                </tr>
              ))}</tbody>
            </table>
            <button type="button" className="spec-add" tabIndex={-1} onClick={() => {
              setEdit({ ...edit, specs: [...edit.specs, ['', '']] });
              setTimeout(() => { const r = document.querySelectorAll('.spec-grid tbody tr'); r[r.length - 1]?.querySelector('input')?.focus(); }, 0);
            }}><span>＋</span> Add Specification</button>

            <LastSaved row={edit} />
            <div className="actions pf-actions">
              {edit.id && <button type="button" className="danger edit-only" onClick={remove}>Delete <kbd className="kbd">Ctrl+Del</kbd></button>}
              <span className="spacer" />
              <button type="button" className="ghost" onClick={() => setEdit(null)}>Cancel <Kbd>Esc</Kbd></button>
              <button data-save>💾 {edit.id ? 'Save Changes' : 'Save Product'} <Kbd>Ctrl+S</Kbd></button>
            </div>
          </form>
        </div>
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {serialDlg && edit && (
        <SerialDialog item={{ id: edit.id || 0, name: edit.name || 'New product' }} mode="in" value={edit.opening_serials}
          qty={num(edit.opening_qty)} onClose={() => setSerialDlg(false)}
          onSave={(list) => { setEdit({ ...edit, opening_serials: list, opening_qty: list.length || edit.opening_qty }); setSerialDlg(false); }} />
      )}
      {catEdit && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setCatEdit(null)}>
          <form className="card form narrow" onSubmit={(e) => { e.preventDefault(); saveCat(); }}>
            <h2 className="acc-head"><span className="acc-head-ic">{catEdit.id ? '✏️' : '＋'}</span><span className="acc-head-txt">{catEdit.id ? 'Edit' : 'Add'} {catEdit.parent_id ? 'Sub Category' : 'Category'}<small>{catEdit.parent_id ? 'A sub category groups products inside a category' : 'Categories group products and set their dealer rates'}</small></span></h2>
            {catEdit.parent_id && !catEdit.id && (
              <label className="full">Category<select value={catEdit.parent_id} onChange={(e) => setCatEdit({ ...catEdit, parent_id: e.target.value })}>
                {mains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            )}
            <label className="full">{catEdit.parent_id ? 'Name' : 'Product Category *'}<input autoFocus value={catEdit.name} onChange={(e) => setCatEdit({ ...catEdit, name: e.target.value })} required /></label>
            {!catEdit.parent_id && (
              <>
                <label className="full">HS Code<input value={catEdit.hs_code ?? ''} onChange={(e) => setCatEdit({ ...catEdit, hs_code: e.target.value })} /></label>
                <label className="full">Ranking Order<input type="number" min="1" max="9999" step="1" value={catEdit.rank ?? ''} placeholder="e.g. 1 — lower numbers list first"
                  onChange={(e) => setCatEdit({ ...catEdit, rank: e.target.value })} /></label>
                <label className="full">Effective Date<input type="date" value={catEdit.effective_date ?? ''} onChange={(e) => setCatEdit({ ...catEdit, effective_date: e.target.value })} /></label>
                <label className="full">Remarks<textarea rows={3} placeholder="Optional remarks" value={catEdit.remarks ?? ''} onChange={(e) => setCatEdit({ ...catEdit, remarks: e.target.value })} /></label>
              </>
            )}
            <div className="actions"><span className="spacer" />
              <button type="button" className="ghost" onClick={() => setCatEdit(null)}>Close <Kbd>Esc</Kbd></button>
              <button data-save>Save <Kbd>Ctrl+S</Kbd></button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/** One Dealer % / Partner % per category (or for every product), applied in one go. */
function RateSetting({ mains, items, onDone }) {
  const { notify, canEdit } = useApp();
  const [q, setQ] = useState('');
  const allRows = [{ id: null, name: 'All products' }, ...mains];
  const rows = allRows.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const [f, setF] = useState({});
  const count = (id) => items.filter((i) => i.mrp > 0 && (!id || i.category_id === id || i.parent_category_id === id)).length;
  const common = (id, key) => {
    const v = [...new Set(items.filter((i) => !id || i.category_id === id || i.parent_category_id === id).map((i) => i[key]))];
    return v.length === 1 ? v[0] : null;
  };
  const apply = async (r) => {
    const v = f[r.id ?? 'all'] || {};
    if (v.dealer_pct === undefined && v.partner_pct === undefined && !v.vat_type) { notify('Enter a % first.', 'err'); return; }
    if (!confirm(`Apply to ${count(r.id)} products in "${r.name}"? Their dealer/partner rates will be recalculated from MRP.`)) return;
    try {
      const res = await api.post('/items/rates', { category_id: r.id,
        dealer_pct: v.dealer_pct === undefined || v.dealer_pct === '' ? null : Number(v.dealer_pct),
        partner_pct: v.partner_pct === undefined || v.partner_pct === '' ? null : Number(v.partner_pct), vat_type: v.vat_type || null });
      notify(`${res.updated} products updated`); setF({ ...f, [r.id ?? 'all']: {} }); onDone();
    } catch (err) { notify(err.message, 'err'); }
  };
  const setV = (r, k, val) => setF({ ...f, [r.id ?? 'all']: { ...(f[r.id ?? 'all'] || {}), [k]: val } });
  return (
    <>
      <header className="page-head"><h1>💰 Dealer Rate Setting</h1><span className="muted">Dealer & Partner rate = MRP − %. Applies to every product with an MRP in that category.</span></header>
      <section className="card dg">
        <div className="dg-bar">
          <span className="muted">{rows.length ? `1–${rows.length}` : 0} / Total {allRows.length}</span>
          <span className="spacer" />
          <input className="dg-search" data-find title="Ctrl+F" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} onFocus={(e) => e.target.select()} />
        </div>
        <div className="dg-scroll">
        <table className="grid dg-soft">
          <thead><tr><th className="sn">SN</th><th>Category</th><th className="num">Products</th><th className="num">Dealer % now</th><th className="num">Partner % now</th>
            <th style={{ width: 120 }}>New Dealer %</th><th style={{ width: 120 }}>New Partner %</th><th style={{ width: 140 }}>VAT Type</th><th className="edit-only" /></tr></thead>
          <tbody>{rows.map((r, i) => {
            const v = f[r.id ?? 'all'] || {};
            const dp = common(r.id, 'dealer_pct'); const pp = common(r.id, 'partner_pct');
            return (
              <tr key={r.id ?? 'all'} className={r.id ? '' : 'sub'}>
                <td className="sn">{i + 1}</td><td className="pname">{r.name}</td><td className="num">{count(r.id)}</td>
                <td className="num">{dp === null ? <span className="muted">mixed</span> : `${dp}%`}</td>
                <td className="num">{pp === null ? <span className="muted">mixed</span> : `${pp}%`}</td>
                <td><input type="number" min="0" max="99" step="0.01" disabled={!canEdit} value={v.dealer_pct ?? ''} placeholder="e.g. 25" onChange={(e) => setV(r, 'dealer_pct', e.target.value)} /></td>
                <td><input type="number" min="0" max="99" step="0.01" disabled={!canEdit} value={v.partner_pct ?? ''} placeholder="e.g. 30" onChange={(e) => setV(r, 'partner_pct', e.target.value)} /></td>
                <td><select disabled={!canEdit} value={v.vat_type || ''} onChange={(e) => setV(r, 'vat_type', e.target.value)}>
                  <option value="">keep</option><option value="inclusive">Inclusive</option><option value="exclusive">Exclusive</option></select></td>
                <td className="edit-only"><button className="btn-sm" onClick={() => apply(r)}>Apply</button></td>
              </tr>
            );
          })}</tbody>
        </table>
        </div>
      </section>
    </>
  );
}
