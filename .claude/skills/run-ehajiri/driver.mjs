#!/usr/bin/env node
/**
 * eHajiri driver — Playwright-based harness for driving the running dev
 * servers (Vite on :4000, Express API on :5001) from the command line.
 *
 * No chromium-cli is available in this environment, so this script fills
 * that role. It is intentionally a thin, general-purpose CLI: `goto`,
 * `screenshot`, `login`, and `smoke` are the primitives; add more
 * subcommands as needed rather than writing one-off scripts per task.
 *
 * Usage:
 *   node driver.mjs smoke [outDir]                  # full login + nav smoke test
 *   node driver.mjs screenshot <path> <out.png>      # screenshot any route (logged out)
 *   node driver.mjs login-screenshot <path> <out.png> [email] [password]
 *
 * Env:
 *   BASE_URL     defaults to http://localhost:4000
 *   HEADLESS     "false" to see the browser (defaults headless)
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const BASE_URL  = process.env.BASE_URL || 'http://localhost:4000';
const HEADLESS  = process.env.HEADLESS !== 'false';
const DEFAULT_EMAIL    = 'admin';
const DEFAULT_PASSWORD = '#28O29@9837'; // system admin seeded by migrations/runner.js v21 — see SKILL.md

async function withBrowser(fn) {
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  try {
    return await fn(page, consoleErrors);
  } finally {
    await browser.close();
  }
}

/**
 * Logs in via a direct API call and injects the session into localStorage,
 * then loads /dashboard. See "Gotcha: login form blocks non-email usernames"
 * in SKILL.md for why this bypasses the on-screen form rather than typing
 * into it — the seeded system admin's username ("admin") fails the login
 * input's native `type="email"` validation, so the browser silently refuses
 * to fire the submit event no matter how the fields are filled.
 */
async function login(page, username = DEFAULT_EMAIL, password = DEFAULT_PASSWORD) {
  await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle' }); // establish origin for localStorage
  const loginRes = await page.request.post(BASE_URL + '/api/auth/login', {
    data: { username, password },
  });
  if (!loginRes.ok()) {
    throw new Error(`API login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }
  const { token, ...user } = await loginRes.json();
  await page.evaluate(([t, u]) => {
    localStorage.setItem('auth_token', t);
    localStorage.setItem('current_user', JSON.stringify(u));
  }, [token, user]);
  await page.goto(BASE_URL + '/dashboard', { waitUntil: 'networkidle' });
}

async function cmdScreenshot(routePath, outFile) {
  await withBrowser(async (page) => {
    await page.goto(BASE_URL + routePath, { waitUntil: 'networkidle' });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await page.screenshot({ path: outFile, fullPage: true });
    console.log('Saved', outFile);
  });
}

async function cmdLoginScreenshot(routePath, outFile, email, password) {
  await withBrowser(async (page) => {
    await login(page, email, password);
    if (routePath && routePath !== '/dashboard') {
      await page.goto(BASE_URL + routePath, { waitUntil: 'networkidle' });
    }
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await page.screenshot({ path: outFile, fullPage: true });
    console.log('Saved', outFile);
  });
}

async function cmdSmoke(outDir = '.') {
  fs.mkdirSync(outDir, { recursive: true });
  let failures = 0;
  await withBrowser(async (page, consoleErrors) => {
    console.log('[1/4] Loading login page…');
    await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(outDir, '01-login.png') });
    const hasForm = await page.locator('.login-form').count();
    if (!hasForm) { console.error('FAIL: login form not found'); failures++; }
    else console.log('  OK: login form rendered');

    console.log('[2/4] Logging in as system admin…');
    await login(page);
    const greeting = await page.locator('body').innerText();
    if (!/dashboard/i.test(page.url())) { console.error('FAIL: did not land on /dashboard, got', page.url()); failures++; }
    else console.log('  OK: reached', page.url());
    await page.screenshot({ path: path.join(outDir, '02-dashboard.png'), fullPage: true });

    console.log('[3/4] Navigating to Daily Attendance Report…');
    await page.goto(BASE_URL + '/attendance/reports/daily', { waitUntil: 'networkidle' });
    const gridRows = await page.locator('table tbody tr, .dg-row').count();
    console.log(`  OK: attendance report loaded (${gridRows} grid rows)`);
    await page.screenshot({ path: path.join(outDir, '03-daily-attendance.png'), fullPage: true });

    console.log('[4/4] Navigating to Role & Permission Management…');
    await page.goto(BASE_URL + '/settings/roles', { waitUntil: 'networkidle' });
    const hasMatrix = await page.locator('text=Leave Calculation').count();
    if (!hasMatrix) { console.error('FAIL: role matrix did not render expected content'); failures++; }
    else console.log('  OK: role matrix rendered');
    await page.screenshot({ path: path.join(outDir, '04-role-management.png'), fullPage: true });

    if (consoleErrors.length) {
      console.warn(`\n${consoleErrors.length} browser console error(s) during the run:`);
      consoleErrors.slice(0, 10).forEach((e) => console.warn('  -', e));
    }
  });

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
}

const [, , cmd, ...args] = process.argv;
switch (cmd) {
  case 'smoke':             await cmdSmoke(args[0]); break;
  case 'screenshot':        await cmdScreenshot(args[0], args[1]); break;
  case 'login-screenshot':  await cmdLoginScreenshot(args[0], args[1], args[2], args[3]); break;
  default:
    console.error('Usage: node driver.mjs <smoke|screenshot|login-screenshot> [args...]');
    process.exit(1);
}
