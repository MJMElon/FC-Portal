/* THE CULLING CALCULATOR IS A PLOT, NOT ONE BATCH AT A TIME.

   The office drew the screen they wanted: the plot at the top, every batch
   standing in it on a line of its own with its balance and its rate, a
   column to key the pokok inang selected off it, and what that leaves. Then
   three buttons, and which one is live is the whole decision:

     · EVERY final rate green  -> Request Drone Flight.
     · Any one of them red     -> Request Final Pokok Inang Selection, which
                                  sends an auditor. Same Nelos case as
                                  before: only the WORDING on the button
                                  changed, because the category is the string
                                  nelos_routes matches on.
     · Still red the SECOND time somebody keys a selection -> Request HQ
       Verification, which goes to HQ Operation. A loop that has been round
       twice is not a figure to re-count.

   THE WORST BATCH DECIDES, never an average: two batches averaged together
   hide the one in trouble behind the one that is fine, which is the reason
   this screen never offered an all-batches figure to act on.

   A batch whose ledger does not add up answers NEITHER button. "Cannot say"
   must never read as "yes".

   And the rounds cannot be counted on the phone, which is why there is a
   table: the second selection is usually keyed by somebody else, often on a
   different phone.

   The rules are driven for real, out of src/modules/palms/cullingActions.js.

   Run: node tests/the_plot_decides_not_one_batch.cjs
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

/* ── the real rules ──────────────────────────────────────────────────── */
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  R('src/modules/palms/cullingActions.js')
    .replace(/^import .*$/gm, 'const fmtNum = (n) => String(n); const fmtPct = (r) => (r * 100).toFixed(2) + "%";')
    .replace(/^export /gm, '')
  + '\n;globalThis.__a = { CULL_LIMIT, CULLING_ACTIONS, HQ_ACTION, actionFor, actionForPlot, caseBody };', ctx);
const A = vm.runInContext('__a', ctx);

/* ── 1. The line itself ──────────────────────────────────────────────── */
is(A.CULL_LIMIT, 0.1, 'ten percent, in one place');

/* ── 2. The worst batch decides ──────────────────────────────────────── */
is(A.actionForPlot([0.05, 0.09, 0.10]).key, 'drone',
   'every batch at or under the line is a plot ready for its drone flight');
is(A.actionForPlot([0.05, 0.09, 0.12]).key, 'recheck',
   'one batch over and the whole plot is not ready, however many are fine');
is(A.actionForPlot([0.12]).key, 'recheck', 'a single batch over is over');
is(A.actionForPlot([0.1000001]).key, 'recheck', 'just over is over');

/* An AVERAGE would call that first case ready: (5 + 9 + 12) / 3 is 8.67%. */
const avg = (0.05 + 0.09 + 0.12) / 3;
is(A.actionFor(avg).key, 'drone',
   'and an average of the same three WOULD have called it ready — which is why it is the worst, not the mean');

/* ── 3. Cannot say is never yes ──────────────────────────────────────── */
is(A.actionForPlot([0.05, NaN]), null,
   'a batch whose ledger does not add up offers no button at all');
is(A.actionForPlot([]), null, 'and a plot with no batches offers none either');

/* ── 4. The categories are the routing, so they are held exactly ─────── */
is(A.CULLING_ACTIONS.find((a) => a.key === 'drone').category,
   'From Culling Calculator - Request Drone Flight',
   'the drone category is unchanged — it is the string nelos_routes matches on');
is(A.CULLING_ACTIONS.find((a) => a.key === 'recheck').category,
   'From Culling Calculator - Request Final Check For Pokok Inang',
   'and so is the auditor one, though the BUTTON was renamed');
is(A.HQ_ACTION.category, 'From Culling Calculator - Request HQ Verification',
   'the HQ one is the third spelling of a string that lives in three places');

/* ── 5. The button was renamed and the case was not ──────────────────── */
const I18N = R('src/i18n.js');
is(/'cull\.actRecheck': 'Request final pokok inang selection'/.test(I18N), true,
   'the button says Request final pokok inang selection');
