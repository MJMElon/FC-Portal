/* THE OFFICE READ 4.4 kg AND THE FIELD CONDUCTOR READ 4,4 kg.

   Same dose, same week, same figure. `n.toLocaleString()` with no locale
   reads the DEVICE's, which on a phone is whatever the person set their
   handset to -- so a conductor whose phone is in a language that writes
   decimals with a comma saw a different number from the one on the office
   screen it is meant to agree with.

   A dose is the harmless end of it, and that is the part worth keeping.
   The separator swaps BOTH ways: on that same phone a plot of 6,515
   seedlings prints 6.515, which somebody running down a column reads as
   six and a half. EVERY figure in the app went through that call -- the
   dose was simply the one with a decimal in it, so it was the one anybody
   could see was wrong.

   So there is one formatter with the locale pinned, and this holds the two
   things that make it worth having:

     1. the shipped files do not format a figure any other way, and
     2. a DATE is not a figure -- it keeps the device locale on purpose,
        so the sweep must not have taken those with it.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/a_figure_reads_the_same_on_every_phone.cjs
   No build and no server needed.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'src');
const HELPER = path.join(ROOT, 'lib', 'numberText.js');

let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const pass = (m) => console.log('pass  ' + m);
const is = (m, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass(m + '  → ' + JSON.stringify(got));
  else fail(m + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want));
};

/* Every .js and .jsx under src, so a file added later is in this check
   without anybody remembering to list it. A list typed out in a test is a
   list that will be wrong. */
function walk(dir, out = []) {
  for (const nm of fs.readdirSync(dir)) {
    const p = path.join(dir, nm);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(nm)) out.push(p);
  }
  return out;
}
const FILES = walk(ROOT);
const rel = (p) => path.relative(path.join(__dirname, '..'), p);

console.log('\n-- 1. The real formatter, on the office own figures --');
let numText = null;
if (!fs.existsSync(HELPER)) {
  fail('src/lib/numberText.js is not there');
} else {
  const sandbox = { module: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(HELPER, 'utf8').replace(/^export /gm, ''), sandbox);
  numText = vm.runInContext('numText', sandbox);
}
if (typeof numText !== 'function') {
  fail('numText is not exported from numberText.js');
} else {
  // The dose off the office screenshot, and its neighbour.
  is('the dose reads with a POINT', numText(4.4, { maximumFractionDigits: 2 }), '4.4');
  is('and so does the one beside it', numText(32.95, { maximumFractionDigits: 2 }), '32.95');
  // The dangerous direction: a thousands separator that reads as a decimal.
  is('a plot keeps its COMMA', numText(6515), '6,515');
  is('and so does a six figure one', numText(997500), '997,500');
  /* A figure that is not a figure must not read as an amount. "NaN kg" on
     a dose line is worse than a blank, because it looks like a quantity. */
  is('nothing is not NaN', numText(undefined), '');
  is('nor is a word', numText('four point four'), '');
  is('but nought is a figure', numText(0), '0');
}

console.log('\n-- 2. Nothing formats a figure its own way --');
{
  /* A bare toLocaleString, or one handed `undefined`, is the device locale.
     Either is the bug. A call that NAMES a locale is somebody deciding, and
     is looked at separately below. */
  const loose = [];
  FILES.forEach((p) => {
    if (p === HELPER) return;
    const src = fs.readFileSync(p, 'utf8');
    src.split('\n').forEach((line, i) => {
      const m = /\.toLocaleString\(\s*(?:undefined\s*[,)]|\))/.exec(line);
      if (!m) return;
      /* A DATE is not a figure. It SHOULD read in the reader's own
         language, so those are the ones this rule leaves alone. */
      if (/Date\s*\(/.test(line)) return;
      loose.push(`${rel(p)}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
  });
  is('no figure is left on the device locale', loose, []);

  /* And no second PIN either. One file names the locale; a second copy of
     it is a second thing to change, and the two drift. */
  const pins = [];
  FILES.forEach((p) => {
    if (p === HELPER) return;
    const src = fs.readFileSync(p, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!/\.toLocaleString\(\s*'/.test(line)) return;
      if (/Date\s*\(/.test(line)) return;          // a date may name one
      pins.push(`${rel(p)}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
  });
  is('and no file pins a locale of its own', pins, []);
}

console.log('\n-- 3. A date is not a figure --');
{
  /* The other half, and the one a careless sweep breaks. These exist and
     have to go on existing: a timestamp in a console table, and the "last
     synced" line, read in the language of whoever is looking at them. */
  const dates = [];
  FILES.forEach((p) => {
    const src = fs.readFileSync(p, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/Date\s*\([^)]*\)\s*\.toLocaleString\(/.test(line)) dates.push(rel(p) + ':' + (i + 1));
    });
  });
  if (!dates.length) fail('every Date().toLocaleString() has gone -- the sweep took the dates with it');
  else pass(dates.length + ' date(s) still read in the reader own language');

  /* And none of them was turned into a number call, which is exactly what
     a regular expression one character too greedy does. */
  const mangled = [];
  FILES.forEach((p) => {
    const src = fs.readFileSync(p, 'utf8');
    if (/new\s+numText\s*\(/.test(src)) mangled.push(rel(p));
  });
  is('and no "new numText(Date(...))" anywhere', mangled, []);
}

console.log('\n-- 4. Every file that formats one says where the rule is --');
{
  const missing = [];
  FILES.forEach((p) => {
    if (p === HELPER) return;
    const src = fs.readFileSync(p, 'utf8');
    if (!/\bnumText\s*\(/.test(src)) return;
    if (!/from '[^']*numberText\.js'/.test(src)) missing.push(rel(p));
  });
  is('every caller imports it', missing, []);
}

console.log('\n-- 5. The dose line itself --');
{
  /* The figure the office actually reported. show() in usage.js is what
     drew "4,4 kg" on the conductor phone. */
  const usage = fs.readFileSync(path.join(ROOT, 'modules', 'maintenance', 'usage.js'), 'utf8');
  is('the dose goes through the formatter',
     /numText\(shown, \{ maximumFractionDigits: 2 \}\)/.test(usage), true);
  /* The office half of this arithmetic carries the same rule and says so.
     A phone that disagrees with the sheet leaves a Field Conductor no way
     to tell which is wrong -- which is the whole reason that file is
     written twice in the first place. */
  is('and the file still names its other copy',
     /BOTH repositories/i.test(usage), true);
}

console.log('\n' + (failed ? 'FAILURES: ' + failed : 'all good'));
process.exit(failed ? 1 : 0);
