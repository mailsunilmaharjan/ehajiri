/* Sales Quotation PDF — the A4 "Professional" layout. Port of NepalAccounts/server/app/quote_pdf.py
 * (ProfessionalBuilder), built on pdfkit + pdf-lib (both loaded lazily).
 *
 * Pages: 1 Cover (brand band, logo, date + quotation no., title, prepared-for, photo card, prepared-by, contact bar)
 *        2 Company Profile (template's uploaded images / pages picked from an uploaded PDF, two per page)
 *        3 Commercial Proposal (# | Description with photo, features, specifications | Qty | Rate | Amount, totals, amount in words)
 *        3 Terms & Conditions + Note · 4 Acceptance (our signature & stamp, client block, thank-you)
 *
 * All layout maths is in millimetres exactly as in the demo; the Q wrapper converts to PDF points.
 * Not ported: the 16:9 "WIDE" deck layout (templates set to WIDE are printed in A4) and the demo's image
 * down-scaling / PDF cache (pdfkit embeds photos as uploaded).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bsLong } from './nepaliDate.js';
import { nepMoney } from './common.js';
import { getFile } from './files.js';

const ASSET_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const FONT_DIR = path.join(ASSET_DIR, 'fonts');
/* Brand logos shown on the cover and in the footer of pages 2+. Drop zkteco.png / yoi.png (PNG or JPEG) into
 * server/assets/brands/ — until a file exists the brand is printed as a plain wordmark. */
const BRANDS = [['ZKTeco', 'zkteco'], ['YOI', 'yoi']];
function loadBrands() {
  return BRANDS.map(([name, base]) => {
    for (const [ext, mime] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg']]) {
      try { return { name, file: { mime, data: fs.readFileSync(path.join(ASSET_DIR, 'brands', `${base}.${ext}`)) } }; } catch { /* try next */ }
    }
    return { name, file: null };
  });
}
const K = 72 / 25.4;                       // mm -> pt
const AW = 210.0, AH = 297.0;              // A4 portrait
const AX = 15.0, ATW = 180.0;              // left margin, content width
const A_BOTTOM = AH - 20;                  // content stops above the footer line
const INK = [31, 41, 55], MUTE = [107, 114, 128], RULE = [226, 229, 233], ZEBRA = [249, 250, 249], DARK = [33, 37, 41];

