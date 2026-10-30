/* A WALK WITH A HOLE IN IT LOOKS EXACTLY LIKE A SHORT WALK.

   The office put two pictures side by side: another app's track covering the
   whole plot in hundreds of zigzags, and ours — one straight red line, corner
   to corner, 33 m. Then they said the thing that settles what this is: B10 is
   fine. B10 reads 1.63 km, 2.59 km, 2.07 km, 2.40 km, hundreds of fixes each,
   off the SAME code on the SAME app. So the app records. What it cannot do is
   record while the phone is asleep, which is the one thing a browser genuinely
   cannot do (see lib/screenWake.js), and a 33 m line made of two fixes minutes
   apart is what that looks like when it is saved.

   THE STALL BAND IS DRAWN ON A SCREEN NOBODY CAN SEE. It goes up 45 seconds
   after the positions stop — behind a dark screen — and the next fix, the one
   that arrives when the phone comes back out of a pocket, clears it. By the
   time anybody looks there is nothing left but "33 m · 2 fixes".

   So the track says it afterwards, and it says it from the evidence inside
   itself. Two things are driven here, both the real ones:

     longestGapS(points)      — the points are in hand (the map)
     gapIsCertain(n, seconds) — they are not (a card, off the summary columns)

   The second is a PROOF and not a guess: n fixes leave n-1 gaps covering the
   whole walk, so if the walk divided by those gaps is already 45 seconds, one
   of them is at least that. Nearly is not good enough — a mark that landed on
   honest short walks is a mark nobody reads on the day it means something.

   Needs nothing but node:  node tests/a_walk_with_a_hole_says_so.cjs */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src', 'modules', 'maintenance', 'track', 'track.js'), 'utf8');

/* The SHIPPED file, run as it stands. A restatement of these three would be a
   second copy of the rule, which is the fault this codebase has a heading
   about. */
/* Asked for BY NAME and one at a time, so a file that has not got one of them
   yet fails as a named check rather than taking the harness down — which is
   exactly what the previous version of this file does, and a run that cannot
   start proves nothing about what it was going to say. */
const WANT = ['longestGapS', 'gapIsCertain', 'secondsBetween', 'STALL_AFTER_S'];
const body = src.replace(/export (function|const)/g, '$1');
const missing = [];
const mod = {};
for (const name of WANT) {
  try { mod[name] = new Function(`${body}\nreturn ${name};`)(); }
  catch (e) { missing.push(name); mod[name] = () => { throw new Error(`${name} is not in track.js`); }; }
}
if (missing.length) console.log('  NOT IN track.js:', missing.join(', '));

const { longestGapS, gapIsCertain, secondsBetween, STALL_AFTER_S } = mod;

let bad = 0;
const is = (gotIn, want, what) => {
  let got;
  try { got = typeof gotIn === 'function' ? gotIn() : gotIn; }
  catch (e) { console.log('  FAIL', what, '\n        threw', e.message); bad++; return; }
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log('  FAIL', what, '\n        got ', a, '\n        want', b); bad++; }
  else console.log('  ok  ', what, '→', a);
};

/* A point is [lng, lat, t, acc]; only t matters here. */
const at = (secs) => secs.map((t, i) => [101.5 + i * 0.0003, 3.2, t, 8]);

console.log('\n1. The gap inside a track the map is holding');

/* It reports the gap and does not judge it: the screen is what compares one
   against STALL_AFTER_S, so a walk in the open answers with its own two
   seconds rather than with a nought that would hide a slow one. */
is(() => longestGapS(at([0, 2, 4, 6])).gap, 2,
   'a walk in the open — a fix every two seconds — gives up its two seconds');
is(() => longestGapS(at([0, 2, 4, 6])).gap >= STALL_AFTER_S, false,
   '...which is nowhere near the line at which anything is said');

/* The office picture: two fixes, 33 m apart, seven minutes between them. */
is(() => longestGapS(at([0, 430])).gap, 430,
   'the straight 33 m line: two fixes, 430 seconds of nothing between them');
is(() => longestGapS(at([0, 430])).at, 0,
   'and it says where the hole opens, so the gap can be found on the line');

is(() => longestGapS(at([0, 2, 4, 300, 302, 304])).gap, 296,
   'a walk that recorded, slept, and recorded again gives up the sleep');
is(() => longestGapS(at([0, 2, 4, 300, 302, 304])).at, 4,
   'and names the fix it stopped at');

is(() => longestGapS(at([0, 20])).gap, 20,
   'a genuinely short walk is reported as what it is and nothing more');
is(() => longestGapS(at([0, 20])).gap >= STALL_AFTER_S, false,
   '...and so is below the line at which anything is said');

