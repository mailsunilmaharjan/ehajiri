import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { execFile } from 'child_process';

/* ──────────────────────────────────────────────────────────────────────────
   Upload scanner — every image / document that reaches the server (they all
   arrive as base64 data URLs inside JSON bodies, see middleware/uploadGuard.js)
   is checked here BEFORE it is saved. A file is blocked when it is:
     • not really what it claims to be (an .exe renamed to .png, etc.),
     • an executable / script / installer / shortcut / archive,
     • a macro-enabled Office file, a PDF with JavaScript / launch actions,
       an SVG or HTML with script, a zip bomb or an archive hiding executables,
     • carrying known malware / hacking-tool / web-shell signatures,
     • flagged by Windows Defender (when present on the server).
   scanUpload() never throws for a detection — it returns { ok:false, reasons }.
   ────────────────────────────────────────────────────────────────────────── */

const DANGEROUS_EXT = new Set([
  'exe','dll','com','bat','cmd','ps1','psm1','psd1','vbs','vbe','js','jse','wsf','wsh','msi','msp','mst','scr','pif',
  'hta','cpl','jar','jnlp','lnk','reg','inf','sys','drv','ocx','application','gadget','msc','py','pyw','rb','pl','sh',
  'bash','zsh','php','phtml','phar','php3','php4','php5','php7','asp','aspx','ashx','asmx','jsp','jspx','cgi','html',
  'htm','xhtml','shtml','mht','mhtml','apk','ipa','dmg','iso','img','vhd','vhdx','swf','chm','appx','msix','scf','url',
  'xll','wll','docm','xlsm','pptm','dotm','xltm','xlam','ppam','sldm','vb','elf','bin','run','deb','rpm','cab','rar',
  '7z','tar','gz','tgz','bz2','xz','zipx','crx','xpi','ps1xml','psc1','sct','wsc','reg','dat_exe',
]);

/* Strong, low-false-positive markers (matched case-insensitively against the raw bytes). */
const MALWARE_SIGNATURES = [
  ['EICAR-STANDARD-ANTIVIRUS-TEST-FILE', 'antivirus test / malware signature'],
  ['mimikatz', 'credential-theft tool (Mimikatz)'],
  ['sekurlsa::', 'credential-theft tool (Mimikatz)'],
  ['invoke-mimikatz', 'credential-theft tool (Mimikatz)'],
  ['meterpreter', 'Metasploit / Meterpreter payload'],
  ['msfvenom', 'Metasploit payload generator'],
  ['metasploit', 'Metasploit framework'],
  ['cobaltstrike', 'Cobalt Strike beacon'],
  ['cobalt strike', 'Cobalt Strike beacon'],
  ['powersploit', 'PowerSploit hacking toolkit'],
  ['invoke-shellcode', 'shellcode injector'],
  ['invoke-reflectivepeinjection', 'reflective PE injector'],
  ['sharphound', 'BloodHound / SharpHound recon tool'],
  ['lazagne', 'password-dumping tool (LaZagne)'],
  ['rubeus', 'Kerberos attack tool (Rubeus)'],
  ['bash -i >& /dev/tcp/', 'reverse shell'],
  ['/bin/sh -i', 'reverse shell'],
  ['nc -e /bin', 'reverse shell'],
  ['c99shell', 'PHP web shell'],
  ['r57shell', 'PHP web shell'],
  ['b374k', 'PHP web shell'],
  ['wso shell', 'PHP web shell'],
  ['eval(base64_decode', 'obfuscated PHP backdoor'],
  ['eval($_post', 'PHP backdoor'],
  ['eval($_request', 'PHP backdoor'],
  ['eval($_get', 'PHP backdoor'],
  ['system($_get', 'PHP backdoor'],
  ['system($_post', 'PHP backdoor'],
  ['passthru($_', 'PHP backdoor'],
  ['shell_exec($_', 'PHP backdoor'],
  ['setwindowshookex', 'keylogger / spyware API'],
  ['getasynckeystate', 'keylogger / spyware API'],
  ['wscript.shell', 'script that runs system commands'],
  ['-encodedcommand', 'encoded PowerShell command'],
  ['downloadstring(', 'script that downloads and runs code'],
  ['frombase64string(', 'script that decodes hidden code'],
  ['this program cannot be run in dos mode', 'Windows executable inside the file'],
].map(([sig, why]) => [Buffer.from(sig.toLowerCase(), 'latin1'), why]);

