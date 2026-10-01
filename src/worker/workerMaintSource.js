/*
 * The Maintenance board's data, for somebody signed in with a PIN.
 *
 * It answers the same questions modules/maintenance/data.js answers, in the
 * same shapes, so the FC Portal's Maintenance module renders unchanged for a
 * worker — the same week card, the same month timeline, the same ticks. What
 * differs is underneath: a worker is `anon` and cannot read shared_plots,
 * nops_maint_field_records, nops_maint_state or nops_maint_published at
 * all, so every question goes to a worker_* database function which checks
 * the token and the boundary before it answers.
 *
 * Two things are deliberately NOT the same:
 *
 *   deleteRecord  refuses. Correcting a record already made is the office's
 *                 job, not the job of whoever happens to be holding a phone.
 *                 The module hides the control too, but a screen that hides a
 *                 button is not the same as a thing that cannot be done.
 *
 *   photos        go up through a TICKET rather than straight into the
 *                 bucket. See uploadPhotos below, and workerApi.photoTicket,
 *                 for why an `anon` sign-in cannot simply be given the
 *                 bucket.
 */

import { dataUrlToBlob } from '../lib/image.js';
import { supabase } from '../lib/supabase.js';
import { PERMANENT, flushOutbox, isOnline, listJobs, looksOffline, queueJob } from '../lib/outbox.js';
import { sortRecords, workTypeByKey } from '../modules/maintenance/helpers.js';
import { batchKey, plotKey } from '../modules/maintenance/plotBatches.js';
import { applicableSchedules } from '../modules/maintenance/schedule.js';
import { applyCompanySwitches } from '../lib/portalSettings.js';
import * as api from './workerApi.js';
import {
  cacheBatches, cacheData, cacheRoster, cacheSchedules,
  cachedBatches, cachedData, cachedRoster, cachedSchedules,
} from './workerOffline.js';

/* Its own queue kind, separate from the FC portal's 'maint_record'. The two
   can sit in one browser — a Field Conductor's phone that a worker borrowed —
   and a job queued by one must not be flushed by the other, which would send
   it under the wrong name and against the wrong boundary. */
export const WORKER_MAINT_JOB = 'worker_maint_record';

/** The record shape the module expects, from what the RPC returns. */
function asRecords(rows) {
  return sortRecords(rows || []);
}

/** batchMap: plot key → [{ batch, qty }], newest batch number last. */
function asBatchMap(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const pk = plotKey(r.plot_name);
    if (!pk) continue;
    if (!out.has(pk)) out.set(pk, []);
    out.get(pk).push({ batch: r.batch_name, qty: Number(r.qty || 0) });
  }
  out.forEach((list) => list.sort(
    (a, b) => (parseInt(batchKey(a.batch), 10) || 0) - (parseInt(batchKey(b.batch), 10) || 0)
  ));
  return out;
}

/** What the phone actually sends when a job is recorded. */
function payloadOf(args) {
  const { plot, workTypeKey, date, qty, chemical, remark, batches, weekNo, scheduleMonth,
          gps, photos } = args || {};
  const wt = workTypeByKey(workTypeKey);
  return {
    /* The pictures themselves, as data: URLs, and NOT part of the row.
       They travel in the queued job so a job recorded in a plot with no
       signal still has its photos when the phone walks back into coverage —
       which is the whole reason the outbox is IndexedDB and not
       localStorage. send() lifts them out and turns them into links before
       anything reaches the database. */
    photos: (photos || []).filter(Boolean),
    plot_name:  plot && plot.plot_name,
    work_type:  workTypeKey,
    jenis:      wt ? wt.jenis : null,
    work_date:  date,
    qty:        qty === '' || qty == null ? null : qty,
    chemical:   chemical || null,
    remark:     remark || null,
    batch_name: batches && batches.length ? batches.join(', ') : null,
    week_no:    weekNo || null,
    schedule_month: scheduleMonth || null,
    // The track walked, when the GPS switch is on for this worker and they
    // recorded one. worker_submit_maint writes these only if the columns are
    // there, so a database part way through the migrations still takes the job.
    gps_lat:        (gps && gps.lat) ?? null,
    gps_lng:        (gps && gps.lng) ?? null,
    gps_accuracy:   (gps && gps.accuracy) ?? null,
    gps_track:      (gps && gps.track) || null,
    gps_points:     (gps && gps.points) ?? null,
    gps_distance_m: (gps && gps.distance_m) ?? null,
    gps_started_at: (gps && gps.started_at) || null,
    gps_ended_at:   (gps && gps.ended_at) || null,
  };
}

