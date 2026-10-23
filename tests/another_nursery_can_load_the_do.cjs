/* WHERE THE SEEDLINGS WERE IS NOT WHO CARRIED THEM.

   "Who Loaded This DO" opened one section per nursery the DO's own plots
   name, and nothing else. That is right nearly every time and wrong often
   enough to matter: seedlings standing in BNN, on a DO issued against BNN,
   are regularly collected and loaded by a UNN 1 gang — and there was no
   way to say so on the screen the question is asked on.

   So the DO's nurseries are still the ones OPENED, and every other nursery
   with workers on the roster can be opened by hand underneath them.

   Three things this holds, each of which is a way it goes quietly wrong:

     · a nursery added BY HAND comes back OPEN the next time the popup is
       opened, because the next save is built from what is on screen — a
       section that did not reopen would drop the answer somebody gave;
     · an EMPTY nursery is not an answer, so a section opened and then left
       alone writes nothing. `{ "UNN1": [] }` reads on every other screen
       as a nursery that was involved;
     · the offered row never offers a nursery that is already a section,
       and it is sorted, so it does not reshuffle itself between two DOs;
     · only a MAIN NURSERY is offered. The company files every section
       under Pre Nursery, Main Nursery or Estate on the Worker Portal's
       System Setting, and a DO is loaded out of a main one — PN is the
       tray shed and UNE is the estate. The rule RECOGNISES rather than
       lists, so a BNN2 added next year is offered without an edit.

   The three real functions are lifted out of useWorkerTick.js rather than
   restated here. nurseriesOfDO is lifted out of data.js for the same
   reason, and nurseryKey is the one in lib/access.js.

   Needs nothing but node:  node tests/another_nursery_can_load_the_do.cjs */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

function grab(src, startMark, what) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('could not find ' + what + ' — has it been renamed?');
  const end = src.indexOf('\n}', a);
  if (end < 0) throw new Error('could not read to the end of ' + what);
  return src.slice(a, end + 2).replace(/^export /, '');
}

const access = read('src', 'lib', 'access.js');
const data = read('src', 'modules', 'do', 'data.js');
const hook = read('src', 'modules', 'do', 'useWorkerTick.js');

const body = [
  grab(access, 'export function nurseryKey', 'nurseryKey'),
  grab(data, 'export function nurseriesOfDO', 'nurseriesOfDO'),
  grab(hook, 'export function sectionsForDO', 'sectionsForDO'),
  grab(hook, 'export function isMainNursery', 'isMainNursery'),
  grab(hook, 'export function otherNurseries', 'otherNurseries'),
  grab(hook, 'export function cleanPicks', 'cleanPicks'),
  grab(data, 'export function itemsFromRecord', 'itemsFromRecord'),
  grab(data, 'export function plotsOfDO', 'plotsOfDO'),
  grab(data, 'export function customerOfDO', 'customerOfDO'),
].join('\n\n');

const { sectionsForDO, isMainNursery, otherNurseries, cleanPicks, plotsOfDO, customerOfDO } =
  new Function(body + '\nreturn { sectionsForDO, isMainNursery, otherNurseries, cleanPicks,'
    + ' plotsOfDO, customerOfDO };')();

let bad = 0;
const is = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log('  FAIL', what, '\n        got ', a, '\n        want', b); bad++; }
  else console.log('  ok  ', what, '→', a);
};

/* The office's own example. B4 and N3 stand in BNN; the roster carries
   general workers in all three nurseries, spelt the way the office types
   them ("UNN 1"), which nurseryKey strips to UNN1. */
const PLOT_MAP = { B4: 'BNN', N3: 'BNN', U3: 'UNN 1', V7: 'UNN 2' };
/* The roster carries PN and UNE people too, and neither may ever be
   offered: a DO is loaded out of a main nursery. */
const BY_NURSERY = { BNN: [{ id: 1 }], UNN1: [{ id: 2 }], UNN2: [{ id: 3 }],
                     PN: [{ id: 4 }], UNE: [{ id: 5 }] };
const DO_BNN = { do_number: 'DO-ABWST002', plot_1: 'B4', plot_2: 'N3' };

console.log('\n── 1. The DO own nursery is open, the others are offered ──');
const first = sectionsForDO(DO_BNN, PLOT_MAP);
is(first, { own: ['BNN'], extra: [] }, 'BNN opens, nothing added by hand yet');
is(otherNurseries(BY_NURSERY, first.own.concat(first.extra)), ['UNN1', 'UNN2'],
  'and the other two are one tap away');

console.log('\n── 2. A DO across two nurseries opens both ──');
const both = sectionsForDO({ plot_1: 'B4', plot_2: 'U3' }, PLOT_MAP);
is(both, { own: ['BNN', 'UNN1'], extra: [] }, 'BNN and UNN1 both from the plots');
is(otherNurseries(BY_NURSERY, both.own), ['UNN2'], 'only UNN2 left to offer');

console.log('\n── 3. The UNN 1 gang loaded a BNN DO ──');
/* Opened on BNN, UNN1 added by hand, two of its workers ticked, saved. */
const picked = { BNN: [], UNN1: ['Andi Rosmini', 'Yuyak'] };
const saved = cleanPicks(['BNN', 'UNN1'], picked);
is(saved, { UNN1: ['Andi Rosmini', 'Yuyak'] },
  'the ticked names are saved, and the untouched BNN section writes nothing');

