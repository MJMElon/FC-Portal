/* A PLOT IS OFFERED AT PENGAMBILAN **OR** SARINGAN ANAK BIBIT.

   Collecting does not happen at one status. Saringan Anak Bibit is the
   screening pass, and seedlings leave a plot during it exactly as they do
   at Pengambilan -- so a Field Conductor can be standing in a screening
   plot with stock going out of it and, until now, the culling calculator
   did not offer that plot at all.

   The gate used to find the FIRST stage named pengambilan and match on
   that one sort_order. It now matches the SET of stages whose names are
   in CULLING_STAGES.

   Three things worth holding, each of which the one-name version got
   wrong or could not do:

     1. both statuses are offered
     2. a stage that is neither is still refused -- a gate that lets
        everything through is not a gate, and a green result on it would
        mean nothing
     3. the names are matched on letters and digits, because the office
        types them by hand

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/culling_takes_both_statuses.cjs
   No build and no server needed.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'palms', 'cullingSource.js'), 'utf8');

/* Lift the real gate out of the shipped file rather than copying it: the
   point is that THIS code behaves, not that a transcription does. */
/* Anchored on the function, so this still RUNS against a version that has
   no CULLING_STAGES in it and reports what that version actually does,
   rather than refusing to start and saying nothing useful. */
let from = SRC.indexOf('const stageKey =');
if (from < 0) from = SRC.indexOf('export async function pengambilanPlots');
const to = SRC.indexOf('/* Whether the last loadPlots()');
if (from < 0 || to < 0) {
  console.log('FAIL  could not find pengambilanPlots in cullingSource.js — has it been renamed?');
  process.exit(1);
}
let code = SRC.slice(from, to).replace(/^export /gm, '');

let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const pass = (m) => console.log('pass  ' + m);

/* Stage list as the office keeps it, Saringan before Pengambilan, with a
   later stage after both so "the last one" is demonstrably not the rule. */
const STAGES = [
  { name: 'Penanaman',           sort_order: 1 },
  { name: 'Saringan Anak Bibit', sort_order: 2 },
  { name: 'Pengambilan',         sort_order: 3 },
  { name: 'Up-keep',             sort_order: 4 },
];

async function run(logRows, stages = STAGES) {
  const ctx = {
    console: { warn(){}, log(){} },
    plotKey: (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    fetchAllRows: async () => ({ data: logRows, error: null }),
    supabase: { from: () => ({ select: () => ({ order: async () => ({ data: stages, error: null }) }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;globalThis.__gate = pengambilanPlots;', ctx);
  return vm.runInContext('__gate()', ctx);
}

(async () => {
  /* 1 & 2 — both statuses in, everything else out. */
  const got = await run([
    { plot_name: 'N16',   act_n: 3, end_date: null },  // Pengambilan
    { plot_name: 'B4',    act_n: 2, end_date: null },  // Saringan Anak Bibit
    { plot_name: 'U6#A',  act_n: 2, end_date: null },  // a split area, screening
    { plot_name: 'P01',   act_n: 1, end_date: null },  // Penanaman — not collecting
    { plot_name: 'Z99',   act_n: 4, end_date: null },  // Up-keep — not collecting
  ]);
  const have = [...got].sort().join(',');

  if (got.has('N16')) pass('a plot at Pengambilan is offered');
  else fail('a plot at Pengambilan is no longer offered — the change broke what worked');

  if (got.has('B4')) pass('a plot at Saringan Anak Bibit is offered');
  else fail('a plot at Saringan Anak Bibit is still missing from the calculator');

  if (got.has('U6')) pass('a split area (U6#A) puts its PLOT on the screen, not the area');
  else fail('a split area at a collecting status did not reach the screen');

  if (!got.has('P01') && !got.has('Z99')) {
    pass('Penanaman and Up-keep are still refused — the gate is still a gate');
  } else {
    fail(`a non-collecting status got through, so the gate proves nothing: ${have}`);
  }

  /* 3 — the office types these by hand. */
  const typed = await run(
    [{ plot_name: 'N16', act_n: 7, end_date: null }],
    [{ name: '  saringan   anak bibit ', sort_order: 7 }, { name: 'Penanaman', sort_order: 8 }]
  );
  if (typed.has('N16')) pass('spacing and case in the stage name do not matter');
  else fail('a stage typed "saringan   anak bibit" was not recognised');

  /* And it cannot quietly match a DIFFERENT stage. */
  const other = await run(
    [{ plot_name: 'N16', act_n: 7, end_date: null }],
    [{ name: 'Saringan Anak Bibit 2', sort_order: 7 }, { name: 'Penanaman', sort_order: 8 }]
  );
  if (!other.has('N16')) pass('a differently-named stage is not folded into one of these');
  else fail('"Saringan Anak Bibit 2" was treated as "Saringan Anak Bibit"');

  /* The fallback: the office has renamed everything. Still the last stage,
     which is what this did when it knew one name. */
  const fb = await run(
    [{ plot_name: 'N16', act_n: 9, end_date: null }],
    [{ name: 'Alpha', sort_order: 8 }, { name: 'Omega', sort_order: 9 }]
  );
  if (fb.has('N16')) pass('with no name recognised it falls back to the last stage, as before');
  else fail('the fallback to the last stage was lost');

  console.log(failed ? `\n${failed} failure(s)` : '\nall good');
  process.exit(failed ? 1 : 0);
})();
