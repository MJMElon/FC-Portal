/* STILL OVER THE LIMIT AFTER A SECOND SELECTION IS HQ, NOT THE AUDITOR
   AGAIN.

   The calculator had two answers. At or under ten percent the block is
   ready and the drone flight records it; over the line the auditor is
   asked to go and look. What neither of them covers is the block the
   auditor HAS looked at, which was selected again, and which is still over
   the line -- asking for the same check a second time is asking the same
   question twice, and the office wanted that one to go to HQ.

   The category and the route for it were set up in the database months ago
   (shared/RUN_ME_culling_inang.sql in mjm-ai-system, pointed at HQ
   Operation) and nothing ever raised it: "From Culling Calculator -
   Request HQ Verification" read "by hand" on the register of what the
   system opens by itself, with no code anywhere that files a case under
   it.

   The round is the whole of the rule, and it is a fact about the GROUND
   rather than about the phone -- the second round is usually keyed by
   somebody else, often on a different phone. So it is read off
   fcportal_culling_inang and never remembered locally, and the two
   directions of not knowing are deliberately not the same:

     UNKNOWN IS NOT NOUGHT. A read that failed, or a phone with no signal,
     answers with the two buttons this screen has always had. Under-counting
     asks the auditor again, which is the round that was going to happen
     anyway. Over-counting sends HQ to a plot nobody has finished looking
     at.

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/hq_is_the_third_way_out.cjs
   No build and no server needed.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const P = (...p) => path.join(__dirname, '..', 'src', 'modules', 'palms', ...p);
const ACTIONS = fs.readFileSync(P('cullingActions.js'), 'utf8');
const TAB = fs.readFileSync(P('CullingTab.jsx'), 'utf8');
const INANG = fs.existsSync(P('cullingInang.js')) ? fs.readFileSync(P('cullingInang.js'), 'utf8') : '';
const SOURCE = fs.readFileSync(P('cullingSource.js'), 'utf8');
const OFFLINE = fs.readFileSync(P('cullingOffline.js'), 'utf8');
const I18N = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8');

let failed = 0;
const fail = (m) => { console.log('FAIL  ' + m); failed++; };
const pass = (m) => console.log('pass  ' + m);
const is = (m, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass(m + '  → ' + JSON.stringify(got));
  else fail(m + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want));
};

/* The real rules, lifted out of the shipped file rather than copied: the
   point is that THIS code decides, not that a transcription does. The
   imports and the exports are the only things changed. */
const sandbox = { console, module: {}, fmtNum: (n) => String(n), fmtPct: (n) => String(n) };
vm.createContext(sandbox);
try {
  vm.runInContext(
    ACTIONS.replace(/^import[\s\S]*?;\s*$/m, '').replace(/^export /gm, ''),
    sandbox
  );
} catch (e) {
  fail('cullingActions.js would not run: ' + e.message);
}
/* Read back as EXPRESSIONS, not off the sandbox object: a `const` at the
   top level of a script does not become a property of the context the way a
   function declaration does, so CULLING_ACTIONS came back undefined and the
   checks that read it failed for a reason that had nothing to do with the
   code under test. */
const actionFor = sandbox.actionFor;
const CULLING_ACTIONS = (() => {
  try { return vm.runInContext('CULLING_ACTIONS', sandbox); } catch (e) { return null; }
})();

console.log('\n-- 1. The three answers --');
if (typeof actionFor !== 'function') {
  fail('actionFor is not in cullingActions.js any more');
} else {
  /* Under the line is the drone flight, whatever the block has been
     through. A block that has come down to ten percent is ready, and how
     many goes it took to get there is not HQs business. */
  is('at the limit, first selection, drone',
     (actionFor(0.1, { attempts: 0 }) || {}).key, 'drone');
  is('at the limit after three selections, STILL the drone',
     (actionFor(0.1, { attempts: 3 }) || {}).key, 'drone');

  // Over the line and never selected: the auditor, as before.
  is('over the limit, nothing selected yet, the auditor',
     (actionFor(0.12, { attempts: 0 }) || {}).key, 'recheck');

  // Over the line again after a selection: HQ.
  is('over the limit after one selection, HQ',
     (actionFor(0.12, { attempts: 1 }) || {}).key, 'hq');
  is('and after four of them, still HQ',
     (actionFor(0.12, { attempts: 4 }) || {}).key, 'hq');

  // Nothing to say about a rate there is no figure for.
  is('no rate, no button', actionFor(NaN, { attempts: 2 }), null);
}

console.log('\n-- 2. Unknown is not nought --');
if (typeof actionFor === 'function') {
  /* Each of these is a phone that cannot say how many rounds the block has
     had. Every one of them has to answer the way the screen answered
     before this rule existed. */
  [
    ['no context at all', undefined],
    ['an empty context', {}],
    ['attempts undefined', { attempts: undefined }],
    ['attempts null', { attempts: null }],
    ['attempts not a number', { attempts: 'two' }],
  ].forEach(([what, ctx]) => {
    is(what + ' asks the auditor, never HQ', (actionFor(0.12, ctx) || {}).key, 'recheck');
  });
}

