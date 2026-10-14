/**
 * A walk in progress, parked where the browser cannot throw it away.
 *
 * THE BROWSER IS FREE TO DISCARD THE PAGE AT ANY MOMENT, and on a phone it
 * does: lock the screen, glance at WhatsApp, take a call, and the tab may be
 * gone when it comes back. Nothing can make it go on RECORDING through that —
 * see lib/screenWake.js — but there is no reason the minutes already walked
 * should go with it, and until now they did: the FC Portal map kept its walk
 * in React state inside a modal, so closing the map, a reload or the browser
 * reclaiming the tab lost every metre of it.
 *
 * So the walk is written down on every change and read back on the way in.
 *
 * IT COMES BACK STOPPED, NEVER RUNNING. The phone was not being watched while
 * the page was away, so the minutes in between have no fixes; carrying on
 * silently would draw a straight line across them and call it walked. The
 * person presses Resume, and the gap in the line is the truth about what
 * happened. (A step over MAX_STEP_M is dropped by `addFix` anyway, so the gap
 * is a gap rather than a kilometre of invented distance.)
 *
 * Every read and write is wrapped. A phone with storage blocked must still be
 * able to walk a track; it just cannot survive being killed.
 *
 * ONE COPY, TWO CALLERS: the Worker Portal task row (through taskTrack.js) and
 * the FC Portal map. They keep their own keys and their own idea of what a
 * session looks like — only the surviving is shared.
 */

/** The FC Portal map's walk. The Worker Portal has its own, see taskTrack.js. */
export const MAP_TRACK_KEY = 'mjm.fc.track';

/**
 * How long a parked walk is still the walk somebody is about to finish.
 *
 * A PAGE KILLED MID-WALK TAKES THE FORM WITH IT — the plot, the job, the
 * quantity are all React state and all gone — so the walk comes back into a
 * form that has to be keyed again, and nothing in it says which job it was
 * for. Within a shift that is obvious to the person standing there. A walk
 * parked last Tuesday is not, and offering it against today's plot is how a
 * line walked round N15 ends up filed against B04.
 *
 * Twelve hours is one working day and the night after it. Older than that and
 * it is dropped rather than shown, because a walk nobody can place is not
 * evidence of anything.
 */
export const PARKED_GOOD_FOR_H = 12;

/**
 * True while a parked walk is still today's. No `parkedAt` reads as too old.
 *
 * Measured in BOTH directions. A phone whose clock has run ahead parks a walk
 * in the future, and a one-sided test drops that walk a minute after it was
 * written — which is the one case where the person is definitely still
 * standing in the plot.
 */
export function stillFresh(state, nowMs) {
  const at = Date.parse((state && state.parkedAt) || '');
  if (!at) return false;
  const hours = Math.abs(((nowMs === undefined ? Date.now() : nowMs) - at) / 3600000);
  return hours <= PARKED_GOOD_FOR_H;
}

export function park(key, state) {
  try {
    if (state) localStorage.setItem(key, JSON.stringify(state));
    else localStorage.removeItem(key);
  } catch (e) { /* a track that cannot be parked is still a track */ }
}

/**
 * Read one back, or null. `isValid` is the caller's own idea of a session it
 * can use — a shape that has changed since it was parked must not come back
 * half-understood.
 */
export function unpark(key, isValid) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s) return null;
    return (isValid ? isValid(s) : true) ? s : null;
  } catch (e) {
    return null;
  }
}

export function clearParked(key) {
  park(key, null);
}
