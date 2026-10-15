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
if (/cullingLines\(batches, termsBy, active, typing\)/.test(TAB)
 && !/editable: Number\.isFinite/.test(TAB)) {
  ok('the screen builds its lines through the one helper and keeps no copy');
} else {
  fail('the line arithmetic is back inside the screen, where it cannot be driven');
}
/* THE TAP THAT USED TO LOSE THE COUNT. Switching batch commits what was
   keyed into the one being left; without it, 52 keyed into 246 vanished the
   moment the next batch was touched. */
if (/if \(active !== l\.batch\) \{ commit\(\); setActive\(l\.batch\); \}/.test(TAB)) {
  ok('tapping another batch COMMITS the count on the one being left');
} else {
  fail('switching batch throws away what was being typed into the last one');
}
if (/commit\(\);\n    setBusy\(true\);/.test(TAB)) {
  ok('and so does raising a case, so the screen does not drop it when the keypad clears');
} else {
  fail('raising a case clears the keypad without folding in what was on it');
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

/* ── 8b. WHAT IS BEING TYPED IS PART OF THE COUNT ────────────────────
   The fault this section exists for: 52 keyed into batch 246 brought it
   from red to green, the Field Conductor tapped the next batch, and the 52
   was gone — the row back to red with nothing saying why. The count being
   typed lived outside the saved list until + or = was pressed.

   The real function, driven over the real batches. */
const lctx = { console };
vm.createContext(lctx);
vm.runInContext(
  R('src/modules/palms/cullingLines.js')
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '')
  + `
    const CULL_LIMIT = 0.1;
    const rateFor = ({ balance, transplant, inang }) =>
      (transplant > 0 ? (balance - (inang || 0)) / transplant : NaN);
    const hasFigures = (r) => !!r && r.transplant > 0 && r.balance >= 0;
    const figuresBroken = (b) => !!b && b.transplant > 0 && b.balance < 0;
    ;globalThis.__L = cullingLines;`, lctx);
const cullingLines = vm.runInContext('__L', lctx);

const BATCHES = [
  { batch: '246', balance: 120, transplant: 1000 },   // 12% — over
  { batch: '247', balance: 60,  transplant: 1000 },   // 6%  — clear
  { batch: '248', balance: -5,  transplant: 1000 },   // the ledger does not add up
];
const line = (ls, b) => ls.find((l) => l.batch === b);

/* 52 on the keypad, nothing committed, 246 active. */
let L = cullingLines(BATCHES, {}, '246', '52');
is(line(L, '246').inang, 52, 'what is being typed counts at once — no + and no = needed');
is(line(L, '246').finalBalance, 68, 'and the final balance follows it');
is(line(L, '246').finalRate <= 0.1, true, 'which is what takes the row from red to green');
is(line(L, '247').inang, 0, 'and it counts for the ACTIVE batch only');

/* The tap on the next batch, which is what used to lose it: the screen
   commits first, so the 52 is in the saved list by the time 247 is live. */
L = cullingLines(BATCHES, { 246: [52] }, '247', '');
is(line(L, '246').inang, 52, 'moving to the next batch keeps the 52 on 246');
is(line(L, '246').finalRate <= 0.1, true, 'so it stays green');

/* Keyed in several goes, which is how a plot is walked. */
L = cullingLines(BATCHES, { 246: [30, 15] }, '246', '7');
is(line(L, '246').inang, 52, 'the goes add up, the one in flight included');
is(line(L, '246').terms, [30, 15, 7],
   'and the SEPARATE counts are what gets saved — a walk in three goes is not one figure of 52');

/* A nought keyed is an answer: I looked and there are none. */
is(line(cullingLines(BATCHES, {}, '246', '0'), '246').inang, 0, 'nought keyed is nought');
is(line(cullingLines(BATCHES, {}, '246', ''), '246').terms, [],
   'and nothing keyed is nothing — it is the empty string that means untouched, never the value');

/* Who may be keyed into. */
is([line(L, '246').editable, line(L, '247').editable, line(L, '248').editable],
   [true, false, false],
   'only a batch over the line — one already under it has nothing to bring down, and one whose ledger does not add up has no rate at all');

/* ── 8c. SAVED AS IT IS KEYED, AND A DRAFT IS NOT A ROUND ────────────
   A count walked in a plot and typed on a phone is work that has been done,
   so it is written within the second of the last keystroke. That makes the
   two things the HQ button turns on impossible to tell apart unless they
   are kept apart: the LIVE figure moves continuously, and the figure the
   last round was SENT with does not. */