const rgb = (h, d = [46, 125, 50]) => { const m = /^#?([0-9a-fA-F]{6})$/.exec(String(h || '').trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : d; };
const tint = (c, f) => c.map((v) => Math.round(v + (255 - v) * f));

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
function words(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${words(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push([Math.floor(n / 100) ? `${ONES[Math.floor(n / 100)]} Hundred` : '', n % 100 ? two(n % 100) : ''].filter(Boolean).join(' '));
  return parts.join(' ');
}
const amountInWords = (a) => { const v = Math.round(Math.abs(Number(a) || 0) * 100); const r = Math.floor(v / 100), p = v % 100; return `Rupees ${words(r)}${p ? ` and ${two(p)} Paisa` : ''} Only`; };
const g = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000);

/* ───────────────────────────── drawing wrapper (mm API like the demo's fpdf) ───────────────────────────── */
class Q {
  constructor(PDFDocument) {
    this.doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true, info: { Producer: 'eHajiri Accounts' } });
    this.chunks = [];
    this.doc.on('data', (c) => this.chunks.push(c));
    const f = (n) => path.join(FONT_DIR, `Poppins-${n}.ttf`);
    this.uni = ['Regular', 'SemiBold', 'Bold', 'Light', 'Medium'].every((n) => fs.existsSync(f(n)));
    if (this.uni) {
      this.doc.registerFont('Q', f('Regular')); this.doc.registerFont('QB', f('SemiBold')); this.doc.registerFont('QH', f('Bold'));
      this.doc.registerFont('QL', f('Light')); this.doc.registerFont('QM', f('Medium'));
    }
    this.cs = 0;
  }
  addPage() { this.doc.addPage({ size: 'A4', margin: 0 }); this.cs = 0; }
  get pageIndex() { const r = this.doc.bufferedPageRange(); return r.start + r.count - 1; }
  /** Poppins has no Devanagari; keep Latin text only (same as the demo). */
  t(s) { return String(s ?? '').replace(/[–—]/g, '-').replace(/[ऀ-ॿ]/g, ''); }
  font(size, bold = false, color = DARK, fam = null) {
    const name = !this.uni ? (bold || fam === 'H' || fam === 'M' ? 'Helvetica-Bold' : 'Helvetica')
      : fam === 'H' ? 'QH' : fam === 'L' ? 'QL' : fam === 'M' ? 'QM' : bold ? 'QB' : 'Q';
    this.doc.font(name).fontSize(size).fillColor(color);
  }
  fill(c) { this.doc.fillColor(c); }
  // text in a box of height h (mm), vertically centred like fpdf's cell()
  textAt(x, y, w, h, s, size, bold = false, color = DARK, align = 'L', fam = null) {
    this.font(size, bold, color, fam);
    const lh = this.doc.currentLineHeight();
    // aligned by hand and never wrapped: like fpdf's cell(), a line longer than its box simply overflows
    const str = this.t(s);
    const tw = this.doc.widthOfString(str, { characterSpacing: this.cs || 0 });
    const bx = align === 'R' ? x * K + w * K - tw : align === 'C' ? x * K + (w * K - tw) / 2 : x * K;
    this.doc.text(str, bx, y * K + (h * K - lh) / 2, { lineBreak: false, characterSpacing: this.cs || 0 });
  }
  width(s, size, bold = false, fam = null) { this.font(size, bold, DARK, fam); return this.doc.widthOfString(this.t(s), { characterSpacing: this.cs || 0 }) / K; }
  /** Greedy word wrap to `w` mm (explicit newlines kept; over-long words are cut). */
  wrap(text, w, size, bold = false, fam = null) {
    const out = [];
    for (const para of this.t(text).split('\n')) {
      if (!para.trim()) { out.push(''); continue; }
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (this.width(test, size, bold, fam) <= w) { line = test; continue; }
        if (line) out.push(line);
        line = word;
        while (this.width(line, size, bold, fam) > w && line.length > 1) {
          let n = line.length - 1;
          while (n > 1 && this.width(line.slice(0, n), size, bold, fam) > w) n--;
          out.push(line.slice(0, n)); line = line.slice(n);
        }
      }
      out.push(line);
    }
    return out;
  }
  /** Wrapped text block; returns the y below it. */
  para(x, y, w, lh, s, size, bold = false, color = DARK, align = 'L', maxLines = null, fam = null) {
    let lines = this.wrap(s, w, size, bold, fam);
    if (maxLines && lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[lines.length - 1] = `${lines[lines.length - 1].trimEnd().slice(0, -1)}…`; }
    lines.forEach((ln, i) => this.textAt(x, y + i * lh, w, lh, ln, size, bold, color, align, fam));
    return y + lines.length * lh;
  }
  linesAt(x, y, w, lines, size, bold = false, color = INK, lh = 4.5, align = 'L') {
    lines.forEach((ln, i) => this.textAt(x, y + i * lh, w, lh, ln, size, bold, color, align));
    return y + lines.length * lh;
  }
  // shapes -------------------------------------------------------------------------------------------------
  rect(x, y, w, h, { fill = null, stroke = null, lw = 0.3, r = 0, opacity = null } = {}) {
    const d = this.doc; d.save();
    if (opacity !== null) d.fillOpacity(opacity);
    if (r) d.roundedRect(x * K, y * K, w * K, h * K, r * K); else d.rect(x * K, y * K, w * K, h * K);
    if (fill && stroke) d.lineWidth(lw * K).fillAndStroke(fill, stroke); else if (fill) d.fill(fill); else if (stroke) d.lineWidth(lw * K).stroke(stroke);
    d.restore();
  }
  disc(cx, cy, r, c, opacity = null) { const d = this.doc; d.save(); if (opacity !== null) d.fillOpacity(opacity); d.circle(cx * K, cy * K, r * K).fill(c); d.restore(); }
  polygon(pts, c) { const d = this.doc; d.save(); d.polygon(...pts.map(([x, y]) => [x * K, y * K])).fill(c); d.restore(); }
  line(x1, y1, x2, y2, c, lw = 0.3, dash = null) {
    const d = this.doc; d.save(); d.lineWidth(lw * K).strokeColor(c);
    if (dash) d.dash(dash * K, { space: dash * K });
    d.moveTo(x1 * K, y1 * K).lineTo(x2 * K, y2 * K).stroke(); d.restore();
  }
  check(x, y, c) { this.line(x, y + 1.6, x + 1.3, y + 3.0, c, 0.7); this.line(x + 1.3, y + 3.0, x + 3.6, y - 0.2, c, 0.7); }
  /** Image fitted inside the box (keeps its shape, centred). Only PNG / JPEG can be embedded. */
  img(file, x, y, w, h) {
    if (!file || !/^image\/(png|jpeg)$/.test(file.mime)) return;
    try { this.doc.image(file.data, x * K, y * K, { fit: [w * K, h * K], align: 'center', valign: 'center' }); } catch { /* a broken upload must not stop the quotation */ }
  }
  end() { return new Promise((resolve, reject) => { this.doc.on('end', () => resolve(Buffer.concat(this.chunks))); this.doc.on('error', reject); this.doc.end(); }); }
}

