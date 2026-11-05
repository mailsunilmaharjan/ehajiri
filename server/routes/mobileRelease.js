import { Router } from 'express';
import fs from 'fs';
import path from 'path';

/* Update channel for the eHajiri Android app (sideloaded APK). Public on purpose - the app asks before anyone signs in, and the
   APK itself holds nothing secret. To publish a new version: copy the APK and a latest.json next to it into the releases folder
   (default C:\Attendance\mobile-releases, or MOBILE_RELEASES_DIR):
     latest.json = { "versionCode": 3, "versionName": "1.2.0", "apk": "eHajiri.apk", "notes": "What's new...", "mandatory": false }
   Installed apps whose versionCode is lower then show an "Update available" prompt. No server restart is needed. */
const router = Router();
const dir = () => process.env.MOBILE_RELEASES_DIR || 'C:/Attendance/mobile-releases';
const readLatest = () => { try { return JSON.parse(fs.readFileSync(path.join(dir(), 'latest.json'), 'utf8')); } catch { return null; } };

router.get('/latest', (_req, res) => {
  const j = readLatest();
  res.set('Cache-Control', 'no-store');
  if (!j) return res.json({ versionCode: 0 });
  res.json({ versionCode: Number(j.versionCode) || 0, versionName: String(j.versionName || ''), notes: String(j.notes || '').slice(0, 1000), mandatory: !!j.mandatory });
});

router.get('/apk', (_req, res) => {
  const j = readLatest();
  const file = j && path.join(dir(), path.basename(String(j.apk || '')));
  if (!file || !file.toLowerCase().endsWith('.apk') || !fs.existsSync(file)) return res.status(404).json({ error: 'No app update is published.' });
  res.set('Cache-Control', 'no-store');
  res.download(file, `eHajiri-${j.versionName || j.versionCode}.apk`);
});

export default router;
