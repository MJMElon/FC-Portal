/* A record's worker is the names TICKED, never the conductor who keyed it.
   The real didTheWork is lifted out of helpers.js. */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'maintenance', 'helpers.js'), 'utf8');
const i = src.indexOf('const sameName =');
const body = src.slice(i, src.indexOf('\n}', src.indexOf('export function didTheWork')) + 2)
  .replace('export function didTheWork', 'function didTheWork');
const didTheWork = new Function(body + '\nreturn didTheWork;')();

// The nursery's general workers. A Field Conductor is NOT one of them.
const WORKERS = ['Andi Rosmini', 'Muhamad Irsan', 'Yuyak'];

const cases = [
  ['conductor ticked two workers',
   { worked_by: 'Andi Rosmini, Yuyak', reported_by: 'Lalu Aenal mashuri' },
   { names: 'Andi Rosmini, Yuyak', keyedBy: 'Lalu Aenal mashuri' }],

  ['conductor ticked NOBODY — his name must not be the worker',
   { worked_by: '', reported_by: 'Lalu Aenal mashuri' },
   { names: '', keyedBy: 'Lalu Aenal mashuri' }],

  ['a worker saved it from their own phone',
   { worked_by: '', reported_by: 'Muhamad Irsan' },
   { names: 'Muhamad Irsan', keyedBy: '' }],

  // Matched without case or spacing, and shown trimmed.
  ['a worker saved it, spelled with odd case and spacing',
   { worked_by: '', reported_by: '  muhamad irsan ' },
   { names: 'muhamad irsan', keyedBy: '' }],

  ['nothing at all',
   { worked_by: '', reported_by: '' },
   { names: '', keyedBy: '' }],

  ['ticked one worker, keyed by that same worker',
   { worked_by: 'Yuyak', reported_by: 'Yuyak' },
   { names: 'Yuyak', keyedBy: 'Yuyak' }],
];

let bad = 0;
console.log('  case                                                shown as              keyed by');
console.log('  ' + '-'.repeat(86));
for (const [name, rec, want] of cases) {
  const got = didTheWork(rec, WORKERS);
  const names = got.names.join(', ');
  const ok = names === want.names && got.keyedBy === want.keyedBy;
  if (!ok) bad++;
  console.log('  ' + (name.length > 50 ? name.slice(0, 49) + '…' : name).padEnd(52) +
    (names || '(nobody ticked)').padEnd(22) +
    (got.keyedBy || '-') + (ok ? '' : '   ✗ want ' + JSON.stringify(want)));
}
// The one that matters: a conductor is never shown as the worker.
const fc = didTheWork({ worked_by: '', reported_by: 'Lalu Aenal mashuri' }, WORKERS);
console.log('\n  the conductor appears as a worker:', fc.names.length ? 'YES ✗' : 'no  ok');
if (fc.names.length) bad++;
console.log('\n' + (bad ? 'FAILED' : 'all correct'));
process.exit(bad ? 1 : 0);
