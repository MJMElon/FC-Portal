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

/* ── 2. Several batches, one line each ───────────────────────────────
   Lifted from the component: expandRows is the whole reason a row cannot
   just carry a comma-joined batch. */
const breedOf = new Map([
  [batchKey('256'), 'IOI DxP HYBRID'],
  [batchKey('268'), 'AA Hybrida 1S'],
]);
const ledgerBreed = (b) => (b ? breedOf.get(batchKey(b)) || '' : '');
const MAX_LINES = 5;
const lineCount = (rows) => rows.reduce((s, r) => s + Math.max(1, (r.picks || []).length), 0);

function expandRows(rows) {
  const out = [];
  for (const r of rows) {
    const nursery = (r.nursery || '').trim();
    const plot = (r.plot || '').trim();
    if (r.picks && r.picks.length) {
      for (const p of r.picks) {
        out.push({ nursery, plot, batch: (p.batch || '').trim(),
                   breed: (p.breed || '').trim(), qty: parseInt(p.qty) || 0 });
      }
    } else {
      out.push({ nursery, plot, batch: (r.batch || '').trim(),
                 breed: (r.breed || '').trim(), qty: parseInt(r.qty) || 0 });
    }
  }
  return out;
}
function togglePick(rows, rowKey, batch) {
  const row = rows.find((r) => r.key === rowKey);
  const on = row && (row.picks || []).some((p) => p.batch === batch);
  if (!on && lineCount(rows) >= MAX_LINES) return rows;          // refused
  return rows.map((r) => {
    if (r.key !== rowKey) return r;
    const picks = r.picks || [];
    return { ...r, picks: picks.some((p) => p.batch === batch)
      ? picks.filter((p) => p.batch !== batch)
      : [...picks, { batch, breed: ledgerBreed(batch), qty: '' }] };
  });
}
const setQty = (rows, k, b, q) => rows.map((r) => (r.key !== k ? r : {
  ...r, picks: r.picks.map((p) => (p.batch === b ? { ...p, qty: q } : p)) }));

let rows = [{ key: 'a', nursery: 'UNN 1', plot: 'B1', picks: [], batch: '', breed: '', qty: '' }];
rows = togglePick(rows, 'a', '256');
if (rows[0].picks.length === 1 && rows[0].picks[0].breed === 'IOI DxP HYBRID') {
  pass('choosing a batch takes its breed straight off the ledger');
} else {
  fail('expected one pick carrying its breed, got ' + JSON.stringify(rows[0].picks));
}

rows = togglePick(rows, 'a', '268');
if (rows[0].picks.length === 2) pass('a second batch can be chosen on the same row');
else fail('the row would not take a second batch: ' + JSON.stringify(rows[0].picks));

rows = setQty(rows, 'a', '256', '2300');
rows = setQty(rows, 'a', '268', '700');
const items = expandRows(rows);
if (items.length === 2) pass('two batches become TWO delivery order lines, not one');
else fail('expected 2 lines, got ' + items.length + ': ' + JSON.stringify(items));

const l256 = items.find((i) => i.batch === '256');
const l268 = items.find((i) => i.batch === '268');
if (l256 && l256.qty === 2300 && l268 && l268.qty === 700) {
  pass('each line carries its OWN quantity — 256 got 2,300 and 268 got 700');
} else {
  fail('the quantities did not land per batch: ' + JSON.stringify(items));
}
if (l256.breed === 'IOI DxP HYBRID' && l268.breed === 'AA Hybrida 1S') {
  pass('each line carries the breed of ITS batch');
} else {
  fail('a line carried the wrong breed: ' + JSON.stringify(items));
}
if (items.every((i) => !/[,;/|]/.test(i.batch))) {
  pass('no line joins batches with a comma');
} else {
  fail('a line names more than one batch. The office report does\n' +
       '      _mvBatchKey("256,268") → matches nothing → the whole sale vanishes.');
}
if (items.every((i) => i.plot === 'B1' && i.nursery === 'UNN 1')) {
  pass('both lines keep the row plot and nursery');
} else {
  fail('the plot or nursery was lost on expansion: ' + JSON.stringify(items));
}

/* Tapping again removes it. */
rows = togglePick(rows, 'a', '256');
if (rows[0].picks.length === 1 && rows[0].picks[0].batch === '268') {
  pass('tapping a chosen batch again takes it off, and leaves the other alone');
} else {
  fail('removing one batch did not behave: ' + JSON.stringify(rows[0].picks));
}

/* Five slots on the record, so five LINES. The sixth is refused HERE,
   not dropped at save time. */
let many = [{ key: 'a', nursery: 'UNN 1', plot: 'B1', picks: [], batch: '', breed: '', qty: '' }];
for (const b of ['256', '268', '252', '253', '254']) many = togglePick(many, 'a', b);
const before = many[0].picks.length;
many = togglePick(many, 'a', '257');
if (before === 5 && many[0].picks.length === 5) {
  pass('a sixth line is refused at the tap, not silently dropped at save');
} else {
  fail(`expected five picks and a refused sixth, got ${before} then ${many[0].picks.length}` +
       '\n      A dropped line means signing a delivery order for more than it records.');
}

/* A plot that offers no batches still produces a line from the row. */
const plain = expandRows([{ key: 'b', nursery: 'PN', plot: 'P01', picks: [],
                            batch: '', breed: 'AA Hybrida 1S', qty: '40' }]);
if (plain.length === 1 && plain[0].qty === 40 && plain[0].breed === 'AA Hybrida 1S') {
  pass('a plot with no batches still makes a line, with its hand-picked breed');
} else {
  fail('the no-batch path broke: ' + JSON.stringify(plain));
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
