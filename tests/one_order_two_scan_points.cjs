/* ONE ORDER, SCANNED AT TWO PLACES AT ONCE -- and a reset that clears only
   the phone that pressed it.

   The office, in three sentences: an order can be scanned at two places at
   the same time, each place has to see how many IT has scanned and how many
   the other has, the two must never overlap (a seal one has taken cannot be
   scanned or keyed at the other); and a Reset clears only this phone's part,
   the other place's scans untouched, with the data in step on both.

   Drives the SHIPPED store.js, scanPoints.js and sealRanges.js, and the REAL
   recordScan lifted out of ScanModule.jsx, for two phones sharing one card.

   Run: node tests/one_order_two_scan_points.cjs
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const R = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failed = 0;
const ok = (m) => console.log('ok    ' + m);
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const yes = (c, m) => (c ? ok(m) : fail(m));
const is = (got, want, m) => (JSON.stringify(got) === JSON.stringify(want) ? ok(m) : fail(m + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));

const strip = (f) => R(f).replace(/^import .*$/gm, '').replace(/^export /gm, '');
const HAS_POINTS = fs.existsSync(path.join(ROOT, 'src/modules/scan/scanPoints.js'));
if (!HAS_POINTS) fail('src/modules/scan/scanPoints.js is not in this build -- nothing knows which phone scanned a seal');
const LIB = strip('src/lib/sealRanges.js') + '\n' + strip('src/modules/scan/store.js') + '\n'
  + (HAS_POINTS ? strip('src/modules/scan/scanPoints.js') : '');

const SRC = R('src/modules/scan/ScanModule.jsx');
function liftArrow(src, header, params) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not in the shipped file: ' + header);
  const from = src.indexOf(params, at);
  let depth = 0;
  for (let j = src.indexOf('{', from); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(from, j + 1);
  }
  throw new Error('unbalanced');
}
const recordSrc = liftArrow(SRC, 'const recordScan = useCallback(', '(rawCode, opts)');

function lib(extra) {
  const store = {};
  const ctx = {
    console, Date, JSON, Math, Object, Set, Map, Array, String, Number, Boolean, Promise, Error,
    crypto: require('crypto').webcrypto,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    supabase: { from: () => ({ insert: async () => ({}) }) },
    ...(extra || {}),
  };
  vm.createContext(ctx);
  vm.runInContext(LIB, ctx);
  return ctx;
}

/* A phone: its own progress map, its own seenRef, its own point. */
function phone(name, card, sent) {
  const L = lib();
  const said = [];
  const point = HAS_POINTS ? L.myScanPoint(name) : { id: name, name };
  Object.assign(L, {
    DEDUPE_DEBOUNCE_MS: 800, OVER_REPEAT_MS: 1200,
    activeRef: { current: card }, consentsRef: { current: [card] }, sealAllocsRef: { current: null },
    lastCodeRef: { current: '' }, lastTimeRef: { current: 0 }, lastOverRef: { current: 0 },
    seenRef: { current: new Set() }, progressRef: { current: {} },
    pointRef: { current: point },
    flash: (text, kind) => said.push({ text, kind }),
    t: (k, v) => k + (v ? ' ' + JSON.stringify(v) : ''),
    beepDuplicate() {}, beepAlarm() {}, beepSuccess() {}, beepComplete() {}, vibrate() {}, setLastInfo() {},
    setProgress: (fn) => { L.progressRef.current = fn(L.progressRef.current); },
    saveScanRecord: async (id, al, code, typed, pt) => { sent.push({ barcode: code, scan_point: pt && pt.id, scan_point_name: pt && pt.name }); },
    findBarcodeElsewhere: async () => null, takeBackScan() {}, labelOfConsent: () => 'another order',
    sealRangesText: () => '', useCallback: (fn) => fn, numText: (n) => String(n),
  });
  vm.runInContext('globalThis.__rec = ' + recordSrc + ';', L);
  const rec = L.__rec;
  /* What the realtime feed / a server read does on this phone. */
  function hear(rows) {
    const cur = L.progressRef.current[card.id] || L.defaultProgress();
    let next = L.addBarcodes(cur, rows.map((r) => r.barcode), (code, n) => ({ code, time: '–', over: n > card.qty }));
    if (HAS_POINTS) {
      next = L.notePoints(next, rows);
      next = L.reconcileWithServer(next, rows, point.id, card.qty).progress;
    }
    L.progressRef.current = { ...L.progressRef.current, [card.id]: next };
    L.seenRef.current = new Set(next.seen || []);
  }
  const counts = () => (HAS_POINTS ? L.countsByPoint(L.progressRef.current[card.id], point.id, point.name) : []);
  return { L, rec, said, point, hear, counts, p: () => L.progressRef.current[card.id] || {} };
}

