// Data layer for the Maintenance module. Pure helpers live in helpers.js
// (no imports there, so they stay unit-testable in plain node).

import { dataUrlToBlob } from '../../lib/image.js';
import { PERMANENT, flushOutbox, isOnline, listJobs, looksOffline, queueJob } from '../../lib/outbox.js';
import {
  cacheBatches, cacheData, cacheSchedules, cacheWorkers,
  cachedBatches, cachedData, cachedSchedules, cachedWorkers,
} from './offline.js';
import { fetchAllRows, supabase } from '../../lib/supabase.js';
import { sortRecords, workTypeByKey } from './helpers.js';
import { batchKey, batchesByPlot, plotKey } from './plotBatches.js';
import { applicableSchedules } from './schedule.js';

export {
  WORK_TYPES,
  allowedNurseries,
  canMaintain,
  sortRecords,
  toCsv,
  todayStr,
  workTypeByKey,
  workTypeLabel,
} from './helpers.js';
export { isModuleAdmin, nurseryKey } from '../../lib/access.js';

/** Raised when the table has not been created yet, so the UI can say which
    SQL to run instead of showing a raw PostgREST error. */
export const SETUP_NEEDED = 'SETUP_NEEDED';

/** Raised when the verify columns have not been added yet. */
export const VERIFY_SETUP_NEEDED = 'VERIFY_SETUP_NEEDED';

/** Raised when the batch/week columns have not been added yet. */
export const BATCH_SETUP_NEEDED = 'BATCH_SETUP_NEEDED';

function isMissingColumn(error) {
  return /column .* does not exist|Could not find the '.*' column/i.test(
    String((error && error.message) || '')
  );
}

function isMissingTable(error) {
  const m = String((error && error.message) || '');
  return /relation .* does not exist|Could not find the table|schema cache/i.test(m);
}

/** Told no, as opposed to not answered — a setup problem, not a wobble. */
function isPermissionDenied(error) {
  const m = String((error && error.message) || '');
  const code = String((error && error.code) || '');
  return code === '42501' || /permission denied|not authori[sz]ed|insufficient privilege/i.test(m);
}

/* What to answer when the network cannot be reached: the last good read, and
   a flag saying so. `fromCache` is what lets the board say "showing what was
   last loaded" instead of drawing an empty week as though it were an empty
   plan. A phone that has never had a good read answers with nothing AND
   fromCache true — "nothing has been loaded onto this phone" is still a
   different sentence from "there is nothing to do". */
function offlineData() {
  const hit = cachedData();
  return {
    plots: (hit && hit.plots) || [],
    records: sortRecords((hit && hit.records) || []),
    fromCache: true,
    cachedAt: (hit && hit.at) || 0,
  };
}

export async function loadMaintenanceData() {
  // No signal at all: do not even try. The failure takes seconds the person
  // standing in the plot does not have.
  if (!isOnline()) return offlineData();

  const [plotsRes, recRes] = await Promise.all([
    supabase.from('shared_plots').select('nursery_name, plot_name').order('plot_name'),
    // Recent work is all a Field Conductor needs on a phone; the office keeps
    // the full history.
    supabase
      .from('nops_maint_field_records')
      .select('*')
      .order('work_date', { ascending: false })
      .limit(500),
  ]);
  /* A dropped connection falls back; a REFUSAL does not. "The table is not
     there" and "you are not allowed" are things the person has to be told,
     and answering them with yesterday's copy would hide a broken deploy
     behind a screen that looks like it is working. */
  if (plotsRes.error) {
    if (looksOffline(plotsRes.error)) return offlineData();
    throw plotsRes.error;
  }
  if (recRes.error) {
    if (looksOffline(recRes.error)) return offlineData();
    if (isMissingTable(recRes.error)) throw new Error(SETUP_NEEDED);
    throw recRes.error;
  }
  const out = {
    plots: plotsRes.data || [],
    records: sortRecords(recRes.data || []),
  };
  cacheData(out);
  return out;
}

/**
 * Photos of the work, into the shared `documents` bucket.
 *
 * They arrive already shrunk (see lib/image.js) — a phone hands over several
 * megabytes and what is kept is a couple of hundred kilobytes. Object storage
 * rather than a column in the database: these are files, and the database has
 * a disk to protect.
 *
 * Best effort per photo. One that will not upload is left out rather than
 * losing the record it belongs to — a Field Conductor should not be made to
 * key the job again because the signal dropped on a picture.
 */
