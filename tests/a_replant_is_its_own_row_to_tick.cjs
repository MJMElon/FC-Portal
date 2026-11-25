/**
 * A REPLANT THAT APPEARED AFTER THE SCHEDULE WAS KEYED IS ITS OWN ROW.
 *
 * The office, describing their own November and then the four answers a
 * worker must be able to give:
 *
 *   "我是worker 1.11.2026那天tick的schedule没有B3-R, 但是我15.11.2026 要做
 *    B3,那时候B3-R有苗:
 *      1. 如果我要做B3-R而已，B3不做了，因为要cull了，所以我可以按B3-R
 *      2. 如果我还是只做B3不做B3-R,也可以只选B3
 *      3. 两个都做可以两个都选
 *      4. 两个都选的话 FC需要approve两次for each"
 *
 * The boundary change that shipped the day before was necessary and not
 * sufficient: the worker's list IS the office schedule, so a plot the office
 * could not name on the 1st had no row to tick on the 15th whatever the
 * database would now accept. 1, 3 and 4 were all impossible.
 *
 * This drives the SHIPPED `periodTasks` with the office's own month, and the
 * shipped `splitDone` for points 1 to 3, because the whole fault was one
 * list builder reading one source.
 *
 * Point 4 is `setVerified(rec.id, …)` in modules/maintenance/data.js, which
 * writes `.eq('id', id)` — so two rows are two approvals by construction.
 * Section 4 reads that rather than restating it.
 *
 * EVERY READER IS GUARDED: on the previous code `replantsStanding` is an
 * option nothing looks at, so the failures have to arrive by NAME rather
 * than as a dead harness.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('pass  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (got === undefined ? '' : '  -> got ' + JSON.stringify(got))); }
};
const safe = (name, fn) => {
  try { return fn(); }
  catch (e) { fail++; console.log('FAIL  ' + name + '  -> threw: ' + e.message); return undefined; }
};

const ROOT = path.join(__dirname, '..');

/* ── The office's November, keyed on the 1st ───────────────────────────────
   B3 is ticked for weeks 1 and 3 on every job. B3-R is on NO row, because a
   3rd-culling transfer had not made it yet. pdConfig is what names the
   chemical: without it weekTasks draws no P & D at all, which is how a
   fixture quietly tests three jobs instead of four. */
const NOV = [{
  nursery: 'BNN',
  month: 'Nov 2026',
  payload: {
    pdConfig: {
      W1: { P: { name: 'Decis', dose: 2, unit: 'ml' } },
      W3: { P: { name: 'Decis', dose: 2, unit: 'ml' } },
    },
    pd: { W1: { B3: { P: true } }, W2: {}, W3: { B3: { P: true } }, W4: {} },
    manuringConfig: [[{ name: 'NPK', dose: 5, unit: 'g' }], [], [{ name: 'NPK', dose: 5, unit: 'g' }], []],
    manuring: { B3: [[true], [false], [true], [false]] },
    weeding: { B3: { R1: true, R3: true } },
    interrowConfig: [[{ name: 'Monex', dose: 1, unit: 'l' }], [], [{ name: 'Monex', dose: 1, unit: 'l' }], []],
    interrow: { B3: [[true], [false], [true], [false]] },
  },
}];

/* The boundary carries the replant — the change that shipped the day before. */
const MINE = (p) => ['B3', 'B3-R'].includes(String(p || '').trim().toUpperCase());