/* Thrown when the office has photos switched off, or the database has not
   had RUN_ME_worker_photos.sql run over it yet. Not a network failure, so
   the job must not sit in the queue for ever waiting for one — the work goes
   in without the pictures and the worker is told which half is missing. */
const NO_PHOTOS = 'WORKER_PHOTOS_REFUSED';

/**
 * The pictures, up to the documents bucket, through a ticket.
 *
 * Three steps and each has a reason:
 *
 *   ask     worker_photo_ticket checks the token AND the photos switch, in
 *           the database, where a tampered-with app cannot argue. This is the
 *           gate; the camera button on the row is only a courtesy.
 *   upload  into worker_photos/<ticket>/ — the only path in the bucket that
 *           an `anon` sign-in can write, and only while the ticket lives.
 *   burn    worker_photo_done, so the ten-minute window closes in seconds.
 *
 * Best effort per PICTURE, like the FC portal's own uploader: one photo that
 * will not go up is left out rather than losing the record it belongs to. A
 * refused TICKET is different and is raised, because that is the office
 * having said no and it has to be visible.
 */
async function uploadPhotos(token, dataUrls, { plot_name, work_type, work_date }) {
  let ticket;
  try {
    ticket = await api.photoTicket(token);
  } catch (e) {
    if (looksOffline(e)) throw e;                 // try the whole job again later
    throw new Error(NO_PHOTOS);
  }
  if (!ticket) throw new Error(NO_PHOTOS);

  const safe = (s) => String(s || '').replace(/[^0-9A-Za-z_-]+/g, '_');
  const stem = `${safe(work_date)}_${safe(plot_name)}_${safe(work_type)}`;
  const urls = [];
  try {
    for (let i = 0; i < dataUrls.length; i++) {
      try {
        // .jpg, because the storage rule insists on it — a bucket that can be
        // handed anything by an anonymous caller is a bucket that will be.
        const path = `worker_photos/${ticket}/${stem}_${Date.now()}_${i}.jpg`;
        const { error } = await supabase.storage.from('documents')
          .upload(path, dataUrlToBlob(dataUrls[i]), { contentType: 'image/jpeg', upsert: true });
        if (error) { console.warn('[worker-maint] photo upload failed:', error.message); continue; }
        const { data } = supabase.storage.from('documents').getPublicUrl(path);
        if (data && data.publicUrl) urls.push(data.publicUrl);
      } catch (e) {
        console.warn('[worker-maint] photo upload failed:', e);
      }
    }
  } finally {
    await api.photoDone(token, ticket);
  }
  return urls;
}

