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

console.log('\n' + (bad ? 'FAILURES: ' + bad : 'all good'));
process.exit(bad ? 1 : 0);

})();