export async function uploadMaintPhotos(dataUrls, { plot, workTypeKey, date }) {
  const urls = [];
  for (let i = 0; i < (dataUrls || []).length; i++) {
    try {
      const safe = (s) => String(s || '').replace(/[^0-9A-Za-z_-]+/g, '_');
      const path = `maint_photos/${safe(date)}/${safe(plot)}_${safe(workTypeKey)}_${Date.now()}_${i}.jpg`;
      const { error } = await supabase.storage
        .from('documents')
        .upload(path, dataUrlToBlob(dataUrls[i]), { contentType: 'image/jpeg', upsert: true });
      if (error) { console.warn('[maintenance] photo upload failed:', error.message); continue; }
      const { data } = supabase.storage.from('documents').getPublicUrl(path);
      if (data && data.publicUrl) urls.push(data.publicUrl);
    } catch (e) {
      console.warn('[maintenance] photo upload failed:', e);
    }
  }
  return urls;
}

/**
 * A queued record, in the shape of the database row it is going to become.
 *
 * The work HAS been done — only the upload is outstanding — so anything
 * counting or listing work has to see it, or a Field Conductor offline is
 * told a plot is still due and does it twice.
 */
export function queuedAsRecord(job) {
  const a = (job && job.payload) || {};

  /* Two portals queue two shapes, and this has to read both.
   *
   * The FC portal parks the arguments it was called with — { plot: {…},
   * workTypeKey, date, weekNo }. The Worker Portal parks the finished database
   * row instead, because its RPC takes exactly that (workerMaintSource's
   * payloadOf). Read only the first shape, a worker's queued job came back
   * with plot_name undefined and work_type undefined, so isDone matched
   * nothing: a worker who finished a plot with no signal was shown it as still
   * due and did it again. The row shape is already the answer, so it is
   * carried through rather than translated. */
  if (a.plot_name !== undefined || a.work_type !== undefined) {
    return {
      id: a.id != null ? a.id : 'pending:' + (job && job.uid),
      _pendingEdit: a.id != null,
      _pending: true,
      ...a,
    };
  }

  return {
    // A queued EDIT keeps the id of the row it is changing, so it stands in
    // place of that row rather than appearing beside it as a second copy.
    id: a.id != null ? a.id : 'pending:' + (job && job.uid),
    _pendingEdit: a.id != null,
    _pending: true,
    work_date: a.date,
    plot_name: a.plot && a.plot.plot_name,
    nursery_name: a.plot && a.plot.nursery_name,
    work_type: a.workTypeKey,
    chemical: a.chemical || null,
    qty: a.qty ?? null,
    remark: a.remark || null,
    reported_by: a.reportedBy || null,
    batch_name: (a.batches || []).join(', '),
    week_no: a.weekNo || null,
    schedule_month: a.scheduleMonth || null,
    photo_urls: (a.photos || []).join(','),
    gps_lat: (a.gps && a.gps.lat) ?? null,
    gps_lng: (a.gps && a.gps.lng) ?? null,
    gps_accuracy: (a.gps && a.gps.accuracy) ?? null,
    gps_points: (a.gps && a.gps.points) ?? null,
    gps_distance_m: (a.gps && a.gps.distance_m) ?? null,
  };
}

/** Saved rows plus whatever the outbox is still holding, edits standing in
    place of the row they change rather than doubling it. */
export function withQueued(records, jobs) {
  const queued = (jobs || []).map(queuedAsRecord);
  const editedIds = new Set(queued.filter((r) => r._pendingEdit).map((r) => r.id));
  return [...queued, ...(records || []).filter((r) => !editedIds.has(r.id))];
}

/* The kind of job the outbox holds for this module. */
export const MAINT_JOB = 'maint_record';

/**
 * Save a record, signal or no signal.
 *
 * Offline it goes straight to the queue; online it is tried and only queued
 * if the attempt failed for a reason a retry could fix. Either way the Field
 * Conductor gets an answer immediately and never loses the work.
 *
 * Returns { queued } so the screen can say which happened.
 */
