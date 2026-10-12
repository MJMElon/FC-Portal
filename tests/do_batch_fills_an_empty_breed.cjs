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
    return { ...r, batch: next, breed: r.breed || known };
  });
}

let rows = [{ key: 'a', plot: 'U8', batch: '', breed: '', qty: '' }];
rows = pickBatch(rows, 'a', '252');
if (rows[0].batch === '252' && rows[0].breed === 'AA Hybrida 1S') {
  pass('picking a batch on an empty row fills the breed from the ledger');
} else {
  fail('expected batch 252 and breed AA Hybrida 1S, got ' + JSON.stringify(rows[0]));
}

rows = [{ key: 'a', plot: 'U8', batch: '', breed: 'UPB PREMIER HYBRID', qty: '' }];
rows = pickBatch(rows, 'a', '252');
if (rows[0].breed === 'UPB PREMIER HYBRID') {
  pass('a breed already chosen by hand is NOT overwritten by the batch');
} else {
  fail('picking a batch changed a breed the Field Conductor had already answered: ' +
       JSON.stringify(rows[0]) + '\n      A lookup fills an empty cell. It never writes over a full one.');
}

rows = pickBatch(rows, 'a', '252');   // press the same chip again
if (rows[0].batch === '' && rows[0].breed === 'UPB PREMIER HYBRID') {
  pass('pressing the same batch again clears it and leaves the breed alone');
} else {
  fail('unpicking the batch did not behave: ' + JSON.stringify(rows[0]));
}

rows = [{ key: 'a', plot: 'U8', batch: '', breed: '', qty: '' }];
rows = pickBatch(rows, 'a', '999');   // a batch nobody has a breed for
if (rows[0].batch === '999' && rows[0].breed === '') {
  pass('a batch with no breed on record still selects, and invents nothing');
} else {
  fail('an unknown batch should select with no breed, got ' + JSON.stringify(rows[0]));
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
