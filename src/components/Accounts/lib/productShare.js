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

/** Opens WhatsApp (app or web) with the message typed in, ready to pick the chat. */
export const openProductChat = (item, company) => window.open(waLink('', productShareText(item, company)), '_blank', 'noopener');

/** The product photo as a File, or null when there is none. */
export async function productPhoto(item) {
  if (!item.has_image) return null;
  const r = await authFetch(`/items/${item.id}/image`);
  if (!r.ok) return null;
  const blob = await r.blob();
  const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return new File([blob], `product-${item.code || item.id}.${ext}`, { type: blob.type || 'image/png' });
}

/** Put the photo on the clipboard so it can be pasted (Ctrl+V) into a chat. Browsers only accept PNG there. */
export async function copyPhoto(file) {
  const png = (async () => {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0);
    return new Promise((res, rej) => c.toBlob((x) => (x ? res(x) : rej(new Error('photo'))), 'image/png'));
  })();
  await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })]);
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