export async function submitRecord(args) {
  if (!isOnline()) {
    await queueJob(MAINT_JOB, args);
    return { queued: true };
  }
  try {
    await sendRecord(args);
    return { queued: false };
  } catch (e) {
    if (e && e.message === BATCH_SETUP_NEEDED) throw e;   // saved; only columns missing
    if (looksOffline(e)) {
      await queueJob(MAINT_JOB, args);
      return { queued: true };
    }
    throw e;
  }
}

/**
 * Everything a queued record needs doing, in order: the photos up to storage,
 * then the row. Used by submitRecord and, later, by the flush.
 */
export async function sendRecord(args) {
  const { photos, ...rest } = args || {};
  const already  = (photos || []).filter((u) => u && !String(u).startsWith('data:'));
  const fresh    = (photos || []).filter((u) => u && String(u).startsWith('data:'));
  const uploaded = fresh.length
    ? await uploadMaintPhotos(fresh, { plot: rest.plot && rest.plot.plot_name, workTypeKey: rest.workTypeKey, date: rest.date })
    : [];
  await saveRecord({ ...rest, photoUrls: [...already, ...uploaded] });
}

/** Send everything the queue is holding. */
export function flushMaintenance() {
  return flushOutbox({
    [MAINT_JOB]: async (payload, uid) => {
      try {
        await sendRecord({ ...payload, clientUid: uid });
      } catch (e) {
        // A row this uid already wrote — the last flush was cut off between
        // the server taking it and the queue letting go of it.
        if (/duplicate key|already exists|23505/i.test(String((e && e.message) || ''))) return;
        if (looksOffline(e)) throw e;                 // try again later
        throw new Error(PERMANENT);                   // the server refused it
      }
    },
  });
}

/** What is still waiting, so a screen can show it rather than lose it. */
export async function pendingRecords() {
  const jobs = await listJobs();
  return jobs.filter((j) => j.kind === MAINT_JOB);
}

/** Create or update one record. `id` present = update. */
export async function saveRecord({ id, plot, workTypeKey, date, qty, chemical, remark, reportedBy,
                                   workedBy, batches, weekNo, scheduleMonth, photoUrls, gps,
                                   clientUid }) {
  const wt = workTypeByKey(workTypeKey);
  const row = {
    work_date: date,
    nursery_name: (plot && plot.nursery_name) || null,
    plot_name: plot.plot_name,
    work_type: workTypeKey,
    // The office's own wording, stored alongside, so the two systems can be
    // matched up without re-deriving it there.
    jenis: wt ? wt.jenis : null,
    chemical: chemical || null,
    qty: qty === '' || qty == null ? null : Number(qty),
    remark: remark || null,
    reported_by: reportedBy || null,
    updated_at: new Date().toISOString(),
  };
  // Which batches were standing in the plot, and which slot of the schedule
  // the job answers. Sent only when there is something to say, so a record
  // made the old way still saves against a table without these columns.
  const extra = {};
  if (batches && batches.length) extra.batch_name = batches.join(', ');
  if (weekNo) extra.week_no = weekNo;
  if (scheduleMonth) extra.schedule_month = scheduleMonth;
  if (photoUrls && photoUrls.length) extra.photo_urls = photoUrls.join(',');
  // Written by a queued record so a repeated flush is refused by the unique
  // index rather than saving the same morning's work twice.
  if (clientUid) extra.client_uid = clientUid;
  /* Who actually did the job, when the conductor keyed it for somebody else.
     Sent only when there is something to say, so a record made the ordinary
     way still saves against a table without the column. */
  if (workedBy && workedBy.length) extra.worked_by = workedBy.join(', ');
  /* The track walked while the job was done, when the GPS switch is on for
     this person and they actually recorded one. Columns from
     shared/add_maint_field_gps.sql; a database without them falls into the
     retry below and the job itself still saves.

     The summary is written into its own columns beside the track rather than
     being worked out from it later: the office lists a nursery's month, and
     adding up a thousand points per row to show one distance is not a query
     anybody wants to run. */
  if (gps && gps.lat != null && gps.lng != null) {
    extra.gps_lat = gps.lat;
    extra.gps_lng = gps.lng;
    if (gps.accuracy != null)   extra.gps_accuracy   = gps.accuracy;
    if (gps.track)              extra.gps_track      = gps.track;
    if (gps.points != null)     extra.gps_points     = gps.points;
    if (gps.distance_m != null) extra.gps_distance_m = gps.distance_m;
    if (gps.started_at)         extra.gps_started_at = gps.started_at;
    if (gps.ended_at)           extra.gps_ended_at   = gps.ended_at;
  }

  const run = (payload) => (id
    ? supabase.from('nops_maint_field_records').update(payload).eq('id', id)
    : supabase.from('nops_maint_field_records').insert(payload));

  let { error } = await run({ ...row, ...extra });
  // The columns are added by shared/add_maint_field_batch.sql. Until someone
  // runs it, save the job itself rather than losing a morning's work — and
  // say so, so the SQL actually gets run.
  if (error && Object.keys(extra).length && isMissingColumn(error)) {
    const retry = await run(row);
    if (retry.error) throw retry.error;
    throw new Error(BATCH_SETUP_NEEDED);
  }
  if (error) throw error;
}