/* ───────────────────────────── the quotation ───────────────────────────── */
class Builder {
  constructor(q, company, d, tpl, items, files) {
    this.p = q; this.c = company; this.d = d; this.tp = tpl; this.items = items; this.files = files;
    this.c1 = rgb(tpl.color1); this.c2 = rgb(tpl.color2, [108, 190, 69]);
    this.logo = files.get('quote-templates', tpl.logo_file);
    this.sign = tpl.signer ? files.get('quote-signers', tpl.signer_file) : files.get('quote-templates', tpl.sign_file);   // a staff signatory only ever gets their own signature
    this.website = tpl.website || '';
    this.address = tpl.address || company.address || '';
    this.phones = tpl.phones || company.phone || '';
    this.pageNo = 0; this.y = 0; this.sec = 0;
    this.place = [];          // [pageIndex, pdf Buffer, srcPageIdx, x, y, w, h] — merged after output
    this.footerPages = [];
    // brand logos: the template's uploads first, then server/assets/brands/*.png, then a plain wordmark
    const fb = loadBrands();
    this.brands = [files.get('quote-templates', tpl.brand_zk_file), files.get('quote-templates', tpl.brand_yoi_file)].map((f, i) => ({ name: fb[i].name, file: f || fb[i].file }));
  }
  /** Draws the brand logos left-to-right at (x, y) with height h; returns the x after the last one. */
  brandRow(x, y, h, gap = 5) {
    const { p } = this;
    const w = h * 2.6;                       // every brand gets the same box, so both logos print at the same size
    for (const b of this.brands) {
      if (b.file) p.img(b.file, x, y, w, h);
      else { const size = h * 1.6; p.textAt(x, y, w, h, b.name, size, false, INK, 'C', 'H'); }
      x += w + gap;
    }
    return x - gap;
  }
  footerText() { return [this.address, this.phones && `Phone: ${this.phones}`, this.website].filter(Boolean).join('  |  '); }

  newPage() {
    const { p, d } = this;
    p.addPage(); this.pageNo++; this.clear = null;
    if (this.logo) p.img(this.logo, AX, 8.5, 36, 11.5); else p.textAt(AX, 10, 100, 6, this.c.name, 11, true, this.c1);
    p.textAt(AX + 60, 9.2, ATW - 60, 4.5, `QUOTATION  ·  ${d.doc_no}`, 8, true, this.c1, 'R');
    p.textAt(AX + 60, 13.8, ATW - 60, 4.5, d.party_name, 8, false, MUTE, 'R');
    p.line(AX, 22, AX + ATW, 22, this.c1, 0.5);
    p.line(AX, AH - 15, AX + ATW, AH - 15, RULE, 0.3);
    const bx = this.brandRow(AX, AH - 13.9, 6, 3);
    p.textAt(bx + 5, AH - 13, ATW - 28 - (bx + 5 - AX), 4, this.footerText(), 7, false, MUTE);
    this.footerPages.push(p.pageIndex);
    this.y = 30;
  }
  section(title, y = null) {
    const { p } = this;
    this.sec++;
    y = y === null ? this.y : y;
    p.textAt(AX, y + 0.6, 11, 6, String(this.sec).padStart(2, '0'), 11, true, this.c2);
    p.textAt(AX + 11, y, ATW - 11, 7, title, 15, true, INK);
    p.rect(AX + 11, y + 8.4, 14, 0.9, { fill: this.c1 });
    return y + 14;
  }
  label(x, y, text, color = null, size = 7.6) {
    this.p.cs = 0.9; this.p.textAt(x, y, 90, 4, String(text).toUpperCase(), size, true, color || this.c1); this.p.cs = 0;
  }

