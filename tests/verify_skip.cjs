/* The Verify Hub can say "later" as well as yes and no.

   A card that cannot be answered yet -- the worker is standing right there
   and will know in a minute, the track needs looking at properly -- had
   only two ways out, and both of them are a verdict. Skip moves it to the
   BACK of the deck so the rest can be got through and it comes round
   again before the pass is over. Nothing is written.

   No browser: the deck is a plain array and the skip is one expression on
   it, so the rotation is exercised directly and the wiring is read off the
   source that ships. Mounting the hub for real needs a signed-in session,
   a nursery, a week and a board, none of which this is about -- and a
   check that cannot reach the thing it names is not evidence.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/verify_skip.cjs
   No build and no server needed.                                         */
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)); }
}
function checkTrue(name, got) { check(name, !!got, true); }

(async () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'maintenance', 'VerifyHub.jsx'), 'utf8');

  console.log('\nThe skip button, in the source that ships');
  checkTrue('there is a skip', /function skip\(\)/.test(src));
  checkTrue('…which moves the top card to the BACK of the deck',
            /\[\.\.\.q\.slice\(1\), q\[0\]\]/.test(src));
  checkTrue('…and writes nothing',
            !/function skip\(\)[\s\S]{0,400}?(onApprove|onReject|onUndo)/.test(src));
  checkTrue('…and leaves the deck alone when there is only one card',
            /q\.length < 2 \? q :/.test(src));
  checkTrue('the button is disabled on the last card',
            /disabled=\{!top \|\| queue\.length < 2\}/.test(src));
  checkTrue('…and says why', /mt\.skipOnlyOne/.test(src));
  checkTrue('it is labelled from the dictionary, not hard-coded',
            /t\('mt\.skip'\)/.test(src));

  const i18n = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8');
  check('the label is in both languages', (i18n.match(/'mt\.skip':/g) || []).length, 2);
  check('…and so is the reason it greys out', (i18n.match(/'mt\.skipOnlyOne':/g) || []).length, 2);

  console.log('\nThe rotation itself');
  /* The deck is a plain array; the skip is one expression on it. Exercised
     here directly so the behaviour is checked rather than the spelling. */
  const rotate = (q) => (q.length < 2 ? q : [...q.slice(1), q[0]]);
  check('skipping moves the first to the end', rotate(['a', 'b', 'c']), ['b', 'c', 'a']);
  check('…twice brings the third up', rotate(rotate(['a', 'b', 'c'])), ['c', 'a', 'b']);
  check('…and three times is where it started',
        rotate(rotate(rotate(['a', 'b', 'c']))), ['a', 'b', 'c']);
  check('nothing is dropped', rotate(['a', 'b', 'c']).slice().sort(), ['a', 'b', 'c']);
  check('one card cannot be skipped past itself', rotate(['a']), ['a']);
  check('an empty deck is left alone', rotate([]), []);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