/* The draft function ALONE — to the next export, or saveInang below it
   would answer for it and the check would pass on a draft that did write a
   round. */
const DRAFT = (() => {
  const from = STORE.indexOf('export async function draftInang');
  const to = STORE.indexOf('\nexport ', from + 10);
  return from < 0 ? '' : STORE.slice(from, to < 0 ? undefined : to);
})();
if (DRAFT && !/attempt|sent_qty/.test(DRAFT)) {
  ok('the draft writes the figure and says nothing about rounds');
} else {
  fail('the draft writes a round — the HQ button would light over a figure nobody has sent');
}
if (/sent_qty: Math\.max/.test(STORE)) {
  ok('and the hard save records what the round was sent with');
} else {
  fail('nothing records the figure a round went with, so a re-open reads as a re-count');
}
if (/const sent = was && was\.sentQty != null \? was\.sentQty : 0;/.test(TAB)) {
  ok('and the HQ button compares against THAT, never against the live draft');
} else {
  fail('the HQ gate compares against the continuously-saved figure, so it can never light');
}
if (/if \(!plotRow \|\| !loadedPlot \|\| loadedPlot !== plotRow\.plot\) return;/.test(TAB)) {
  ok('and nothing is written until the plot own rows have been read');
} else {
  fail('the draft can race the load and write an empty selection over a real one');
}
if (/setTimeout\(\(\) => \{\s*draftInang/.test(TAB)) {
  ok('within the second of the last keystroke, not on every digit');
} else {
  fail('the draft is not debounced — three writes to key 250 on a nursery signal');
}

/* ── 8d. A SAVE SOMEBODY PRESSES ─────────────────────────────────────
   The draft goes up by itself, so this changes nothing about what is
   recorded. What it changes is KNOWING: a save that happens silently is one
   nobody can be sure of, and a Field Conductor about to walk away wants to
   be told rather than to assume. */
if (/async function saveDraftNow/.test(TAB) && /data-save/.test(TAB)) {
  ok('there is a Save button, and it writes the same draft');
} else {
  fail('no Save button');
}
if (/flash\(landed \? t\('cull\.saved'\) : t\('cull\.draftFailed'\)\)/.test(TAB)) {
  ok('and it SAYS whether it landed, which is the whole of its job');
} else {
  fail('the Save button does not say whether the save landed');
}
if (/async function saveDraftNow[\s\S]{0,200}commit\(\);/.test(TAB)) {
  ok('folding in what is on the keypad first, so it saves what is on screen');
} else {
  fail('Save does not commit the keypad, so it can write less than the screen shows');
}
if (/const landed = await draftInang\(/.test(TAB)) {
  ok('and it is the DRAFT writer — pressing Save raises no case and counts no round');
} else {
  fail('the Save button writes through the round-counting save');
}
for (const k of ['cull.save', 'cull.saved', 'cull.nothingToSave']) {
  const n = (I18N.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length;
  if (n === 2) ok("'" + k + "' is in both languages");
  else fail("'" + k + "' appears " + n + " times, wanted 2 (English and Malay)");
}

/* ── 9. The board the office drew, and the clear underneath it ───────── */
if (!/'AC', 'AC'/.test(TAB) && !/key\('00'/.test(TAB)) {
  ok('four rows, and no AC or 00 — the keypad the office drew');
} else {
  fail('the keypad still carries AC or 00');
}
if (/grid-cols-4 grid-rows-4/.test(TAB)) {
  ok('four columns by four rows');
} else {
  fail('the keypad is not the four-by-four board');
}
if (/onPress\('AC'\)/.test(TAB) && /onPointerDown: start/.test(TAB)) {
  ok('and holding delete still clears the lot — the function survived the row that carried it');
} else {
  fail('AC went and nothing replaced it, so there is no way back to nothing');
}
if ((TAB.match(/text-center align-middle/g) || []).length === 4) {
  ok('every figure is centred across and down');
} else {
  fail('the table is not centred in all four columns');
}
if ((TAB.match(/whitespace-normal break-words/g) || []).length >= 6) {
  ok('and the headings and figures WRAP rather than being squeezed');
} else {
  fail('a column still squeezes its text instead of wrapping it');
}

/* ── 10. The SQL the office has to run ───────────────────────────────── */
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