is(() => longestGapS([]).gap, 0, 'no points at all says nothing');
is(() => longestGapS(at([0])).gap, 0, 'one point has no gap BETWEEN anything');

console.log('\n2. The same question off the summary columns, where the points are not');

is(() => gapIsCertain(2, 430), 430,
   'two fixes over seven minutes: the one gap IS the whole walk');
is(() => gapIsCertain(798, 2400), 0,
   "B10's own shape — 798 fixes over forty minutes — says nothing at all");
is(() => gapIsCertain(2, 20), 0,
   'two fixes over twenty seconds is a short walk, not a hole');
is(() => gapIsCertain(40, 400), 0,
   'forty fixes over four hundred seconds averages ten, so nothing is certain');

/* The pigeonhole, on its own edge. 10 fixes leave 9 gaps; at 405 seconds that
   is exactly 45 each, so one of them is at least 45 and it is CERTAIN. One
   second less and it is not. */
is(() => gapIsCertain(10, 405), 45, 'exactly at the line: 9 gaps over 405 s is certain');
is(() => gapIsCertain(10, 404), 0,  'one second under it, and nothing is proved');

is(() => gapIsCertain(1, 600), 600,
   'ONE fix over ten minutes leaves the whole walk uncovered');
is(() => gapIsCertain(0, 600), 0, 'no fixes is no track, not a track with a hole');
is(() => gapIsCertain(2, 10), 0, 'a walk shorter than the stall itself says nothing');
is(() => gapIsCertain(null, null), 0, 'a record with no stamps at all says nothing');

console.log('\n3. The seconds come off the two stamps the list already reads');

is(() => secondsBetween('2026-10-20T09:00:00.000Z', '2026-10-20T09:07:10.000Z'), 430,
   'started_at to ended_at, in whole seconds');
is(() => secondsBetween(null, '2026-10-20T09:07:10.000Z'), 0, 'a missing start is nought');
is(() => secondsBetween('nonsense', 'nonsense'), 0, 'and so is anything unreadable');
is(() => secondsBetween('2026-10-20T09:07:10.000Z', '2026-10-20T09:00:00.000Z'), 0,
   'backwards is nought rather than a negative walk');

console.log('\n4. The office rows, end to end');

/* Every row in the screenshots, driven through the pair the cards actually
   use. The B10 rows are the ones that must stay quiet. */
const rows = [
  { plot: 'B10', points: 798, secs: 2400, want: 0 },
  { plot: 'B10', points: 1120, secs: 3100, want: 0 },
  { plot: 'other 33 m', points: 2, secs: 430, want: 430 },
  { plot: 'other 22 m', points: 2, secs: 265, want: 265 },
  { plot: 'the 120 m L', points: 5, secs: 540, want: 135 },
  { plot: 'the 0 m row', points: 1, secs: 180, want: 180 },
];
for (const r of rows) {
  is(() => gapIsCertain(r.points, r.secs), r.want,
     `${r.plot}: ${r.points} fixes over ${r.secs}s`);
}

console.log('\n5. And the screens say it');

const map = fs.readFileSync(path.join(root, 'src', 'modules', 'maintenance', 'track', 'TrackMap.jsx'), 'utf8');
const card = fs.readFileSync(path.join(root, 'src', 'modules', 'maintenance', 'RecordCard.jsx'), 'utf8');
const hub = fs.readFileSync(path.join(root, 'src', 'modules', 'maintenance', 'VerifyHub.jsx'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'src', 'i18n.js'), 'utf8');

is(/longestGapS\(state\.points\)/.test(map), true,
   'the map asks the real points it is holding');
is(/blindNow\s*=\s*!recording/.test(map), true,
   'and only once the walk is OVER — while it runs, the stall band is the one that speaks');
is(/mt\.trkHadGap/.test(map), true, 'the map has the sentence');
is(/gapIsCertain\(r\.gps_points/.test(card), true,
   'the record card asks off the summary columns, with no second read');
is(/gapIsCertain\(r\.gps_points/.test(hub), true,
   'and so does the office hub, which is where somebody looks at a straight line');
is((i18n.match(/'mt\.trkHadGap'/g) || []).length, 2, 'the sentence is in both languages');
is((i18n.match(/'mt\.trkGapTag'/g) || []).length, 2, 'and so is the tag on the row');
is(/screen goes off/.test(i18n), true,
   'and it says WHY, because the reason is the only part anybody can act on');

console.log(bad ? `\n${bad} FAILED\n` : '\nAll good.\n');
process.exit(bad ? 1 : 0);