/**
 * Has this record been checked, sent back, or neither?
 *
 * Three columns say it — verified_at, rejected_at, and nothing — and exactly
 * one of them is set at a time. See shared/add_maint_field_verify.sql and
 * shared/add_maint_field_reject.sql in the office repository.
 */
export function verifyState(r) {
  if (!r) return 'awaiting';
  if (r.rejected_at) return 'rejected';
  if (r.verified_at) return 'verified';
  return 'awaiting';
}

/** Still waiting for a conductor to look at it. A record on its way up from a
    phone is not in the deck: there is nothing to sign for until it lands. */
export const awaitingVerify = (rows) =>
  (rows || []).filter((r) => !r._pending && verifyState(r) === 'awaiting');

/**
 * What the database can hold an answer in.
 *
 * Read off a row rather than asked of the server: the caller already has the
 * records, and a column that exists comes back as a key whether or not it is
 * set. With no records at all there is nothing to verify either way.
 *
 * TWO questions, deliberately. Signing needs verified_at, which
 * shared/add_maint_field_verify.sql has been adding for months. Sending back
 * needs rejected_at, which arrived later with
 * shared/add_maint_field_reject.sql. Asking them as one question emptied the
 * whole hub on every database that had run only the first file — the
 * morning's work was there, and the conductor was shown nothing.
 */
export function hasVerifyColumns(rows) {
  const r = (rows || []).find((x) => x && !x._pending);
  return !!r && 'verified_at' in r;
}

export function hasRejectColumns(rows) {
  const r = (rows || []).find((x) => x && !x._pending);
  return !!r && 'rejected_at' in r;
}

/**
 * The office's schedule for a nursery and month, and the batches currently
 * standing in each plot. Both feed the week timeline.
 *
 * A missing schedule is not an error — the office simply has not planned that
 * month yet — so it comes back as null and the timeline says as much.
 */
export async function loadSchedules(nurseryKeys, monthLabel) {
  const keys = (nurseryKeys || []).filter(Boolean);
  if (!keys.length) return [];

  /* The plan matters most of all offline: it is the LIST OF WORK, and
     without it the week card draws four empty jobs and says everything is
     done. Cached per month, because that is the unit the board asks for and
     a conductor may page back to last month's while standing in a plot. */
  const fallback = () => (cachedSchedules(monthLabel) || { rows: [] }).rows;
  if (!isOnline()) return fallback();

  // Every month this nursery has ever had a plan for, not just this one: the
  // office carries a plan forward without writing a row until it is saved, so
  // the applicable month has to be worked out here. There is at most one row
  // per nursery per month, so this stays small.
  const { data, error } = await supabase
    .from('nops_maint_state')
    .select('nursery, month, payload')
    .in('nursery', keys);
  if (error) {
    if (looksOffline(error)) return fallback();
    if (isMissingTable(error)) return [];
    throw error;
  }
  /* applicableSchedules picks the plan that applies and migrates the older
     payload shapes. Its OUTPUT is cached, not the raw rows: it is what the
     board reads, it is smaller, and doing the work once online beats doing
     it on a phone that is already struggling. */
  const rows = applicableSchedules(data || [], monthLabel);
  cacheSchedules(monthLabel, rows);
  return rows;
}

/**
 * What is standing in each plot.
 *
 * Postgres works this out in shared_plot_batch_balance — see
 * shared/create_plot_batch_balance.sql in the office repository. That turns
 * tens of thousands of ledger rows crossing the network into one row per
 * plot·batch, which is the difference between a phone downloading the whole
 * nursery's history and asking a question.
 *
 * Until that view exists the old way still works, so the app is never
 * waiting on a migration to be run.
 */