  /* 1. cover */
  cover() {
    const { p, d, tp } = this;
    p.addPage(); this.pageNo++;
    const white = [255, 255, 255], soft = [222, 240, 222], accent = tint(this.c2, 0.25), darkBand = this.c1.map((v) => Math.round(v * 0.82));
    const R = AX + ATW;
    const spaced = (x, y, w, text, size, color, align = 'L', sp = 1.6, fam = 'M') => { p.cs = sp; p.textAt(x, y, w, 4.5, text.toUpperCase(), size, false, color, align, fam); p.cs = 0; };

    const title = d.qt_subject || 'Quotation';
    p.font(27, false, DARK, 'H');
    const tl = p.wrap(title, 150, 27, false, 'H').slice(0, 3);
    const titleY = 60;
    const pfY = titleY + tl.length * 11.2 + 7;
    const pfLines = [d.party_address, d.qt_attn && `Attn: ${d.qt_attn}`].filter(Boolean);
    const pfEnd = pfY + 6 + 8 + pfLines.length * 5.4;
    const band = Math.max(150, pfEnd + 30);

    p.rect(0, 0, AW, band, { fill: this.c1 });
    p.polygon([[0, band], [0, band - 46], [AW * 0.62, band]], darkBand);
    p.disc(AW + 6, 26, 62, this.c2, 0.20);
    p.disc(AW - 30, band - 6, 30, white, 0.10);
    for (let i = 0; i < 6; i++) { const x0 = AW - 92 + i * 7; p.line(x0, band, x0 + 34, band - 34, white, 0.25); }
    p.rect(0, band, AW, 1.8, { fill: this.c2 });

    if (this.logo) { p.rect(AX, 15, 58, 20, { fill: white, r: 3 }); p.img(this.logo, AX + 3, 17, 52, 16); }
    else p.textAt(AX, 19, 110, 8, this.c.name, 15, false, white, 'L', 'H');
    const dd = new Date(`${d.doc_date}T00:00:00Z`);
    spaced(R - 70, 15, 70, 'Date', 7.2, accent, 'R');
    p.textAt(R - 80, 19.6, 80, 6, bsLong(d.doc_date), 12, false, white, 'R', 'M');
    p.textAt(R - 80, 25.4, 80, 4.5, dd.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }), 8.5, false, soft, 'R', 'L');
    p.line(R - 34, 32.2, R, 32.2, accent, 0.3);
    spaced(R - 70, 34.4, 70, 'Quotation No.', 7.2, accent, 'R');
    p.textAt(R - 80, 39, 80, 6, d.doc_no, 12, false, white, 'R', 'M');

    p.rect(AX, titleY - 7.2, 9, 1.1, { fill: this.c2 });
    spaced(AX + 12, titleY - 9.3, 120, 'Commercial Proposal', 8, accent);
    tl.forEach((ln, i) => p.textAt(AX, titleY + i * 11.2, 150, 11.2, ln, 27, false, white, 'L', 'H'));

    spaced(AX, pfY, 80, 'Prepared for', 7.4, accent);
    p.textAt(AX, pfY + 5.4, 120, 8, d.party_name, 15.5, false, white, 'L', 'M');
    let yy = pfY + 14;
    for (const v of pfLines) { p.textAt(AX, yy, 120, 5.2, v, 10, false, soft, 'L', 'L'); yy += 5.4; }
    const clientLogo = this.files.get('quotes', d.qt_client_logo);
    if (clientLogo) { p.rect(R - 38, pfY, 38, 26, { fill: white, r: 3 }); p.img(clientLogo, R - 35, pfY + 3, 32, 20); }

    const cover = this.files.get('quote-templates', tp.cover_file);
    if (cover) {
      const cw = 140, ch = 78, cx = (AW - cw) / 2, cy = band - 20;
      p.rect(cx + 1.5, cy + 2.2, cw, ch, { fill: [0, 0, 0], r: 5, opacity: 0.09 });
      p.rect(cx, cy, cw, ch, { fill: white, stroke: RULE, lw: 0.3, r: 5 });
      p.img(cover, cx + 6, cy + 5, cw - 12, ch - 10);
    }


    // authorised-distributor mark under the dot grid
    p.cs = 0.8; p.textAt(AX, AH - 44, 100, 4.5, 'AUTHORIZED NATIONAL DISTRIBUTOR FOR NEPAL', 7.6, false, this.c1, 'L', 'M'); p.cs = 0;
    this.brandRow(AX, AH - 38, 12, 6);

    const lines = [[tp.prepared_name || this.c.name, 12.5, INK, 'M']];
    if (tp.prepared_post) lines.push([tp.prepared_post, 9, MUTE, null]);
    if (tp.prepared_phone) lines.push([`Phone: ${tp.prepared_phone}`, 9, MUTE, null]);
    if (tp.prepared_email) lines.push([tp.prepared_email, 9, this.c1, null]);
    const bh = 6 + lines.reduce((a, _, i) => a + (i === 0 ? 6.4 : 4.8), 0);
    const by = AH - 17 - bh;
    p.rect(R - 1.2, by, 1.2, bh, { fill: this.c1 });
    spaced(R - 95, by, 92, 'Prepared by', 7.4, this.c1, 'R');
    yy = by + 5.6;
    lines.forEach(([v, size, col, fam], i) => { p.textAt(R - 95, yy, 92, i === 0 ? 6 : 4.6, v, size, false, col, 'R', fam); yy += i === 0 ? 6.4 : 4.8; });

    p.rect(0, AH - 11.4, AW, 1.4, { fill: this.c2 });
    p.rect(0, AH - 10, AW, 10, { fill: this.c1 });
    p.textAt(AX, AH - 7.5, ATW, 5, [this.website, this.phones && `Phone: ${this.phones}`, this.address].filter(Boolean).join('     ·     '), 8, false, white, 'C', 'L');
  }

  /* 2. company profile: two slides per page */
  async profile(pdfLib) {
    const slots = [];
    for (const ent of this.tp.profile_list || []) {
      const f = this.files.get('quote-templates', ent.file);
      if (!f) continue;
      if (f.mime === 'application/pdf') {
        try {
          const doc = await pdfLib.PDFDocument.load(f.data, { ignoreEncryption: true });
          const n = doc.getPageCount();
          for (const i of pageList(ent.pages, n)) { const { width, height } = doc.getPage(i).getSize(); slots.push({ kind: 'pdf', file: f, idx: i, a: width / height }); }
        } catch { /* unreadable PDF: skip */ }
      } else if (/^image\/(png|jpeg)$/.test(f.mime)) {
        try { const im = this.p.doc.openImage(f.data); slots.push({ kind: 'img', file: f, a: im.width / im.height }); } catch { /* skip */ }
      }
    }
    if (!slots.length) return;
    const { p } = this;
    let first = true;
    const page = () => { this.newPage(); if (first) { first = false; return this.section('Company Profile'); } return this.y; };
    const put = (slot, x, y, w, h) => {
      const fw = Math.min(w, h * slot.a), fh = fw / slot.a, fx = x + (w - fw) / 2, fy = y + (h - fh) / 2;
      p.rect(fx + 0.9, fy + 1.1, fw, fh, { fill: [0, 0, 0], opacity: 0.10 });
      p.rect(fx, fy, fw, fh, { fill: [255, 255, 255], stroke: RULE, lw: 0.3 });
      if (slot.kind === 'img') p.img(slot.file, fx, fy, fw, fh);
      else this.place.push([p.pageIndex, slot.file.data, slot.idx, fx, fy, fw, fh]);
    };
    const pending = [];
    const flush = () => {
      if (!pending.length) return;
      const y0 = page(), boxH = (A_BOTTOM - y0 - 6) / 2;
      pending.forEach((s, k) => put(s, AX, y0 + k * (boxH + 6), ATW, boxH));
      pending.length = 0;
    };
    for (const s of slots) {
      if (s.a < 1.1) { flush(); const y0 = page(); put(s, AX, y0, ATW, A_BOTTOM - y0); }
      else { pending.push(s); if (pending.length === 2) flush(); }
    }
    flush();
  }

  /* 3. commercial proposal */
  specsOf(l) {
    const it = this.items[l.item_id] || {};
    let specs = []; try { specs = JSON.parse(it.specs || '[]'); } catch { specs = []; }
    return specs.filter((s) => String(s?.[0] ?? '').trim()).map(([k, v]) => [String(k).trim(), String(v ?? '').trim()]).slice(0, 14);
  }
  featuresOf(l) {
    const it = this.items[l.item_id] || {};
    const lines = String(it.features || '').split('\n').map((s) => s.replace(/^[\s•-]+|[\s•-]+$/g, '')).filter(Boolean);
    if (l.service_to) lines.push(`Service ${bsLong(l.service_from)} to ${bsLong(l.service_to)}`);
    if ((lines.length || this.specsOf(l).length) && l.warranty_months) lines.push(`Warranty ${l.warranty_months} months`);
    return lines.slice(0, 10);
  }
  /** Description cell: photo thumbnail, product name, ✓ features, compact specifications table. Returns its height. */
  desc(x, y, w, l, draw = true) {
    const { p } = this;
    const it = this.items[l.item_id] || {};
    const photo = this.files.get('items', it.image_file);
    const pad = 2.6;
    let tx = x + pad, tw = w - 2 * pad, ph = 0;
    if (photo) {
      if (draw) { p.rect(tx, y + pad, 21, 21, { fill: [255, 255, 255], stroke: RULE, lw: 0.25, r: 1.5 }); p.img(photo, tx + 1, y + pad + 1, 19, 19); }
      ph = 21 + 2 * pad; tx += 25; tw -= 25;
    }
    let cy = y + pad;
    const nl = p.wrap(l.item, tw, 10, true).slice(0, 3);
    if (draw) p.linesAt(tx, cy, tw, nl, 10, true, INK, 5);
    cy += nl.length * 5 + 0.8;
    for (const f of this.featuresOf(l)) {
      const fl = p.wrap(f, tw - 5, 8.6).slice(0, 3);
      if (draw) { p.check(tx + 0.2, cy + 0.6, this.c2); p.linesAt(tx + 5, cy, tw - 5, fl, 8.6, false, [55, 65, 81], 4.1); }
      cy += fl.length * 4.1 + 0.4;
    }
    const specs = this.specsOf(l);
    if (specs.length) {
      cy = Math.max(cy, y + ph - pad) + 1.6;
      tx = x + pad; tw = w - 2 * pad;
      const kw = Math.round(tw * 0.36 * 100) / 100, cp = 1.1, lh = 3.6, vw = tw - kw;
      for (const [k, v] of specs) {
        const kl = p.wrap(k, kw - 2 * cp, 7.8), vl = p.wrap(v || '-', vw - 2 * cp, 7.8);
        const rh = Math.max(kl.length, vl.length) * lh + 2 * cp;
        if (draw) {
          p.rect(tx, cy, kw, rh, { fill: [246, 247, 246], stroke: RULE, lw: 0.2 });
          p.rect(tx + kw, cy, vw, rh, { fill: [255, 255, 255], stroke: RULE, lw: 0.2 });
          p.linesAt(tx + cp, cy + cp, kw - 2 * cp, kl, 7.8, false, MUTE, lh);
          p.linesAt(tx + kw + cp, cy + cp, vw - 2 * cp, vl, 7.8, false, INK, lh);
        }
        cy += rh;
      }
    } else if (String(l.note || '').trim()) {
      const nl2 = p.wrap(l.note, tw, 8.6).slice(0, 3);
      if (draw) p.linesAt(tx, cy, tw, nl2, 8.6, false, MUTE, 4.1);
      cy += nl2.length * 4.1;
    }
    return Math.max(cy - y + pad, ph, 10);
  }

  proposal() {
    const { p, d } = this;
    this.newPage();
    let y = this.section('Commercial Proposal');
    const attn = String(d.qt_attn || '').trim();
    p.textAt(AX, y, ATW, 5, attn ? `Dear ${attn},` : 'Dear Sir / Madam,', 10, true, INK);
    y = p.para(AX, y + 6, ATW, 4.8, `Thank you for your interest in our products and services. We are pleased to submit our quotation for ${d.qt_subject || 'your requirement'}. Please find the details below.`, 9.5, false, [55, 65, 81], 'L', 3) + 5;
    const cw = [9, 101, 18, 25, 27], cx = cw.map((_, i) => AX + cw.slice(0, i).reduce((a, b) => a + b, 0));
    const heads = [['#', 'C'], ['Description', 'L'], ['Qty', 'C'], ['Rate (Rs)', 'R'], ['Amount (Rs)', 'R']];
    const headRow = (yy) => {
      p.rect(AX, yy, ATW, 8, { fill: this.c1 });
      p.cs = 0.5; heads.forEach(([h, al], i) => p.textAt(cx[i] + 2, yy + 1.9, cw[i] - 4, 4.5, h.toUpperCase(), 7.8, true, [255, 255, 255], al)); p.cs = 0;
      return yy + 8;
    };
    y = headRow(y);
    d.lines.forEach((l, i) => {
      const n = i + 1;
      const rh = this.desc(cx[1], y, cw[1], l, false);
      if (y + rh > A_BOTTOM) { this.newPage(); y = headRow(this.y); }
      if (n % 2 === 0) p.rect(AX, y, ATW, rh, { fill: ZEBRA });
      this.desc(cx[1], y, cw[1], l);
      const rate = l.qty ? l.amount / l.qty : 0;
      p.textAt(cx[0], y + 2.6, cw[0], 5, String(n), 9.5, true, MUTE, 'C');
      p.textAt(cx[2] + 1, y + 2.6, cw[2] - 2, 5, `${g(l.qty)} ${l.unit || ''}`.trim(), 9.5, false, INK, 'C');
      p.textAt(cx[3] + 1, y + 2.6, cw[3] - 3, 5, nepMoney(rate), 9.5, false, INK, 'R');
      p.textAt(cx[4] + 1, y + 2.6, cw[4] - 3, 5, nepMoney(l.amount), 9.5, true, INK, 'R');
      p.line(AX, y + rh, AX + ATW, y + rh, RULE, 0.3);
      y += rh;
    });
    const rows = [['Sub Total', d.discount ? d.gross : d.taxable + d.exempt]];
    if (d.discount) rows.push(['Discount', -d.discount]);
    rows.push([`VAT ${g(this.c.vat_rate || 13)}%`, d.vat]);
    const { tp } = this;
    const stampImg = this.files.get('quote-templates', tp.stamp_file);
    const need = 7 * rows.length + 14 + (stampImg || this.sign ? 24 : 0);
    if (y + need + 4 > A_BOTTOM) { this.newPage(); y = this.y; }
    y += 4;
    const sw = 84, sx = AX + ATW - sw;
    let ty = y;
    for (const [k, v] of rows) {
      p.textAt(sx + 2, ty + 1.3, 40, 4.5, k, 9, false, MUTE);
      p.textAt(sx + 40, ty + 1.3, sw - 42, 4.5, (v < 0 ? '- ' : '') + nepMoney(v), 9.5, false, INK, 'R');
      p.line(sx, ty + 7, sx + sw, ty + 7, RULE, 0.3);
      ty += 7;
    }
    ty += 1.5;
    p.rect(sx, ty, sw, 10, { fill: this.c1, r: 1.5 });
    p.cs = 0.6; p.textAt(sx + 3, ty + 2.8, 40, 4.5, 'GRAND TOTAL', 8.6, true, [255, 255, 255]); p.cs = 0;
    p.textAt(sx + 36, ty + 2.4, sw - 39, 5, `Rs ${nepMoney(d.total)}`, 11.5, true, [255, 255, 255], 'R');
    this.label(AX, y + 1, 'Amount in words');
    p.para(AX, y + 6, ATW - sw - 10, 4.8, amountInWords(d.total), 9.5, true, INK, 'L', 3);
    p.para(AX, y + 21, ATW - sw - 10, 4.2, 'All prices are in Nepalese Rupees (Rs). VAT is charged at the prevailing rate.', 7.8, false, MUTE, 'L', 2);
    this.y = y + 37;                      // Terms & Conditions begins right under the 'All prices…' note, beside the stamp
    this.clear = null;
    // company stamp + the preparer's signature, side by side just below the grand total (pictures only)
    if (stampImg || this.sign) {
      const by = ty + 11.5;
      // real drawn size of each picture (fitted into its box), so the two sit tight against each other
      const fit = (f, w, h) => { try { const im = p.doc.openImage(f.data), s = Math.min(w / im.width, h / im.height); return [im.width * s, im.height * s]; } catch { return [w, h]; } };
      const [sw1, sh1] = this.sign ? fit(this.sign, 34, 16) : [0, 0];
      const [sw2, sh2] = stampImg ? fit(stampImg, 26, 20) : [0, 0];
      const x0 = sx + (sw - sw1 - sw2 - 1) / 2;          // centred under the grand total
      if (this.sign) p.img(this.sign, x0, by, sw1, sh1);
      if (stampImg) p.img(stampImg, x0 + sw1 + 1, by, sw2, sh2);
      this.clear = { until: by + Math.max(sh1, sh2) + 2, w: sx - AX - 4 };   // terms rows stay left of the pictures until they end
    }
  }

  /* 4. terms */
  terms() {
    const { p, d } = this;
    const terms = (d.qt_terms_list || []).filter((r) => String(r?.[0] ?? '').trim() || String(r?.[1] ?? '').trim());
    const notes = String(d.qt_notes || '').trim();
    if (!terms.length && !notes) return;
    if (this.y + 40 > A_BOTTOM) this.newPage();
    let y = this.section('Terms & Conditions', this.y);
    const KW = 50;
    for (const [k, v] of terms) {
      const W = this.clear && y < this.clear.until ? this.clear.w : ATW;     // narrower while beside the signature / stamp
      const kl = p.wrap(k, KW - 6, 9, true).slice(0, 2), vl = p.wrap(v, W - KW - 2, 9);
      const rh = Math.max(kl.length, vl.length) * 4.6 + 4.4;
      if (y + rh > A_BOTTOM) { this.newPage(); y = this.y; }
      p.rect(AX, y + 3.2, 1.6, 1.6, { fill: this.c2 });
      p.linesAt(AX + 4.5, y + 2.2, KW - 6, kl, 9, true, [27, 59, 30], 4.6);
      p.linesAt(AX + KW, y + 2.2, W - KW - 2, vl, 9, false, INK, 4.6);
      p.line(AX, y + rh, AX + W, y + rh, RULE, 0.25);
      y += rh;
    }
    if (notes) {
      const nl = p.wrap(notes, ATW - 16, 9).slice(0, 6);
      const nh = nl.length * 4.6 + 12;
      if (y + nh + 5 > A_BOTTOM) { this.newPage(); y = this.y - 5; }
      y += 5;
      p.rect(AX, y, ATW, nh, { fill: tint(this.c2, 0.88), r: 2 });
      p.rect(AX, y, 1.4, nh, { fill: this.c1 });
      this.label(AX + 6, y + 3.2, 'Note');
      p.linesAt(AX + 6, y + 8, ATW - 12, nl, 9, false, INK, 4.6);
      y += nh;
    }
    this.y = y + 8;
  }

  /* 5. acceptance */
  thanks() {
    const { p, tp, d } = this;
    if (this.y + 86 > A_BOTTOM) this.newPage();
    let y = this.section('Acceptance', this.y);
    y = p.para(AX, y, ATW, 4.8, 'We trust our offer meets your requirements. Kindly sign and return a copy of this quotation as your acceptance, or contact us for any clarification.', 9.5, false, [55, 65, 81], 'L', 3) + 5;
    const bh = 58, bw = 88;
    for (let i = 0; i < 2; i++) p.rect(AX + i * (bw + 4), y, bw, bh, { fill: i ? [255, 255, 255] : [250, 251, 250], stroke: RULE, lw: 0.3, r: 2 });
    let x = AX;
    this.label(x + 5, y + 4, `For ${this.c.name}`.slice(0, 46));
    const stamp = this.files.get('quote-templates', tp.stamp_file);
    if (this.sign) p.img(this.sign, x + 5, y + 10, 36, 18);
    if (stamp) p.img(stamp, x + 56, y + 8, 26, 22);
    p.line(x + 5, y + 31, x + 60, y + 31, MUTE, 0.25);
    let yy = y + 33;
    if (tp.prepared_name) { p.textAt(x + 5, yy, bw - 10, 5, tp.prepared_name, 10.5, true, INK); yy += 5.6; }
    for (const [v, col] of [[tp.prepared_post, MUTE], [tp.prepared_phone && `Phone: ${tp.prepared_phone}`, MUTE], [tp.prepared_email, this.c1]]) {
      if (v) { p.textAt(x + 5, yy, bw - 10, 4.4, v, 8.6, false, col); yy += 4.6; }
    }
    x = AX + bw + 4;
    this.label(x + 5, y + 4, 'Accepted by');
    p.textAt(x + 5, y + 9.5, bw - 10, 5, d.party_name, 10.5, true, INK);
    [['Name', 22], ['Designation', 31], ['Signature & Stamp', 42], ['Date', 52]].forEach(([lbl, ly]) => {
      p.textAt(x + 5, y + ly - 4.2, 34, 4, lbl, 8, false, MUTE);
      p.line(x + 36, y + ly, x + bw - 5, y + ly, [200, 205, 210], 0.25, 1);
    });
    y += bh + 8;
    p.textAt(AX, y, ATW, 5, 'Thank you for your business.', 11, true, this.c1, 'C');
    p.textAt(AX, y + 6, ATW, 4.5, [this.website, this.phones && `Phone: ${this.phones}`, this.c.email].filter(Boolean).join('   ·   '), 8.4, false, MUTE, 'C');
    this.y = y + 12;
  }
}

