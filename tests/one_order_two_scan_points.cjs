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
    issuedOfRef: { current: () => 0 },
    flash: (text, kind) => said.push({ text, kind }),
    t: (k, v) => k + (v ? ' ' + JSON.stringify(v) : ''),
    beepDuplicate() {}, beepAlarm() {}, beepSuccess() {}, beepComplete() {}, vibrate() {}, setLastInfo() {},
    setProgress: (fn) => { L.progressRef.current = fn(L.progressRef.current); },
    saveScanRecord: async (id, al, code, typed, pt) => { sent.push({ barcode: code, scan_point: pt && pt.id, scan_point_name: pt && pt.name }); return L.__serverSays; },
    findBarcodeElsewhere: async () => null, takeBackScan() {}, labelOfConsent: () => 'another order',
    sealRangesText: () => '', useCallback: (fn) => fn, numText: (n) => String(n), refreshUnsynced() {},
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

  console.log('\n3. Reset clears only what this phone has NOT synced');
  // A seal of A's already went out on a DO: a reset must never take it.
  A.L.progressRef.current = { ...A.L.progressRef.current, c1: A.L.markSealsOnDO(A.p(), ['0035101']) };
  // A synced 0035101..0035103; then scans two more with no Sync yet.
  ['0035104', '0035105'].forEach((c) => A.rec(c, { typed: true }));
  const unsyncedA = ['0035104', '0035105'];               // what the outbox hands back
  const done = A.L.resetPoint(A.p(), unsyncedA, CARD.qty);
  is(done.dropped.sort(), ['0035104', '0035105'], 'A clears its 2 unsynced scans');
  yes(['0035102', '0035103'].every((c) => done.progress.seen.includes(c)), 'the seals A already synced stay');
  yes(done.progress.seen.includes('0035101'), 'the seal already on a DO stays');
  yes(!done.dropped.some((c) => c.startsWith('00352')), 'B\'s seals are not touched');
  A.L.progressRef.current = { ...A.L.progressRef.current, c1: done.progress };
  A.L.seenRef.current = new Set(done.progress.seen || []);   // what resetMyScans does
  const back = A.rec('0035104', { typed: true });
  yes(back.ok, 'a cleared seal can be scanned again afterwards');
  is(A.L.resetPoint(A.p(), [], CARD.qty).dropped.length, 0, 'with nothing unsynced, a reset clears nothing');

  console.log('\n4. Seals from before any of this have no point, and Reset leaves them');
  const L = lib();
  let p = L.addBarcodes(L.defaultProgress(), ['1', '2', '3', '4'], (code) => ({ code, time: '–' }));
  if (HAS_POINTS) {
    const me = L.myScanPoint('X');
    const c = L.countsByPoint(p, me.id, me.name);
    is(c.map((x) => [x.id === '', x.n]), [[false, 0], [true, 4]], 'four earlier seals read as "no scan point" beside my 0');
    is(L.resetPoint(p, [], 4).dropped.length, 0, 'they are not in the outbox, so a reset leaves them');
  }
}

