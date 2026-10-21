/* WHAT WAS DONE AND NOBODY SIGNED FOR IT.
 *
 * Two gaps, one shape, and both of them are invisible by construction.
 *
 *   - Skipping "Who Loaded This DO" writes NOTHING. do/data.js says it in
 *     as many words: a DO with no worked_by_by_nursery "reads identically
 *     to one nobody has looked at yet". So the only difference between a
 *     delivery order somebody answered and one somebody walked past is an
 *     empty column that nothing was looking at.
 *   - A plot the ledger says was transplanted into owes four jobs, each a
 *     crew and a quantity. Nothing raised a plot whose jobs were never
 *     recorded either; you found it by opening the sheet and looking.
 *
 * Both are somebody's pay. The dashboard now raises them, and these are the
 * rules that decide what it raises -- driven for real out of
 * src/components/verify/pending.js rather than restated here.
 *
 * Run: node tests/nobody_signed_for_this_work.cjs
 * No build and no server needed.
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
const yes = (c, m) => (c ? ok(m) : fail(m));

/* ── the real rules, with their two imports supplied for real ─────────
   isCancelledDO and TRANSPLANT_JOBS are lifted out of the shipped files
   they live in, not stubbed: a stub of "what counts as cancelled" or "what
   the four jobs are" would be a second copy of the very thing under test. */
const strip = (f) => R(f).replace(/^import .*$/gm, '').replace(/^export /gm, '');

const cancelled = (() => {
  const src = R('src/modules/do/data.js');
  const at = src.indexOf('export function isCancelledDO');
  let depth = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1).replace(/^export /, '');
  }
  throw new Error('isCancelledDO not found');
})();

const jobs = (() => {
  const src = R('src/modules/maintenance/transplantData.js');
  const at = src.indexOf('export const TRANSPLANT_JOBS = [');
  const end = src.indexOf('];', at) + 2;
  return src.slice(at, end).replace(/^export /, '');
})();

const ctx = { console, Date, JSON, Math, Object, Set, Array, String, Number, Boolean };
vm.createContext(ctx);
vm.runInContext(cancelled + '\n' + jobs + '\n' + strip('src/components/verify/pending.js')
  + '\n;globalThis.__p = { doNeedsWorkers, missingJobs, plotsOwingJobs, clampIndex, LOADING_WORKERS_FROM };',
  ctx);
const P = vm.runInContext('__p', ctx);

/* ── 1. The delivery order nobody ticked ─────────────────────────────── */
const DO = (over) => Object.assign({ id: 7, do_number: 'DO-1', status: 'issued' }, over);

is(P.doNeedsWorkers(DO({})), true,
   'a DO with no worked_by_by_nursery at all is outstanding — the skip wrote nothing');
is(P.doNeedsWorkers(DO({ worked_by_by_nursery: null })), true,
   'an explicit null is the same answer');
is(P.doNeedsWorkers(DO({ worked_by_by_nursery: {} })), true,
   'an EMPTY object names nobody, so it is outstanding too');
is(P.doNeedsWorkers(DO({ worked_by_by_nursery: { UNN1: [] } })), true,
   'a nursery with no names against it still names nobody');
is(P.doNeedsWorkers(DO({ worked_by_by_nursery: { UNN1: ['Ali'] } })), false,
   'one name is an answer, and it comes off the list');
is(P.doNeedsWorkers(DO({ worked_by_by_nursery: { BNN: [], UNN1: ['Ali'] } })), false,
   'an empty section beside a filled one is still an answer');

/* A cancelled DO loaded nothing, so nobody loaded it. Driven through the
   REAL isCancelledDO so the two screens cannot disagree about what counts
   as cancelled. */
is(P.doNeedsWorkers(DO({ status: 'Cancelled' })), false,
   'a cancelled DO is not outstanding — nothing was loaded, so nobody loaded it');