is(/'cull\.actHq': 'Request HQ verification'/.test(I18N), true, 'and the third one says HQ');
for (const k of ['cull.actHq', 'cull.finalBalance', 'cull.pickBatchFirst', 'cull.saveFailed']) {
  const n = (I18N.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length;
  if (n === 2) ok("'" + k + "' is in both languages");
  else fail("'" + k + "' appears " + n + " times, wanted 2 (English and Malay)");
}

/* ── 6. The case records the WHOLE plot ──────────────────────────────── */
const t = (k) => ({ 'cull.plot': 'Plot', 'cull.batchField': 'Batch', 'cull.balance': 'Balance',
  'cull.selected': 'Selected', 'cull.finalBalance': 'Final balance', 'cull.raisedBy': 'Raised by' }[k] || k);
const body = A.caseBody({
  t, plot: 'U6', nursery: 'UNN1', by: 'Ali', date: '2026-10-15',
  rows: [
    { batch: '123', balance: 40, inang: 0, terms: [], rate: 0.05, finalRate: 0.05, finalBalance: 40 },
    { batch: '125', balance: 100, inang: 10, terms: [6, 4], rate: 0.12, finalRate: 0.10, finalBalance: 90 },
  ],
});
is(/Batch 123: Balance 40 \(5.00%\)/.test(body), true, 'every batch is on the case, not just one');
is(/Batch 125: Balance 100 \(12.00%\)/.test(body), true, 'including the one that was over');
is(/\(6 \+ 4\)/.test(body), true,
   'and the separate counts are kept — a walk in two goes is not one figure of 10');
is(/Final balance 90 \(10.00%\)/.test(body), true, 'with what the selection left it at');

/* ── 7. The screen is wired to all of it ─────────────────────────────── */
const TAB = R('src/modules/palms/CullingTab.jsx');
if (/actionForPlot\(lines\.map\(\(l\) => l\.finalRate\)\)/.test(TAB)) {
  ok('the screen asks the rule about every batch at once');
} else {
  fail('the screen does not decide over the whole plot');
}
if (/const canFinal = anyOver && saved\.rounds < 1;/.test(TAB)
 && /const canHq    = anyOver && saved\.rounds >= 1 && keyedThisRound;/.test(TAB)) {
  ok('HQ is the SECOND time round and only with a new selection keyed');
} else {
  fail('the HQ button is not gated on a second round');
}
if (/editable: Number\.isFinite\(rate\) && rate > CULL_LIMIT/.test(TAB)) {
  ok('only a batch over the line can be keyed into');
} else {
  fail('the Select cell is offered on a batch that has nothing to bring down');
}
if (/await saveInang\(/.test(TAB) && TAB.indexOf('await saveInang(') < TAB.indexOf('await submitCase(')) {
  ok('the selection is written down BEFORE the case is raised');
} else {
  fail('a case can be raised over figures the office cannot see');
}
if (/if \(!cached\) pruneInang\(/.test(TAB)) {
  ok('a plot that has left the list loses its selection — and never off a cached list');
} else {
  fail('the prune can run against a list a phone read with no signal');
}
if (/clearInang\(plot\)/.test(TAB)) {
  ok('and a plot an admin takes off by hand loses it too');
} else {
  fail('removing a plot by hand leaves its selection behind');
}

/* ── 8. The store, and the one thing it must never do ────────────────── */
const STORE = R('src/modules/palms/cullingInang.js');
if (/onConflict: 'plot,batch'/.test(STORE)) {
  ok('one row per block of ground, replaced each round');
} else {
  fail('the save does not upsert on (plot, batch) — a second round would stack beside the first');
}
if (/export async function saveInang/.test(STORE) && /if \(error\) throw error;/.test(STORE)) {
  ok('and a refused save THROWS — nobody is told a selection was recorded when it was not');
} else {
  fail('saveInang swallows a refusal');
}

/* ── 9. The SQL the office has to run ────────────────────────────────── */
const SQL = R('../mjm-ai-system/shared/RUN_ME_culling_inang.sql');
is(/CREATE UNIQUE INDEX IF NOT EXISTS fcportal_culling_inang_block[\s\S]{0,80}\(plot, batch\)/.test(SQL), true,
   'the table carries the unique index the upsert names');
is(/'From Culling Calculator - Request HQ Verification'/.test(SQL), true,
   'and the HQ category is spelled the same there as in the code');
is(/to_module, updated_by\)[\s\S]{0,200}'nursery_ops'/.test(SQL), true,
   'routed to HQ Operation');

console.log('');
console.log(failed ? failed + ' FAILED' : 'all good');
process.exit(failed ? 1 : 0);