export function makeWorkerMaintSource(token, workerId = null) {
  /**
   * One job, sent: the pictures up to storage, then the row that links to
   * them. Used by submitRecord and again by the flush, so a record made with
   * no signal takes exactly the same path when it finally goes.
   *
   * Answers whether the photos had to be left behind, rather than throwing
   * over them — the WORK is the thing being recorded, and a picture that
   * cannot be attached must not cost somebody their morning.
   */
  async function send(payload) {
    const { photos, ...row } = payload || {};
    const fresh   = (photos || []).filter((u) => u && String(u).startsWith('data:'));
    const already = (photos || []).filter((u) => u && !String(u).startsWith('data:'));

    let urls = already;
    let dropped = false;
    if (fresh.length) {
      try {
        urls = already.concat(await uploadPhotos(token, fresh, row));
      } catch (e) {
        if (e && e.message === NO_PHOTOS) {
          console.warn('[worker-maint] photos are switched off, or not migrated — recording without them');
          dropped = true;
        } else {
          throw e;                                 // offline: the whole job waits
        }
      }
    }
    await api.submitMaintenance(token, {
      ...row,
      photo_urls: urls.length ? urls.join(',') : null,
    });
    return { dropped };
  }

  return {
    /* The list, and what has already been done against it.
     *
     * Kept on the phone after every good read and served from there when the
     * network cannot answer. Without this a worker who reopened the portal in
     * a plot was shown an empty list under "Everything on the plan is done.
     * Well done." — which is not a blank screen, it is a wrong instruction,
     * and this screen IS the instruction.
     *
     * `fromCache` lets the list say which it is showing. A REFUSAL is still
     * raised: "you are not signed in", "the module is switched off for you"
     * are answers the worker has to be given, and covering them with
     * yesterday's copy would hide a supervisor's decision behind a screen
     * that looks like it is working. */
    async loadData() {
      const fallback = () => {
        const hit = cachedData(workerId);
        return {
          plots: (hit && hit.plots) || [],
          records: asRecords((hit && hit.records) || []),
          fromCache: true,
          cachedAt: (hit && hit.at) || 0,
        };
      };
      if (!isOnline()) return fallback();
      try {
        const [plots, records] = await Promise.all([
          api.plots(token),
          api.maintRecords(token, 500),
        ]);
        const out = { plots: plots || [], records: asRecords(records) };
        cacheData(workerId, out);
        return out;
      } catch (e) {
        if (looksOffline(e)) return fallback();
        throw e;
      }
    },

    async loadPlotBatches() {
      const fallback = () => (cachedBatches(workerId) || { map: new Map() }).map;
      if (!isOnline()) return fallback();
      try {
        const map = asBatchMap(await api.plotBatches(token));
        cacheBatches(workerId, map);
        return map;
      } catch (e) {
        if (looksOffline(e)) return fallback();
        // The office's balance view may not exist yet. The board copes with
        // no batches; it must not fail to open over it.
        console.warn('[worker-maint] batches unavailable:', e && e.message);
        return new Map();
      }
    },

    /* The module asks for named nurseries and a month. Which nurseries is
       already decided by the boundary, so that argument is ignored here — but
       the month is not, and neither is what has to happen to the rows before
       the board can read them.

       applicableSchedules is the same step data.js takes on the FC side: it
       picks the plan that applies (the office carries a plan forward without
       writing a row, so the newest month at or before this one wins) and
       migrates payloads saved under the older manuring/inter-row shape.
       Returning the raw rows instead left every week chip empty, because the
       board was handed a shape it does not read. */
    async loadSchedules(_keys, monthLabel) {
      /* The plan matters more here than anywhere: it IS the to-do list. Lose
         it and the screen has nothing to put on the list, and says the period
         is clear. Cached per month, which is the unit the board asks for. */
      const fallback = () => (cachedSchedules(workerId, monthLabel) || { rows: [] }).rows;
      if (!isOnline()) return fallback();
      try {
        const rows = applicableSchedules(await api.schedules(token), monthLabel);
        cacheSchedules(workerId, monthLabel, rows);
        return rows;
      } catch (e) {
        if (looksOffline(e)) return fallback();
        console.warn('[worker-maint] schedules unavailable:', e && e.message);
        return [];
      }
    },

    /* Offline goes straight to the queue; online is tried and only queued if
       the attempt failed for a reason a retry could fix. A worker in a plot
       with no signal gets an answer immediately and never loses the morning.

       A refusal — outside your boundary, module switched off — is NOT such a
       reason, and is raised so the worker is told now rather than finding out
       nothing was ever recorded. */
    async submitRecord(args) {
      const payload = payloadOf(args);
      if (!isOnline()) {
        await queueJob(WORKER_MAINT_JOB, payload);
        return { queued: true };
      }
      try {
        const { dropped } = await send(payload);
        return { queued: false, photosDropped: dropped };
      } catch (e) {
        if (looksOffline(e)) {
          await queueJob(WORKER_MAINT_JOB, payload);
          return { queued: true };
        }
        throw e;
      }
    },

    /* The colleagues this worker may credit a job to.
     *
     * This used to be null — no roster for a PIN sign-in at all — on the
     * reasoning that a worker recording their own morning has already
     * answered the question, and a list of colleagues is a way to credit work
     * to the wrong person. That is a judgement about how a nursery is run,
     * not a fact about the software, and it is the office's to make: it is a
     * switch now, in System Setting and on the worker's own row, and this
     * just answers when asked.
     *
     * Names only, and only inside the boundary — worker_maint_roster, not the
     * Settings screen's roster. The module asks only when the `workers`
     * switch is on, and a database without the function simply has no tick
     * list rather than a broken form.
     */
    /* One record's walked line, fetched only when somebody opens that job.
       A database that has not run RUN_ME_worker_track_view.sql simply has no
       function to call, and the summary then shows the distance without the
       map rather than failing to open. */
    async loadTrack(id) {
      try {
        return await api.maintTrack(token, id);
      } catch (e) {
        console.warn('[worker-maint] track unavailable:', e && e.message);
        return null;
      }
    },

    async loadWorkers() {
      const fallback = () => (cachedRoster(workerId) || { rows: [] }).rows;
      if (!isOnline()) return fallback();
      try {
        const rows = await api.maintRoster(token);
        cacheRoster(workerId, rows || []);
        return rows;
      } catch (e) {
        if (looksOffline(e)) return fallback();
        console.warn('[worker-maint] roster unavailable:', e && e.message);
        return [];
      }
    },

    deleteRecord() {
      return Promise.reject(new Error('Only the office can remove a record.'));
    },

    flushQueue() {
      return flushOutbox({
        [WORKER_MAINT_JOB]: async (payload) => {
          try {
            // The same send() the online path uses, so the photos a worker
            // attached in a plot with no signal go up when the signal comes
            // back rather than being dropped on the way out of the queue.
            await send(payload);
          } catch (e) {
            if (looksOffline(e)) throw e;          // try again later
            throw new Error(PERMANENT);            // the database refused it
          }
        },
      });
    },

    async pending() {
      const jobs = await listJobs();
      return jobs.filter((j) => j.kind === WORKER_MAINT_JOB);
    },
  };
}