export async function loadPlotBatches() {
  /* What is standing in each plot, so the record form can offer the batches
     rather than ask somebody to type one. Cached like the rest: without it
     the form still saves, but the batch has to be remembered rather than
     picked, which is exactly the typing this module exists to avoid. */
  const fallback = () => (cachedBatches() || { map: new Map() }).map;
  if (!isOnline()) return fallback();

  const view = await fetchAllRows(() => supabase
    .from('shared_plot_batch_balance')
    .select('plot_key, plot_name, batch_name, qty')
    .order('plot_key', { ascending: true }));
  if (!view.error) {
    const map = mapFromBalances(view.data || []);
    cacheBatches(map);
    return map;
  }
  if (looksOffline(view.error)) return fallback();

  /* The long way round is for a view that is NOT THERE — never created, not
     granted, renamed. It is emphatically NOT for a view that merely failed to
     answer, and it used to be used for both.

     That mattered, because of when it fires. A database under strain is
     exactly when the view read fails, and the old rule answered a failure by
     paging the ENTIRE inventory ledger — tens of thousands of rows, a
     thousand at a time — from every phone that opened Maintenance. So the
     moment the database started struggling, every Field Conductor's phone
     began doing the single most expensive thing this module knows how to do.
     A wobble became a stampede, and the stampede kept the wobble going.

     A missing view is a permanent condition and a one-off cost, and still
     takes the long way. A failure is transient and is raised: the caller
     already draws a board with no batches, which is a form a conductor can
     still work with — and the read is retried next time it is opened rather
     than a hundred times in the same minute. */
  if (!isMissingTable(view.error) && !isPermissionDenied(view.error)) {
    console.warn('[maintenance] plot balances could not be read, and the ledger is ' +
      'not a substitute for a database that is already struggling:', view.error.message);
    throw view.error;
  }

  console.warn('[maintenance] plot balance view is not there, reading the ledger:',
    view.error.message);
  const map = await loadPlotBatchesFromLedger();
  cacheBatches(map);
  return map;
}

/** The view's rows in the shape the form already expects. */
function mapFromBalances(rows) {
  const out = new Map();
  for (const r of rows) {
    const pk = r.plot_key || plotKey(r.plot_name);
    if (!pk) continue;
    if (!out.has(pk)) out.set(pk, []);
    out.get(pk).push({ batch: r.batch_name, qty: Number(r.qty || 0) });
  }
  // Ordered by batch number, so the list reads against the office movement
  // report row for row.
  out.forEach((list) => list.sort(
    (a, b) => (parseInt(batchKey(a.batch), 10) || 0) - (parseInt(batchKey(b.batch), 10) || 0)
  ));
  return out;
}

/** The whole ledger, added up here. Only for a database without the view. */
async function loadPlotBatchesFromLedger() {
  const [logsRes, dosRes] = await Promise.all([
    fetchAllRows(() => supabase.from('shared_inventory_logs')
      .select('transaction_type, plot_name, batch_name, quantity_change, remark')
      .in('transaction_type', ['Seeds_Received', 'Planted', 'Transplanted',
        'Transplanted_Premium', 'Transplanted_DoubleTone', 'Damaged_Seeds',
        '1st_Culling', '2nd_Culling', '3rd_Culling', 'Cull3_Transfer'])
      .order('id', { ascending: true })),
    fetchAllRows(() => supabase.from('shared_do_records')
      .select('status, remark, plot_1, qty_1, batch_1, plot_2, qty_2, batch_2, plot_3, qty_3, batch_3, plot_4, qty_4, batch_4, plot_5, qty_5, batch_5')
      .order('id', { ascending: true }))
      .then((r) => r, () => ({ data: [] })),
  ]);
  if (logsRes.error) throw logsRes.error;
  return batchesByPlot(logsRes.data || [], (dosRes && dosRes.data) || []);
}

/**
 * A Field Conductor's signature on a record.
 *
 * Workers record their own morning, so a record is a claim until somebody who
 * answers for the plot has looked at it. This is that: a name and a time, and
 * nothing else changes — the work still counts for the week either way.
 *
 * Passing null un-verifies, for the times it was pressed on the wrong row.
 *
 * Columns from shared/add_maint_field_verify.sql. A database without them
 * says so plainly rather than failing with PostgREST's wording, because the
 * fix is to run one file.
 */