const SCRIPT_MARKERS = [
  ['<script', 'embedded script'],
  ['<?php', 'PHP code'],
  ['<%@', 'server-side script'],
  ['<%=', 'server-side script'],
  ['javascript:', 'script link'],
  ['vbscript:', 'script link'],
  ['#!/bin/', 'shell script'],
  ['#!/usr/bin/', 'shell script'],
  ['@echo off', 'batch script'],
  ['powershell -', 'PowerShell command'],
  ['cmd.exe /c', 'command-line execution'],
  ['createobject(', 'script that runs system commands'],
].map(([sig, why]) => [Buffer.from(sig, 'latin1'), why]);

const hasBytes = (hay, needle) => hay.indexOf(needle) !== -1;
const lower = (buf) => {
  // cheap ASCII lower-casing, keeps bytes >= 0x80 untouched
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) { const c = buf[i]; out[i] = (c >= 65 && c <= 90) ? c + 32 : c; }
  return out;
};

/* ── type sniffing by magic bytes ── */
function sniff(buf) {
  const b = buf;
  const startsWith = (...bytes) => bytes.every((x, i) => b[i] === x);
  const asc = (s, off = 0) => b.slice(off, off + s.length).toString('latin1') === s;
  if (b.length < 4) return { kind: b.length === 0 ? 'empty' : 'text' };
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return { kind: 'image', sub: 'png' };
  if (startsWith(0xff, 0xd8, 0xff)) return { kind: 'image', sub: 'jpeg' };
  if (asc('GIF87a') || asc('GIF89a')) return { kind: 'image', sub: 'gif' };
  if (asc('RIFF') && asc('WEBP', 8)) return { kind: 'image', sub: 'webp' };
  if (asc('BM') && b.length > 26) return { kind: 'image', sub: 'bmp' };
  if (asc('ftyp', 4) && /^(heic|heix|hevc|hevx|mif1|msf1|avif|avis)/.test(b.slice(8, 12).toString('latin1'))) return { kind: 'image', sub: 'heif' };
  if (asc('%PDF')) return { kind: 'pdf' };
  if (asc('PK\x03\x04') || asc('PK\x05\x06')) return { kind: 'zip' };
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return { kind: 'ole' };
  if (asc('{\\rtf')) return { kind: 'rtf' };
  // dangerous binaries
  if (asc('MZ')) return { kind: 'danger', why: 'Windows executable (.exe / .dll)' };
  if (startsWith(0x7f, 0x45, 0x4c, 0x46)) return { kind: 'danger', why: 'Linux executable (ELF)' };
  if (startsWith(0xca, 0xfe, 0xba, 0xbe)) return { kind: 'danger', why: 'Java class / macOS executable' };
  if (startsWith(0xfe, 0xed, 0xfa, 0xce) || startsWith(0xfe, 0xed, 0xfa, 0xcf) || startsWith(0xce, 0xfa, 0xed, 0xfe) || startsWith(0xcf, 0xfa, 0xed, 0xfe))
    return { kind: 'danger', why: 'macOS executable (Mach-O)' };
  if (asc('#!')) return { kind: 'danger', why: 'script file (#!)' };
  if (asc('Rar!')) return { kind: 'danger', why: 'RAR archive' };
  if (startsWith(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return { kind: 'danger', why: '7-Zip archive' };
  if (startsWith(0x1f, 0x8b)) return { kind: 'danger', why: 'compressed archive (gzip)' };
  if (asc('MSCF')) return { kind: 'danger', why: 'cabinet / installer archive' };
  if (startsWith(0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00)) return { kind: 'danger', why: 'Windows shortcut (.lnk)' };
  // text?
  const head = b.slice(0, 4096);
  if (head.indexOf(0) === -1) {
    const t = head.toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
    if (t.startsWith('<svg') || (t.startsWith('<?xml') && t.includes('<svg'))) return { kind: 'svg' };
    if (t.startsWith('<!doctype html') || t.startsWith('<html') || t.startsWith('<head') || t.startsWith('<body')) return { kind: 'html' };
    return { kind: 'text' };
  }
  // UTF-16 text (BOM)
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return { kind: 'text16' };
  return { kind: 'unknown' };
}

/* ── ZIP central directory (no external library) ── */
function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count && n < 100000; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const xlen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    entries.push({ name, method, csize, usize, lho });
    off += 46 + nlen + xlen + clen;
  }
  return entries;
}
function inflateEntry(buf, e, maxOut = 2 * 1024 * 1024) {
  try {
    const lo = e.lho;
    if (buf.readUInt32LE(lo) !== 0x04034b50) return null;
    const dataStart = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.slice(dataStart, dataStart + e.csize);
    if (e.method === 0) return raw.slice(0, maxOut);
    if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: maxOut });
  } catch { /* ignore */ }
  return null;
}

