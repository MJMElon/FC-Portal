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

/* plotsOfDO reads plot_1..plot_5 through itemsFromRecord, so both are
   lifted -- doIsMine places a DO by the plots that function returns, and a
   restatement of it here would be a second reader of those five columns. */
const doPlots = (() => {
  const src = R('src/modules/do/data.js');
  const grab = (name) => {
    const at = src.indexOf('export function ' + name);
    if (at < 0) throw new Error(name + ' not found');
    /* The body opens after the PARAMETER LIST, not at the first brace in
       the line: itemsFromRecord is declared `(d, plotMap = {})`, and a
       scan from the first `{` matches that default and hands back half a
       signature. */
    let depth = 0;
    for (let j = src.indexOf('{', src.indexOf(')', at)); j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1).replace(/^export /, '');
    }
    throw new Error(name + ' not closed');
  };
  return grab('itemsFromRecord') + '\n' + grab('plotsOfDO');
})();

/* And the one nursery-matching rule this whole system compares names by. */
const nkey = (() => {
  const src = R('src/lib/access.js');
  const at = src.indexOf('export function nurseryKey');
  let depth = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1).replace(/^export /, '');
  }
  throw new Error('nurseryKey not found');
})();

const jobs = (() => {
  const src = R('src/modules/maintenance/transplantData.js');
  const at = src.indexOf('export const TRANSPLANT_JOBS = [');
  const end = src.indexOf('];', at) + 2;
  return src.slice(at, end).replace(/^export /, '');
})();

