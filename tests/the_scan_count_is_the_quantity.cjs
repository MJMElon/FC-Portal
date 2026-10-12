/* A SCANNED DELIVERY ORDER IS ISSUED FOR WHAT WAS SCANNED.

   The barcode counter has already counted the seedlings onto the lorry,
   so on a delivery order opened out of a scan the quantity is not a
   suggestion to be re-keyed. One batch and there is nothing to decide --
   the whole count came off it, and the box fills itself. Several batches
   and only the conductor knows the split, so the boxes are keyed and the
   SUM has to come back to the scanned count.

   Three things this holds, and each is a way it would go quietly wrong:

     - A figure the SCAN filled in is withdrawn the moment the scan can no
       longer answer (a second batch picked), rather than leaving the
       first batch holding the whole lorry and the second one nought.
     - A figure the CONDUCTOR keyed is never touched. House rule: a lookup
       fills an empty cell and never writes over a full one.
     - A delivery order with NO scan behind it -- the DO module's manual
       entry, which shares this very form -- is untouched by all of it.

   The rule is driven for real, out of src/modules/do/qty.js, rather than
   restated here.

   Run: node tests/the_scan_count_is_the_quantity.cjs
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

/* ── the real module ─────────────────────────────────────────────────── */
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(R('src/modules/do/qty.js').replace(/^export /gm, '')
  + '\n;globalThis.__q = { rowQty, lineCount, totalQty, scanTally, applyScannedQty };', ctx);
const Q = vm.runInContext('__q', ctx);

const row = (over) => Object.assign({ key: 'k', nursery: 'BNN', plot: 'B1', picks: [], batch: '', breed: '', qty: '' }, over);
const pick = (batch, qty) => ({ batch, breed: 'UPB PREMIER HYBRID', qty: qty === undefined ? '' : String(qty) });
const SCANNED = 69;

/* ── 1. One batch: the scan answers it ───────────────────────────────── */
let rows = [row({ picks: [pick('253')] })];
rows = Q.applyScannedQty(rows, SCANNED);
is(rows[0].picks[0].qty, '69', 'one batch picked takes the whole scanned count');
is(Q.scanTally(rows, SCANNED).auto, true, 'and the form knows that box is not to be keyed');
is(Q.scanTally(rows, SCANNED).tallies, true, 'so it tallies on its own');

/* ── 2. Asked again, nothing moves ───────────────────────────────────── */
is(Q.applyScannedQty(rows, SCANNED) === rows, true,
   'the same array comes back when there is nothing to do, so the effect cannot loop');

/* ── 3. A second batch withdraws the scan answer ─────────────────────── */
let two = [row({ picks: [rows[0].picks[0], pick('268')] })];
two = Q.applyScannedQty(two, SCANNED);
is([two[0].picks[0].qty, two[0].picks[1].qty], ['', ''],
   'picking a second batch withdraws the figure the scan filled in');
is(two[0].picks[0]._auto, undefined, 'and drops its mark with it');
const t3 = Q.scanTally(two, SCANNED);
is([t3.auto, t3.left, t3.tallies], [false, 69, false],
   'two batches: keyed by hand, 69 still to key, and it does not tally yet');

/* ── 4. What the conductor keyed is never touched ────────────────────── */
const keyed = [row({ picks: [pick('253', 40), pick('268', 29)] })];
is(Q.applyScannedQty(keyed, SCANNED) === keyed, true,
   'a quantity the conductor keyed is left exactly as keyed');
is(Q.scanTally(keyed, SCANNED).tallies, true, '40 and 29 tally with the 69 scanned');

/* ── 5. Short and over are both refused ──────────────────────────────── */
const short = [row({ picks: [pick('253', 40), pick('268', 9)] })];
is([Q.scanTally(short, SCANNED).left, Q.scanTally(short, SCANNED).tallies], [20, false],
   'keying less than was scanned is 20 short and does not tally');
const over = [row({ picks: [pick('253', 40), pick('268', 40)] })];
is([Q.scanTally(over, SCANNED).left, Q.scanTally(over, SCANNED).tallies], [-11, false],
   'keying more than was scanned is 11 over and does not tally');

