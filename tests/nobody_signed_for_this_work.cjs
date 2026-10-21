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
  + '\n;globalThis.__p = { doNeedsWorkers, missingJobs, plotsOwingJobs, clampIndex, sinceISO, VERIFY_WINDOW_DAYS };',
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

/* ── 4. The window ───────────────────────────────────────────────────── */
is(P.VERIFY_WINDOW_DAYS, 92,
   'the same 92 days History uses, so the portal has one answer to how far back it looks');
is(P.sinceISO(92, new Date(2026, 9, 21)), '2026-07-21', '92 days back from 21 Oct 2026');
is(P.sinceISO(92, new Date(2026, 0, 5)), '2025-10-05', 'and it crosses the year end');

/* ── 5. The wiring on the page ───────────────────────────────────────── */
const board = R('src/components/VerificationBoard.jsx');
const dash  = R('src/components/Dashboard.jsx');
const maint = R('src/modules/maintenance/MaintenanceModule.jsx');

yes(/<VerificationBoard \/>/.test(dash), 'the board is on the dashboard');
yes(dash.indexOf('<VerificationBoard />') > dash.indexOf('<CollectionBoard />')
 && dash.indexOf('<VerificationBoard />') < dash.indexOf('<MaintenanceBoard />'),
    'between the collections and the maintenance status, which is the order of the morning');
yes(/if \(!ready \|\| total === 0\) return null;/.test(board),
    'and it disappears when there is nothing to verify');
yes(/grid grid-cols-2/.test(board), 'the two halves sit side by side at every width');

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