if (A && B) {
  console.log('\n4b. The order quantity is counted over EVERY scan point');
  const C9 = { id: 'c9', al_number: 'AL-9', customer: 'Nine', qty: 9, memberIds: ['c9'] };
  const srv = [], sA = [], sB = [];
  const X = phone('Place X', C9, sA), Y = phone('Place Y', C9, sB);
  for (let i = 1; i <= 9; i++) Y.rec('00900' + String(i).padStart(2, '0'), { typed: true });
  sB.forEach((r) => srv.push(r)); X.hear(srv);
  const r = X.rec('0090099', { typed: true });
  yes(!r.ok && r.key === 'scan.orderFull', 'with 9 ordered and 9 taken at the other place, this phone cannot take one more (' + r.key + ')');
  is(X.p().unique, 9, 'and the order still counts 9');
  const ry = Y.rec('0090098', { typed: true });
  yes(!ry.ok && ry.key === 'scan.orderFull', 'the place that took the nine cannot take a tenth either');

  console.log('\n4c. A DO carries THIS phone own seals and the earlier ones, never the other place');
  const C = { id: 'c5', al_number: 'AL-5', customer: 'Five', qty: 10, memberIds: ['c5'] };
  const s2 = [], sx = [], sy = [];
  const P = phone('P', C, sx), Q = phone('Q', C, sy);
  ['0050001', '0050002'].forEach((c) => P.rec(c, { typed: true }));
  ['0050003', '0050004', '0050005'].forEach((c) => Q.rec(c, { typed: true }));
  sx.concat(sy).forEach((x) => s2.push(x));
  s2.push({ barcode: '0050006' });   // an earlier scan, no point
  P.hear(s2);
  is(P.L.sealsMineForDO(P.p(), P.point.id).sort(), ['0050001', '0050002', '0050006'], 'P issues its own 2 and the 1 earlier seal, not Q 3');
  const doCodes = /sealsMineForDO\(progressRef\.current\[consentId\]/.test(SRC);
  yes(doCodes, 'the DO seals are picked by sealsMineForDO');
  yes(/const newScans = sealsMineForDO\(/.test(SRC), 'and the DO quantity is this phone own count');
  yes(!/data-reset-earlier/.test(SRC), 'Reset offers no button for the earlier scans');
}

console.log('\n5. The reset is the outbox: queued scans of this order, and no server call');
(async () => {
  if (!HAS_POINTS) { fail('no scan points: nothing to reset by'); return finish(); }
  const calls = [];
  const removed = [];
  const L = lib({
    supabase: { rpc: async (fn, args) => { calls.push({ fn, args }); return { data: 7, error: null }; }, from: () => ({ insert: async () => { calls.push({ fn: 'insert' }); return {}; } }) },
    listJobs: async () => [
      { uid: 'j1', kind: 'scan_record', payload: { consentId: 'c1', barcode: '0035104' } },
      { uid: 'j2', kind: 'scan_record', payload: { consentId: 'c1', barcode: '0035101' } },
      { uid: 'j3', kind: 'scan_record', payload: { consentId: 'c9', barcode: '0090001' } },
      { uid: 'j4', kind: 'do_record', payload: { consentId: 'c1' } },
    ],
    removeJob: async (uid) => { removed.push(uid); },
  });
  const codes = await L.resetUnsynced(['c1'], new L.Set(['0035101']));
  is(codes, ['0035104'], 'it hands back the unsynced scans of this order');
  is(removed, ['j1'], 'and takes only those out of the outbox -- not a seal on a DO, not another order, not a DO');
  is(calls.length, 0, 'nothing is asked of the server: a synced scan is not the phone to take back');

  console.log('\n5b. A scan stays on the phone until Sync');
  {
    const jobs = [];
    const S = lib({ queueJob: async (kind, payload) => { jobs.push({ kind, payload }); }, supabase: { from: () => ({ insert: async () => { calls.push({ fn: 'insert' }); return {}; } }) } });
    await S.saveScanRecord('c1', 'AL-1', '0035190', false, { id: 'sp', name: 'X' });
    is(jobs.map((j) => j.kind), ['scan_record'], 'a scan goes into the outbox');
    is(calls.length, 0, 'and nothing is sent to the server, line or no line');
    const sa = R('src/lib/syncAll.js');
    const tick = sa.slice(sa.indexOf('export function startAutoSync'));
    yes(!/flushScanRecords/.test(tick.replace(/\/\*[\s\S]*?\*\//g, '')), 'the 30-second tick does not send scans');
    yes(/sync\(false\)/.test(SRC), 'opening the scan screen reads the list and sends nothing');
    yes(/onSync=\{\(\) => sync\(true\)\}/.test(SRC), 'the Sync button sends them');
    yes(/data-sync-here/.test(SRC), 'and the open order offers Sync beside its unsynced count');
  }

  console.log('\n6. The scan screen offers it');
  yes(/data-scan-points/.test(SRC), 'the scanner draws a count per scan point');
  yes(/data-reset-mine/.test(SRC) && /resetMyScans/.test(SRC), 'and a Reset that clears this phone\'s scans');
  yes(!/resetScans\(/.test(SRC), 'and it no longer deletes anything on the server');
  const i18n = R('src/i18n.js');
  ['scan.resetMine', 'scan.pointsTitle', 'scan.duplicateAt', 'do.queueWaiting'].forEach((k) =>
    yes((i18n.match(new RegExp("'" + k.replace('.', '\\.') + "'", 'g')) || []).length === 2, k + ' is in both languages'));

  console.log('\n7. A row deleted in Supabase leaves the phone too');
  {
    const L = lib();
    const base = { ...L.defaultProgress(), seen: ['004187', '004190', '004193', '004200', '004201'], unique: 5,
      pointOf: { '004200': 'sp-me', '004201': 'sp-other' } };
    const r = L.reconcileWithServer(base, [], 'sp-me', 9, new L.Set());
    is([...r.progress.seen], [], 'every seal the table no longer has and nothing is waiting to send is dropped -- this phone own too');
    const w = L.reconcileWithServer(base, [], 'sp-me', 9, new L.Set(['004200']));
    yes(w.progress.seen.includes('004200'), 'this phone own scan still waiting for Sync is kept');
    const q = L.reconcileWithServer(base, [], 'sp-me', 9, new L.Set(['004190']));
    yes(q.progress.seen.includes('004190'), 'an earlier scan still waiting in the outbox is kept');
    const n = L.reconcileWithServer(base, [], 'sp-me', 9, null);
    yes(['004187', '004190', '004193', '004200'].every((c) => n.progress.seen.includes(c)), 'an outbox that could not be read drops no earlier scan and none of this phone own');
    const k = L.reconcileWithServer(base, [{ barcode: '004187' }], 'sp-me', 9, new L.Set());
    yes(k.progress.seen.includes('004187'), 'an earlier scan the table still has is kept');
    const d = L.reconcileWithServer({ ...base, doSeals: ['004187'] }, [], 'sp-me', 9, new L.Set());
    yes(d.progress.seen.includes('004187'), 'a seal already on a DO is never dropped');
    yes(/waitingScanCodes\(scanIds\)/.test(SRC) && /reconcileWithServer\([^)]*waiting\)/.test(SRC), 'the scan screen hands the outbox to the reconcile');
  }
  finish();
})().catch((e) => { fail('harness died: ' + e.message); finish(); });

function finish() {
  console.log('\n' + (failed ? failed + ' FAILED' : 'all checks passed'));
  process.exit(failed ? 1 : 0);
}