/* BOTH routes, because isCancelledDO has two and the capital is exact:
   a DO cancelled by its REMARK must not be raised either, and a lowercase
   "cancelled" is not what that rule reads. The first draft of this test
   used the lowercase one and was right to fail. */
is(P.doNeedsWorkers(DO({ remark: 'void [CANCELLED] by office' })), false,
   'and one cancelled in its remark is out by the same shared rule');
is(P.doNeedsWorkers(DO({ status: 'cancelled' })), true,
   'while a lowercase status is NOT the cancelled the shared rule means');
is(P.doNeedsWorkers(null), false, 'nothing at all is not a DO');
is(P.doNeedsWorkers({ do_number: 'x' }), false,
   'a row with no id cannot be answered, so it is not raised');

/* ── 2. The transplanted plot whose jobs are not recorded ────────────── */
const rows = [
  { plot: 'B04', qty: 2300, batch: '256' },
  { plot: 'B07', qty: 1900, batch: '258' },
  { plot: 'N12', qty: 800,  batch: '261' },
];
const rec = (plot, work_type) => ({ plot_name: plot, work_type });
const ALL = ['blanket_spray', 'lining', 'polybag_fill', 'transplanting'];

{
  const records = [
    ...ALL.map((k) => rec('B04', k)),              // B04 fully recorded
    rec('B07', 'blanket_spray'), rec('B07', 'lining'),   // B07 half
    // N12 nothing at all
  ];
  const owing = P.plotsOwingJobs(rows, records);
  is(owing.map((r) => r.plot), ['B07', 'N12'],
     'a plot with all four jobs recorded is off the list; the other two stay');
  is(owing[0].missing.map((j) => j.key), ['polybag_fill', 'transplanting'],
     'and the card can say WHICH jobs are missing, not merely how many');
  is(owing[1].missing.length, 4, 'a plot nobody has recorded at all owes all four');
}
{
  is(P.plotsOwingJobs(rows, []).length, 3, 'no records at all: every transplanted plot is owing');
  is(P.plotsOwingJobs([], [rec('B04', 'lining')]).length, 0,
     'and a plot the ledger never transplanted into is not raised by a stray record');
}
/* A record for ANOTHER plot must not tick this one off. */
is(P.missingJobs('B04', [rec('B07', 'lining')]).length, 4,
   'a record against a different plot ticks nothing off this one');

/* ── 3. The stepper ──────────────────────────────────────────────────── */
is(P.clampIndex(0, 5), 0, 'the stepper starts at the first card');
is(P.clampIndex(9, 5), 4, 'it CLAMPS rather than wrapping — the last card does not roll round');
is(P.clampIndex(-3, 5), 0, 'and it cannot go below the first');
is(P.clampIndex(3, 0), 0, 'an emptied list leaves the index somewhere safe');
/* The one that matters: answering the card you are ON shortens the list
   under you, and the index must come back inside it. */
is(P.clampIndex(2, 2), 1, 'a list that SHRANK under the open card does not point past the end');

/* ── 4. Where the loading list starts ────────────────────────────────── */
/* A rolling 92 days opened on 332 delivery orders, nearly all from before
   anybody was ticking loaders at all -- 332 questions that were never going
   to be answered, sitting on top of the handful that would. A wall gets
   scrolled past; it is not a list anybody works down. The floor is the
   month the step started being done. */
is(P.LOADING_WORKERS_FROM, '2026-10-01',
   'the loading list starts at October 2026, the month the step started being done');
yes(!/VERIFY_WINDOW_DAYS|sinceISO/.test(R('src/components/VerificationBoard.jsx')),
   'and the rolling window is gone, so there is only one rule for where it starts');

/* ── 5. The wiring on the page ───────────────────────────────────────── */
const board = R('src/components/VerificationBoard.jsx');
const dash  = R('src/components/Dashboard.jsx');
const maint = R('src/modules/maintenance/MaintenanceModule.jsx');

