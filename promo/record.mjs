// Records the 60-second XOGrid promo in one continuous take (1920x1080, silent).
// Needs the promo frontend running (npm run serve, port 5190). Output: promo/out/xogrid-promo.webm
// Read-only: it never connects a wallet and never presses "Claim voucher" or any other button that sends data.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const APP = `http://localhost:${process.env.PROMO_PORT ?? 5190}`;
const VOUCHER = '317c4947b5b9cc71d1fe01616cdc930b6ca3ef5808700c68d1cb0696e79b4911';
const CLAIM_CODE = '2320669251afb04fbaa5b24db40cf6aa'; // already redeemed on mainnet by TXID, so safe to show
const TXID = 'b6c1a0b29cd32d29c1f730e18e15a15ab00755228790f467b91ce62813c86181';
const W = 1920, H = 1080;

const logo = readFileSync(resolve(here, '../frontend/src/assets/images/xogridlogo-trimmed.png')).toString('base64');
const overlay = readFileSync(resolve(here, 'overlay.js'), 'utf8').replace('__LOGO_DATA_URI__', `data:image/png;base64,${logo}`);

const outDir = resolve(here, 'out');
const rawDir = resolve(outDir, 'raw');
rmSync(rawDir, { recursive: true, force: true });
mkdirSync(rawDir, { recursive: true });

// Wake the Render API first so the first frames are not a loading state.
await fetch(`${APP}/api/templates`).catch(() => {});

const browser = await chromium.launch();
const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    recordVideo: { dir: rawDir, size: { width: W, height: H } },
});
await context.addInitScript(overlay);
// Warm the explorer's cache in a background tab so the cut to it is quick. Its own video file is discarded.
const warm = await context.newPage();
await warm.goto(`https://3xpl.com/bitcoin-cash/transaction/${TXID}`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
await warm.waitForTimeout(3000);
await warm.close();
// The main page is created after the warm-up so its video starts at the title card.
const page = await context.newPage();

const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const log = (m) => console.log(`${now().toFixed(1).padStart(5)}s  ${m}`);
const sleep = (ms) => page.waitForTimeout(ms);
/** Waits until the given second of the video, so scenes land on the storyboard times. */
const at = async (s, label) => { const d = s - now(); if (d > 0) await sleep(d * 1000); else log(`  late by ${(-d).toFixed(1)}s for ${label}`); log(label); };

const promo = (fn, ...args) => page.evaluate(([f, a]) => window.__promo[f](...a), [fn, args]);
const caption = (html) => promo('caption', html);
const scrollTo = (y, ms) => promo('scrollTo', y, ms);
const scrollToEl = async (locator, offset = 140, ms = 1200) => {
    const y = await locator.evaluate((el, off) => el.getBoundingClientRect().top + scrollY - off, offset);
    await scrollTo(y, ms);
};

let mouse = { x: W / 2, y: H / 2 };
const glide = async (x, y, steps = 16) => { await page.mouse.move(x, y, { steps }); mouse = { x, y }; };
const center = async (locator) => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const hover = async (locator, steps) => { const c = await center(locator); await glide(c.x, c.y, steps); };
const click = async (locator) => { await hover(locator); await sleep(180); await page.mouse.down(); await sleep(70); await page.mouse.up(); };

// Scene 1 (0-5s): title card over the landing page while the app's own loader finishes underneath.
await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded' });
await page.mouse.move(mouse.x, mouse.y);
log('title card');

// Scene 2 (5-14s): landing -> Explore, filter by category, open a template.
await at(4.6, 'reveal landing');
await promo('card', null);
await caption('Find templates by <b>what they do</b>');
await glide(900, 760, 30);
await click(page.getByRole('link', { name: /Explore templates/i }).or(page.getByRole('button', { name: /Explore templates/i })).first());
await page.waitForURL('**/explore');
await sleep(700);
await scrollTo(560, 1100);
const payment = page.locator('button.explore-filter', { hasText: 'Payment' });
await click(payment);
await sleep(600);
await scrollTo(860, 1000);
const voucherCard = page.locator(`a[href="/t/${VOUCHER}"]`).first();
await hover(voucherCard);
await sleep(500);

// Scene 3 (14-28s): template page: identifier, badge, plain-English steps.
await at(13.6, 'open template');
await click(voucherCard);
await page.waitForURL(`**/t/${VOUCHER}`);
await page.getByText('TEMPLATE IDENTIFIER', { exact: false }).first().waitFor();
// The SPA keeps Explore's scroll position; start the template page at its header.
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
await caption('Every template gets a <b>content-addressed ID</b>');
await sleep(500);
await hover(page.getByText(VOUCHER).first());
await sleep(1600);
await hover(page.getByText('Auto-checked', { exact: true }).first());
await at(21, 'steps');
await caption('Its steps, explained in <b>plain English</b>');
await scrollToEl(page.getByText('What this template does', { exact: false }).first(), 160, 1400);
await glide(700, 640, 40);

// Scene 4 (28-37s): technical details: CashAssembly and the automated checks.
await at(27.6, 'technical');
await caption('Real CashAssembly. <b>Automated checks.</b>');
const scripts = page.locator('summary', { hasText: 'Scripts (CashAssembly)' }).first();
await scrollToEl(scripts, 300, 1300);
await click(scripts);
await sleep(1500);
await scrollToEl(page.getByText('Automated checks (version', { exact: false }).first(), 120, 1500);
await glide(520, 560, 35);

// Scene 5 (37-43s): the honesty rules: what each badge means.
await at(36.6, 'policy');
await promo('fade', true);
await caption(null);
await promo('go', '/policy');
await page.getByText('Understand every registry status', { exact: false }).first().waitFor();
await sleep(300);
await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((e) => e.textContent.includes('Understand every registry status')); window.scrollTo({ top: h.getBoundingClientRect().top + scrollY - 120, behavior: 'instant' }); });
await promo('fade', false);
await caption('Badges say what was checked, <b>never “safe”</b>');
await glide(900, 520, 30);
await scrollTo((await page.evaluate(() => scrollY)) + 380, 2400);