(async () => {
  const wt = await safe('workerTasks.js loads',
    () => import(path.join(ROOT, 'src/worker/workerTasks.js')));
  if (!wt) {
    console.log('\n' + pass + ' passed, ' + fail + ' failed  (workerTasks.js would not load)');
    process.exit(1);
  }
  const { periodTasks, splitDone, idOf } = wt;

  const list = (opts) => safe('periodTasks', () => periodTasks(NOV, 3, opts)) || [];
  const plotsIn = (l) => [...new Set(l.map((t) => t.plot))].sort();
  const rowsFor = (l, p) => l.filter((t) => t.plot === p);

  // ── 1. The 15th, with B3-R standing ────────────────────────────────────
  console.log('\n-- 1. the office own month');

  const before = list({ plotFilter: MINE });
  ok('the schedule the office keyed carries B3 and only B3',
     plotsIn(before).join(',') === 'B3', plotsIn(before));
  ok('and it is four jobs, so the fixture is the whole week',
     before.length === 4, before.map((t) => t.workTypeKey));

  const after = list({ plotFilter: MINE, replantsStanding: ['B3-R'] });
  ok('B3-R is on the list once it has seedlings',
     plotsIn(after).join(',') === 'B3,B3-R', plotsIn(after));
  ok('and it takes EVERY one of its parent rounds, not one of them',
     rowsFor(after, 'B3-R').length === rowsFor(after, 'B3').length
       && rowsFor(after, 'B3-R').length === 4,
     [rowsFor(after, 'B3-R').length, rowsFor(after, 'B3').length]);
  ok('each row keeps the job and the chemical the office planned',
     rowsFor(after, 'B3-R').every((r) => {
       const p = rowsFor(after, 'B3').find((x) => x.workTypeKey === r.workTypeKey
                                              && x.side === r.side);
       return !!p && r.chemical === p.chemical;
     }));

  /* A ROW THE OFFICE DID NOT KEY HAS TO SAY SO, or a worker meets a plot
     that was not on the list yesterday with nothing to read about why. */
  ok('every derived row names the parent it came from',
     rowsFor(after, 'B3-R').length > 0
       && rowsFor(after, 'B3-R').every((r) => r.replantOf === 'B3'),
     rowsFor(after, 'B3-R').map((r) => r.replantOf));
  ok('and the office own rows carry no such mark',
     rowsFor(after, 'B3').every((r) => !r.replantOf));

  /* Asked as CONTIGUOUS RUNS, never as a literal order. A plot whose rows
     are split by another plot's is a worker walking back; written as a
     string match the check read truthy on the failure message itself and
     could not fail at all. */
  const runs = after.map((t) => t.plot).filter((p, i, a) => p !== a[i - 1]);
  ok('each plot own rows are together, so a worker walks the two plots once',
     runs.length === new Set(runs).size, after.map((t) => t.plot));

  // ── 1b. What must NOT put a row there ──────────────────────────────────
  console.log('\n-- 1b. and what does not');

  ok('a replant with NOTHING standing is offered nothing',
     plotsIn(list({ plotFilter: MINE, replantsStanding: [] })).join(',') === 'B3');
  /* A replant whose PARENT is on no row of this week has nothing to take.
     The first version of this check compared two counts that are equal
     whatever the rule does, so it tested nothing; B9-R is a replant of a
     plot the office never ticked. */
  const orphan = list({
    plotFilter: (p) => ['B3', 'B3-R', 'B9', 'B9-R'].includes(String(p).toUpperCase()),
    replantsStanding: ['B3-R', 'B9-R'],
  });
  ok('a replant whose parent is on no row of this week is offered nothing',
     rowsFor(orphan, 'B9-R').length === 0, rowsFor(orphan, 'B9-R').map((t) => t.workTypeKey));
  const wk2 = safe('week 2', () => periodTasks(NOV, 2, { plotFilter: MINE, replantsStanding: ['B3-R'] })) || [];
  ok('week 2, which the office ticked for nothing, stays empty',
     wk2.length === 0, wk2.map((t) => t.plot + ' ' + t.workTypeKey));

  /* THE BOUNDARY STILL DECIDES. A replant handed in whose parent the filter
     turned away must not come in through the back door. */
  const notMine = list({ plotFilter: (p) => false, replantsStanding: ['B3-R'] });
  ok('a boundary that allows nothing is still a boundary',
     notMine.length === 0, notMine.map((t) => t.plot));

  /* THE OFFICE PRESSING SAVE SCHEDULE MUST NOT DRAW IT TWICE. */
  const keyed = JSON.parse(JSON.stringify(NOV));
  keyed[0].payload.pd.W3['B3-R'] = { P: true };
  keyed[0].payload.weeding['B3-R'] = { R3: true };
  const both = safe('after Save Schedule',
    () => periodTasks(keyed, 3, { plotFilter: MINE, replantsStanding: ['B3-R'] })) || [];
  const ids = both.map((t) => t.id);
  ok('a row the office has since keyed is not offered a second time',
     ids.length === new Set(ids).size, ids.filter((x, i) => ids.indexOf(x) !== i));
  ok('and the keyed row is the office own, unmarked',
     (both.find((t) => t.plot === 'B3-R' && t.workTypeKey === 'weeding') || {}).replantOf
       === undefined);

  /* A replant of a replant takes the PLOT's rounds, never a derived row's. */
  const two = list({ plotFilter: (p) => ['B3', 'B3-R', 'B3-R2'].includes(String(p).toUpperCase()),
                     replantsStanding: ['B3-R', 'B3-R2'] });
  ok('B3-R2 takes B3 own rounds, not B3-R own',
     rowsFor(two, 'B3-R2').every((r) => r.replantOf === 'B3'),
     rowsFor(two, 'B3-R2').map((r) => r.replantOf));

  // ── 2. The office's four answers ───────────────────────────────────────
  console.log('\n-- 2. the four answers a worker must be able to give');

  const split = (recs) => safe('splitDone',
    () => splitDone(after, recs, { week: 3, month: 'Nov 2026', me: 'Siti' }))
    || { todo: [], done: [] };

  const rec = (plot, work) => ({
    id: plot + work, plot_name: plot, work_type: work, chemical: '',
    work_date: '2026-11-15', week_no: 3, reported_by: 'Siti',
  });

  /* 1. B3-R only, because B3 is about to be culled. */
  const one = split([rec('B3-R', 'weeding')]);
  ok('1. B3-R alone can be answered',
     one.done.some((t) => t.plot === 'B3-R' && t.workTypeKey === 'weeding'));
  ok('   and B3 is left outstanding, not closed with it',
     one.todo.some((t) => t.plot === 'B3' && t.workTypeKey === 'weeding'));

  /* 2. B3 only — which is what the screen could always do, and must not
        have stopped doing. */
  const onlyParent = split([rec('B3', 'weeding')]);
  ok('2. B3 alone can be answered',
     onlyParent.done.some((t) => t.plot === 'B3' && t.workTypeKey === 'weeding'));
  ok('   and B3-R is left outstanding',
     onlyParent.todo.some((t) => t.plot === 'B3-R' && t.workTypeKey === 'weeding'));

  /* 3. Both. */
  const bothDone = split([rec('B3', 'weeding'), rec('B3-R', 'weeding')]);
  ok('3. both can be answered',
     ['B3', 'B3-R'].every((p) =>
       bothDone.done.some((t) => t.plot === p && t.workTypeKey === 'weeding')));

  /* And a record on one NEVER answers the other — the whole of 1 and 2. */
  ok('a record on the parent never answers the replant',
     !onlyParent.done.some((t) => t.plot === 'B3-R'));
  ok('and a record on the replant never answers the parent',
     !one.done.some((t) => t.plot === 'B3'));

  /* The two rows are two identities, which is what makes them two records
     and (section 4) two approvals. */
  ok('the two rows carry different ids',
     safe('idOf', () => idOf({ workTypeKey: 'weeding', plot: 'B3', chemical: '' })
                    !== idOf({ workTypeKey: 'weeding', plot: 'B3-R', chemical: '' })));

  // ── 3. The screen asks for what it needs ───────────────────────────────
  console.log('\n-- 3. the screen reads the balances and joins on the key');

  const SCREEN = safe('WorkerTasks.jsx reads',
    () => fs.readFileSync(path.join(ROOT, 'src/worker/WorkerTasks.jsx'), 'utf8')) || '';
  const noComments = SCREEN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  ok('it loads the batch balances', /source\.loadPlotBatches\(\)/.test(noComments));
  ok('it hands periodTasks the standing replants',
     /periodTasks\([^)]*replantsStanding/.test(noComments.replace(/\s+/g, ' ')));
  ok('it asks isReplantPlot rather than a regex of its own',
     /isReplantPlot\(/.test(noComments) && !/-R\\d/.test(noComments));
  ok('and joins the two lists on plotKey, not on the spelling',
     /plotKey\(/.test(noComments));

  const ROW = safe('TaskRow.jsx reads',
    () => fs.readFileSync(path.join(ROOT, 'src/worker/TaskRow.jsx'), 'utf8')) || '';
  ok('the row draws the parent it came from', /task\.replantOf/.test(ROW));

  const I18N = safe('i18n.js reads',
    () => fs.readFileSync(path.join(ROOT, 'src/i18n.js'), 'utf8')) || '';
  ok('and the label is in both languages',
     (I18N.match(/'wk\.replantOf'/g) || []).length === 2,
     (I18N.match(/'wk\.replantOf'/g) || []).length);

  // ── 4. Two rows are two approvals, by construction ─────────────────────
  console.log('\n-- 4. the FC approves each on its own');

  const DATA = safe('data.js reads',
    () => fs.readFileSync(path.join(ROOT, 'src/modules/maintenance/data.js'), 'utf8')) || '';
  /* setVerified names ONE row. That is the whole of point 4: nothing had to
     change for it, and a writer that started verifying by plot or by week
     would take the two approvals back into one. */
  ok('setVerified writes one record by its id',
     /export function setVerified\(id, who\)/.test(DATA)
       && /writeVerification\(\s*\n?\s*id,/.test(DATA));
  const MOD = safe('MaintenanceModule.jsx reads',
    () => fs.readFileSync(path.join(ROOT, 'src/modules/maintenance/MaintenanceModule.jsx'), 'utf8')) || '';
  ok('and the conductor verifies a record, never a plot',
     /source\.setVerified\(rec\.id,/.test(MOD));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