const CARD = { id: 'c1', al_number: 'AL-77', customer: 'Imbok', qty: 10, memberIds: ['c1'] };
const server = [];   // the table: every row the phones sent, first one wins on a barcode
const sentA = [], sentB = [];
const take = (rows) => rows.forEach((r) => { if (!server.some((s) => s.barcode === r.barcode)) server.push(r); });

let A, B;
try {
  A = phone('UNN1 loading', CARD, sentA);
  B = phone('UNN2 loading', CARD, sentB);
} catch (e) { fail('the two phones could not be built: ' + e.message); }

if (A && B) {
  console.log('1. Each place keeps its own count of the same order');
  yes(A.point.id !== B.point.id, 'the two phones are two scan points');
  ['0035101', '0035102', '0035103'].forEach((c) => A.rec(c, { typed: true }));
  ['0035201', '0035202'].forEach((c) => B.rec(c, { typed: true }));
  take(sentA); take(sentB);
  A.hear(server); B.hear(server);
  const ca = A.counts(), cb = B.counts();
  is(ca.map((p) => [p.mine, p.n]), [[true, 3], [false, 2]], 'phone A reads: mine 3, the other place 2');
  is(cb.map((p) => [p.mine, p.n]), [[true, 2], [false, 3]], 'phone B reads: mine 2, the other place 3');
  is((ca.find((p) => !p.mine) || {}).name, 'UNN2 loading', 'and A names the other place');
  is(A.p().unique, 5, 'the order total on A is 5');
  yes(sentA.every((r) => r.scan_point === A.point.id), 'every row A sent carries A as its scan point');

  console.log('\n2. The two places cannot overlap -- scanned or keyed');
  const r1 = B.rec('0035101');
  yes(!r1.ok && r1.key === 'scan.duplicateAt', 'B scanning a seal A took is refused (' + r1.key + ')');
  yes(JSON.stringify(r1.vars || {}).includes('UNN1 loading'), 'and the refusal says it is at UNN1 loading');
  const r2 = B.rec('0035102', { typed: true });
  yes(!r2.ok && r2.key === 'scan.duplicateAt', 'keyed by hand the same seal is refused too');
  is(B.p().unique, 5, 'B still counts 5, nothing doubled');
  const r3 = A.rec('0035103', { typed: true });
  is(r3.key, 'scan.duplicate', 'a seal THIS phone took reads as an ordinary duplicate');

  console.log('\n3. Reset clears only this phone, and the other phone follows');
  // A seal of A's already went out on a DO: a reset must never take it.
  A.L.progressRef.current = { ...A.L.progressRef.current, c1: A.L.markSealsOnDO(A.p(), ['0035101']) };
  const done = A.L.resetPoint(A.p(), A.point.id, false, CARD.qty);
  is(done.dropped.sort(), ['0035102', '0035103'], 'A clears its own 2 not-yet-collected seals');
  yes(!done.dropped.includes('0035101'), 'the seal already on a DO is kept');
  yes(!done.dropped.some((c) => c.startsWith('00352')), 'B\'s seals are not touched');
  A.L.progressRef.current = { ...A.L.progressRef.current, c1: done.progress };
  A.L.seenRef.current = new Set(done.progress.seen || []);   // what resetMyScans does
  // the server function deletes A's rows that are on no DO
  for (let i = server.length - 1; i >= 0; i--) if (done.dropped.includes(server[i].barcode)) server.splice(i, 1);
  B.hear(server);
  is(B.counts().map((p) => [p.mine, p.n]), [[true, 2], [false, 1]], 'B, reading the table again, drops A\'s cleared seals: mine 2, other 1');
  is(B.p().unique, 3, 'and B\'s order total is 3');
  const back = A.rec('0035102', { typed: true });
  yes(back.ok, 'a cleared seal can be scanned again afterwards');

  console.log('\n4. Seals from before any of this have no point, and can be cleared');
  const L = lib();
  let p = L.addBarcodes(L.defaultProgress(), ['1', '2', '3', '4'], (code) => ({ code, time: '–' }));
  p = { ...p, completedFired: true, completedAt: 1 };
  if (HAS_POINTS) {
    const me = L.myScanPoint('X');
    const c = L.countsByPoint(p, me.id, me.name);
    is(c.map((x) => [x.id === '', x.n]), [[false, 0], [true, 4]], 'four earlier seals read as "no scan point" beside my 0');
    is(L.resetPoint(p, me.id, false, 4).dropped.length, 0, 'a reset of my part alone leaves them');
    const all = L.resetPoint(p, me.id, true, 4);
    is(all.dropped.length, 4, 'asked to, it clears the earlier ones too');
    yes(all.progress.unique === 0 && all.progress.completedFired === false, 'and the card is no longer "complete"');
  }
}

