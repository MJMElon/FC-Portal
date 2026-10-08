/* WHICH NURSERY A RECORD IS IN: THE PLOT DECIDES.

   The office's Work Maintenance List has always answered it that way. This
   screen answered it off the record's own nursery_name, compared spelling
   for spelling, and the two disagreed — so a job the office could see, with
   the conductor's signature on it and the walk drawn beside it, was not in
   the phone's History at all. A record that cannot be found is a record
   somebody does again.

   Two ways it happened, both reproduced below:
     · nursery_name empty on the record (nothing to match, so it matched
       nothing, under any pick);
     · nursery_name spelt "UNN2" against a picker offering "UNN 2".

   The real filter is lifted out of MaintenanceModule.jsx rather than
   restated here, so a change to it that reintroduces either fault fails
   this test instead of passing it.

   Needs nothing but node:  node tests/history_follows_the_plot.cjs */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'maintenance', 'MaintenanceModule.jsx'), 'utf8');

// The two helpers and the filter, exactly as the screen has them. useMemo is
// stubbed to call its factory, which is all these three use it for.
function grab(startMark, endMark, what) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('could not find ' + what + ' — has it been renamed?');
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('could not find the end of ' + what);
  return src.slice(a, b);
}

const body =
  grab('  const mayOpen = useMemo(', '  const visiblePlots = useMemo(', 'mayOpen') +
  grab('  const plotNurseryKey = useMemo(', '\n\n', 'plotNurseryKey') +
  grab('  const recordNurseryKey = useMemo(', '\n\n', 'recordNurseryKey') +
  grab('  const visible = useMemo(', '\n\n', 'the visible filter') +
  '\n  return visible;\n';

const useMemo = (fn) => fn();
// The real ones, from the modules the screen imports them from.
const nurseryKey = (name) => String(name == null ? '' : name).replace(/[^a-z0-9]/gi, '').toUpperCase();
const plotKey = (v) => String(v == null ? '' : v).trim().toUpperCase()
  .replace(/^PLOT\s*:?\s*/, '').split(/[\s(,[]/)[0].replace(/[^0-9A-Z-]/g, '');

const run = new Function('useMemo', 'nurseryKey', 'plotKey',
  'plots', 'allRecords', 'allowed', 'plotFilter', 'nursery', body);

const PLOTS = [
  { plot_name: 'N1',  nursery_name: 'UNN 2' },
  { plot_name: 'N14', nursery_name: 'UNN 2' },
  { plot_name: 'N17', nursery_name: 'UNN 2' },
  { plot_name: 'B1',  nursery_name: 'BNN' },
];

let id = 0;
const rec = (plot, nurseryOnRecord) =>
  ({ id: ++id, plot_name: plot, nursery_name: nurseryOnRecord, work_date: '2026-10-02' });

const RECORDS = [
  rec('N1',  'UNN 2'),   // 1 — the ordinary case
  rec('N14', 'UNN2'),    // 2 — the same nursery, spelt the office's way
  rec('N17', ''),        // 3 — no nursery on the record at all
  rec('N17', null),      // 4 — the same, as null
  rec('B1',  'BNN'),     // 5 — another nursery, must NOT follow N into UNN 2
  rec('Z9',  'UNN 2'),   // 6 — a plot shared_plots does not list: fall back
];

let pass = 0, fail = 0;
const is = (what, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + what + ' → ' + a); }
  else { fail++; console.log('  FAIL ' + what + '\n         got  ' + a + '\n         want ' + b); }
};
const ids = (rs) => rs.map((r) => r.id).sort((a, b) => a - b);

console.log('\n── Looking at UNN 2, unrestricted ──');
is('every UNN 2 record, however its nursery is spelt or left empty',
  ids(run(useMemo, nurseryKey, plotKey, PLOTS, RECORDS, null, null, 'UNN 2')),
  [1, 2, 3, 4, 6]);

console.log('\n── The other nursery is still the other nursery ──');
is('BNN shows only B1',
  ids(run(useMemo, nurseryKey, plotKey, PLOTS, RECORDS, null, null, 'BNN')),
  [5]);

console.log('\n── No nursery picked: everything the person may open ──');
is('all six',
  ids(run(useMemo, nurseryKey, plotKey, PLOTS, RECORDS, null, null, '')),
  [1, 2, 3, 4, 5, 6]);

console.log('\n── A person ticked for one nursery, spelt the office way ──');
is("ticked for 'UNN2' still sees UNN 2's work",
  ids(run(useMemo, nurseryKey, plotKey, PLOTS, RECORDS, ['UNN2'], null, '')),
  [1, 2, 3, 4, 6]);
is('and none of BNN',
  ids(run(useMemo, nurseryKey, plotKey, PLOTS, RECORDS, ['UNN2'], null, 'BNN')).length,
  0);
is('a tick for one nursery does not become a tick for another',
  ids(run(useMemo, nurseryKey, plotKey, PLOTS, RECORDS, ['BNN'], null, '')),
  [5]);

console.log('\n── A plot restriction still restricts ──');
is('only the plots the filter allows',
  ids(run(useMemo, nurseryKey, plotKey, PLOTS, RECORDS, null, (p) => p === 'N1', '')),
  [1]);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
