/* B1, B2, B3 ... B10 — NOT B1, B10, B11, B2.

   A plain .sort() compares "B10" and "B2" letter by letter, so the 1
   beats the 2 and the dropdown reads B1, B1-R, B10, B11, B12, B2, B3.
   A Field Conductor scrolling for B4 finds it after B39, in a list of
   fifty plots, in the sun, with a lorry waiting.

   The transfer plots are the reason this is not just parseInt: B1-R is a
   plot in its own right and has to sort beside B1, not at the end and
   not merged into it.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/plots_read_in_order.cjs
   No build and no server needed.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'do', 'EntryModal.jsx'), 'utf8');
const from = SRC.indexOf('function comparePlots');
const to   = SRC.indexOf('const emptyRow');
if (from < 0 || to < 0) { console.log('FAIL  comparePlots is not in EntryModal.jsx'); process.exit(1); }

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(SRC.slice(from, to) + '\n;globalThis.__cmp = comparePlots;', ctx);
const cmp = vm.runInContext('__cmp', ctx);

let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const pass = (m) => console.log('pass  ' + m);

function check(label, input, want) {
  const got = [...input].sort(cmp);
  if (got.join(' ') === want.join(' ')) pass(label + ': ' + got.join(' '));
  else fail(label + '\n      got  ' + got.join(' ') + '\n      want ' + want.join(' '));
}

/* The case from the screenshot. */
check('plain numbers run 1 to 14',
  ['B1', 'B10', 'B11', 'B12', 'B2', 'B3', 'B4', 'B14'],
  ['B1', 'B2', 'B3', 'B4', 'B10', 'B11', 'B12', 'B14']);

/* A -R transfer plot belongs beside its own plot, not at the end. */
check('a -R plot sits with its own number',
  ['B11-R', 'B1', 'B10', 'B1-R', 'B2'],
  ['B1', 'B1-R', 'B2', 'B10', 'B11-R']);

/* Several prefixes keep their groups. */
check('prefixes stay in their own groups',
  ['U10', 'B2', 'N3', 'U2', 'B10', 'N21'],
  ['B2', 'B10', 'N3', 'N21', 'U2', 'U10']);

/* The real list is unpadded and padded in places. */
check('padded and unpadded sort together',
  ['B01', 'B10', 'B2'],
  ['B01', 'B2', 'B10']);

/* Nothing numeric must not throw or reorder wildly. */
check('names with no number fall back to plain text',
  ['SEEDBED', 'ANNEX'],
  ['ANNEX', 'SEEDBED']);

/* Stable and total: sorting twice gives the same list. */
const once = ['B11-R', 'B1', 'B10', 'B1-R', 'B2', 'U3'].sort(cmp);
const twice = [...once].sort(cmp);
if (once.join() === twice.join()) pass('the order is stable when sorted again');
else fail('sorting an already-sorted list changed it: ' + once.join() + ' → ' + twice.join());

/* And the breed chips really are gone from the form. */
if (!/breedOptions/.test(SRC)) pass('the breed chip list is gone from the DO form');
else fail('breedOptions is still in EntryModal.jsx');

console.log(failed ? `\n${failed} failure(s)` : '\nall good');
process.exit(failed ? 1 : 0);