yes(/<VerificationBoard \/>/.test(dash), 'the board is on the dashboard');
/* Moved LAST on the page -- the office asked for it after the module tiles
   rather than between the collections and the maintenance status, so it is
   the last thing a Field Conductor scrolls to rather than a prompt sitting
   ahead of the day's own tools. */
yes(dash.indexOf('<VerificationBoard />') > dash.indexOf('<CollectionBoard />')
 && dash.indexOf('<VerificationBoard />') > dash.indexOf('<MaintenanceBoard />')
 && dash.indexOf('<VerificationBoard />') > dash.lastIndexOf('<ModuleGrid'),
    'last on the page, after both boards and both module-tile rows');
yes(/if \(!ready \|\| total === 0\) return null;/.test(board),
    'and it disappears when there is nothing to verify');
yes(/grid grid-cols-2/.test(board), 'the two halves sit side by side at every width');
yes(!/jobLabel/.test(board),
    'the job names are off the transplanting card -- four spelt in full made it a paragraph');

/* A DO ANSWERED HAS TO LEAVE THE LIST, and openWorkerTick's own `after`
   callback is the wrong tool: closeWorkerTick runs it on BOTH routes, so a
   DO skipped a second time would vanish exactly like one filled in -- card
   gone, work still owed, which is the fault this board exists to stop. */
yes(/if \(wasOpen\.current && !wt\.wtOpen\) setDoTick/.test(board),
    'the popup closing re-reads the delivery orders');
yes(/\}, \[mayDo, doTick\]\);/.test(board),
    'and that re-read is what the list is built from, so saved drops and skipped stays');
yes(!/openWorkerTick\([^)]*,\s*\(\)\s*=>/.test(board),
    'never through the after-callback, which fires on skip as well as on save');

/* A DO NUMBER IS NOT A THING ANYBODY RECOGNISES. The card and the popup
   both have to say which delivery, off which plot, of how many -- the
   person ticking a gang cannot answer from a reference number. Both read
   the SAME two rules out of do/data.js, which
   tests/another_nursery_can_load_the_do.cjs drives; here it is only that
   they are wired to them. */
const tick = R('src/modules/do/WorkerTickModal.jsx');
yes(/customerOfDO\(doCard\)/.test(board) && /plotsOfDO\(doCard\)/.test(board),
    'the card names the customer and the plot');
yes(!/doCard\.customer_name/.test(board),
    'and never customer_name on its own, which read out the AL number on every DO this portal issued');
yes(/customerOfDO\(wt\.wtDO\)/.test(tick), 'the popup names the customer too');
yes(/itemsFromRecord\(wt\.wtDO/.test(tick), 'and lists the plots it was loaded off');
yes(/wt\.wtDO\.total_qty\) \|\| lines\.reduce/.test(tick),
    'with the DO own total, falling back to the lines only where it has none');
yes(/setWtPlotMap\(plotMap \|\| \{\}\)/.test(R('src/modules/do/useWorkerTick.js')),
    'the plot map rides into the popup, so a DO that names a nursery still resolves');

/* TRANSPLANTING HAS LEFT MAINTENANCE -- button, sheet and the state behind
   them. A half-removal that leaves the import is the kind that comes back. */
yes(!/TransplantSheet/.test(maint), 'the Transplanting sheet is gone from the Maintenance module');
yes(!/t\('tp\.button'\)/.test(maint), 'and so is its button');
yes(/TransplantSheet/.test(board), 'the board opens that same sheet instead — the function is moved, not rebuilt');

/* Tailwind scans the SOURCE, so a class built from a variable is a class
   that never exists. This is the bug that would ship as "no borders". */
yes(!/`[^`]*-\$\{tone\}-/.test(board.replace(/\/\*[\s\S]*?\*\//g, '')),
    'no colour class is built from a variable, which Tailwind would never generate');

console.log('');
console.log(failed ? 'FAILED (' + failed + ')' : 'all green');
process.exit(failed ? 1 : 0);
