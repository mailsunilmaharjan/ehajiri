// Share a product by WhatsApp or email: name, MRP, dealer rate, VAT, features, specifications, website
// (the same message the mobile order app sends).
import { authFetch, waLink } from './api';

const rs = (n) => (Number(n) ? `Rs.${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—');

export function productShareText(item, company) {
  const L = [`*${item.name}*`, '', `MRP: ${rs(item.mrp)}`, `Dealer Rate: ${rs(item.dealer_price)}`,
    `VAT: ${!item.vat_applicable ? 'Exempt' : item.vat_type === 'exclusive' ? 'Exclusive' : 'Inclusive'}`];
  const features = String(item.features || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (features.length) L.push('', '*Features*', ...features);
  const specs = (item.specs || []).filter(([k, v]) => k || v);
  if (specs.length) L.push('', '*Specifications*', ...specs.map(([k, v]) => `${k || ''}: ${v || ''}`.trim()));
  if (item.website) L.push('', `🌐 ${/^https?:\/\//i.test(item.website) ? item.website : `https://${item.website}`}`);
  if (company?.name) L.push('', company.name);
  return L.join('\n');
}

/** Opens the device's share sheet with the photo when it can; otherwise WhatsApp with the text ready. */
export async function shareProductWhatsApp(item, company) {
  const text = productShareText(item, company);
  const viaText = () => window.open(waLink('', text), '_blank', 'noopener');
  if (!item.has_image || !navigator.share || !navigator.canShare) { viaText(); return; }
  try {
    const r = await authFetch(`/items/${item.id}/image`);
    if (!r.ok) throw new Error('no photo');
    const blob = await r.blob();
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const files = [new File([blob], `product.${ext}`, { type: blob.type || 'image/png' })];
    if (navigator.canShare({ files })) await navigator.share({ files, text });
    else viaText();
  } catch (e) { if (e.name !== 'AbortError') viaText(); }
}

export function shareProductEmail(item, company) {
  const body = productShareText(item, company).replace(/\*/g, '');
  // mail links break at about 2000 characters (each line break / symbol counts several), so a long list is cut.
  let cut = body;
  while (encodeURIComponent(cut).length > 1800 && cut.includes('\n')) cut = `${cut.slice(0, cut.lastIndexOf('\n'))}`;
  if (cut !== body) cut += '\n…';
  const subject = company?.name ? `${item.name} — ${company.name}` : item.name;
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cut)}`;
}
