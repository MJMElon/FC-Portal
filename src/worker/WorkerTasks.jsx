import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../context/LanguageContext.jsx';
import { useAutoSync, useOnline } from '../hooks/useOnline.js';
import { withQueued } from '../modules/maintenance/data.js';
import { todayStr, workTypeByKey, workTypeLabel } from '../modules/maintenance/helpers.js';
import {
  daysInMonthLabel, monthLabelOf, weekOfDate,
} from '../modules/maintenance/schedule.js';
import { isReplantPlot, plotKey } from '../modules/maintenance/plotBatches.js';
import { tintOf } from '../modules/maintenance/tints.js';
import WorkIcon from '../modules/maintenance/WorkIcons.jsx';
import { useWorker } from './WorkerAuthContext.jsx';
import WorkerGround from './WorkerGround.jsx';
import WorkerNav from './WorkerNav.jsx';
import {
  makeWorkerMaintSource, workerPermissions, workerPlotFilter,
} from './workerMaintSource.js';
import { canMaintFn } from '../modules/maintenance/functions.js';
import { compressImage } from '../lib/image.js';
import { agoText } from '../lib/ago.js';
import { periodLabel, periodTasks, splitDone } from './workerTasks.js';
import DoneSheet from './DoneSheet.jsx';
import PocketMode from './PocketMode.jsx';
import TaskRow from './TaskRow.jsx';
import { useWorkerTrack } from './useWorkerTrack.js';

/* The map brings Leaflet with it, and Leaflet is most of a megabyte. Pulled
   down only when somebody asks to look — the same arrangement the FC Portal's
   GpsTrack uses, for the same reason. */
const TrackMap = lazy(() => import('../modules/maintenance/track/TrackMap.jsx'));

/**
 * The Worker Portal, as a to-do list.
 *
 * A worker signs in and sees the jobs the office asked for in the period they
 * are standing in — plot, work, chemical and dose — and finishes them by
 * swiping. There is no month planner, no nursery to pick, no form to fill in:
 * everything a record needs is already in the schedule, which is what makes
 * "zero typing" possible rather than a slogan.
 *
 * ── Why this is not MaintenanceModule with a flag ──
 *
 * It is the same DATA and the same rules — the same source, the same schedule
 * reader, the same isDone, the same outbox, the same access checks — and none
 * of that is re-implemented here. What differs is the shape of the screen, and
 * those are genuinely different jobs: a Field Conductor plans a month across
 * four weeks and several nurseries, a worker works down today's list. Bolting
 * a second full layout into an eleven-hundred-line component would have made
 * both harder to change than keeping the layouts apart and the rules shared.
 *
 * There is no full form behind this any more, and no way to reach one. It was
 * there for a job nobody scheduled, and it was the FC Portal's month planner
 * wearing this portal's ribbon — a second screen, with a second set of rules,
 * that a worker only ever arrived at by accident. Work that is not on the plan
 * is the office's to add to the plan.
 */
