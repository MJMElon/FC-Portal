/* A BROWSER STOPS GIVING POSITIONS WHEN THE PAGE IS NOT ON SCREEN.

   Not throttles — stops. So a walk recorded from a web page lives or dies on
   whether the screen stays awake, and the one lever for that is the screen
   wake lock.

   THE BROWSER TAKES THAT LOCK BACK the moment the page is hidden, and does
   not hand it back. So a single `wakeLock.request()` at Start is a lock that
   is gone for good after the first notification, app switch or glance away —
   and every walk after that moment is at the mercy of the display timeout.

   That is what the office was seeing: the same plot recorded 798 fixes one
   day and 2 the next. The Worker Portal had the full treatment and the FC
   Portal track map had the one-line version, which is the shape of every
   drift in this codebase — two copies, one of them thinner.

   lib/screenWake.js is the one copy now, and this drives the real one.

   Needs nothing but node:  node tests/the_screen_lock_is_asked_again.cjs */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'screenWake.js'), 'utf8');
const i = src.indexOf('export function holdScreenAwake');
if (i < 0) throw new Error('holdScreenAwake has been renamed');
const body = src.slice(i).replace('export function', 'function');
const holdScreenAwake = new Function(
  'navigator', 'document', body + '\nreturn holdScreenAwake;')
  .bind(null);

let bad = 0;
const is = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log('  FAIL', what, '\n        got ', a, '\n        want', b); bad++; }
  else console.log('  ok  ', what, '→', a);
};

/* A phone, as far as this code can tell: a wake lock that can be asked for and
   taken away, and a page that can be hidden. */
function phone({ hasApi = true, refuses = false } = {}) {
  const log = [];
  let listener = null;
  const locks = [];
  const doc = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => { if (name === 'visibilitychange') listener = fn; },
    removeEventListener: (name) => { if (name === 'visibilitychange') listener = null; },
  };
  const nav = hasApi ? {
    wakeLock: {
      request: async () => {
        log.push('ask');
        if (refuses) throw new Error('refused');
        const lock = {
          released: false,
          release: async () => { lock.released = true; log.push('release'); },
          addEventListener: () => {},
        };
        locks.push(lock);
        return lock;
      },
    },
  } : {};
  return {
    nav, doc, log, locks,
    hide: () => { doc.visibilityState = 'hidden'; if (listener) listener(); },
    show: () => { doc.visibilityState = 'visible'; if (listener) listener(); },
    listening: () => listener !== null,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

(async () => {

console.log('\n── 1. It is asked for when the walk starts ──');
{
  const p = phone();
  const stop = holdScreenAwake(p.nav, p.doc)();
  await settle();
  is(p.log, ['ask'], 'one lock taken');
  is(p.listening(), true, 'and the page is watched, which is the whole point');
  stop();
}

console.log('\n── 2. …and AGAIN every time the page comes back ──');
{
  const p = phone();
  const stop = holdScreenAwake(p.nav, p.doc)();
  await settle();
  /* The browser releases it on hidden without being asked and without telling
     anybody. This is the notification, the app switch, the glance away. */
  p.hide(); await settle();
  is(p.log, ['ask'], 'nothing is asked while the page is hidden');
  p.show(); await settle();
  is(p.log, ['ask', 'ask'], 'it is asked again the moment the page is back');
  p.hide(); await settle(); p.show(); await settle();
  is(p.log, ['ask', 'ask', 'ask'], 'and again, every time, not just the second');
  stop();
}

console.log('\n── 3. The previous version is what the office was losing tracks to ──');
{
  /* Asking once, the way startRecording used to: one request, no listener. */
  const p = phone();
  p.nav.wakeLock.request('screen').catch(() => {});
  await settle();
  p.hide(); await settle(); p.show(); await settle();
  is(p.log, ['ask'], 'asked once, and never again after the first time hidden');
  is(p.listening(), false, 'nothing was watching the page at all');
}

console.log('\n── 4. Letting go gives the lock back and stops watching ──');
{
  const p = phone();
  const stop = holdScreenAwake(p.nav, p.doc)();
  await settle();
  stop();
  await settle();
  is(p.locks.map((l) => l.released), [true], 'the lock is released when the walk stops');
  is(p.listening(), false, 'and the page is no longer watched');
}

console.log('\n── 5. A phone without the API still records ──');
{
  const p = phone({ hasApi: false });
  let threw = null;
  try { holdScreenAwake(p.nav, p.doc)()(); } catch (e) { threw = e.message; }
  is(threw, null, 'no API, no throw — a walk records without a lock, just less reliably');
}
{
  const p = phone({ refuses: true });
  let threw = null;
  try { const s = holdScreenAwake(p.nav, p.doc)(); await settle(); s(); } catch (e) { threw = e.message; }
  is(threw, null, 'and a phone that refuses the lock does not take the walk down with it');
}

console.log('\n── 6. The stall rule: a line that has stopped growing says so ──');
{
  const tsrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'maintenance', 'track', 'track.js'), 'utf8');
  const grab = (mark) => {
    const a = tsrc.indexOf(mark);
    if (a < 0) throw new Error('could not find ' + mark);
    return tsrc.slice(a, tsrc.indexOf('\n}', a) + 2).replace('export function', 'function');
  };
  const secs = Number((tsrc.match(/export const STALL_AFTER_S = (\d+)/) || [])[1]);
  const { stalledFor, isStalled } = new Function(
    'const STALL_AFTER_S = ' + secs + ';\n' +
    grab('export function stalledFor') + '\n' + grab('export function isStalled') +
    '\nreturn { stalledFor, isStalled };')();

  is(secs, 45, 'three quarters of a minute of nothing has never been the sky');
  const now = 1_000_000;
  is(stalledFor(now - 10_000, now), 10, 'ten seconds of quiet is ten seconds');
  is(isStalled(now - 10_000, now), false, 'and is not worth saying');
  is(isStalled(now - 60_000, now), true, 'a minute of nothing is');
  is(stalledFor(null, now), 0, 'and before the first fix there is nothing to be quiet about');
}

console.log('\n── 7. A walk survives the page being thrown away ──');
{
  /* Nothing can keep RECORDING through a locked phone. What must not also
     happen is losing the metres already walked, which is what the FC map did:
     the walk lived in React state inside a modal. */
  const psrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'maintenance', 'track', 'parked.js'), 'utf8');
  const grab = (mark) => {
    const a = psrc.indexOf(mark);
    if (a < 0) throw new Error('could not find ' + mark);
    return psrc.slice(a, psrc.indexOf('\n}', a) + 2).replace('export function', 'function');
  };
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const hours = Number((psrc.match(/export const PARKED_GOOD_FOR_H = (\d+)/) || [])[1]);
  const { park, unpark, clearParked, stillFresh } = new Function('localStorage',
    'const PARKED_GOOD_FOR_H = ' + hours + ';\n' +
    grab('export function park') + '\n' + grab('export function unpark') + '\n' +
    grab('export function clearParked') + '\n' + grab('export function stillFresh') +
    '\nreturn { park, unpark, clearParked, stillFresh };')(localStorage);

  const walk = { points: [[114.1, 3.9, 0, 8], [114.1001, 3.9, 12, 7]], distance: 11,
                 startedAt: '2026-10-14T01:00:00.000Z', parkedAt: '2026-10-14T01:05:00.000Z' };
  park('mjm.fc.track', walk);
  is(unpark('mjm.fc.track', (x) => Array.isArray(x.points) && x.points.length > 0), walk,
    'the walk comes back exactly as it was parked');

  /* It must come back only where it can be understood. A shape that changed
     since it was parked is worse than nothing: half a walk read as a whole
     one is a figure somebody writes down. */
  park('mjm.fc.track', { points: [] });
  is(unpark('mjm.fc.track', (x) => Array.isArray(x.points) && x.points.length > 0), null,
    'an empty one is not offered back');
  store['mjm.fc.track'] = '{ not json';
  is(unpark('mjm.fc.track', () => true), null, 'and neither is a half-written one');

  park('mjm.fc.track', walk);
  clearParked('mjm.fc.track');
  is(unpark('mjm.fc.track', () => true), null,
    'handing the walk to the record clears it, so it cannot come back on the NEXT job');

  /* A phone with storage blocked must still walk a track. */
  const blocked = { getItem: () => { throw new Error('denied'); },
                    setItem: () => { throw new Error('denied'); },
                    removeItem: () => { throw new Error('denied'); } };
  const B = new Function('localStorage',
    grab('export function park') + '\n' + grab('export function unpark') +
    '\nreturn { park, unpark };')(blocked);
  let threw = null;
  try { B.park('k', walk); is(B.unpark('k', () => true), null, 'and a blocked store reads as nothing'); }
  catch (e) { threw = e.message; }
  is(threw, null, 'storage refused is not a reason to lose the walk on screen');
}