const ctx = { console, Date, JSON, Math, Object, Set, Array, String, Number, Boolean };
vm.createContext(ctx);
vm.runInContext(cancelled + '\n' + doPlots + '\n' + nkey + '\n' + jobs + '\n'
  + strip('src/components/verify/pending.js')
  + '\n;globalThis.__p = { doNeedsWorkers, missingJobs, plotsOwingJobs, clampIndex, LOADING_WORKERS_FROM, TJ: TRANSPLANT_JOBS, doIsMine: (typeof doIsMine === \'function\' ? doIsMine : null), owedBatches: (typeof owedBatches === \'function\' ? owedBatches : null) };',
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


/* ── 1b. AND IT HAS TO BE ONE OF MY NURSERIES ────────────────────────
   The office: *"BNN acc 只看到 BNN 的 plot, UNN1 只看到 UNN1 的 plot"*.
   The transplanting half has been scoped since it was written and this
   one never was, so a BNN conductor was shown a DO for N12.

   The plots come off the real plotsOfDO, so these fixtures are keyed the
   way a DO actually is -- plot_1..plot_5 and nothing else. */
const MAP = { B2: 'BNN', B3: 'BNN', N12: 'UNN 2', U18: 'UNN 1' };
const ONE = (over) => DO(Object.assign({ plot_1: 'B2', qty_1: 10 }, over));

/* ON THE PREVIOUS CODE THERE IS NO RULE AT ALL, and a test that then
   throws on a null reports a stack instead of naming what is missing. */
if (typeof P.doIsMine !== 'function') {
  fail('verify/pending.js exports no doIsMine -- the loading half is unscoped');
} else {

is(P.doIsMine(ONE({}), MAP, ['BNN']), true,
   'a BNN conductor keeps a BNN DO');
is(P.doIsMine(ONE({}), MAP, ['UNN1']), false,
   'and does not see it from the UNN1 circle');
is(P.doIsMine(DO({ plot_1: 'N12', qty_1: 10 }), MAP, ['BNN']), false,
   'the N12 DO the office was shown on a BNN board is off it');

/* THE TEST IS ANY, NOT EVERY, because a DO carries five plot columns and
   one load really can be drawn from two nurseries. Asking that all of
   them are mine would drop a DO half of which is my own work, and nobody
   would ever name the gang for it. */
is(P.doIsMine(DO({ plot_1: 'B2', qty_1: 5, plot_2: 'N12', qty_2: 5 }), MAP, ['BNN']), true,
   'a DO spanning two nurseries is mine if ANY plot is');
is(P.doIsMine(DO({ plot_1: 'B2', qty_1: 5, plot_2: 'N12', qty_2: 5 }), MAP, ['UNN2']), true,
   '…and the other nursery keeps it too, on the same rule');

/* The access tick list is typed by hand and says UNN1 where Seedling
   Stock says "UNN 1". Every nursery comparison in either repository goes
   through nurseryKey for exactly this. */
is(P.doIsMine(DO({ plot_1: 'U18', qty_1: 1 }), MAP, ['UNN1']), true,
   'UNN1 and "UNN 1" are one nursery');

/* A DO THAT CANNOT BE PLACED GOES ON SHOWING. A card that vanishes off
   every board with nothing saying where it went is the exact fault this
   board exists to stop. */
is(P.doIsMine(DO({ plot_1: 'ZZ9', qty_1: 1 }), MAP, ['BNN']), true,
   'a plot missing from Seedling Stock keeps its DO on the board');
is(P.doIsMine(DO({}), MAP, ['BNN']), true,
   'and so does a DO naming no plot at all');

/* Nobody configured is nobody asked -- the portal showed every DO before
   this existed and must go on doing so. */
is(P.doIsMine(DO({ plot_1: 'N12', qty_1: 1 }), MAP, []), true,
   'an empty nursery list is every nursery, not none');
is(P.doIsMine(DO({ plot_1: 'N12', qty_1: 1 }), MAP, null), true,
   '…and so is no list at all');
}

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


/* ── 2b. A NEW DELIVERY IS A NEW SET OF FOUR JOBS ────────────────────
   The office counted their own board and B11 was not on it, over a plot
   that had taken 135 more seedlings on 24 Oct after its four jobs were
   recorded on 29 Sep. The old rule asked only whether the PLOT had each
   job recorded, in any month ever, so a second delivery into a finished
   plot was invisible -- four more crews owed their pay, on no screen.

   IT CANNOT BE DONE BY DATE: filling and lining are sometimes done
   before the seedlings arrive and sometimes after, 两种都有, so a record
   older than an arrival proves nothing. The BATCH is what both sides
   carry, and the office own rows are what these fixtures are.

   The five plots below are theirs, letter for letter. */
const TJ = P.TJ;
/* ON THE PREVIOUS RULE THERE IS NO owedBatches AND missingJobs TAKES TWO
   ARGUMENTS, so a test that just calls them reports a stack instead of
   naming what is missing. */
if (typeof P.owedBatches !== 'function') {
  fail('verify/pending.js exports no owedBatches -- a second delivery into a finished plot is invisible');
} else {
const jrec = (plot, key, batch) => ({ plot_name: plot, work_type: key, batch_name: batch });
const four = (plot, batch) => TJ.map((j) => jrec(plot, j.key, batch));

/* B11: ledger 269, 271 -- record 269. The 271 delivery is owed. */
is(P.missingJobs('B11', four('B11', '269'), ['269', '271']).length, 4,
   'B11 owes all four again: batch 271 arrived and no record mentions it');
is(P.owedBatches('B11', four('B11', '269'), ['269', '271']), ['271'],
   '…and the card can say WHICH delivery, so the plot does not read as a mistake');

/* THE THREE THAT MUST NOT MOVE. Their record lists are the same batches
   as the ledger in a DIFFERENT ORDER -- "260, 267, 259" against "259,
   260, 267" -- which a string comparison calls different and a set does
   not. Getting this wrong puts three correct plots back on the board for
   ever, which is the wall this list is careful not to become. */
is(P.missingJobs('U4', four('U4', '260, 267, 259'), ['259', '260', '267']).length, 0,
   'U4 is NOT owed: same batches, written in another order');
is(P.missingJobs('N15', four('N15', '271, 270'), ['270', '271']).length, 0,
   'N15 is NOT owed, for the same reason');
is(P.missingJobs('N3', four('N3', '263, 270, 269'), ['263', '269', '270']).length, 0,
   'N3 is NOT owed either');
is(P.owedBatches('U4', four('U4', '260, 267, 259'), ['259', '260', '267']), [],
   '…and nothing is named as owed on a plot that owes nothing');

/* B4 and U17 matched already, and go on matching. */
is(P.missingJobs('B4', four('B4', '264, 270'), ['264', '270']).length, 0,
   'B4 is NOT owed: its record names both batches');

/* Never recorded is still never recorded, and needs no batch to say so. */
is(P.missingJobs('B2', [], ['271']).length, 4,
   'B2 owes all four -- nothing has ever been recorded for it');
is(P.owedBatches('B2', [], ['271']), [],
   '…and names no batch, because the whole plot is owed and a note would be noise');

/* A RECORD WITH NO BATCH ON IT COVERS EVERYTHING. saveTransplantRecord
   writes `batch_name: rec.batch || null`, so a blank is possible, and
   raising a plot for ever over a record nobody can tie to a delivery
   would be worse than the fault. */
is(P.missingJobs('B9', four('B9', null), ['269', '271']).length, 0,
   'a record with no batch on it keeps the old behaviour rather than stranding the plot');
is(P.missingJobs('B9', four('B9', ''), ['269', '271']).length, 0,
   '…and so does an empty one');

/* And a caller that passes no batches at all -- every caller before this
   rule existed -- gets exactly the old answer. */
is(P.missingJobs('B11', four('B11', '269')).length, 0,
   'asked without the ledger batches, it is the question it always was');

/* The batch is matched on letters and digits, like every other key in
   this system: a stray space must not owe somebody four jobs. */
is(P.missingJobs('B11', four('B11', ' 269 , 271 '), ['269', '271']).length, 0,
   'spacing round a batch number is not a different batch');
}

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

/* ── 5. The wiring: a floating icon, not a card pushed onto the dashboard ──
   It used to sit last on the dashboard and disappear when there was
   nothing to verify -- the right default for something nobody asked to
   see. It is the floating dock's own window now, opened on purpose the
   same way PALMS and Nelos already are, so it no longer hides itself when
   it is opened and finds nothing: see VerificationBoard.jsx and
   VerifyWindow.jsx for why. */
const board = R('src/components/VerificationBoard.jsx');
const dash  = R('src/components/Dashboard.jsx');
const dock  = R('src/components/FloatingDock.jsx');
const win   = R('src/components/VerifyWindow.jsx');
const maint = R('src/modules/maintenance/MaintenanceModule.jsx');

yes(!/<VerificationBoard\b/.test(dash) && !/VerificationBoard\.jsx/.test(dash),
    'the board is OFF the dashboard -- no import, no element');
yes(/actions\.push\('verify'\)/.test(dock) && /VerifyWindow/.test(dock),
    'the dock offers it as a third fan action, opening VerifyWindow');
yes(/pendingVerifyCount/.test(dock),
    "and the dock's own badge reads the shared count, not a copy of the board's query");
yes(/<VerificationBoard onCount=\{onCount\} \/>/.test(win),
    'the window renders the real board as its body, lazily, and hands its count back up');
yes(!/if \(!ready \|\| total === 0\) return null;/.test(board),
    'it no longer disappears when there is nothing to verify');
yes(/total === 0/.test(board) && /vrf\.allDone/.test(board),
    "-- it says so instead, now that opening it was somebody's choice");
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