// Scene 6 (43-54s): the voucher demo on mainnet, then the real transaction on an explorer.
await at(41.6, 'demo');
await promo('fade', true);
await caption(null);
await promo('go', '/demo');
const mainnet = page.getByRole('button', { name: /Mainnet \(real BCH\)/ });
await mainnet.waitFor();
await mainnet.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 380, behavior: 'instant' }));
await promo('fade', false);
await caption('A template you can <b>run live</b> on BCH mainnet');
await click(mainnet);
await sleep(350);
await click(page.locator('input[type=checkbox]').first());
log('  mainnet confirmed');
const codeInput = page.getByPlaceholder('32 hex characters');
await scrollToEl(page.getByRole('heading', { name: 'Claim a voucher' }), 160, 1000);
await click(codeInput);
await page.keyboard.type(CLAIM_CODE, { delay: 8 });
log('  code typed');
await sleep(400);

await at(47.6, 'explorer');
await promo('fade', true);
await caption(null);
await page.goto(`https://3xpl.com/bitcoin-cash/transaction/${TXID}`, { waitUntil: 'domcontentloaded' });
await page.getByText('Outputs', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => {});
// 3xpl shows its own loader ("Looking for Satoshi") after the HTML arrives; stay black until it is gone.
await page.getByText('Looking for Satoshi', { exact: false }).first().waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
await page.getByText(TXID.slice(0, 10), { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
await page.addStyleTag({ content: '[class*=trollbox i], [id*=trollbox i] { display: none !important; }' }).catch(() => {});
await sleep(400);
await page.mouse.move(mouse.x, mouse.y);
await promo('fade', false);
await caption('The claim, <b>confirmed on mainnet</b>');
await hover(page.getByText(TXID.slice(0, 10), { exact: false }).first(), 30);
await sleep(900);
await hover(page.getByText('Outputs', { exact: true }).first(), 30);

// Scene 7 (54-60s): end card.
await at(54.6, 'end card');
await caption(null);
await page.mouse.move(-50, -50);
await promo('card', 'end');
await at(60.0, 'done');

const video = page.video();
await context.close();
await browser.close();
const out = resolve(outDir, 'xogrid-promo.webm');
if (existsSync(out)) rmSync(out);
renameSync(await video.path(), out);
log(`saved ${out}`);