console.log('\n── 4. …and it comes back OPEN next time ──');
const again = sectionsForDO(Object.assign({}, DO_BNN, { worked_by_by_nursery: saved }), PLOT_MAP);
is(again, { own: ['BNN'], extra: ['UNN1'] },
  'UNN1 reopens from the record, so the next save cannot drop it');
is(otherNurseries(BY_NURSERY, again.own.concat(again.extra)), ['UNN2'],
  'and it is no longer offered twice');
/* The whole point of reopening it: the next save is built from the sections
   on screen, so a section that stayed shut would wipe the answer. */
is(cleanPicks(again.own.concat(again.extra), { BNN: [], UNN1: saved.UNN1 }), saved,
  'saving again with nothing changed keeps what was there');

console.log('\n── 5. An empty section is not an answer ──');
is(cleanPicks(['BNN', 'UNN1'], { BNN: ['Yuyak'], UNN1: [] }), { BNN: ['Yuyak'] },
  'a nursery opened and then left alone writes nothing at all');
is(cleanPicks(['BNN'], {}), {}, 'and a popup nobody touched writes nothing');
/* A nursery whose names were all UNTICKED again is cleared, not left behind:
   the save writes the whole column, so an absent key is how it is removed. */
is(cleanPicks(['BNN', 'UNN1'], { BNN: [], UNN1: [] }), {},
  'unticking everybody clears the record rather than leaving a stale key');

console.log('\n── 6. Only a MAIN NURSERY is offered ──');
is(['BNN', 'UNN1', 'UNN2'].map(isMainNursery), [true, true, true], 'the three there are today');
is(['PN', 'UNE'].map(isMainNursery), [false, false], 'the tray shed and the estate are not');
is(['BNN2', 'UNN3'].map(isMainNursery), [true, true],
  'and one added next year is taken in without an edit here');
is(isMainNursery(''), false, 'nothing is not a nursery');
/* The office own words: only BNN, UNN1 and UNN2 for selection now. */
is(otherNurseries(BY_NURSERY, []), ['BNN', 'UNN1', 'UNN2'],
  'so the picker offers those three and nothing else');
is(otherNurseries(Object.assign({ BNN2: [{ id: 6 }] }, BY_NURSERY), ['BNN']),
  ['BNN2', 'UNN1', 'UNN2'],
  'and a BNN 2 with workers on it joins them the day it exists');

console.log('\n── 7. A nursery with no workers is never offered ──');
is(otherNurseries({ BNN: [{ id: 1 }] }, ['BNN']), [],
  'nothing to offer when the roster only knows the DO own nursery');
is(otherNurseries({}, []), [], 'and an unreadable roster offers nothing rather than throwing');

console.log('\n── 8. A DO whose plots match no nursery ──');
const none = sectionsForDO({ plot_1: '' }, PLOT_MAP);
is(none, { own: [], extra: [] }, 'no section is derived');
is(otherNurseries(BY_NURSERY, []), ['BNN', 'UNN1', 'UNN2'],
  'but every main nursery is offered, so the question can still be answered');

/* ── WHAT THE DO IS, which the popup and the card both have to say ──
   "Who Loaded This DO" carried a DO number and nothing else, and a DO
   number is not a thing anybody recognises: the person ticking has to know
   which delivery, off which plot, of how many. Both screens read these two
   functions, so one answer, not two. */
console.log('\n── 9. The customer is not simply customer_name ──');
is(customerOfDO({ customer_name: 'Ladang Jaya', remark: 'x', al_number: 'C2A729' }),
  'Ladang Jaya', 'the column wins where a DO carries one');
/* THE ONE THAT WAS WRONG ON SCREEN. This portal writes the customer into
   the REMARK and names no customer column -- EntryModal is `remark:
   al.customer_name` -- so every DO it has ever issued fell through to the
   AL number, and an AL number is a reference, not a name. */
is(customerOfDO({ remark: 'Ladang Jaya', al_number: 'C2A729' }), 'Ladang Jaya',
  'and the remark answers for every DO this portal issued');
is(customerOfDO({ customer_name: '   ', remark: '', al_number: 'C2A729' }), 'C2A729',
  'the AL number is the last resort, never the first');
is(customerOfDO({}), '', 'and a DO with none of the three says nothing rather than "undefined"');
is(customerOfDO(null), '', 'a missing record does not throw');

console.log('\n── 10. The plots a DO names ──');
is(plotsOfDO({ plot_1: 'B4', qty_1: 60, plot_2: 'N3', qty_2: 40 }), ['B4', 'N3'],
  'every plot on the DO, in the order it was keyed');
is(plotsOfDO({ plot_1: 'B4', qty_1: 60, plot_2: 'B4', qty_2: 40 }), ['B4'],
  'a plot twice is one plot — the card has one line for it');
is(plotsOfDO({ plot_1: '', breed_1: 'DxP', qty_1: 60 }), [],
  'a line with no plot adds nothing, so the card reads as the DO naming none');
is(plotsOfDO({}), [], 'and an empty DO does not throw');

console.log('\n' + (bad ? 'FAILURES: ' + bad : 'all good'));
process.exit(bad ? 1 : 0);
