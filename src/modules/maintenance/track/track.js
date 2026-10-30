/**
 * A walked track: the maths, with nothing on screen and nothing async.
 *
 * Kept apart from the map so it can be tested in plain node — the awkward
 * parts of a GPS track are all decisions about which fixes to believe, and
 * those are exactly the parts worth having a test for.
 *
 * A point is [lng, lat, t, acc]:
 *   lng, lat  degrees, six decimals. Longitude FIRST — the same order the
 *             site boundary uses (see scan_system_setting.html, which says the
 *             same thing rather more loudly), and the order GeoJSON wants. Get
 *             it backwards and the track is not obviously wrong, it is just
 *             somewhere in the sea.
 *   t         seconds since the track started. Not a timestamp per point: a
 *             thousand full ISO strings is most of the size of the record.
 *   acc       the phone's own radius in metres, kept so a track can be judged
 *             later rather than only believed.
 */

/** Below this, a fix is good enough to START a recording. */
export const START_ACCURACY_M = 30;

/**
 * And below THIS, a fix is good enough to keep during one. Looser on purpose:
 * a track that stops the moment somebody walks under a shade house is worse
 * than one with a slightly soft corner in it, and the accuracy is stored per
 * point so a soft corner can be seen for what it is.
 */
export const KEEP_ACCURACY_M = 60;

/**
 * A fix nearer than this to the last one is not a step, it is the GPS
 * breathing. Standing still for ten minutes should not draw a ball of wool,
 * and it should not fill the record with six hundred points either.
 */
export const MIN_STEP_M = 3;

/**
 * And a jump further than this between two fixes is not a step either — it is
 * the phone changing its mind, usually on the way out of a building. Dropped:
 * a single wild fix otherwise adds a kilometre to the day's distance.
 */
export const MAX_STEP_M = 120;

/**
 * And this long without a fix, while recording, is not a quiet stretch — it is
 * a line that has STOPPED GROWING, and the commonest reason is the screen
 * going to sleep. The phone gives a position every second or two in the open;
 * three quarters of a minute of nothing has never been the sky.
 *
 * It is a number rather than a feeling because the screen says it out loud:
 * a track that quietly stops is how somebody walks a whole plot for nothing.
 */
export const STALL_AFTER_S = 45;

/**
 * THE STALL BAND IS DRAWN ON A SCREEN NOBODY CAN SEE.
 *
 * It is the right thing to show while somebody is looking, and the case it was
 * written for is the case where they are not: the phone sleeps, the positions
 * stop, the band goes up behind a dark screen, and the next fix — the one that
 * arrives when the phone comes back out of a pocket — clears it. What is left
 * is a saved track reading "33 m · 2 fixes", which looks exactly like a short
 * walk and is in fact a whole plot walked for nothing.
 *
 * So the track has to say it AFTERWARDS, and the evidence is inside it: `t` is
 * seconds since the walk started, so two fixes forty-five seconds apart are
 * forty-five seconds the phone was not listening through. A walk in the open
 * gives a position every second or two.
 *
 * Returns { gap, at } — the longest gap in whole seconds and the `t` it opens
 * at — or { gap: 0, at: null } for a track with nothing to say.
 */
export function longestGapS(points) {
  const ps = points || [];
  let gap = 0, at = null;
  for (let i = 1; i < ps.length; i += 1) {
    const d = Math.round((Number(ps[i][2]) || 0) - (Number(ps[i - 1][2]) || 0));
    if (d > gap) { gap = d; at = Number(ps[i - 1][2]) || 0; }
  }
  return { gap: Math.max(0, gap), at };
}

/**
 * The same question asked of a record whose POINTS ARE NOT IN HAND.
 *
 * The list read deliberately leaves `gps_track` behind — a thousand points a
 * row is most of a nursery's signal — so a card has the count and the two
 * timestamps and nothing else. That is enough, and it is enough EXACTLY
 * rather than nearly: `n` fixes leave `n - 1` gaps between them covering the
 * whole walk, so if the walk divided by those gaps is already STALL_AFTER_S,
 * then at least one of them is that long. It cannot be otherwise. A track of
 * one fix leaves the whole walk uncovered and counts as one gap.
 *
 * Nearly is not good enough here and never has been: a mark that guessed would
 * end up on honest short walks, and then it is a mark nobody reads on the day
 * it means something.
 */