/**
 * The workers a Field Conductor may credit a job to: the payroll register,
 * filtered to his nurseries by the caller.
 *
 * This is the same roster the 555 Worker Portal signs people in against, so a
 * name a conductor ticks here and a name a worker records under themselves
 * are the same string. Two rosters would mean two spellings of one person,
 * and nothing downstream could add them up.
 *
 * NOTE the select list. `pin` is a column on this table and is NEVER asked
 * for: a PIN is a door number the office hands out, and no screen outside the
 * Payroll register has business holding one. Do not add it.
 *
 * A database without the payroll module returns nothing, and the tick list
 * simply does not appear.
 */
export async function loadWorkers() {
  /* The colleagues a job can be credited to. Cached with the rest, because
     "record offline" has to mean the WHOLE form: without this the tick list
     is empty in the plot, and the conductor either credits nobody or keys a
     name — which is the typing the list exists to remove. */
  const fallback = () => (cachedWorkers() || { rows: [] }).rows;
  if (!isOnline()) return fallback();

  const { data, error } = await supabase
    .from('mjmnpayroll_workers')
    .select('id, worker_no, full_name, nursery, section, role, job_title, maint_general, active')
    .eq('active', true)
    .order('full_name');
  if (error) {
    if (looksOffline(error)) return fallback();
    if (isMissingTable(error)) return [];
    throw error;
  }
  const rows = data || [];
  cacheWorkers(rows);
  return rows;
}

/* One write for the whole answer, because it IS one answer: a record is
   waiting, verified, or sent back, and setting one of those means clearing
   the others. Leaving the old columns behind would give a row two answers at
   once, which no screen can read.

   The reject columns are shared/add_maint_field_reject.sql and arrived after
   the verify ones, so a database with only the older file still has to work:
   naming a column that is not there fails the whole update, and the tick a
   conductor has been pressing for weeks would stop. So the write is tried
   whole, and once more without the newer columns if that is what is missing.
   Only a database missing the verify columns too raises. */
async function writeVerification(id, full, verifyOnly) {
  const run = (patch) => supabase
    .from('nops_maint_field_records').update(patch).eq('id', id);

  let { error } = await run(full);
  if (error && isMissingColumn(error)) ({ error } = await run(verifyOnly));
  if (error) {
    if (isMissingColumn(error)) throw new Error(VERIFY_SETUP_NEEDED);
    throw error;
  }
}

/**
 * Which batches the work was actually done on, decided at verification.
 *
 * A worker records a plot; which of the batches standing in it he walked is
 * the conductor's answer, given while checking the record and not before —
 * he is the one who was there and knows. Stored the way the record form
 * stores it, comma-separated, so one column reads the same whoever filled it.
 *
 * Its own write rather than a field on setVerified: the batches are a fact
 * about the work and the signature is a fact about the checking, and a
 * conductor correcting the batches on a record he has already signed must not
 * have to un-sign it first.
 */
export async function setBatches(id, batchName) {
  const { error } = await supabase.from('nops_maint_field_records')
    .update({ batch_name: batchName || null }).eq('id', id);
  if (error) throw error;
}

/** Checked and signed for — or, with no name, back to waiting. */
export function setVerified(id, who) {
  const signed = who
    ? { verified_by: who, verified_at: new Date().toISOString() }
    : { verified_by: null, verified_at: null };
  return writeVerification(
    id,
    { ...signed, rejected_by: null, rejected_at: null, reject_reason: null },
    signed
  );
}

/**
 * Sent back, with the reason.
 *
 * The row stays and the work may well have been done — what is refused is the
 * RECORD of it. The FC Portal stops counting a rejected record towards the
 * week, so the plot goes back on the list as still outstanding, which is the
 * whole point of the button.
 *
 * There is no "verify only" fallback here: without the reject columns there
 * is nowhere to put this at all, so it says so rather than silently doing
 * half of it.
 */
export function setRejected(id, who, reason) {
  const patch = {
    rejected_by: who || null,
    rejected_at: new Date().toISOString(),
    reject_reason: reason || null,
    verified_by: null,
    verified_at: null,
  };
  return writeVerification(id, patch, patch);
}

export async function deleteRecord(id) {
  const { error } = await supabase.from('nops_maint_field_records').delete().eq('id', id);
  if (error) throw error;
}
