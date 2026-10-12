/* A SEAL IS COUNTED ONCE.

   The barcode on a seal is the thing being counted, so the count is a SET
   of barcodes, not a tally kept beside one.

   The scanner itself has always refused a seal it has already taken. What
   got past that guard came in by the other door: a card can be a MERGED
   consent group -- several rows for one trip -- and the scan table is
   unique on (consent_id, barcode), so the same seal filed against two of
   its member rows is two perfectly legal rows. The merge read them both
   in, filtering the incoming barcodes only against what was already held
   and never against EACH OTHER. The seal landed twice, the count went up
   by two, and the log carried two lines reading the same number.

   A tally that is wrong stays wrong for ever, because nothing afterwards
   recomputes it. So `unique` is DERIVED from the set, `addBarcodes` is the
   only door in, and `loadProgress` repairs a phone already carrying a
   doubled count.

   The rule is driven for real, out of src/modules/scan/store.js.

   Run: node tests/a_seal_is_counted_once.cjs
   No build and no server needed.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const ok = (m) => console.log('ok    ' + m);
const is = (got, want, m) => (JSON.stringify(got) === JSON.stringify(want)
  ? ok(m)
  : fail(m + '  — got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)));

/* ── the real store, with its Supabase half cut away ──────────────────
   Only the counting half is under test, so the imports (which would pull
   in the whole supabase client) are dropped and the browser bits stubbed.
   Everything below the import line is the shipped file. */
const store = R('src/modules/scan/store.js')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '');
const mem = {};
const ctx = {
  console,
  localStorage: {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
  },
  supabase: {},
  cacheGet: () => null,
  cacheSet: () => {},
  PERMANENT: 'permanent', flushOutbox: () => {}, looksOffline: () => false, queueJob: () => {},
};
vm.createContext(ctx);
vm.runInContext(store + '\n;globalThis.__s = { defaultProgress, addBarcodes, dedupeProgress, dedupeScans, loadProgress, saveProgress, PROGRESS_KEY };', ctx);
const S = vm.runInContext('__s', ctx);

const line = (code, n, qty) => ({ code, time: '09:0' + n, over: n > qty });
const QTY = 5;

/* ── 1. The ordinary case: five seals, five entries ──────────────────── */
let p = S.addBarcodes(S.defaultProgress(), ['001', '002', '003', '004', '005'],
  (c, n) => line(c, n, QTY));
is([p.unique, p.seen.length, p.scans.length], [5, 5, 5], 'five different seals are five');
is(p.scans.map((s) => s.code), ['005', '004', '003', '002', '001'],
   'and the log reads newest first');

/* ── 2. The same seal again is not counted ───────────────────────────── */
const again = S.addBarcodes(p, ['003'], (c, n) => line(c, n, QTY));
is(again === p, true, 'a seal already held changes nothing at all');
is([again.unique, again.scans.length], [5, 5], 'the count and the log stand still');

/* ── 3. THE MERGED CARD: one seal filed against two member rows ───────
   This is what got past the scanner's own guard. Both rows are legal --
   the table is unique on (consent_id, barcode), not on the barcode. */
const fromServer = ['001', '002', '003', '004', '005', '006', '006'];
const merged = S.addBarcodes(S.defaultProgress(), fromServer, (c, n) => line(c, n, QTY));
is([merged.unique, merged.scans.length], [6, 6],
   'a seal that comes back twice from the server is counted once');
is(merged.seen.filter((c) => c === '006').length, 1, 'and is held once');

/* ── 4. Over quota is counted off what the count WILL be ─────────────── */
is(merged.scans.find((s) => s.code === '006').over, true, 'the sixth seal is marked over quota');
is(merged.scans.find((s) => s.code === '005').over, false, 'the fifth is not');

/* ── 5. A phone already carrying a doubled count is repaired ──────────
   Nothing on the phone recomputes a tally, so a card that doubled before
   this rule existed would read 7 of 5 for ever. */
const damaged = {
  seen: ['001', '002', '003', '003', '004', '005'],
  scans: [
    { code: '005', time: '09:05' }, { code: '004', time: '09:04' },
    { code: '003', time: '–' },
    { code: '003', time: '09:03' }, { code: '002', time: '09:02' }, { code: '001', time: '09:01' },
  ],
  unique: 6, over: 1, completedFired: true, overFired: true, doIssued: false,
};
const fixed = S.dedupeProgress(damaged);
is([fixed.unique, fixed.seen.length, fixed.scans.length], [5, 5, 5],
   'a doubled card goes back to the five seals it actually holds');
is(fixed.scans.find((s) => s.code === '003').time, '09:03',
   'and keeps the FIRST sighting, the one with the real time on it');
is(fixed.completedFired, true, 'everything else about the card is left alone');
is(S.dedupeProgress(fixed) === fixed, true, 'a card with nothing to clean is handed straight back');

/* ── 6. loadProgress repairs, and writes the repair down ─────────────── */
ctx.localStorage.setItem(S.PROGRESS_KEY, JSON.stringify({ c1: damaged }));
const loaded = S.loadProgress();
is(loaded.c1.unique, 5, 'loadProgress repairs what is already on the phone');
is(JSON.parse(ctx.localStorage.getItem(S.PROGRESS_KEY)).c1.unique, 5,
   'and writes it back, so it stays repaired with nothing more scanned');

/* ── 7. A blank or spaced barcode is not a seal ──────────────────────── */
const spaced = S.addBarcodes(S.defaultProgress(), ['  007 ', '007', '', null], (c, n) => line(c, n, QTY));
is([spaced.unique, spaced.seen], [1, ['007']],
   'the same number with a space round it is the same seal, and a blank is none');

/* ── 8. Nobody writes the count by hand any more ─────────────────────── */
const SM = R('src/modules/scan/ScanModule.jsx');
if (!/unique: *newUnique|const unique = cur\.unique \+ 1/.test(SM)) {
  ok('no path increments the count beside the set');
} else {
  fail('a path still increments unique by hand — it will drift from the seals it is made of');
}
if ((SM.match(/addBarcodes\(/g) || []).length === 3) {
  ok('all three doors — the scanner, the server merge and the live feed — go through addBarcodes');
} else {
  fail('found ' + (SM.match(/addBarcodes\(/g) || []).length + ' calls to addBarcodes, wanted 3');
}
if (!/seen: \[\.\.\.cur\.seen/.test(SM)) {
  ok('and none of them builds the seen list of its own');
} else {
  fail('a path still appends to seen directly, bypassing the filter');
}

console.log('');
console.log(failed ? failed + ' FAILED' : 'all good');
process.exit(failed ? 1 : 0);