console.log('\n── 8. …but only while it is still the walk somebody is finishing ──');
{
  /* A kill takes the FORM with it — the plot, the job, the quantity are all
     gone — so the walk comes back into a form that has to be keyed again and
     nothing in it says which job it was for. Within the shift that is obvious
     to the person standing there; a walk parked last Tuesday is not, and
     offering it against today's plot files N15 under B04. */
  const psrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'maintenance', 'track', 'parked.js'), 'utf8');
  const hours = Number((psrc.match(/export const PARKED_GOOD_FOR_H = (\d+)/) || [])[1]);
  const a = psrc.indexOf('export function stillFresh');
  const stillFresh = new Function(
    'const PARKED_GOOD_FOR_H = ' + hours + ';\n' +
    psrc.slice(a, psrc.indexOf('\n}', a) + 2).replace('export function', 'function') +
    '\nreturn stillFresh;')();

  is(hours, 12, 'one working day and the night after it');
  const now = Date.parse('2026-10-14T09:00:00.000Z');
  const at = (iso) => stillFresh({ parkedAt: iso }, now);
  is(at('2026-10-14T08:40:00.000Z'), true, 'parked twenty minutes ago is this morning walk');
  is(at('2026-10-13T22:00:00.000Z'), true, 'and last night is still inside the window');
  is(at('2026-10-07T09:00:00.000Z'), false, 'last Tuesday is not, and is dropped rather than shown');
  is(at('2026-10-14T09:00:30.000Z'), true,
    'a phone whose clock runs ahead parks in the future — that one is DEFINITELY still in the plot');
  is(stillFresh({}, now), false, 'and something parked before this rule existed has no date to trust');
  is(stillFresh(null, now), false, 'nothing parked is not fresh either');
}

console.log('\n' + (bad ? 'FAILURES: ' + bad : 'all good'));
process.exit(bad ? 1 : 0);

})();
