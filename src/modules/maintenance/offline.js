/**
 * The Maintenance module's copy of the nursery, kept on the device.
 *
 * The module records offline and always has — the outbox saw to that. What it
 * could not do was READ offline: every open went straight to Supabase, and a
 * phone that reloaded in a plot came back to an empty board. Worse than
 * empty, in fact: with no plan loaded the week card said "nothing due —
 * you're all clear" and the plot list said "no nursery is open to you yet",
 * which are a lie and a wrong diagnosis. A Field Conductor reading those
 * would go home.
 *
 * So the last good read is kept here, the same arrangement the Culling
 * Calculator already had (cullingOffline.js) — and for the same reason: the
 * plot is where the work is and where the signal is not.
 *
 * ── Two things this is careful about ──
 *
 * 1. GPS TRACKS ARE STRIPPED. `loadMaintenanceData` selects * from
 *    nops_maint_field_records, and gps_track is an array of every point
 *    walked — hundreds per record. Five hundred of those would be megabytes,
 *    and localStorage gives about five in total, so caching them raw would
 *    throw QuotaExceeded and leave the phone with NO cache at all. The board
 *    only ever draws the summary columns; the track is fetched per record
 *    when somebody opens one, which needs a signal anyway.
 *
 * 2. A FAILED READ NEVER OVERWRITES A GOOD ONE. Only a successful load
 *    calls the cache-writers here. An empty answer from a half-broken
 *    connection saved over the top would turn "no signal" into "nothing to
 *    do", which is the failure this file exists to prevent.
 *
 * Nothing here throws. A device with storage full or switched off simply has
 * no cache, and behaves exactly as the module did before this existed.
 */

/* Bumped when the shape changes, so old code cannot read a new cache or the
   other way about. A missed cache costs one read; a misread one costs a
   wrong decision. */
const KEY = 'mjm_maint_offline_v1';

/* How many records to keep. The board shows recent work — the office keeps
   the history — and 300 rows of summary columns is comfortably inside what
   localStorage will take even beside the other modules' caches. */
const MAX_RECORDS = 300;

/** The columns the board actually draws. Everything else is left behind. */
function slimRecord(r) {
  const out = {};
  for (const k in r) {
    if (k === 'gps_track') continue;      // the reason this function exists
    out[k] = r[k];
  }
  return out;
}

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw && typeof raw === 'object' ? raw : null;
  } catch (e) {
    return null;
  }
}

function write(next) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    /* Storage full or refused. The read that just succeeded still gave the
       person their figures; they simply will not have them tomorrow. */
  }
}

/** Keep the plots and records just read. */
export function cacheData({ plots, records }) {
  const now = read() || {};
  write({
    ...now,
    at: Date.now(),
    plots: plots || [],
    records: (records || []).slice(0, MAX_RECORDS).map(slimRecord),
  });
}

/** Keep one month's plan, filed under the month it is for. */
export function cacheSchedules(monthLabel, rows) {
  const now = read() || {};
  const months = now.months || {};
  months[monthLabel || ''] = { at: Date.now(), rows: rows || [] };
  write({ ...now, months });
}

/** Keep what is standing in each plot. A Map on the way in and out. */
export function cacheBatches(map) {
  const now = read() || {};
  const flat = [];
  (map || new Map()).forEach((list, plot) => flat.push([plot, list]));
  write({ ...now, batchesAt: Date.now(), batches: flat });
}

/**
 * @returns {{ plots, records, at } | null} null when this phone has never
 *   had a good read — which the screen must say plainly, because it is a
 *   different sentence from "there is nothing to do".
 */
export function cachedData() {
  const raw = read();
  if (!raw || !Array.isArray(raw.plots)) return null;
  return { plots: raw.plots, records: raw.records || [], at: Number(raw.at) || 0 };
}

/** One month's plan from the last good read, or null. */
export function cachedSchedules(monthLabel) {
  const raw = read();
  const hit = raw && raw.months && raw.months[monthLabel || ''];
  if (!hit || !Array.isArray(hit.rows)) return null;
  return { rows: hit.rows, at: Number(hit.at) || 0 };
}

/* What the store figures are worked out from: plot capacity, tray sizes,
   the chemicals' own pump coverage and the preset. Small, and it changes
   about as often as the nursery is rebuilt — so it is kept, and a phone
   with no signal still shows the week's usage rather than nothing. */
export function cacheCapacity(c) {
  const now = read() || {};
  write({ ...now, capAt: Date.now(), cap: c || null });
}

export function cachedCapacity() {
  const raw = read();
  return (raw && raw.cap) || null;
}

/** The roster the record form credits work to. */
export function cacheWorkers(rows) {
  const now = read() || {};
  write({ ...now, workersAt: Date.now(), workers: rows || [] });
}

export function cachedWorkers() {
  const raw = read();
  if (!raw || !Array.isArray(raw.workers)) return null;
  return { rows: raw.workers, at: Number(raw.workersAt) || 0 };
}

export function cachedBatches() {
  const raw = read();
  if (!raw || !Array.isArray(raw.batches)) return null;
  return { map: new Map(raw.batches), at: Number(raw.batchesAt) || 0 };
}

/** When this phone last had a good read of the board, or 0 for never. */
export function cachedAt() {
  const raw = read();
  return (raw && Number(raw.at)) || 0;
}