/** '2-5, 7' -> [1, 2, 3, 4, 6] (0-based). Empty = every page. */
function pageList(spec, count) {
  const s = String(spec || '').trim();
  if (!s) return Array.from({ length: count }, (_, i) => i);
  const out = [];
  for (const part0 of s.split(',')) {
    const [a, b] = part0.trim().split('-');
    const lo = parseInt(a, 10), hi = parseInt(b ?? a, 10);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (let p = Math.min(lo, hi); p <= Math.max(lo, hi); p++) if (p >= 1 && p <= count && !out.includes(p - 1)) out.push(p - 1);
  }
  return out;
}

async function loadKit() {
  try { return [(await import('pdfkit')).default, await import('pdf-lib')]; } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') throw Object.assign(new Error('PDF support is not installed on the server yet (packages "pdfkit" and "pdf-lib"). Ask your administrator.'), { status: 501 });
    throw e;
  }
}

export async function quotationPdf(company, d, tpl, items) {
  const [PDFDocument, pdfLib] = await loadKit();
  // pre-load every stored file the layout can use (drawing is synchronous)
  const cache = new Map();
  const want = [];
  for (const c of ['logo_file', 'cover_file', 'sign_file', 'stamp_file', 'brand_zk_file', 'brand_yoi_file']) want.push(['quote-templates', tpl[c]]);
  for (const e of tpl.profile_list || []) want.push(['quote-templates', e.file]);
  want.push(['quotes', d.qt_client_logo], ['quote-signers', tpl.signer_file]);
  for (const i of Object.values(items || {})) want.push(['items', i.image_file]);
  for (const [kind, name] of want) if (name && !cache.has(`${kind}/${name}`)) cache.set(`${kind}/${name}`, await getFile(kind, name));
  const files = { get: (kind, name) => (name ? cache.get(`${kind}/${name}`) || null : null) };

  const q = new Q(PDFDocument);
  const b = new Builder(q, company, d, tpl, items || {}, files);
  b.cover();
  await b.profile(pdfLib);
  b.proposal();
  b.terms();
  b.thanks();
  // "Page x of y" on every page except the cover
  const total = q.doc.bufferedPageRange().count;
  for (const pi of b.footerPages) {
    q.doc.switchToPage(pi);
    q.font(7, false, MUTE);
    q.textAt(AX + ATW - 28, AH - 13, 28, 4, `Page ${pi + 1} of ${total}`, 7, false, MUTE, 'R');
  }
  const raw = await q.end();
  if (!b.place.length) return raw;

  // merge the template's uploaded PDF pages into their boxes
  const out = await pdfLib.PDFDocument.load(raw);
  const srcs = new Map();
  for (const [pageIdx, data, srcIdx, x, y, w, h] of b.place) {
    try {
      let src = srcs.get(data);
      if (!src) { src = await pdfLib.PDFDocument.load(data, { ignoreEncryption: true }); srcs.set(data, src); }
      const [emb] = await out.embedPdf(src, [srcIdx]);
      out.getPage(pageIdx).drawPage(emb, { x: x * K, y: (AH - y - h) * K, width: w * K, height: h * K });
    } catch { /* skip an unreadable page */ }
  }
  return Buffer.from(await out.save());
}
