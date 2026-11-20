/* AFTER THE BARCODES ARE SCANNED, THE DO IS THE SCAN'S.

   The office, in one message: the DO number, the delivery date and the
   customer name are fixed and cannot be edited; nursery, plot and batch are
   compulsory on every item; the car plate photo and the customer signature
   are compulsory; and the one button is Save & Continue (it read Save &
   Sign DO), pressable only once all of it is there.

   This renders the REAL EntryModal in a real browser, opened the way the
   scan screen opens it (scannedQty set), and drives it field by field.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/a_scanned_do_is_complete_before_it_saves.cjs
*/
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require(process.env.NODE_PATH + '/playwright');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
const ok = (m, c, got) => { if (c) console.log('pass  ' + m); else { failed++; console.log('FAIL  ' + m + (got !== undefined ? '  -> got ' + JSON.stringify(got) : '')); } };

const out = path.join(os.tmpdir(), 'mjm-scan-do-form.js');
execFileSync('npx', ['esbuild', path.join(__dirname, 'fixtures/scan_do_form_entry.jsx'),
  '--bundle', '--format=iife', '--jsx=automatic', '--loader:.js=jsx', '--log-level=error',
  '--define:import.meta.env={"VITE_SUPABASE_URL":"http://127.0.0.1:9","VITE_SUPABASE_ANON_KEY":"stub","VITE_GEMINI_KEY":"","MODE":"test","DEV":false,"PROD":true}',
  '--define:process.env.NODE_ENV="production"', '--outfile=' + out], { cwd: ROOT, stdio: 'pipe' });
const PAGE = '<!doctype html><meta charset="utf-8"><body><div id="root"></div><script src="/app.js"></script></body>';
const server = http.createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(fs.readFileSync(out)); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  page.setDefaultTimeout(3000);
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('dialog', (d) => d.dismiss());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('[data-do-save]', { timeout: 15000 }).catch(() => {});

  const btn = page.locator('[data-do-save]');
  ok('the button reads Save & Continue', /Save & Continue/i.test(await btn.innerText().catch(() => '')), await btn.innerText().catch(() => ''));
  ok('…and no longer Save & Sign DO', !/Sign DO/i.test(await btn.innerText().catch(() => '')));

  const inputs = page.locator('.modal-box input:not([type=file]):not([type=number])');
  const dateBox = page.locator('.modal-box input[type=date]');
  ok('the DO number is read-only', await inputs.first().evaluate((e) => e.readOnly).catch(() => false));
  ok('the delivery date is read-only', await dateBox.evaluate((e) => e.readOnly).catch(() => false));
  const cust = page.locator('.modal-box input').nth(2);
  ok('the customer name is the order own, and read-only',
    await cust.evaluate((e) => e.readOnly && e.value === 'Imbok Sdn Bhd').catch(() => false),
    await cust.evaluate((e) => [e.readOnly, e.value]).catch(() => null));
  await dateBox.fill('2020-01-01').catch(() => {});
  ok('typing a date changes nothing', (await dateBox.inputValue().catch(() => '')) !== '2020-01-01');

  const missing = async () => (await page.locator('[data-do-missing] li').allInnerTexts().catch(() => []));
  ok('with nothing filled in, the button is greyed', await btn.isDisabled().catch(() => false));
  let m = await missing();
  ok('…and says what is missing: nursery, plot, photo, signature',
    m.some((x) => /nursery/i.test(x)) && m.some((x) => /plot/i.test(x)) && m.some((x) => /photo/i.test(x)) && m.some((x) => /signature/i.test(x)), m);

  await page.locator('.modal-box button', { hasText: /^BNN$/ }).click().catch(() => {});
  await page.locator('.modal-box .cf-btn').first().click().catch(() => {});
  await page.locator('.cf-opt', { hasText: /^B2$/ }).click().catch(() => {});
  m = await missing();
  ok('a plot that offers batches asks for one', m.some((x) => /batch/i.test(x)), m);
  await page.locator('.modal-box button', { hasText: /^270/ }).click().catch(() => {});
  await page.locator('.modal-box input[type=number]').first().fill('40').catch(() => {});
  m = await missing();
  ok('nursery, plot and batch answered: only the photo and the signature are left',
    m.length === 2 && m.some((x) => /photo/i.test(x)) && m.some((x) => /signature/i.test(x)), m);
  ok('…so the button is still greyed', await btn.isDisabled().catch(() => false));

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('.modal-box input[type=file]').setInputFiles({ name: 'plate.png', mimeType: 'image/png', buffer: png }).catch(() => {});
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-do-missing] li')].some((l) => /photo/i.test(l.textContent)), null, { timeout: 5000 }).catch(() => {});
  m = await missing();
  ok('the photo taken: only the signature is left', m.length === 1 && /signature/i.test(m[0] || ''), m);

  await page.locator('.modal-box canvas').scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.locator('.modal-box canvas').boundingBox().catch(() => null);
  if (box) {
    await page.mouse.move(box.x + 20, box.y + 30); await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 60); await page.mouse.up();
  }
  ok('signed: nothing is missing', (await page.locator('[data-do-missing]').count()) === 0, await missing());
  ok('…and Save & Continue can be pressed', !(await btn.isDisabled().catch(() => true)));
  await btn.click().catch(() => {});
  await page.waitForFunction(() => window.__done, null, { timeout: 5000 }).catch(() => {});
  const saved = await page.evaluate(() => window.__saved);
  ok('it saves the plot, the batch and the order customer',
    saved && saved.plot_1 === 'B2' && saved.batch_1 === '270' && saved.remark === 'Imbok Sdn Bhd', saved);

  await page.mouse.click(5, 5);
  ok('a stray tap outside the form does not throw the signature away', !(await page.evaluate(() => window.__closed)));

  await browser.close(); server.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