export default function WorkerTasks() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { token, worker, boundary, actions, company, modules } = useWorker();
  const online = useOnline();

  /* Keyed by worker, because a supervisor's handset gets passed round a gang
     and one man's plots must never be drawn into another man's list. */
  const source = useMemo(
    () => makeWorkerMaintSource(token, worker && worker.id), [token, worker]);
  const permissions = useMemo(
    () => workerPermissions(boundary, actions, company), [boundary, actions, company]);
  const plotFilter = useMemo(() => workerPlotFilter(boundary), [boundary]);

  const mayGps = canMaintFn(permissions, 'gps');
  const mayPhotos = canMaintFn(permissions, 'photos');

  const [plots, setPlots] = useState([]);
  const [records, setRecords] = useState([]);
  const [schedule, setSchedule] = useState([]);
  /* plotKey -> [{batch, qty}], read for one question only: which -R plots
     have seedlings standing. A Map so an absent read is an empty one. */
  const [batchMap, setBatchMap] = useState(() => new Map());
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);      // the task id being saved
  const [toast, setToast] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [pocket, setPocket] = useState(false);
  const [openDone, setOpenDone] = useState(null);   // a finished job, opened
  /* { at } when the list was drawn from the phone's own copy; at === 0 means
     this phone has never had a good read at all. */
  const [stale, setStale] = useState(null);
  /* Pictures taken for a job that has not been recorded yet, as data: URLs,
     keyed by task id. Held here rather than on the row so a re-render — a
     sync landing, the clock ticking a walk on — cannot lose them, and so
     they can be handed to submitRecord without the row having to know
     anything about how a record is sent. */
  const [photos, setPhotos] = useState({});
  const pickFor = useRef(null);                      // which task the picker is for
  const fileRef = useRef(null);

  /* Watching even while nothing is running, so the list knows how good the
     fix is BEFORE Start is pressed. Only asked for when this worker has GPS at
     all — nobody else's battery pays for a number they will never see. */
  const track = useWorkerTrack(mayGps);

  const today = todayStr();
  const month = monthLabelOf(today);
  const week = weekOfDate(today);

  const refreshPending = useCallback(async () => {
    try { setPending(await source.pending()); } catch (_) { setPending([]); }
  }, [source]);

  const reload = useCallback(async () => {
    try {
      /* The batch balances are read for ONE question: which of this worker's
         -R plots have seedlings standing. See periodTasks. It is its own
         promise rather than part of loadData because that read already has
         four callers and none of the others wants it — and because it must
         never be what stops the list drawing: loadPlotBatches swallows its
         own failure and answers an empty map, so a database with no balance
         view behaves exactly as this screen did before. */
      const [d, s, bm] = await Promise.all([
        source.loadData(),
        source.loadSchedules(null, month),
        source.loadPlotBatches(),
      ]);
      setPlots(d.plots);
      setRecords(d.records);
      setSchedule(s);
      setBatchMap(bm || new Map());
      /* Where the list came from. The screen looks identical either way, and
         that is exactly the problem it solves: an empty list drawn from a
         cache nobody has filled reads as "everything on the plan is done",
         which is the one thing this screen must never say by accident. */
      setStale(d.fromCache ? { at: d.cachedAt || 0 } : null);
      setError(null);
    } catch (e) {
      /* Offline is not an error here — the list is drawn from what was
         already read, and a worker in a plot with no signal still has one. */
      setError((e && e.message) || String(e));
    } finally {
      setLoading(false);
    }
  }, [source, month]);

  useEffect(() => { reload(); refreshPending(); }, [reload, refreshPending]);

  /* Anything the outbox is still holding counts as done. Without this a
     worker who finished a plot with no signal sees it back on the list and
     does it twice — which is the one failure this screen must not have. */
  const allRecords = useMemo(() => withQueued(records, pending), [records, pending]);

  /* Every -R plot of this worker's with something standing in it. `plots` is
     worker_plots — which carries the replant because the boundary does — and
     `batchMap` is worker_plot_batches, whose rows are already `qty > 0`. So
     "有苗" is read and never guessed, and the two lists are joined on the
     plot KEY rather than the spelling, because one is shared_plots own and
     the other is the balance view's. */
  const replantsStanding = useMemo(() => {
    const standing = new Set();
    batchMap.forEach((list, k) => {
      if ((list || []).some((b) => Number(b && b.qty) > 0)) standing.add(k);
    });
    return (plots || [])
      .map((p) => p && p.plot_name)
      .filter((n) => n && isReplantPlot(n) && standing.has(plotKey(n)));
  }, [plots, batchMap]);

  const tasks = useMemo(
    () => periodTasks(schedule, week, { plotFilter, replantsStanding }),
    [schedule, week, plotFilter, replantsStanding]);
  /* `me` is what decides whose repair a sent-back job is. It is the name on
     the worker's own row — the same string worker_submit_maint writes into
     reported_by — so the two are being compared like with like. */
  const { todo, done } = useMemo(
    () => splitDone(tasks, allRecords, { week, month, me: worker && worker.name }),
    [tasks, allRecords, week, month, worker]);

  const label = periodLabel(week, month, daysInMonthLabel(month));

  /* The record behind a finished task — the row the summary is drawn from.
     Matched the same way isDone matches, so a task shown as done always has
     one to open. Newest first, because a plot sprayed twice in a block should
     open on the spray that was just walked. */
  const recordFor = useCallback((task) => {
    const want = (r) =>
      r.work_type === task.workTypeKey
      && r.plot_name === task.plot
      && (!task.chemical || !r.chemical || r.chemical === task.chemical
          || String(r.chemical).indexOf(task.chemical) !== -1);
    const hits = allRecords.filter(want);
    return hits.length ? hits[0] : null;
  }, [allRecords]);

  /* Send what is queued, and re-read the board only if something went.
   *
   * The re-read is the expensive half — three RPCs over a nursery's signal —
   * and running it every minute whether or not anything was waiting would
   * turn the auto-sync below into a poll. Asking the queue first is a local
   * IndexedDB read, so a tick with nothing to send costs nothing and makes
   * no request at all. `force` is the Sync button, where somebody has asked
   * for a refresh and should get one. */
  const sync = useCallback(async (force = false) => {
    if (syncing) return;
    let waiting = [];
    try { waiting = await source.pending(); } catch (_) { waiting = []; }
    if (!waiting.length && !force) return;

    setSyncing(true);
    try { await source.flushQueue(); } catch (_) { /* try again next time */ }
    await refreshPending();
    await reload();
    setSyncing(false);
  }, [source, syncing, refreshPending, reload]);

  /* A quiet retry every minute, AND the moment the line comes back.
   *
   * It used to be a bare interval that only started once there was something
   * queued and the browser already thought it was online — so a worker
   * walking out of a plot with a morning's work on the phone waited up to a
   * minute after reconnecting before anything was sent, and if the tab was
   * reopened at exactly the wrong moment, longer. useAutoSync is the FC
   * portal's own rhythm: fire on mount, every minute while online, and
   * immediately on the browser's `online` event, which is the event that
   * actually means "there is a line now".
   *
   * Cheap to run with nothing queued — sync() asks the local IndexedDB
   * whether anything is waiting and returns without a request if not — so
   * there is no need to gate it on `pending`, and gating on it was how the
   * reconnect got missed. */
  useAutoSync(sync, 60000);

  /**
   * Finish a job: write the record the schedule already describes.
   *
   * Nothing is asked for, because nothing is missing. The plot, the work, the
   * chemical and its dose are the office's plan; the date is today, because
   * the job is being finished now; the name is whoever's PIN opened the app.
   * `gps` is the walk, when there was one.
   */
  /* ── The camera ────────────────────────────────────────────────────────
     One hidden input for the whole list rather than one per row: twenty
     jobs would otherwise mean twenty file inputs on a screen, and which
     job a picture belongs to is remembered here instead.

     `capture` opens the camera straight away. A worker photographing the
     work they are standing in is not going hunting through a gallery, and
     a phone that does not honour it falls back to the picker anyway. */
  const MAX_PHOTOS = 3;

  const askForPhoto = useCallback((task) => {
    const have = (photos[task.id] || []).length;
    if (have >= MAX_PHOTOS) {
      setToast(t('wk.photoMax', { n: MAX_PHOTOS }));
      setTimeout(() => setToast(null), 2600);
      return;
    }
    pickFor.current = task.id;
    if (fileRef.current) {
      fileRef.current.value = '';        // so the same picture twice still fires
      fileRef.current.click();
    }
  }, [photos, t]);

  const photoChosen = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    const id = pickFor.current;
    if (!file || !id) return;
    try {
      /* Shrunk on the phone, before it is kept anywhere. A camera hands over
         several megabytes and what a record needs is evidence the work was
         done — the same treatment, and the same helper, the FC Portal's own
         form gives a photo. */
      const small = await compressImage(file, { maxW: 1280, maxBytes: 300 * 1024 });
      setPhotos((was) => ({ ...was, [id]: (was[id] || []).concat(small).slice(0, MAX_PHOTOS) }));
    } catch (err) {
      setToast(t('wk.photoFailed'));
      setTimeout(() => setToast(null), 2600);
    }
  }, [t]);

  const dropPhoto = useCallback((taskId, i) => {
    setPhotos((was) => {
      const list = (was[taskId] || []).filter((_, n) => n !== i);
      const next = { ...was };
      if (list.length) next[taskId] = list; else delete next[taskId];
      return next;
    });
  }, []);

  /* Let go of a job's pictures once they are somewhere safer. Never called
     before the record is away — a failed save that had already emptied this
     would take the photos with it. */
  const dropAllPhotos = useCallback((taskId) => {
    setPhotos((was) => {
      if (!was[taskId]) return was;
      const next = { ...was };
      delete next[taskId];
      return next;
    });
  }, []);

  const complete = useCallback(async (task, gps = null) => {
    setBusy(task.id);
    const plot = plots.find((p) => p.plot_name === task.plot)
      || { plot_name: task.plot, nursery_name: task.nursery || null };
    const mine = photos[task.id] || [];
    // How long the toast stays up. Bad news is read more slowly than good.
    let linger = 2600;
    try {
      const { queued, photosDropped } = await source.submitRecord({
        plot,
        workTypeKey: task.workTypeKey,
        date: today,
        chemical: task.chemical || null,
        qty: null,
        remark: null,
        batches: [],
        weekNo: week,
        scheduleMonth: month,
        reportedBy: worker ? worker.name : '',
        workedBy: [],
        photos: mine,
        gps,
      });
      /* The job went in but the pictures did not — the office has photos
         switched off, or this database has not had the migration run over
         it. Said out loud rather than swallowed: a worker who photographed
         the work and is told only "saved" will believe the picture is on the
         record, and find out months later that it never was. */
      if (photosDropped) linger = 5000;
      setToast(photosDropped ? t('wk.doneNoPhotos', { plot: task.plot })
             : queued        ? t('wk.doneOffline', { plot: task.plot })
                             : t('wk.doneSaved', { plot: task.plot }));
      // Only once they are somewhere else — on the record, or in the queued
      // job — is it safe to stop holding them here.
      if (mine.length) dropAllPhotos(task.id);
      await refreshPending();
      if (!queued) await reload();
    } catch (e) {
      setToast((e && e.message) || t('wk.saveFailed'));
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), linger);
    }
  }, [plots, source, today, week, month, worker, t, refreshPending, reload, photos, dropAllPhotos]);

  /* Start does both: it begins the walk AND puts the phone away. Pressing two
     buttons to do one thing is two chances to press only the first, and the
     one that would be missed is the one that saves the battery. Coming back
     out is a hold, and Pocket is on the row for going in again. */
  const startTrack = (task) => {
    if (!mayGps) return;
    track.start({ workTypeKey: task.workTypeKey, plot: task.plot,
                  chemical: task.chemical, nursery: task.nursery });
    setPocket(true);
  };
  /* Stop saves. It is what the button is for: a walk nobody records is a
     battery spent on nothing. */
  const stopTrack = (task) => complete(task, track.stop());

  /* The map only ever looks. The walk is run from the row's own buttons, and
     the map is handed it so the line grows while it is watched — a second
     Start there would be a rival recording of the same job. */
  const live = track.session
    ? { points: track.session.points, distance: track.session.distance,
        startedAt: track.session.startedAt, running: track.running }
    /* An empty walk, not null. Null is what a FINISHED job's map is opened
       with — there the line comes from the record and the map must not be
       told to draw nothing over it. Opening the map from a row with nothing
       running is a different sentence, and it should read as one. */
    : { points: [], distance: 0, startedAt: null, running: false };

  const head = 'text-[10px] font-black text-slate-400 uppercase tracking-widest';

  return (
    <div className="min-h-screen bg-slate-100 fade-enter">
      {/* The FC Portal's page ribbon: the name on the left over the portal it
          belongs to, and the controls on the right. Not the dashboard's
          centred 555 book — that is the front of an app, and this is a screen
          inside one. */}
      <WorkerNav
        title={t('wk.tasksTitle')}
        onSettings={modules.settings ? () => navigate('/worker/settings') : null}
      />
      <WorkerGround />

      {/* A walk is running and the worker has come back to look at the list.
          This is the way back into the dark screen — the shape a phone uses
          for a call in progress, because it is the same situation: something
          is running that this screen is not showing.

          It replaced a fourth button on every row. Putting the phone away is
          not a property of one job among four; it is the state the phone is
          in, and it belongs at the top where that state is announced. */}
      {track.running && !pocket && (
        <button
          type="button"
          onClick={() => setPocket(true)}
          className="w-full bg-rose-700 active:bg-rose-800 text-white px-4 py-2.5
                     flex items-center gap-2.5 sticky top-0 z-20"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-white/90 animate-pulse shrink-0" />
          <span className="text-[11px] font-black uppercase tracking-widest truncate">
            {t('wk.backToPocket', { plot: track.session ? track.session.task.plot : '' })}
          </span>
        </button>
      )}

      <div className="max-w-[900px] mx-auto px-3 sm:px-6 py-3 space-y-3 pb-24">
        {/* The period, spelt out. A list with no dates on it is a list somebody
            will work through in the wrong week. */}
        <div className="flex items-baseline justify-between gap-2 pt-1">
          <span className={head}>{t('wk.thisPeriod')}</span>
          <span className="text-[12px] font-black text-slate-600 tabular-nums">
            {t('mt.weekN', { n: week })} · {label}
          </span>
        </div>

        {/* Anything the queue is still holding, and whether there is signal. */}
        {(pending.length > 0 || !online || stale) && (
          <div className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${
            pending.length ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${online ? 'bg-amber-500' : 'bg-slate-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-black text-slate-700">
                {pending.length ? t('mt.pendingN', { n: pending.length }) : t('mt.offline')}
              </div>
              {/* Three situations, three sentences. A list drawn off the
                  phone has to SAY so, and a phone with nothing on it has to
                  say that too — otherwise the empty list below reads as an
                  empty plan, which on this screen is an instruction to go
                  home. */}
              <div className="text-[10px] font-bold text-slate-400">
                {stale && !stale.at ? t('wk.neverLoaded')
                 : stale            ? t('wk.showingCached', { when: agoText(stale.at, t) })
                 : online           ? t('mt.pendingHint')
                                    : t('mt.offlineHint')}
              </div>
            </div>
            {online && pending.length > 0 && (
              <button onClick={() => sync(true)} disabled={syncing}
                className="shrink-0 bg-amber-500 disabled:opacity-50 text-white font-black text-[10px] uppercase tracking-widest rounded-xl px-3 py-2">
                {syncing ? t('mt.syncing') : t('mt.syncNow')}
              </button>
            )}
          </div>
        )}

        {loading && (
          <div className="text-center py-10 text-[12px] font-black text-slate-400 uppercase tracking-widest">
            {t('common.loading')}
          </div>
        )}

        {/* Nothing to do — or nothing loaded. The green "well done" panel was
            shown for both, and on a phone that had never read the plan it
            told a worker his period was finished before he had started it. */}
        {!loading && !todo.length && stale && !stale.at && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl px-5 py-7 text-center">
            <div className="text-[14px] font-black text-amber-900 leading-relaxed">
              {t('wk.neverLoaded')}
            </div>
          </div>
        )}

        {!loading && !todo.length && !(stale && !stale.at) && (
          <div className="bg-emerald-50 rounded-3xl px-5 py-7 text-center">
            <div className="text-[15px] font-black text-emerald-700">
              {done.length ? t('wk.periodClear') : t('wk.periodEmpty')}
            </div>
          </div>
        )}

        {!loading && todo.length > 0 && (
          <>
            <div className="text-[10.5px] font-bold text-slate-400 -mt-1">{t('wk.swipeHint')}</div>
            {/* Said only while a walk is running, and said because it is the
                one thing about the track a worker cannot work out for
                themselves: a phone that locks stops giving positions, and the
                line simply stops growing. The app holds the screen awake
                while it can, but a worker who pockets the phone should know
                what they are risking. */}
            {track.running && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2
                              text-[11px] font-bold text-amber-800 leading-snug">
                {t('wk.keepScreenOn')}
              </div>
            )}

            <div className="space-y-2.5">
              {todo.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  tint={tintOf(task.workTypeKey)}
                  tracking={track.trackingId === task.id}
                  session={track.trackingId === task.id ? track.session : null}
                  elapsed={track.elapsed}
                  denied={track.denied}
                  busy={busy === task.id}
                  onStart={mayGps ? () => startTrack(task) : null}
                  onPause={track.pause}
                  onResume={track.resume}
                  onStop={() => stopTrack(task)}
                  onComplete={() => complete(task, track.trackingId === task.id ? track.stop() : null)}
                  /* Sent back by the conductor, and this worker's to redo.
                     The row says so and says why: "work not finished" and
                     "wrong plot" send somebody to do very different things,
                     and a repair with no reason on it is the same mistake
                     made twice. */
                  sentBack={task.sentBack || null}
                  onMap={mayGps ? () => setMapOpen(true) : null}
                  onPhoto={mayPhotos ? () => askForPhoto(task) : null}
                  onDropPhoto={(i) => dropPhoto(task.id, i)}
                  photos={photos[task.id] || null}
                  canStart={track.canStart}
                  /* Why it cannot start, ON the button rather than in a
                     paragraph above the list. A grey button with no reason is
                     the app silently doing nothing; a paragraph explaining it
                     four rows above is clutter on a screen meant to be worked
                     down. The button itself is the honest place. */
                  waitFor={track.canStart ? null
                    : track.denied ? t('wk.waitGpsOff')
                    : track.accuracy == null ? t('wk.waitGps')
                    : t('wk.waitAcc', { acc: track.accuracy })}
                />
              ))}
            </div>
          </>
        )}

        {/* What has been finished this period. Kept on screen rather than
            vanishing: a worker wants to see the morning behind them, and it is
            the only proof the swipe did anything. */}
        {!loading && done.length > 0 && (
          <>
            <div className="flex items-baseline justify-between gap-2 pt-3">
              <span className={head}>{t('wk.completed')}</span>
              <span className="text-[12px] font-black text-emerald-600 tabular-nums">
                {done.length}/{tasks.length}
              </span>
            </div>
            <div className="text-[10.5px] font-bold text-slate-400 -mt-1">{t('wk.tapDone')}</div>
            <div className="space-y-1.5">
              {done.map((task) => {
                const tone = tintOf(task.workTypeKey);
                const rec = recordFor(task);
                return (
                  <button key={task.id} type="button"
                    onClick={() => rec && setOpenDone({ record: rec, task })}
                    className="w-full text-left bg-white/70 border border-slate-200 rounded-2xl px-3.5 py-2.5 flex items-center gap-3 active:bg-white">
                    <span className={`w-8 h-8 rounded-xl grid place-items-center shrink-0 ${tone.bg} opacity-60`}>
                      <WorkIcon workKey={task.workTypeKey} className={`w-5 h-5 ${tone.fg}`} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-black text-slate-500 leading-none">
                        {task.plot}
                        <span className="ml-2 text-[11px] font-bold text-slate-400">
                          {workTypeLabel(workTypeByKey(task.workTypeKey), lang)}
                        </span>
                      </div>
                      {task.chemical && (
                        <div className="text-[11px] font-bold text-slate-400 mt-0.5 truncate">
                          {task.chemical}
                        </div>
                      )}
                      {/* Somebody ELSE's record on this plot was sent back.
                          It stays here rather than vanishing: two workers
                          must not both walk out to the same plot, and a job
                          that disappears off one man's screen because it is
                          another man's repair is a job nobody can account
                          for. It is not on his to-do list, and it says why. */}
                      {task.sentBack && (
                        <div className="text-[11px] font-bold text-rose-600 mt-0.5 truncate">
                          {t('wk.sentBackOther', { who: task.sentBack.who || '' })}
                        </div>
                      )}
                    </div>
                    <span className={`text-[16px] font-black shrink-0 ${
                      task.sentBack ? 'text-rose-500' : 'text-emerald-600'}`} aria-hidden="true">
                      {task.sentBack ? '↩' : '✓'}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {error && !loading && !tasks.length && (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[12px] font-bold text-slate-500">
            {error}
          </div>
        )}

      </div>

      {/* One picker for the whole list. Which job it is for is remembered in
          pickFor, not in the markup — twenty jobs must not mean twenty file
          inputs on the page. */}
      {mayPhotos && (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={photoChosen}
        />
      )}

      {/* The phone in a pocket, still walking. Closes itself if the walk ends
          from anywhere else, so it can never be a black screen over nothing. */}
      {pocket && track.session && (
        <PocketMode
          task={track.session.task}
          session={track.session}
          elapsed={track.elapsed}
          /* The map, without coming back to the list first — and it stays
             recording while it is looked at. Closing the map drops back into
             the pocket screen, which is where the phone was. */
          onMap={() => setMapOpen(true)}
          onExit={() => setPocket(false)}
        />
      )}

      {/* ABOVE the pocket screen, which is z-70. TrackMap carries z-60 for the
          FC Portal, so opened from the pocket the black screen sat on top of
          it — the map could be seen through nothing and every tap on it, Find
          Me included, was swallowed by the overlay in front. It looked like
          the map's buttons were dead, and only ever while a walk was running,
          because that is the only time the pocket screen exists. */}
      {mapOpen && (
        <div className="fixed inset-0 z-[80]">
          <Suspense fallback={
            <div className="fixed inset-0 bg-slate-900 grid place-items-center">
              <div className="text-emerald-400 font-mono text-xs uppercase tracking-[0.3em] animate-pulse">
                {t('common.loading')}
              </div>
            </div>
          }>
            {/* The fix comes from the watch this screen is already running —
                two watchPosition calls at once left the map with none, and
                Find Me dead. */}
            <TrackMap
              viewOnly
              live={live}
              fix={track.fix}
              watchOwn={false}
              onClose={() => setMapOpen(false)}
              onDone={() => setMapOpen(false)}
            />
          </Suspense>
        </div>
      )}

      {openDone && (
        <DoneSheet
          record={openDone.record}
          task={openDone.task}
          source={source}
          onClose={() => setOpenDone(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white
                        text-[12.5px] font-bold px-4 py-2.5 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
