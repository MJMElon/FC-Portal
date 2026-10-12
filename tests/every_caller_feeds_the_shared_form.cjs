/* A SHARED FORM IS ONLY AS GOOD AS ITS HUNGRIEST CALL SITE.

   EntryModal is ONE component with TWO call sites: the DO module and the
   scan module. That is the right shape — the office asked for one
   delivery-order form and gets one. But the component is only shared at
   the TEMPLATE level: every piece of data it draws is handed in as a
   prop, and each module loads its own.

   So adding a feed is TWO edits, and the half that is forgotten fails
   SILENTLY. batchMap is what taught us: the DO module loaded it and
   passed it; the scan module never did; and EntryModal, asked for the
   batches in a plot with no batchMap, answers [] and draws no batch row
   at all. Nothing threw, nothing logged, and the scan form simply looked
   like last week's while the DO form looked new. The office found it the
   only way anybody could — by selecting a plot and seeing nothing.

   So: every prop EntryModal reads has to be handed to it by EVERY call
   site. The exceptions are named below and each has a reason.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/every_caller_feeds_the_shared_form.cjs
   No build and no server needed.
*/
'use strict';
const fs = require('fs');
const path = require('path');

const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const ok = (m) => console.log('ok    ' + m);

const FORM = 'src/modules/do/EntryModal.jsx';
const CALLERS = ['src/modules/do/DoModule.jsx', 'src/modules/scan/ScanModule.jsx'];

/* Props a call site may legitimately leave out, and why. Anything NOT on
   this list must be passed by every caller. */
const MAY_OMIT = {
  /* The DO module arrives with a photo already taken; the scan module
     opens the form cold and lets EntryModal take one. */
  photoBase64: 'the scan flow has no photo yet when the form opens',
  /* Only the scan flow knows how many seals were just counted. */
  initialQty: 'only the scan flow can suggest a quantity',
  /* And only the scan flow has a COUNT to hold the quantities to. A
     manual delivery order has no scanner behind it, so there is nothing
     for its lines to tally with -- see src/modules/do/qty.js. */
  scannedQty: 'only a delivery order opened out of a scan has one',
};

const src = R(FORM);

/* The destructured prop list on the component signature. One line, so it
   is read rather than parsed. */
const sig = /export default function EntryModal\(\s*\{([^}]*)\}/.exec(src);
if (!sig) {
  fail('could not find EntryModal\'s prop list — has the signature changed?');
} else {
  const props = sig[1]
    .split(',')
    .map((p) => p.split('=')[0].trim())
    .filter(Boolean);
  ok('EntryModal takes ' + props.length + ' props: ' + props.join(', '));

  const required = props.filter((p) => !Object.prototype.hasOwnProperty.call(MAY_OMIT, p));

  CALLERS.forEach((file) => {
    const body = R(file);
    /* The <EntryModal ... /> element, from the tag to its close. */
    const el = /<EntryModal\b([\s\S]*?)\/>/.exec(body);
    if (!el) { fail(file + ' does not render <EntryModal /> — did it move?'); return; }
    const missing = required.filter((p) => !new RegExp('(^|\\s)' + p + '\\s*=').test(el[1]));
    if (missing.length) {
      fail(file + ' never passes: ' + missing.join(', ')
         + '  → EntryModal reads them, so that part of the form is silently dead there');
    } else {
      ok(path.basename(file) + ' feeds every prop the form reads');
    }
  });
}

/* The specific one that bit, named so a regression reads plainly rather
   than as a list of prop names. */
CALLERS.forEach((file) => {
  const body = R(file);
  if (!/loadBatchData/.test(body)) {
    fail(path.basename(file) + ' never calls loadBatchData() — it cannot have a batchMap to pass');
  } else {
    ok(path.basename(file) + ' loads the batches through the shared loadBatchData()');
  }
});

/* And it must be the SAME loader, not a second copy of the rule. */
const dataSrc = R('src/modules/do/data.js');
if (!/export async function loadBatchData/.test(dataSrc)) {
  fail('loadBatchData is not exported from src/modules/do/data.js');
} else {
  ok('there is one loadBatchData, in the DO module data layer');
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nall good');
process.exit(failed ? 1 : 0);
