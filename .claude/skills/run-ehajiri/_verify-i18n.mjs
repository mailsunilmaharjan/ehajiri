// One-off: verify Nepali menu translations, flag toggle, online-only device list — delete after use.
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:4000';
const OUT = process.argv[2] || '.';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

async function goto(url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
}

await goto(BASE_URL + '/login');
const res = await page.request.post(BASE_URL + '/api/auth/login', {
  data: { username: 'admin', password: '#28O29@9837' },
});
const { token, ...user } = await res.json();
await page.evaluate(([t, u]) => {
  localStorage.setItem('auth_token', t);
  localStorage.setItem('current_user', JSON.stringify(u));
  localStorage.setItem('app_language', 'np');   // Nepali
}, [token, user]);
await goto(BASE_URL + '/dashboard');

// 1. open the Staff (कर्मचारी) dropdown — should show Nepali labels + flag toggle
await page.locator('text=कर्मचारी').first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + '/np-menu.png' });
console.log('saved np-menu.png');

// 2. Device Connectivity — click a staff Full Name on /users
await goto(BASE_URL + '/users');
await page.locator('td:has-text("Manita Shrstha")').first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + '/device-panel.png' });
console.log('saved device-panel.png');

await browser.close();