console.log('\n-- 3. The case is filed under the row the database holds --');
{
  /* A case carries its category BY VALUE and nelos_routes matches on that
     string, so these words are the same string in three places. One letter
     out and every HQ verification falls back to the Field Conductor who
     raised it. This is the spelling on the register, copied from the
     office own result. */
  const WANT = 'From Culling Calculator - Request HQ Verification';
  const hq = (CULLING_ACTIONS || []).find((a) => a.key === 'hq');
  if (!hq) fail('there is no hq rule in CULLING_ACTIONS');
  else {
    is('the category is spelled exactly as the database holds it', hq.category, WANT);
    is('it is raised at the ordinary priority', hq.priority, 'normal');
    /* A fixed sentence, not the button label: a case is read by whoever
       picks it up, days later, in whatever language they use. */
    const title = hq.caseTitle('U3');
    is('the case title names the plot', title.includes('"U3"'), true);
    is('and says what makes it different from the one before it',
       /second/i.test(title), true);
  }

  /* THE SPECIFIC RULE FIRST. Every block the HQ rule matches is also over
     the limit, so a list that put recheck first would never reach it --
     and the test would pass on the figures while the screen showed the
     auditor for ever. */
  const keys = (CULLING_ACTIONS || []).map((a) => a.key);
  is('hq is tried before recheck', keys.indexOf('hq') < keys.indexOf('recheck'), true);
}

console.log('\n-- 4. The round count comes off the server --');
{
  is('there is a module for the selection table', !!INANG, true);
  is('it names the table the SQL creates', /fcportal_culling_inang/.test(INANG), true);
  /* The upsert names (plot, batch) as its conflict target, which is the
     unique index in RUN_ME_culling_inang.sql. One row per block, replaced
     each round -- the figure that matters is the one standing now. */
  is('one row per block, replaced rather than added to',
     /onConflict:\s*'plot,batch'/.test(INANG), true);
  /* A read that failed must answer null and not an empty map. An empty map
     says "no block has ever been selected", which would take every block
     back to its first round and hide every HQ case there should be. */
  is('a failed read answers null, never an empty map',
     /if \(res\.error\)[\s\S]{0,200}return null/.test(INANG), true);
  is('the higher round wins where two rows exist',
     /prev\.attempt >= attempt/.test(INANG), true);
  is('the blocks carry the count out to the screen',
     /attempts:\s*sel \? sel\.attempt/.test(SOURCE), true);
  /* Read BESIDE the four gates, not as one of them: a block is on this
     screen whether or not anybody has counted in it. */
  is('a selection read that fails does not empty the plot list',
     /loadInangSelections\(\),\n\s*\]\);\n\s*if \(!atPengambilan \|\| !planted \|\| !finished \|\| !dos\)/.test(SOURCE),
     true);
}

console.log('\n-- 5. The sweep only ever runs against a server list --');
{
  /* A block leaves the calculator when its collecting status closes or its
     drone map lands. Its selection has to go with it, or next season starts
     at round two and goes straight to HQ. Swept against a CACHED list it
     would delete every block somebody else has started on. */
  is('the sweep is called where the server rows are in hand',
     /sweepInangSelections\(saved, new Set\(out\.map/.test(SOURCE), true);
  const cacheExit = SOURCE.indexOf('return (cachedBlocks() || { rows: [] }).rows');
  const sweepAt = SOURCE.indexOf('sweepInangSelections(saved');
  is('and never on the way out through the cache', cacheExit < sweepAt, true);
}

console.log('\n-- 6. A round is a case --');
{
  /* Pressed twice, the second press raises nothing -- the server dedupes
     it. Counting that as a round would spend the block second selection on
     a double tap and send the next real count to HQ. */
  is('a deduped press records no round', /if \(!deduped\) await recordRound\(round\)/.test(TAB), true);
  /* A refused case is one the Field Conductor will press again. Recording a
     round for it would turn that retry into an escalation. */
  const errAt = TAB.indexOf("flash(t('cull.raiseFailed'))");
  const recAt = TAB.indexOf('await recordRound');
  is('a refused case records no round', errAt > 0 && errAt < recAt, true);
  /* No signal still counts: the queue sends the case, and a round the
     phone forgot is a round the next person cannot see. */
  is('a queued case does record one',
     /if \(queued\) \{[\s\S]{0,400}await recordRound\(round\)/.test(TAB), true);
  /* A block already under the limit is offered the drone button with
     nothing keyed. Nothing was selected, so it is not a round. */
  is('and a press with nothing counted is not a round',
     /const round = counted \? \(rounds \|\| 0\) \+ 1 : 0/.test(TAB), true);
  is('the selection goes through the outbox like the case does',
     /export async function submitSelection/.test(OFFLINE)
       && /\[INANG_JOB\]: async \(payload\)/.test(OFFLINE), true);
}

console.log('\n-- 7. The screen says why it is asking HQ --');
{
  is('the button has a third tone', /tone: 'esc'/.test(ACTIONS), true);
  is('and the screen draws it', /action\.tone === 'esc'/.test(TAB), true);
  is('a line says which selection this is', /data-hqnote/.test(TAB), true);
  ['cull.actHq', 'cull.hqNote', 'cull.round'].forEach((k) => {
    const n = (I18N.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length;
    is('both languages carry ' + k, n, 2);
  });
  /* The case says which round it is, and only once there has been more
     than one: on a first selection the line would say nothing, because
     round 1 is every other case in the list. */
  is('the case body carries the round, above one only',
     /round > 1 \? \[`\$\{t\('cull\.round'\)\}/.test(ACTIONS), true);
}

console.log('\n' + (failed ? 'FAILURES: ' + failed : 'all good'));
process.exit(failed ? 1 : 0);
