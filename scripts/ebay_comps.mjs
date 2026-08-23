// Pull eBay SOLD comps for a card or sealed product.
//
//   node scripts/ebay_comps.mjs "2009 Topps factory sealed complete set" \
//        --exclude "hand collated,opened,empty box" --require "topps,2009" --limit 60
//
// Sold listings require a signed-in session — run scripts/ebay_login.mjs first.
//
// Why the filtering matters: raw card comps are polluted with lots, reprints,
// customs and empty boxes, and graded prices are 3-20x raw. Averaging them all
// together produces a number that describes nothing. So we bucket by grade and
// report the MEDIAN, which survives the outliers that a mean does not.
import { chromium } from 'playwright';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ROOT, PROFILE_DIR, launchArgs } from './_browser.mjs';

const argv = process.argv.slice(2);
const query = argv.find(a => !a.startsWith('--'));
if (!query) {
  console.error('usage: node scripts/ebay_comps.mjs "<search>" [--require a,b] [--exclude x,y] [--limit N] [--label id] [--json]');
  process.exit(2);
}
const opt = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
const csv = v => (v ? v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []);

const REQUIRE = csv(opt('require'));
const LIMIT = parseInt(opt('limit', '60'), 10);
const LABEL = opt('label');
const AS_JSON = argv.includes('--json');

// Junk that reliably contaminates card/sealed-product comps.
const DEFAULT_EXCLUDE = [
  'reprint', 'custom', 'digital', 'topps now digital', 'sticker',
  'empty box', 'empty', 'wrapper', 'box only', 'no cards',
  'lot of', 'you pick', 'u pick', 'choose', 'read description', 'damaged',
];
const EXCLUDE = [...DEFAULT_EXCLUDE, ...csv(opt('exclude'))];

const url = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(query) +
            '&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=120';

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, launchArgs());
const page = ctx.pages()[0] ?? await ctx.newPage();

await page.goto('https://www.ebay.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1200);
const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(2500);

const pageTitle = await page.title();
if (/sign in|register/i.test(pageTitle)) {
  console.error('\n  eBay is gating sold listings behind sign-in.');
  console.error('  Run:  node scripts/ebay_login.mjs\n');
  await ctx.close();
  process.exit(3);
}
if (resp && resp.status() >= 400) {
  console.error(`  eBay returned HTTP ${resp.status()} — likely rate-limited. Wait a few minutes.`);
  await ctx.close();
  process.exit(4);
}

const rawItems = await page.evaluate(() => {
  const nodes = new Set();
  for (const sel of ['li.s-item', 'li.s-card', '.s-card', '[data-testid="item-card"]']) {
    document.querySelectorAll(sel).forEach(n => nodes.add(n));
  }
  const pick = (el, sels) => {
    for (const s of sels) { const n = el.querySelector(s); if (n?.innerText?.trim()) return n.innerText.trim(); }
    return null;
  };
  return [...nodes].map(el => ({
    title: pick(el, ['.s-item__title', '.s-card__title', '[role="heading"]', 'h3']),
    priceText: pick(el, ['.s-item__price', '.s-card__price', '.su-styled-text.primary']),
    text: (el.innerText || '').slice(0, 600),
    href: el.querySelector('a[href*="/itm/"]')?.href ?? null,
  }));
});

const MONEY = /\$\s?([\d,]+(?:\.\d{2})?)/;
const GRADE = /\b(PSA|BGS|SGC|CSG|BVG)\s*\.?\s*(10|9\.5|9|8\.5|8|7|6|5)\b/i;
const SOLD_DATE = /Sold\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/;

const seen = new Set();
const items = [];
for (const r of rawItems) {
  const title = (r.title || '').replace(/^New Listing/i, '').trim();
  if (!title || /^shop on ebay$/i.test(title)) continue;
  const lower = title.toLowerCase();
  if (EXCLUDE.some(x => lower.includes(x))) continue;
  if (REQUIRE.length && !REQUIRE.every(t => lower.includes(t))) continue;

  const m = (r.priceText || r.text || '').match(MONEY);
  if (!m) continue;
  const price = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(price) || price <= 0) continue;

  const key = r.href?.match(/\/itm\/(\d+)/)?.[1] ?? `${title}|${price}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const g = title.match(GRADE);
  items.push({
    title,
    price,
    sold_date: (r.text.match(SOLD_DATE) || [])[1] ?? null,
    grade: g ? `${g[1].toUpperCase()} ${g[2]}` : null,
    url: r.href ? r.href.split('?')[0] : null,
  });
  if (items.length >= LIMIT) break;
}

await ctx.close();

const stats = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return {
    n: s.length,
    median: +q(0.5).toFixed(2),
    p25: +q(0.25).toFixed(2),
    p75: +q(0.75).toFixed(2),
    min: +s[0].toFixed(2),
    max: +s[s.length - 1].toFixed(2),
  };
};

const raw = items.filter(i => !i.grade);
const buckets = {};
for (const i of items.filter(i => i.grade)) (buckets[i.grade] ??= []).push(i.price);

const result = {
  query, ran_at: new Date().toISOString().slice(0, 10),
  total_matched: items.length,
  raw: stats(raw.map(i => i.price)),
  graded: Object.fromEntries(
    Object.entries(buckets).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, stats(v)])
  ),
  sales: items.slice(0, 25),
};

if (LABEL) {
  mkdirSync(join(ROOT, 'catalog'), { recursive: true });
  appendFileSync(join(ROOT, 'catalog', 'comps.jsonl'),
    JSON.stringify({ label: LABEL, ...result, sales: undefined }) + '\n');
}

if (AS_JSON) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

const fmt = s => s ? `n=${String(s.n).padEnd(3)} median $${String(s.median).padEnd(9)} IQR $${s.p25}–$${s.p75}  range $${s.min}–$${s.max}` : '(none)';
console.log(`\nQUERY: ${query}`);
console.log(`matched ${items.length} sold listings after filtering\n`);
console.log(`  RAW / UNGRADED   ${fmt(result.raw)}`);
for (const [g, s] of Object.entries(result.graded)) console.log(`  ${g.padEnd(16)} ${fmt(s)}`);
console.log('\n  recent sales:');
for (const s of items.slice(0, 12)) {
  console.log(`   ${(s.sold_date ?? '—').padEnd(13)} $${String(s.price).padEnd(9)} ${(s.grade ?? 'raw').padEnd(8)} ${s.title.slice(0, 64)}`);
}
console.log();
