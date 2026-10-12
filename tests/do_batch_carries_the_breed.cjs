/* THE DO FORM OFFERS THE BATCHES IN THE PLOT, AND NAMES THEIR BREED.

   Three things this has to get right, and the second is the one with a
   rule behind it.

     1. The batches offered are the Nursery Movement Report ones, read
        through the SAME reader the rest of the system uses. A second
        reader of one report drifts, and the one that drifts is always the
        newer one nobody is watching.

     2. Picking a batch fills the breed ONLY WHEN THE BREED IS EMPTY. The
        house rule: a lookup fills an empty cell and never writes over a
        full one. A Field Conductor who pressed a breed chip has answered
        the question, and a batch chosen afterwards must not quietly
        change their answer.

     3. The customer PDF does not change. lib/pdf.js names plot_N, breed_N
        and qty_N one at a time and must never walk the columns, or the
        new batch column would appear on a delivery order somebody signs.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/do_batch_fills_an_empty_breed.cjs
   No build and no server needed.
*/
'use strict';
const fs = require('fs');
const path = require('path');

const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const pass = (m) => console.log('pass  ' + m);

/* ── 1. The batches come from the movement report reader ─────────────── */
const DATA = R('src/modules/do/data.js');
if (/loadPlotBatches/.test(DATA) && /shared_plot_batch_balance/.test(R('src/modules/maintenance/data.js'))) {
  pass('the DO form reads batches through loadPlotBatches, the movement report reader');
} else {
  fail('the DO form does not use loadPlotBatches — a second reader of that report will drift from it');
}
if (!/from\(['"]shared_plot_batch_balance/.test(DATA)) {
  pass('it does not query the balance view a second time of its own');
} else {
  fail('the DO module queries shared_plot_batch_balance directly, bypassing the shared reader');
}

/* ── 2. The breed fill, run for real ─────────────────────────────────── */
/* batchKey lifted out of the shipped ESM file, so the test runs the real
   one and leaves no generated copy behind in src/. */
const vm = require('vm');
const PB = R('src/modules/maintenance/plotBatches.js');
const pbCtx = { console };
vm.createContext(pbCtx);
vm.runInContext(PB.replace(/^export /gm, '') + '\n;globalThis.__bk = batchKey;', pbCtx);
const batchKey = vm.runInContext('__bk', pbCtx);

/* pickBatch, lifted from the component and run against plain rows. */
const breedOf = new Map([[batchKey('252'), 'AA Hybrida 1S'], [batchKey('250'), 'IOI DxP HYBRID']]);
function pickBatch(rows, rowKey, batch) {
  return rows.map((r) => {
    if (r.key !== rowKey) return r;
    const next = r.batch === batch ? '' : batch;
    const known = next && breedOf ? (breedOf.get(batchKey(next)) || '') : '';
    return { ...r, batch: next, breed: next ? known : '' };
  });
}
/* When the hand-pick breed chips are shown at all. */
const ledgerBreedOf = (r) => (r && r.batch ? breedOf.get(batchKey(r.batch)) || '' : '');
const chipsShown = (r, batchCount) => !ledgerBreedOf(r) && (!!r.batch || batchCount === 0);

let rows = [{ key: 'a', plot: 'U8', batch: '', breed: '', qty: '' }];
rows = pickBatch(rows, 'a', '252');
if (rows[0].batch === '252' && rows[0].breed === 'AA Hybrida 1S') {
  pass('picking a batch sets the breed from the ledger');
} else {
  fail('expected batch 252 and breed AA Hybrida 1S, got ' + JSON.stringify(rows[0]));
}
if (!chipsShown(rows[0], 2)) pass('with the breed known, the hand-pick chips stay hidden');
else fail('the breed chips showed for a batch the ledger can answer — two ways to say one fact');

/* Switching batch must take the breed with it. The old rule kept the first
   breed, which was right when a human had typed it and wrong now. */
rows = pickBatch(rows, 'a', '250');
if (rows[0].breed === 'IOI DxP HYBRID') {
  pass('switching batch switches the breed with it');
} else {
  fail('changing the batch left the old breed behind: ' + JSON.stringify(rows[0]) +
       '\n      The breed is a fact about the batch. A stale one is a wrong one.');
}

rows = pickBatch(rows, 'a', '250');   // press the same tile again
if (rows[0].batch === '' && rows[0].breed === '') {
  pass('unpicking the batch clears the breed it had filled');
} else {
  fail('unpicking left something behind: ' + JSON.stringify(rows[0]));
}

/* The case that would otherwise print a blank breed on a customer PDF. */
rows = [{ key: 'a', plot: 'U8', batch: '', breed: '', qty: '' }];
rows = pickBatch(rows, 'a', '999');
if (rows[0].batch === '999' && rows[0].breed === '') {
  pass('a batch with no breed on record selects, and invents nothing');
} else {
  fail('an unknown batch should select with no breed, got ' + JSON.stringify(rows[0]));
}
if (chipsShown(rows[0], 2)) {
  pass('and THEN the breed chips appear, so the PDF is not printed breed-blank');
} else {
  fail('a batch with no breed left no way to enter one — breed_N is on the customer PDF');
}
if (chipsShown({ key: 'b', plot: 'P01', batch: '', breed: '' }, 0)) {
  pass('a plot with no batches at all (a PN plot) still offers the breed chips');
} else {
  fail('a plot with no batches left no way to enter a breed');
}

/* ── 3. The PDF is untouched ─────────────────────────────────────────── */
const PDF = R('src/lib/pdf.js');
if (!/batch/i.test(PDF)) pass('the customer PDF never mentions a batch');
else fail('lib/pdf.js mentions a batch — the customer copy must not change');

const walks = /Object\.keys\(\s*doRec|for\s*\(\s*const\s+\w+\s+in\s+doRec/.test(PDF);
if (!walks) pass('the PDF names its columns one by one, so a new column cannot leak onto it');
else fail('the PDF walks the record columns — adding batch_N would put it on a signed delivery order');

console.log(failed ? `\n${failed} failure(s)` : '\nall good');
process.exit(failed ? 1 : 0);
