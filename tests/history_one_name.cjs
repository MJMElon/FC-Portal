/* A history card names ONE worker: whoever did the work.

   `worked_by` is set when the conductor says somebody else did it — keying
   it for a worker whose phone was broken, or correcting a record the office
   sent back — so where it is there it is the answer, and `reported_by` is
   merely who held the phone.

   The card used to print that second name under the first, as "keyed by
   Amri". It answers a question nobody asks of this card: the card is read to
   find out who the morning belongs to, and two names where there is one
   worker reads as a disagreement. The office's own form still shows both,
   and the record still holds both.

   The card needs a signed-in session, a nursery and a week to mount, none of
   which this is about — so the rule is run as the rule, over the shipped
   source, and the source is checked for not carrying the second name.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/history_one_name.cjs
   No build, no browser and no server needed.                               */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)); }
}
function checkTrue(name, got) { check(name, !!got, true); }
function checkFalse(name, got) { check(name, !!got, false); }

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

(async () => {
  console.log('\nWhich name the card shows');
  /* The expression the card ships, run on the cases that matter. */
  const shown = (r) => r.worked_by || r.reported_by || '(nobody)';
  check('the conductor said who did it, so that is the name',
        shown({ worked_by: 'Awaludin', reported_by: 'Amri' }), 'Awaludin');
  check('…even where the office corrected it to somebody else',
        shown({ worked_by: 'Awaludin', reported_by: 'Awaludin' }), 'Awaludin');
  check('nobody named means the person who reported it did it themselves',
        shown({ worked_by: '', reported_by: 'Amri' }), 'Amri');
  check('…and null counts as nobody named',
        shown({ worked_by: null, reported_by: 'Amri' }), 'Amri');
  check('neither is a record that credits nobody',
        shown({ worked_by: null, reported_by: null }), '(nobody)');

  console.log('\nAnd the second name is gone from the card');
  const card = read('modules', 'maintenance', 'RecordCard.jsx');
  checkTrue('the card still shows worked_by, falling back to reported_by',
            /\{r\.worked_by \|\| r\.reported_by \|\| t\('mt\.byNobody'\)\}/.test(card));
  checkFalse('…and no longer prints "keyed by" under it',
             /keyedBy/.test(card));
  /* Comments stripped first: the one above the cell explains what
     reported_by is for, and a check that cannot tell prose from code is a
     check that fails for being right. */
  const code = card.replace(/\/\*[\s\S]*?\*\//g, '');
  check('…and reported_by is RENDERED in exactly one place, the fallback',
        (code.match(/reported_by/g) || []).length, 1);
  checkTrue('the reason it came off is written where the next person will read it',
            /two names\s+where there is one worker/i.test(card));

  console.log('\nNothing is left pointing at a label that has gone');
  const i18n = read('i18n.js');
  check('the dictionary entry is removed, both languages',
        (i18n.match(/'mt\.keyedBy'/g) || []).length, 0);
  const src = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(e.name)) src.push(fs.readFileSync(full, 'utf8'));
    });
  })(path.join(__dirname, '..', 'src'));
  check('…and nothing anywhere still asks for it',
        src.filter((f) => /mt\.keyedBy/.test(f)).length, 0);

  /* The office keeps both: the record is still the record, and the form that
     corrects it is where the two names are told apart. */
  console.log('\nThe record itself is untouched');
  checkTrue('the card reads the row, it does not write it',
            !/\.update\(|\.upsert\(|supabase/.test(card));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