function checkOoxml(buf, reasons) {
  const entries = readZipEntries(buf);
  if (!entries) { reasons.push('damaged or malformed Office / zip file'); return; }
  if (entries.length > 5000) { reasons.push('archive with too many entries (zip bomb)'); return; }
  let total = 0;
  let hasContentTypes = false;
  for (const e of entries) {
    const n = e.name.replace(/\\/g, '/');
    const ln = n.toLowerCase();
    total += e.usize;
    if (n.startsWith('/') || n.split('/').includes('..') || /^[a-z]:/i.test(n)) { reasons.push('archive entry escapes its folder (path traversal)'); return; }
    if (ln === '[content_types].xml') hasContentTypes = true;
    if (ln.endsWith('vbaproject.bin') || ln.includes('vbadata.xml')) { reasons.push('contains VBA macros'); return; }
    if (ln.includes('/activex/') || ln.startsWith('activex/')) { reasons.push('contains ActiveX controls'); return; }
    const ext = ln.includes('.') ? ln.split('.').pop() : '';
    if (DANGEROUS_EXT.has(ext)) { reasons.push(`hides a "${ext}" program/script inside`); return; }
    if (e.csize > 0 && e.usize / e.csize > 200 && e.usize > 5 * 1024 * 1024) { reasons.push('zip bomb (extreme compression ratio)'); return; }
  }
  if (total > 300 * 1024 * 1024) { reasons.push('expands to an unreasonable size (zip bomb)'); return; }
  if (!hasContentTypes) { reasons.push('not a genuine Office document'); return; }
  // peek at relationship parts for remote-template / external-object injection
  for (const e of entries) {
    const ln = e.name.toLowerCase();
    if (!ln.endsWith('.rels') || e.usize > 1024 * 1024) continue;
    const data = inflateEntry(buf, e);
    if (!data) continue;
    const txt = data.toString('utf8').toLowerCase();
    if (txt.includes('attachedtemplate') && txt.includes('targetmode="external"')) { reasons.push('loads a remote template (document injection)'); return; }
    if (/oleobject[^>]*targetmode="external"/.test(txt) || /mhtml:|\.hta|\.sct|file:\/\/\//.test(txt)) { reasons.push('links to an external program/object'); return; }
  }
}

function checkPdf(buf, reasons) {
  const text = buf.toString('latin1');
  // undo #xx name escapes used to hide keywords (/J#61vaScript)
  const norm = text.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const bad = [['/JavaScript', 'JavaScript'], ['/JS', 'JavaScript'], ['/Launch', 'launch-program action'],
    ['/RichMedia', 'embedded media/Flash'], ['/EmbeddedFile', 'embedded file'], ['/XFA', 'XFA form script']];
  for (const [k, why] of bad) {
    const re = new RegExp(k.replace('/', '\\/') + '(?![A-Za-z])');
    if (re.test(norm)) { reasons.push(`PDF contains ${why}`); return; }
  }
}

function checkOle(buf, reasons) {
  const s = buf.toString('latin1');
  const u = buf.toString('utf16le');
  if (/_VBA_PROJECT|Macros\/VBA|VBA\/ThisDocument|Attribute VB_Name/i.test(s) || /_VBA_PROJECT|Attribute VB_Name/i.test(u)) reasons.push('contains VBA macros');
}

function checkSvg(buf, reasons) {
  const t = buf.toString('utf8').toLowerCase();
  if (/<script|javascript:|vbscript:|<foreignobject|<iframe|<embed|<object|<!entity|\son[a-z]+\s*=|data:text\/html/.test(t)) reasons.push('SVG contains script or active content');
}

function checkText(buf, reasons) {
  const t = buf.toString('utf8').toLowerCase();
  for (const [m, why] of SCRIPT_MARKERS) if (t.includes(m.toString('latin1'))) { reasons.push(`file contains ${why}`); return; }
}

/* ── main entry ── */
export function inspectBuffer(buf, { declaredMime = '', filename = '' } = {}) {
  const reasons = [];
  if (!buf || !buf.length) return { ok: true, reasons };
  const mime = String(declaredMime || '').toLowerCase().split(';')[0].trim();

  // 1. file name
  if (filename) {
    const parts = String(filename).toLowerCase().split('.').slice(1);
    const hit = parts.find(p => DANGEROUS_EXT.has(p.trim()));
    if (hit) reasons.push(`file type ".${hit}" is not allowed`);
  }

  // 2. real type vs claim
  const s = sniff(buf);
  if (s.kind === 'danger') reasons.push(`is a ${s.why}`);
  if (s.kind === 'unknown') reasons.push('unrecognised binary file');
  if (s.kind === 'html') reasons.push('HTML pages are not allowed');
  if (s.kind === 'zip') { /* OOXML checked below */ }
  const claimsImage = mime.startsWith('image/');
  if (claimsImage && !['image', 'svg'].includes(s.kind) && s.kind !== 'danger') reasons.push('claims to be an image but is not');
  if (mime === 'application/pdf' && s.kind !== 'pdf' && s.kind !== 'danger') reasons.push('claims to be a PDF but is not');
  if (/openxmlformats|vnd\.ms-(word|excel|powerpoint)|msword/.test(mime) && !['zip', 'ole'].includes(s.kind) && s.kind !== 'danger') reasons.push('claims to be an Office document but is not');
  if (mime === 'image/svg+xml' && s.kind !== 'svg') reasons.push('claims to be SVG but is not');
  if (s.kind === 'zip' && !/openxmlformats|officedocument|msword|excel|powerpoint|^$|application\/(zip|octet-stream)/.test(mime) && !claimsImage && !mime.startsWith('text/')) { /* keep going */ }

  // 3. deep checks per kind
  if (reasons.length === 0) {
    if (s.kind === 'zip') checkOoxml(buf, reasons);
    else if (s.kind === 'ole') checkOle(buf, reasons);
    else if (s.kind === 'pdf') checkPdf(buf, reasons);
    else if (s.kind === 'svg') checkSvg(buf, reasons);
    else if (s.kind === 'text') checkText(buf, reasons);
    else if (s.kind === 'rtf') { if (/\\objdata|\\objupdate|\\\*\\objdata/i.test(buf.toString('latin1'))) reasons.push('RTF with embedded object'); }
  }

  // 4. signatures in the raw bytes (also catches polyglot images with code appended)
  if (reasons.length === 0) {
    const lo = lower(buf.length > 32 * 1024 * 1024 ? buf.slice(0, 32 * 1024 * 1024) : buf);
    for (const [sig, why] of MALWARE_SIGNATURES) if (hasBytes(lo, sig)) { reasons.push(`contains ${why}`); break; }
    if (reasons.length === 0 && ['image', 'pdf'].includes(s.kind)) {
      for (const [sig, why] of SCRIPT_MARKERS.slice(0, 5)) if (hasBytes(lo, sig)) { reasons.push(`image/document has hidden ${why}`); break; }
    }
  }
  return { ok: reasons.length === 0, reasons, kind: s.kind };
}

/* ── Windows Defender (best effort, skipped where unavailable) ── */
const MPCMD = process.platform === 'win32'
  ? ['C:\\Program Files\\Windows Defender\\MpCmdRun.exe', 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\CurrentVersion\\MpCmdRun.exe']
      .find(p => { try { return fs.existsSync(p); } catch { return false; } })
  : null;
let active = 0;
const waiters = [];
const acquire = () => new Promise(res => { if (active < 3) { active++; res(); } else waiters.push(res); });
const release = () => { const n = waiters.shift(); if (n) n(); else active--; };

export async function defenderScan(buf) {
  if (!MPCMD) return { ok: true, skipped: true };
  await acquire();
  const dir = path.join(os.tmpdir(), 'ehajiri-scan');
  const file = path.join(dir, crypto.randomBytes(10).toString('hex') + '.bin');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buf);
    await new Promise(r => setTimeout(r, 60));
    // real-time protection may already have removed it → that is a detection too
    if (!fs.existsSync(file)) return { ok: false, threat: 'removed by antivirus real-time protection' };
    const code = await new Promise((resolve) => {
      execFile(MPCMD, ['-Scan', '-ScanType', '3', '-File', file, '-DisableRemediation'], { timeout: 30000, windowsHide: true },
        (err) => resolve(err ? (typeof err.code === 'number' ? err.code : -1) : 0));
    });
    if (code === 2) return { ok: false, threat: 'detected by Windows Defender' };
    if (!fs.existsSync(file)) return { ok: false, threat: 'removed by antivirus real-time protection' };
    return { ok: true };
  } catch { return { ok: true, skipped: true }; }
  finally { try { fs.unlinkSync(file); } catch { /* ignore */ } release(); }
}

/* Short-lived cache so re-saving the same form doesn't rescan the same bytes. */
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;
export async function scanUpload(buf, meta = {}) {
  const key = crypto.createHash('sha256').update(buf).update(String(meta.declaredMime || '')).update(String(meta.filename || '')).digest('hex');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.r;
  let result = inspectBuffer(buf, meta);
  if (result.ok) {
    const d = await defenderScan(buf);
    if (!d.ok) result = { ok: false, reasons: [d.threat || 'flagged as malware'] };
  }
  cache.set(key, { t: Date.now(), r: result });
  if (cache.size > 500) for (const [k, v] of cache) { if (Date.now() - v.t > CACHE_MS) cache.delete(k); }
  return result;
}