console.log('\n5. The reset goes through ONE server function, and drops this point\'s queued scans');
(async () => {
  if (!HAS_POINTS) { fail('no scan points: nothing to reset by'); return finish(); }
  const calls = [];
  const removed = [];
  const L = lib({
    supabase: { rpc: async (fn, args) => { calls.push({ fn, args }); return { data: 7, error: null }; }, from: () => ({}) },
    listJobs: async () => [
      { uid: 'j1', kind: 'scan_record', payload: { consentId: 'c1', point: { id: 'sp-me' } } },
      { uid: 'j2', kind: 'scan_record', payload: { consentId: 'c1', point: { id: 'sp-other' } } },
      { uid: 'j3', kind: 'scan_record', payload: { consentId: 'c9', point: { id: 'sp-me' } } },
    ],
    removeJob: async (uid) => { removed.push(uid); },
  });
  const n = await L.resetScans(['c1'], 'sp-me', false);
  is(calls.map((c) => c.fn), ['fcportal_reset_scans'], 'one call to fcportal_reset_scans');
  is(calls[0] && calls[0].args, { p_consent_ids: ['c1'], p_scan_point: 'sp-me', p_unassigned: false }, 'naming the order and THIS point');
  is(n, 7, 'answering how many rows the server took off');
  is(removed, ['j1'], 'only this point\'s queued scan for this order is dropped from the outbox');

  console.log('\n6. The scan screen offers it');
  yes(/data-scan-points/.test(SRC), 'the scanner draws a count per scan point');
  yes(/data-reset-mine/.test(SRC) && /resetMyScans/.test(SRC), 'and a Reset that clears this phone\'s scans');
  yes(/broadcastReset\(/.test(SRC), 'which tells the other phones on the order');
  const i18n = R('src/i18n.js');
  ['scan.resetMine', 'scan.pointsTitle', 'scan.duplicateAt', 'do.queueWaiting'].forEach((k) =>
    yes((i18n.match(new RegExp("'" + k.replace('.', '\\.') + "'", 'g')) || []).length === 2, k + ' is in both languages'));
  finish();
})().catch((e) => { fail('harness died: ' + e.message); finish(); });

function finish() {
  console.log('\n' + (failed ? failed + ' FAILED' : 'all checks passed'));
  process.exit(failed ? 1 : 0);
}
