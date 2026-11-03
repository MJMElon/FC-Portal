/* A stage the office takes off the list leaves every phone the next time
   PALMS is opened with signal.

   Both docks drew the cached stage list and asked the office for a fresh one
   ONLY when there was no cache — so a phone that had ever opened PALMS kept
   its old list for good. Up-keep (stage 12) was taken off the list, and
   phones went on keying it into October; the board drew those entries as
   "Stage 12" because no stage had that number any more.

   Run: node tests/a_removed_stage_leaves_the_phone.cjs                     */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)); }
}
const code = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

for (const f of ['src/components/FloatingDock.jsx', 'src/components/PalmsDock.jsx', 'src/modules/palms/PalmsBody.jsx']) {
  const src = code(f);
  check(f + ' asks the office for the list every time it opens',
    /\n\s*refreshOfficeConfig\(\)\.then/.test(src), true);
  check(f + ' does not skip the ask because something is cached',
    /if \(!cached\) refreshOfficeConfig/.test(src), false);
}

/* And the fresh list REPLACES the old one, so a removed stage is gone. */
const DATA = code('src/modules/palms/data.js');
check('applyOfficeConfig replaces the stage list rather than adding to it',
  /ACTIVITIES\.length = 0;/.test(DATA), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
