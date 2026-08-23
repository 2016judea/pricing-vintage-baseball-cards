// Sign in to eBay and persist the session in .browser-profile, so
// ebay_comps.mjs can read SOLD listings (which eBay gates behind login).
//
// Credentials come from .env (EBAY_USER / EBAY_PASS), which is gitignored.
// eBay frequently answers automated logins with a CAPTCHA or a one-time code.
// We do not try to defeat those — the window is visible, and the script pauses
// for Aidan to clear the challenge by hand, then reuses the trusted session.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT, PROFILE_DIR, launchArgs } from './_browser.mjs';

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split('\n').filter(l => l.trim() && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
if (!env.EBAY_USER || !env.EBAY_PASS) { console.error('.env missing EBAY_USER / EBAY_PASS'); process.exit(2); }

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, launchArgs());
const page = ctx.pages()[0] ?? await ctx.newPage();

const isChallenge = async () =>
  /splashui|captcha|challenge/i.test(page.url()) || /security measure|verify yourself/i.test(await page.title() + await page.locator('body').innerText().catch(() => ''));

// A session is only "good" if a sold-search page actually renders result rows.
const sessionWorks = async () => {
  await page.goto('https://www.ebay.com/sch/i.html?_nkw=topps+baseball&LH_Sold=1&LH_Complete=1',
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  if (await isChallenge()) return false;
  if (/sign in|register/i.test(await page.title())) return false;
  return await page.evaluate(() =>
    document.querySelectorAll('li.s-item, li.s-card, .s-card').length > 3);
};

const waitForHuman = async (why, mins = 8) => {
  console.log(`\n  >>> ${why}`);
  console.log('  >>> Please clear it in the open Chrome window. Waiting...\n');
  const until = Date.now() + mins * 60000;
  while (Date.now() < until) {
    await page.waitForTimeout(5000);
    if (!(await isChallenge())) { console.log('  challenge cleared, continuing\n'); return true; }
  }
  return false;
};

console.log('checking existing session...');
if (await sessionWorks()) {
  console.log('\n  Already signed in and sold listings render. Nothing to do.\n');
  await ctx.close(); process.exit(0);
}

console.log('signing in...');
await page.goto('https://signin.ebay.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1500);
if (await isChallenge()) await waitForHuman('eBay showed a CAPTCHA on the sign-in page.');

try {
  await page.fill('#userid', env.EBAY_USER, { timeout: 20000 });
  await page.click('#signin-continue-btn').catch(() => {});
  await page.waitForTimeout(2500);
  if (await isChallenge()) await waitForHuman('eBay challenged after the username step.');
  await page.fill('#pass', env.EBAY_PASS, { timeout: 20000 });
  await page.click('#sgnBt').catch(() => page.keyboard.press('Enter'));
  await page.waitForTimeout(5000);
} catch (e) {
  console.log('  form fields differed from expected; falling back to manual entry.');
}

if (await isChallenge()) {
  await waitForHuman('eBay challenged the login (CAPTCHA or one-time code).');
}

// 2FA / device verification codes go to Aidan's email or phone — only he can enter them.
if (/verify|challenge|twostep|otp/i.test(page.url())) {
  await waitForHuman('eBay wants a verification code sent to your email/phone.', 10);
}

const ok = await sessionWorks();
console.log(ok
  ? '\n  Signed in. Sold listings render correctly. Session saved to .browser-profile\n'
  : '\n  Still cannot read sold listings. Leave the window open, sign in manually, then re-run.\n');
await ctx.close();
process.exit(ok ? 0 : 1);
