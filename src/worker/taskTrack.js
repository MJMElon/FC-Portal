/**
 * One walked job: Start, Pause, Resume, Stop — the state, with nothing on
 * screen and nothing async.
 *
 * Kept apart from the row that draws it for the same reason track.js is kept
 * apart from the map: the awkward parts are all decisions about which fixes to
 * believe and what a pause does to a clock, and those are exactly the parts
 * worth having a test for.
 *
 * The maths itself is NOT re-done here. addFix, metresBetween, trackPayload
 * and the four thresholds live in modules/maintenance/track/track.js and are
 * the same ones the FC Portal's full-screen map uses, so a track walked from a
 * task row and a track walked from the record form are the same object with
 * the same rules behind it.
 *
 * ── What a pause is ──
 *
 * A pause stops the track taking fixes. It does not stop the clock, and that
 * is deliberate: `t` on a point is seconds since the track STARTED, so making
 * it skip the paused minutes would put every later point at a time it was not
 * recorded at, and ended_at would say the job finished before it did.
 *
 * The cost is that the first fix after a long pause can be a long way from the
 * last one before it. That is already handled: a step over MAX_STEP_M is not a
 * step, it is the phone changing its mind, and addFix drops it. So a pause
 * leaves a gap in the line rather than a kilometre of false distance — which
 * is the honest drawing of what happened.
 */
import { addFix, trackPayload } from '../modules/maintenance/track/track.js';
import { park, unpark } from '../modules/maintenance/track/parked.js';

/** Where a track in progress is kept, so locking the phone cannot lose it. */
export const TRACK_KEY = 'mjm.worker.track';

/** A job's identity: the plot AND what is going on it. */
export const taskId = (task) =>
  task ? `${task.workTypeKey}|${task.plot}|${task.chemical || ''}` : '';

/** Nothing running. */
export const idle = () => null;

/**
 * Begin. `at` is the wall clock, passed in rather than read, so a test can say
 * what time it is.
 */
export function start(task, at = new Date()) {
  return {
    id: taskId(task),
    task: { workTypeKey: task.workTypeKey, plot: task.plot,
            chemical: task.chemical || '', nursery: task.nursery || null },
    status: 'running',
    startedAt: at.toISOString(),
    points: [],
    distance: 0,
    /* Why the last fix was not taken — 'still', 'weak', 'jump'. Shown on the
       row, because a line that has stopped growing with no reason given is
       indistinguishable from an app that has stopped working. */
    why: null,
  };
}

export const pause  = (s) => (s && s.status === 'running' ? { ...s, status: 'paused' } : s);
export const resume = (s) => (s && s.status === 'paused'  ? { ...s, status: 'running', why: null } : s);

/**
 * Offer the session a fix from the phone.
 *
 * Ignored while paused — that is the whole of what pause means — and ignored
 * when nothing is running, so a stray callback arriving after Stop cannot
 * resurrect a finished track.
 */
export function fix(s, { lat, lng, accuracy }, at = new Date()) {
  if (!s || s.status !== 'running') return s;
  const t = (at.getTime() - Date.parse(s.startedAt)) / 1000;
  const next = addFix({ points: s.points, distance: s.distance },
                      { lat, lng, accuracy, t });
  return { ...s, points: next.points, distance: next.distance, why: next.why };
}

/**
 * What gets saved with the record, or null if the walk never took a fix.
 *
 * A track with no points is not a failure worth blocking a save over: the
 * worker did the job, the phone could not see the sky. The record is written
 * without a track and says so by having none.
 */
export function payload(s) {
  if (!s || !s.points.length) return null;
  return trackPayload({ points: s.points, distance: s.distance, startedAt: s.startedAt });
}

/** Seconds since Start, paused minutes included — see the note at the top. */
export function elapsed(s, at = new Date()) {
  if (!s || !s.startedAt) return 0;
  return Math.max(0, (at.getTime() - Date.parse(s.startedAt)) / 1000);
}

/* ── Surviving a locked phone ──────────────────────────────────────────────
 *
 * A worker starts a track, puts the phone in a pocket, walks the plot, and the
 * browser is free to throw the page away at any point in that. Kept in
 * localStorage on every change, read back on load: the alternative is a worker
 * finding out at the end of the row that the last ten minutes were not
 * recorded.
 *
 * Every read and write is wrapped — a phone with storage blocked must still be
 * able to walk a track, it just cannot survive being killed. */
export function save(s) {
  park(TRACK_KEY, s);
}

export function load() {
  const s = unpark(TRACK_KEY,
    (x) => !!x.id && !!x.startedAt && Array.isArray(x.points));
  /* Comes back PAUSED however it went away. The phone was not being watched
     while the page was gone, so the minutes in between have no fixes;
     resuming silently would draw a straight line across them and call it
     walked. The worker presses Resume, and the gap is visible. */
  return s ? { ...s, status: 'paused' } : null;
}