/* What the module's access checks should conclude about a worker.
 *
 * Built here rather than special-casing lib/access.js: the rules there are
 * the rules, and a worker's boundary is just another way of arriving at the
 * same two answers — which nurseries, and which actions.
 *
 *   record   yes, that is the whole point of the portal — unless a supervisor
 *            has switched it off in the Worker Portal's Settings
 *   edit     no, and `delete` likewise. Both are answered here rather than
 *            left absent, because an absent one now falls back to "is this an
 *            Operation admin" and a worker must not depend on that staying
 *            false. There is no worker_* function to change or remove a record
 *            with either, so the buttons would fail on the phone.
 *   export   no; a worker does not need the nursery's month as a spreadsheet
 *
 * `actions` is the worker's own row of switches — portal.actions.maintenance,
 * set per worker in Settings, the same keys the office sets per Field
 * Conductor. It goes in LAST so a supervisor's answer wins, and anything not
 * set there is left absent so functions.js can apply the documented default
 * rather than this file inventing a second one.
 *
 * `workers` used to be forced off here and is not any more — the tick list is
 * the office's decision, and worker_maint_roster answers it with names inside
 * the boundary and nothing else.
 *
 * `photos` was forced off here too, and that was not a judgement either: there
 * was no upload path for a PIN sign-in at all, because the documents bucket
 * takes uploads from `authenticated` and a worker is `anon` with a public
 * key. There is one now — a ticket, minted by the database against the
 * worker's own token and good for one folder for ten minutes. See
 * uploadPhotos above and shared/RUN_ME_worker_photos.sql. So the switch is
 * left alone and answered honestly, which is what it looked like it did all
 * along.
 */
export function workerPermissions(boundary, actions, company) {
  const nurseries = boundary && boundary.nurseries;
  const a = (actions && actions.maintenance) || {};
  const built = {
    manage_users: false,
    modules: {},
    scan_nurseries: Array.isArray(nurseries) ? { maintenance: nurseries } : {},
    scan_actions: {
      maintenance: {
        ...a,
        view: true,
        record: a.record === false ? false : true,
        edit: false,
        delete: false,
        export: false,
      },
    },
  };
  /* And then the company's own vetoes over the top of all of it — the switches
     on System Setting → Portal View & Function, which reach this phone with
     the sign-in because `anon` cannot read that table for itself. Off beats
     on, so this can only ever take something away. */
  return applyCompanySwitches(built, company);
}

/* The plot half of a boundary, as a predicate. null means every plot in the
   allowed nurseries, which is what most workers have. */
export function workerPlotFilter(boundary) {
  const plots = boundary && boundary.plots;
  if (!Array.isArray(plots)) return null;
  const keys = new Set(plots.map((n) => plotKey(n)));
  return (plotName) => keys.has(plotKey(plotName));
}