/* ── 6. Back to one batch, and the scan answers again ────────────────── */
let back = [row({ picks: [two[0].picks[0]] })];
back = Q.applyScannedQty(back, SCANNED);
is(back[0].picks[0].qty, '69', 'taking the second batch off puts the scanned count back on the first');

/* ── 7. A plot that offers no batches ────────────────────────────────── */
let bare = Q.applyScannedQty([row({ plot: 'P30' })], SCANNED);
is(bare[0].qty, '69', 'a plot with no batches takes the scanned count on the row itself');

/* ── 8. Two rows are two lines ───────────────────────────────────────── */
const tworows = [row({ picks: [pick('253', 40)] }), row({ key: 'k2', plot: 'B2', picks: [pick('268', 29)] })];
is([Q.lineCount(tworows), Q.scanTally(tworows, SCANNED).auto], [2, false],
   'two rows of one batch each are two lines, keyed by hand');
is(Q.scanTally(tworows, SCANNED).tallies, true, 'and they tally across the rows, not within one');

/* ── 9. NO SCAN: the manual delivery order is untouched ──────────────── */
const manual = [row({ picks: [pick('253')] })];
is(Q.applyScannedQty(manual, 0) === manual, true, 'with no scan behind it nothing is filled in');
is(Q.scanTally(manual, 0).tallies, true, 'and there is nothing to tally, so the save is not blocked');
is(Q.scanTally(manual, 0).auto, false, 'and no box is taken away from the person keying it');

/* ── 10. The form is wired to the rule, not to a second copy ─────────── */
const EM = R('src/modules/do/EntryModal.jsx');
if (/from '\.\/qty\.js'/.test(EM) && /scanTally\(rows, scannedQty\)/.test(EM) && /applyScannedQty\(rs, scannedQty\)/.test(EM)) {
  ok('EntryModal reads the rule out of qty.js');
} else {
  fail('EntryModal does not use qty.js — a second copy of this arithmetic will drift from it');
}
if (!/const rowQty = |const lineCount = /.test(EM)) {
  ok('and keeps no copy of the arithmetic of its own');
} else {
  fail('EntryModal still defines rowQty/lineCount itself');
}
if (/if \(!scan\.tallies\) return alert/.test(EM)) {
  ok('a delivery order that does not tally with its scan does not save');
} else {
  fail('save does not refuse a total that disagrees with the scanned count');
}
if ((EM.match(/readOnly=\{scan\.auto\}/g) || []).length === 2) {
  ok('both quantity boxes are read-only while the scan is answering them');
} else {
  fail('a quantity box is still keyable while the scan is filling it in');
}
if (/scan\.scanned > 0 && \(/.test(EM)) {
  ok('the scanned count stays on screen for the whole of the form');
} else {
  fail('the scanned count is not shown');
}

/* ── 11. Scan hands over the count, and only the count ───────────────── */
const SM = R('src/modules/scan/ScanModule.jsx');
if (/scannedQty=\{doEntry\.scannedQty\}/.test(SM)) {
  ok('ScanModule hands the scanned count to the form');
} else {
  fail('ScanModule does not pass scannedQty — the form has no count to hold anything to');
}
if (/const scannedQty = newScans > 0 \? newScans : 0;/.test(SM)) {
  ok('and it is newScans alone, never the balance fallback beside it');
} else {
  fail('scannedQty is not derived from newScans alone — a figure no scanner saw must not bind a delivery order');
}
const DM = R('src/modules/do/DoModule.jsx');
if (!/scannedQty/.test(DM)) {
  ok('the DO module passes none, so its manual entry is untouched');
} else {
  fail('the DO module passes a scannedQty — it has no scan behind it');
}

/* ── 12. Both languages say it ───────────────────────────────────────── */
const I18N = R('src/i18n.js');
for (const k of ['do.scannedLabel', 'do.scanOneLine', 'do.scanTallies', 'do.scanShort', 'do.scanOver', 'do.fromTheScan', 'do.mustTallyScan']) {
  const n = (I18N.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length;
  if (n === 2) ok("'" + k + "' is in both languages");
  else fail("'" + k + "' appears " + n + " times, wanted 2 (English and Malay)");
}

console.log('');
console.log(failed ? failed + ' FAILED' : 'all good');
process.exit(failed ? 1 : 0);