export function gapIsCertain(points, seconds) {
  const n = Math.round(Number(points) || 0);
  const s = Math.round(Number(seconds) || 0);
  if (n < 1 || s < STALL_AFTER_S) return 0;
  const worst = Math.floor(s / Math.max(1, n - 1));
  return worst >= STALL_AFTER_S ? worst : 0;
}

/** Seconds between two stamps, for the callers that hold only those. */
export function secondsBetween(startedAt, endedAt) {
  const a = Date.parse(startedAt || ''), b = Date.parse(endedAt || '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 1000));
}

/** How long the line has been standing still, in whole seconds. */
export function stalledFor(lastFixAtMs, nowMs) {
  if (!lastFixAtMs) return 0;
  return Math.max(0, Math.round((nowMs - lastFixAtMs) / 1000));
}

/** Is that long enough to be worth saying? */
export function isStalled(lastFixAtMs, nowMs) {
  return stalledFor(lastFixAtMs, nowMs) >= STALL_AFTER_S;
}

const R = 6371000;                      // metres
const rad = (d) => (d * Math.PI) / 180;

/** Metres between two [lng, lat] points, on the sphere. */
export function metresBetween(a, b) {
  if (!a || !b) return 0;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const la1 = rad(a[1]), la2 = rad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Six decimals, so the numbers stop growing. About a tenth of a metre. */
const six = (n) => Number(Number(n).toFixed(6));

/**
 * Offer a fix to a track.
 *
 * Returns { points, distance, added, why } — the track either with the point
 * on the end or exactly as it was, and the reason when it was not taken, which
 * is what the screen shows so the worker is never left wondering why the line
 * stopped growing.
 */
export function addFix(state, fix) {
  const points = state.points || [];
  const distance = state.distance || 0;

  if (!fix || fix.lat == null || fix.lng == null) {
    return { points, distance, added: false, why: 'nofix' };
  }
  if (fix.accuracy != null && fix.accuracy > KEEP_ACCURACY_M) {
    return { points, distance, added: false, why: 'weak' };
  }

  const p = [six(fix.lng), six(fix.lat),
             Math.max(0, Math.round(fix.t || 0)),
             fix.accuracy == null ? null : Math.round(fix.accuracy)];

  if (!points.length) return { points: [p], distance: 0, added: true, why: null };

  const last = points[points.length - 1];
  const step = metresBetween(last, p);
  if (step < MIN_STEP_M) return { points, distance, added: false, why: 'still' };
  if (step > MAX_STEP_M) return { points, distance, added: false, why: 'jump' };

  return { points: [...points, p], distance: distance + step, added: true, why: null };
}

/** Can a recording be started on this fix? */
export function mayStart(fix) {
  return !!fix && fix.accuracy != null && fix.accuracy < START_ACCURACY_M;
}

/** "820 m" / "1.4 km" — a distance as somebody would say it. */
export function formatDistance(m) {
  const n = Number(m) || 0;
  return n < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(2)} km`;
}

/** "8m 40s" — how long the track took. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

/**
 * What is saved with the record.
 *
 * The whole track, plus the summary spelt out beside it — the board lists a
 * nursery's month and must not have to open and add up a thousand points to
 * show "820 m" against a row.
 */
export function trackPayload(state) {
  const points = (state && state.points) || [];
  if (!points.length) return null;
  const first = points[0];
  const startedAt = state.startedAt || null;
  const seconds = points[points.length - 1][2] || 0;
  return {
    track: points,
    points: points.length,
    distance_m: Math.round(state.distance || 0),
    started_at: startedAt,
    ended_at: startedAt ? new Date(Date.parse(startedAt) + seconds * 1000).toISOString() : null,
    // The first fix, kept in its own columns: "where was this job" is a
    // question the office asks of five hundred rows at once, and it should not
    // cost a JSON array each to answer.
    lat: first[1],
    lng: first[0],
    accuracy: first[3],
  };
}

/** Opens a spot in whatever map the phone uses. */
export function mapsUrl(lat, lng) {
  return `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`;
}
