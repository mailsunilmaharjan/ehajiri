/* Image / PDF uploads for the Accounts module (product photos, bank QR codes, quotation logos…).
 * Port of NepalAccounts/server/app/images.py — but stored in the tenant's own database
 * (acc_files) instead of a shared disk folder, so tenants can never see each other's uploads and
 * the files travel with the normal database backup.
 *
 * Content is checked by its real bytes (magic numbers), never by the declared type or extension.
 */
import crypto from 'crypto';
import { q, one } from './accDb.js';
import { bad } from './common.js';

const SIGS = [
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];
const PDF = { ext: 'pdf', mime: 'application/pdf', test: (b) => b.length > 5 && b.toString('latin1', 0, 5) === '%PDF-' };

/** Decode a data: URL, verify it really is a PNG/JPG/WEBP (or PDF), store it, return the file name. */
export async function saveImage(folder, prefix, dataUrl, maxMb = 3, allowPdf = false) {
  const b64 = String(dataUrl || '').split(',').pop();
  if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) bad('Not a valid image.');
  const raw = Buffer.from(b64, 'base64');
  if (raw.length > maxMb * 1024 * 1024) bad(`Image is larger than ${maxMb} MB. Use a smaller picture.`);
  const kind = SIGS.find((s) => s.test(raw)) || (allowPdf && PDF.test(raw) ? PDF : null);
  if (!kind) bad(`Use a JPG, PNG, WEBP${allowPdf ? ' or PDF file.' : ' image.'}`);
  const name = `${String(prefix).replace(/[^\w-]/g, '')}-${crypto.randomBytes(6).toString('hex')}.${kind.ext}`;
  await q('INSERT INTO acc_files (kind, name, mime, data) VALUES (%s, %s, %s, %s)', [folder, name, kind.mime, raw]);
  return name;
}

export async function removeImage(folder, name) {
  if (name) await q('DELETE FROM acc_files WHERE kind = %s AND name = %s', [folder, String(name).replace(/[\\/]/g, '')]);
}

export async function getFile(folder, name) {
  if (!name) return null;
  return one('SELECT mime, data FROM acc_files WHERE kind = %s AND name = %s', [folder, String(name).replace(/[\\/]/g, '')]);
}

/** Express: send a stored file, or 404 JSON. */
export async function serveImage(res, folder, name) {
  const f = await getFile(folder, name);
  if (!f) return bad('No image.', 404);
  res.set({ 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  res.send(f.data);
}
