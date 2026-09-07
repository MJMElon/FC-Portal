import { useEffect, useMemo, useState } from 'react';
import { useAutoSync, useOnline } from '../../hooks/useOnline.js';
import { agoText } from '../../lib/ago.js';
import TopNav from '../../components/TopNav.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLang } from '../../context/LanguageContext.jsx';
import {
  BATCH_SETUP_NEEDED,
  SETUP_NEEDED,
  VERIFY_SETUP_NEEDED,
  WORK_TYPES,
  allowedNurseries,
  awaitingVerify,
  canMaintain,
  deleteRecord,
  flushMaintenance,
  hasRejectColumns,
  hasVerifyColumns,
  isModuleAdmin,
  loadMaintenanceData,
  loadPlotBatches,
  loadWorkers,
  loadSchedules,
  nurseryKey,
  pendingRecords,
  setRejected,
  setVerified,
  submitRecord,
  toCsv,
  todayStr,
  withQueued,
  workTypeByKey,
  workTypeLabel,
} from './data.js';
import { canMaintFn, canMaintCorrect } from './functions.js';
import { generalWorkers } from './helpers.js';
import { formatDistance, mapsUrl } from './track/track.js';
import GpsTrack from './GpsTrack.jsx';
import HistoryDialog from './HistoryDialog.jsx';
import PhotoSlots from './PhotoSlots.jsx';
import VerifyHub from './VerifyHub.jsx';
import WeekBoard from './WeekBoard.jsx';
import WorkIcon from './WorkIcons.jsx';
import WhoDidIt from './WhoDidIt.jsx';
import WorkSheet from './WorkSheet.jsx';
import { batchesIn } from './plotBatches.js';
import RecordCard from './RecordCard.jsx';
import { tintOf } from './tints.js';
import {
  WEEKS,
  isDone as isJobDone,
  mergeWeekTasks,
  monthLabelOf,
  shiftMonthLabel,
  weekDates,
  weekOfDate,
} from './schedule.js';

/** Matches the work sheet: three photos is enough to show a job was done. */
const MAX_PHOTOS = 3;

/* Where the module gets its data and who it thinks is asking.
 *
 * The FC Portal's answer — a Supabase session, and data.js reading the tables
 * directly — is the default, so the module behaves exactly as it always has
 * when nobody passes anything.
 *
 * The Worker Portal passes its own: a worker signed in with a PIN is `anon`
 * and cannot read those tables at all, so its data comes back through the
 * worker_* database functions instead. Same board, same counting, same table
 * written at the end of it — only the door differs. See
 * worker/workerMaintSource.js.
 */
const FC_SOURCE = {
  loadData:       loadMaintenanceData,
  loadPlotBatches,
  loadWorkers,
  loadSchedules,
  submitRecord,
  deleteRecord,
  setVerified,
  setRejected,
  flushQueue:     flushMaintenance,
  pending:        pendingRecords,
};

// Maintenance work recorded in the field: which job, on which plot, on which
// day. Plots come from shared_plots (Seedling Stock Management settings);
// which nurseries a Field Conductor sees is set on the main portal's User
// Access, and which a worker sees is their boundary in the Worker Portal's
// Settings. Both arrive here as the same `allowed` list.
export default function MaintenanceModule({
  source = FC_SOURCE,
  /* { name, permissions } — who is recording. Absent means the FC session. */
  identity = null,
  /* The bar across the top. The FC Portal's TopNav signs out of Supabase,
     which is not what a worker's Sign Out has to do. */
  nav = null,
  /* A worker's boundary can name individual plots, which a nursery list
     cannot express. Absent means every plot in the allowed nurseries. */
  plotFilter = null,
  subtitle = 'FC Portal',
  back = '/dashboard',
}) {
  const auth = useAuth();
  const staffName   = identity ? identity.name        : auth.staffName;
  const permissions = identity ? identity.permissions : auth.permissions;
  const { t, lang } = useLang();

  const [plots, setPlots] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [setup, setSetup] = useState(false);
  /* { at } when the board is drawn from the device's own copy rather than a
     fresh read; at === 0 means this phone has never had one. null when the
     figures came from the office just now. */
  const [stale, setStale] = useState(null);
  const [nursery, setNursery] = useState('');
  const [editing, setEditing] = useState(null); // { record? } — open sheet
  const [toast, setToast] = useState(null);
  const [schedule, setSchedule] = useState([]);     // one row per nursery that has a plan
  const [batchMap, setBatchMap] = useState(new Map());
  const [sheet, setSheet] = useState(null);         // { week, workType }
  const [history, setHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workers, setWorkers] = useState([]);   // the roster a conductor may credit work to
  const [pending, setPending] = useState([]);   // records the queue is holding
  const [syncing, setSyncing] = useState(false);
  const online = useOnline();

  // This page's own nursery list — Maintenance and PALMS are set separately.
  const allowed = allowedNurseries(permissions, 'maintenance');
  /* The three-layer rule, not canScan's all-or-nothing one. Recording work is
     a company switch now (System Setting → Portal View & Function), and the
     per-person tick that used to seed the key is gone — so under canScan every
     row saved since read as "no Record Work" with nothing left to tick. See
     MAINT_FUNCTION_DEFAULT.record. */
  const mayRecord = canMaintFn(permissions, 'record');
  /* Changing a record already made, and removing one, are two ticks now —
     Setting → a person → Maintenance → Edit work done / Delete work done —
     because they are two different acts. Correcting a quantity somebody
     mis-keyed is bookkeeping; making the morning disappear is not.

     Neither falls open. An unticked box that still erases records would be
     the screen lying in the expensive direction. See canMaintCorrect. */
  const mayEdit   = canMaintCorrect(permissions, 'edit');
  const mayDelete = canMaintCorrect(permissions, 'delete');
  const mayExport = canMaintain(permissions, 'export');
  /* Not a permission — what the work sheet uses to decide whether a job
     already ticked off can be opened again. Nothing is changed or removed by
     it; it re-opens a form. That is why it is still the plain admin question
     and not one of the two ticks above. */
  const isAdmin   = isModuleAdmin(permissions, 'operation');
  /* Signing off a worker's morning.
   *
   * TWO conditions, and they are different in kind. The tick — Setting → a
   * person → Maintenance → Verify work done — is who the office has decided
   * may sign. `source.setVerified` is whether signing is possible at all from
   * this door, and the Worker Portal's source deliberately has none: there is
   * no worker_* function to verify with, so a worker holds no button whatever
   * anybody ticks. Nobody signs off their own morning.
   *
   * Which is why a record a worker saves appears in the completed list with
   * nothing to press, and the same record in the FC Portal carries the button
   * — one board, one list, and the difference is who is holding the phone. */
  const mayVerify = !!source.setVerified && canMaintain(permissions, 'verify');

  /* The functions inside Maintenance, switched on one at a time — the office
     sets them per Field Conductor on the FC Portal's Setting screen, and per
     worker in the Worker Portal's Settings. Same keys, same defaults, one
     list: see functions.js.

     Every one of them defaults ON, so a person whose access predates the
     switches keeps the form they had. GPS is the exception and stays off
     until it is asked for. */
  const maySchedule = canMaintFn(permissions, 'schedule');
  const fnBatches   = canMaintFn(permissions, 'batches');
  const fnWorkers   = canMaintFn(permissions, 'workers');
  const fnGps       = canMaintFn(permissions, 'gps');
  /* The camera, like everything else on this form, is the switch and nothing
     else. It used to be the switch AND a prop the Worker Portal passed as
     false, which made the two portals differ for a reason that was not on any
     screen. A worker still gets no camera — a PIN sign-in is `anon` and the
     documents bucket takes uploads from `authenticated` only — but that is
     now said in ONE place, workerMaintSource.js, as a permission the worker
     cannot have, rather than as a second hidden rule here. */
  const fnPhotos    = canMaintFn(permissions, 'photos');
  const fnRemark    = canMaintFn(permissions, 'remark');

  const flash = (text) => {
    setToast(text);
    clearTimeout(flash._t);
    flash._t = setTimeout(() => setToast(null), 3000);
  };

  async function reload() {
    try {
      const d = await source.loadData();
      setPlots(d.plots);
      setRecords(d.records);
      /* Whether what is on screen came off the device rather than the
         office. The board looks identical either way, and that is the
         problem it solves: an empty week drawn from a cache that was never
         filled reads as "you're all clear", which is the one thing it must
         not be mistaken for. */
      setStale(d.fromCache ? { at: d.cachedAt || 0 } : null);
      setError(null);
      setSetup(false);
    } catch (e) {
      if (e && e.message === SETUP_NEEDED) setSetup(true);
      else setError(e.message || String(e));
    }
    setLoading(false);
  }
  useEffect(() => {
    reload();
  }, []);

  const refreshPending = () => source.pending().then(setPending).catch(() => setPending([]));

  /* Send anything waiting. useAutoSync already fires on mount, every minute
     while online, and the moment the connection comes back — which is exactly
     when a queue wants emptying. */
  async function sync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const before = (await source.pending()).length;
      if (before) {
        const r = await source.flushQueue();
        if (r.sent) { flash(t('mt.synced', { n: r.sent })); reload(); }
        if (r.dropped) flash(t('mt.syncDropped', { n: r.dropped }));
      }
    } catch (e) {
      console.warn('[maintenance] sync failed:', e);
    }
    await refreshPending();
    setSyncing(false);
  }
  useAutoSync(sync, 60000);

  const visiblePlots = useMemo(
    () => plots.filter((p) =>
      (allowed === null || allowed.includes(p.nursery_name)) &&
      (!plotFilter || plotFilter(p.plot_name))),
    [plots, allowed, plotFilter]
  );

  /* This nursery's workers. A conductor covering two nurseries should not be
     offered the other one's crew on a plot they never set foot in.

     Matched through nurseryKey, not by string equality. The nursery on screen
     comes from shared_plots and reads "UNN 2"; the Payroll register is filled
     in by hand and may say "UNN2". Comparing them as they are spelt found the
     crew for BNN — which has no space in it — and nobody at all for UNN 1 or
     UNN 2, so the tick list simply did not appear there.

     `section` is read when `nursery` is blank, the same fallback the office's
     own worker link uses: the register copies one into the other, but a row
     added since carries only whichever the person keying it used. */
  const nurseryWorkers = useMemo(() => {
    const want = nursery ? nurseryKey(nursery) : null;
    const mine = want
      ? workers.filter((w) => (nurseryKey(w.nursery) || nurseryKey(w.section)) === want)
      : workers;
    /* Only the people who actually do maintenance work. The register holds
       the whole nursery — the conductor, his assistant, drivers, the pump
       operator, clerks — and offering all of them is offering the wrong
       answer nineteen ways. Same rule the office's Worker Record uses, so a
       name on one sheet is a name on the other. Judged per nursery, because
       the rule asks whether anybody HERE has been labelled. */
    return generalWorkers(mine);
  }, [workers, nursery]);

  const nurseryOptions = useMemo(
    () => [...new Set(visiblePlots.map((p) => p.nursery_name).filter(Boolean))].sort(),
    [visiblePlots]
  );

  // Open on the first nursery rather than on nothing: with no "All" to fall
  // back to, an empty pick would leave the whole screen blank.
  useEffect(() => {
    if (!nursery && nurseryOptions.length) setNursery(nurseryOptions[0]);
  }, [nurseryOptions, nursery]);


  /* A queued record has not reached the database, but the work HAS been done
     — so it counts for the week's ticks and shows in the list. Without this a
     Field Conductor offline would see the plot still outstanding and do it
     twice. The dashboard's month summary counts the same way (withQueued). */
  const allRecords = useMemo(() => withQueued(records, pending), [records, pending]);

  // Records this user may see, in the nursery they are looking at.
  const visible = useMemo(
    () => allRecords.filter(
      (r) =>
        (allowed === null || allowed.includes(r.nursery_name)) &&
        (!plotFilter || plotFilter(r.plot_name)) &&
        (!nursery || r.nursery_name === nursery)
    ),
    [allRecords, allowed, plotFilter, nursery]
  );

  /* A record sent back is a record refused, so the plot it was made against
     goes back on the list as still outstanding — that is the whole point of
     the Verify Hub's left swipe. Everything that COUNTS work reads this list;
     everything that LISTS records reads the other, because the rejected
     record itself must stay visible or nobody can see what was refused. */
  const accepted = useMemo(() => allRecords.filter((r) => !r.rejected_at), [allRecords]);

  /* What the database can hold an answer in, read off the records already
     loaded rather than asked for separately — a column that exists comes back
     as a key whether or not it is set.

     TWO questions, not one, and conflating them emptied the deck. Signing
     needs verified_at, which shared/add_maint_field_verify.sql has been
     adding for months. Sending back needs rejected_at, which arrived with
     shared/add_maint_field_reject.sql and may not have been run yet — and a
     database with only the older file must still show a conductor the
     morning's work with a tick on it, not an empty hub. */
  const verifyReady = !records.length || hasVerifyColumns(records);
  const rejectReady = !records.length || hasRejectColumns(records);
  const deck = useMemo(
    () => (verifyReady ? awaitingVerify(visible) : []),
    [visible, verifyReady]
  );

  const today = todayStr();
  const nowMonth = monthLabelOf(today);
  const nowWeek = weekOfDate(today);

  /* Which week is on screen. Back and next walk off the end of a month into
     the one either side, so a conductor catching up on the last days of last
     month does not have to know that the schedule is filed per month. */
  const [view, setView] = useState({ month: nowMonth, week: nowWeek });
  const month = view.month;
  const currentWeek = view.week;
  const viewingNow = month === nowMonth && currentWeek === nowWeek;
  const stepWeek = (d) => setView((v) => {
    const w = v.week + d;
    if (w < 1) return { month: shiftMonthLabel(v.month, -1), week: WEEKS.length };
    if (w > WEEKS.length) return { month: shiftMonthLabel(v.month, 1), week: 1 };
    return { month: v.month, week: w };
  });

  // Which nurseries the timeline covers: the one the filter names, or every
  // one this person can see. "All nurseries" used to be a dead end asking
  // them to choose first — the week's work is the same question either way.
  const timelineNurseries = useMemo(
    () => (nursery ? [nursery] : nurseryOptions),
    [nursery, nurseryOptions]
  );
  const nurseriesSig = timelineNurseries.join('|');

  // The office's schedules for those nurseries this month, and what is
  // standing in each plot. Both are read once and re-read after a save.
  useEffect(() => {
    let live = true;
    const names = nurseriesSig ? nurseriesSig.split('|') : [];
    if (!names.length) { setSchedule([]); return undefined; }
    // The office files under BNN / UNN1; shared_plots says "UNN 1". Ask for
    // both spellings and keep whichever comes back.
    const keys = [...new Set(names.flatMap((n) => [n, nurseryKey(n)]))];
    source.loadSchedules(keys, month)
      .then((rows) => { if (live) setSchedule(rows); })
      .catch(() => { if (live) setSchedule([]); });
    return () => { live = false; };
  }, [nurseriesSig, month]);

  /* The roster a conductor may credit a job to. Only the FC portal asks —
     a worker recording their own morning is already the answer, and its
     source offers no loadWorkers at all. */
  useEffect(() => {
    let live = true;
    if (!source.loadWorkers) { setWorkers([]); return undefined; }
    source.loadWorkers()
      .then((rows) => { if (live) setWorkers(rows || []); })
      .catch((e) => { console.warn('[maintenance] worker list unavailable:', e); if (live) setWorkers([]); });
    return () => { live = false; };
  }, [source]);

  // Once, when the module opens. Deliberately NOT re-read after a save:
  // recording that a plot was sprayed moves no seedlings, so the balances
  // cannot have changed — and this read pages the entire inventory ledger.
  // Hanging it off the record count meant a Field Conductor working through
  // twelve plots read the whole ledger twelve times for no new information.
  useEffect(() => {
    let live = true;
    source.loadPlotBatches()
      .then((m) => { if (live) setBatchMap(m); })
      .catch(() => { if (live) setBatchMap(new Map()); });
    return () => { live = false; };
  }, []);

  // Every week's jobs, and how many of each are already recorded.
  const tasksByWeek = useMemo(
    () => WEEKS.reduce((acc, w) => { acc[w] = mergeWeekTasks(schedule, w); return acc; }, {}),
    [schedule]
  );
  const counts = useMemo(() => WEEKS.reduce((acc, w) => {
    acc[w] = WORK_TYPES.reduce((c, wt) => { c[wt.key] = tasksByWeek[w][wt.key].length; return c; }, {});
    return acc;
  }, {}), [tasksByWeek]);
  const doneCounts = useMemo(() => WEEKS.reduce((acc, w) => {
    acc[w] = WORK_TYPES.reduce((c, wt) => {
      c[wt.key] = tasksByWeek[w][wt.key].filter((x) =>
        isJobDone(accepted, { workTypeKey: wt.key, plot: x.plot,
                              chemical: x.chemical, week: w, month })).length;
      return c;
    }, {});
    return acc;
  }, {}), [tasksByWeek, accepted, month]);

  async function handleSheetSave({ task, batches, remark, photos, qty, workedBy, gps }) {
    const plot = visiblePlots.find((p) => p.plot_name === task.plot)
      || { plot_name: task.plot, nursery_name: task.nursery || nursery || null };
    setSaving(true);
    try {
      const { queued } = await source.submitRecord({
        plot,
        workTypeKey: sheet.workType.key,
        // Today, always: the record says the job was done, and it is being
        // written now.
        date: today,
        chemical: task.chemical,
        qty: qty || null,
        remark,
        batches,
        weekNo: sheet.week,
        scheduleMonth: month,
        reportedBy: staffName,
        workedBy,
        photos,
        gps,
      });
      if (queued) {
        flash(t('mt.savedOffline', { plot: task.plot }));
        await refreshPending();
      } else {
        flash(t('mt.savedToast', { work: workTypeLabel(sheet.workType, lang), plot: task.plot }));
        reload();
      }
    } catch (e) {
      // The job saved; only the batch/week columns were missing.
      if (e && e.message === BATCH_SETUP_NEEDED) { flash(t('mt.batchSetupNeeded')); reload(); }
      else flash(t('mt.saveErr', { msg: (e && e.message) || String(e) }));
    }
    setSaving(false);
  }

  async function handleSave(form) {
    const plot = visiblePlots.find((p) => p.plot_name === form.plotName);
    if (!plot) return;
    try {
      const { queued } = await source.submitRecord({
        id: editing && editing.record ? editing.record.id : null,
        plot,
        workTypeKey: form.workTypeKey,
        date: form.date,
        qty: form.qty,
        chemical: form.chemical,
        remark: form.remark,
        reportedBy: staffName,
        workedBy: form.workedBy,
        batches: form.batches,
        photos: form.photos,
        gps: form.gps,
      });
      if (queued) {
        flash(t('mt.savedOffline', { plot: plot.plot_name }));
        await refreshPending();
      } else {
        flash(t('mt.savedToast', {
          work: workTypeLabel(workTypeByKey(form.workTypeKey), lang),
          plot: plot.plot_name,
        }));
        reload();
      }
      setEditing(null);
    } catch (e) {
      flash(t('mt.saveErr', { msg: e.message || String(e) }));
    }
  }

  async function handleDelete(rec) {
    if (!mayDelete) return flash(t('mt.noPermDelete'));
    if (!window.confirm(t('mt.confirmDelete'))) return;
    try {
      await source.deleteRecord(rec.id);
      flash(t('mt.deletedToast'));
      reload();
    } catch (e) {
      flash(t('mt.saveErr', { msg: e.message || String(e) }));
    }
  }

  /* Sending a record back, from the deck. The row stays and nothing is
     deleted — what is refused is the record of it, so the plot goes back on
     the week as still outstanding. */
  function handleReject(rec, reason) {
    if (!mayVerify) return Promise.resolve();
    return source.setRejected(rec.id, staffName, reason);
  }

  async function handleVerify(rec) {
    if (!mayVerify) return;
    const on = !rec.verified_at;
    /* Answer on screen before the round trip: a conductor works down a list
       of a morning's records, and a tick that waits for the network turns
       into two taps and a duplicate. Put back if the save fails. */
    setRecords((rs) => rs.map((r) => (r.id === rec.id
      ? { ...r, verified_by: on ? staffName : null, verified_at: on ? new Date().toISOString() : null }
      : r)));
    try {
      await source.setVerified(rec.id, on ? staffName : null);
    } catch (e) {
      setRecords((rs) => rs.map((r) => (r.id === rec.id ? rec : r)));
      flash(e && e.message === VERIFY_SETUP_NEEDED
        ? t('mt.verifySetupNeeded')
        : t('mt.saveErr', { msg: (e && e.message) || String(e) }));
    }
  }

  function handleExport() {
    if (!mayExport) return flash(t('mt.noPermExport'));
    const blob = new Blob([toCsv(visible, lang)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `maintenance_${nursery || 'all'}_${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="min-h-screen bg-slate-100 fade-enter">
      {nav || <TopNav title={t('mt.title')} subtitle={subtitle} user={staffName} back={back} />}
      <div className="max-w-[900px] mx-auto px-3 sm:px-6 py-4 space-y-3">
        {/* Filters + actions */}
        <div className="flex flex-wrap gap-2">
          {/* One nursery at a time. "All" only ever produced a schedule the
              Field Conductor could not work through as one list. */}
          {nurseryOptions.length > 0 && (
            <select
              value={nursery}
              onChange={(e) => setNursery(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500"
            >
              {nurseryOptions.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setHistory(true)}
            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 font-black text-[11px] uppercase tracking-widest rounded-xl px-4 py-2.5"
          >
            🗂️ {t('mt.history')}
          </button>
          <div className="flex-1" />
          {mayExport && !!visible.length && (
            <button
              onClick={handleExport}
              className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 font-black text-[11px] uppercase tracking-widest rounded-xl px-4 py-2.5"
            >
              {t('mt.exportCsv')}
            </button>
          )}
        </div>

        {/* What has been recorded but not yet sent. Shown rather than hidden:
            a Field Conductor needs to know their morning is safe, and that it
            has not reached the office yet. */}
        {(pending.length > 0 || !online || stale) && (
          <div className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${
            pending.length ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${online ? 'bg-amber-500' : 'bg-slate-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-black text-slate-700">
                {pending.length ? t('mt.pendingN', { n: pending.length }) : t('mt.offline')}
              </div>
              {/* Three different sentences, because they are three different
                  situations and only one of them is "all is well".

                  A board drawn from the device has to SAY it is, and when
                  the device has nothing it has to say that too — otherwise
                  the empty week below reads as an empty plan. That is the
                  whole bug: the screen looked the same whether the office
                  had scheduled nothing or the phone had loaded nothing. */}
              <div className="text-[10px] font-bold text-slate-400">
                {stale && !stale.at ? t('mt.neverLoaded')
                 : stale            ? t('mt.showingCached', { when: agoText(stale.at, t) })
                 : online           ? t('mt.pendingHint')
                                    : t('mt.offlineHint')}
              </div>
            </div>
            {online && pending.length > 0 && (
              <button onClick={sync} disabled={syncing}
                className="shrink-0 bg-amber-500 disabled:opacity-50 text-white font-black text-[10px] uppercase tracking-widest rounded-xl px-3 py-2">
                {syncing ? t('mt.syncing') : t('mt.syncNow')}
              </button>
            )}
          </div>
        )}

        {/* One week at a time, at full width, and any week — a Field
            Conductor is as often catching up on last week or reading ahead to
            next as working the one we are standing in. The same card the
            portal's front page draws, except that here the dials are buttons:
            tapping one opens the record form for that job's plots. */}
        {!setup && maySchedule && (
          <div className="space-y-3 pt-1">
            {!mayRecord ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4 text-[13px] font-bold text-amber-800">
                {t('mt.noPermRecord')}
              </div>
            ) : (
              <>
                <WeekBoard
                  month={month}
                  week={currentWeek}
                  isNow={viewingNow}
                  counts={counts[currentWeek]}
                  doneCounts={doneCounts[currentWeek]}
                  onPrev={() => stepWeek(-1)}
                  onNext={() => stepWeek(1)}
                  onNow={() => setView({ month: nowMonth, week: nowWeek })}
                  onOpen={(week, workType) => setSheet({ week, workType })}
                  /* Nothing on the device AND no plan read: the week is empty
                     because nothing was loaded, not because nothing is due. */
                  noPlan={!!(stale && !stale.at) || (!!stale && !schedule.length)}
                />
                {/* The three answers the month's list used to carry. They are
                    about the plan, not about the four weeks it was drawn as,
                    so they outlive it. */}
                {!timelineNurseries.length ? (
                  <div className="bg-white border border-slate-200 rounded-2xl px-4 py-5 text-center text-[13px] font-bold text-slate-400">
                    {/* "No nursery is open to you yet" is a statement about
                        PERMISSIONS, and it used to be shown for a phone that
                        simply had not loaded anything — sending a Field
                        Conductor to ask an admin for access he already has.
                        With nothing on the device, say that instead. */}
                    {stale && !stale.at ? t('mt.neverLoaded') : t('mt.noPlots')}
                  </div>
                ) : !schedule.length ? (
                  <div className="bg-white border border-slate-200 rounded-2xl px-4 py-5 text-center text-[13px] font-bold text-slate-400">
                    {t('mt.noSchedule', { nursery: timelineNurseries.join(', '), month })}
                  </div>
                ) : schedule.some((r) => r.carried) ? (
                  <div className="bg-sky-50 border border-sky-200 rounded-xl px-3.5 py-2.5 text-[11px] font-bold text-sky-800">
                    {t('mt.carriedFrom', {
                      month: [...new Set(schedule.filter((r) => r.carried).map((r) => r.month))].join(', '),
                    })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        {/* The morning's submissions, one card at a time. On the page rather
            than behind a button: checking the morning is part of the morning,
            and a deck nobody can see is a deck nobody opens.

            Only where signing is possible at all — the Worker Portal's source
            has no setVerified, so a worker never sees this. Nobody signs off
            their own morning. */}
        {!setup && mayVerify && (
          <VerifyHub
            records={deck}
            columnsReady={verifyReady}
            canReject={rejectReady}
            staffName={staffName}
            onApprove={(rec) => source.setVerified(rec.id, staffName)}
            onReject={handleReject}
            onUndo={(rec) => source.setVerified(rec.id, null)}
            onChanged={reload}
          />
        )}

        {mayRecord && (
          <button
            onClick={() => setEditing({})}
            disabled={setup || !visiblePlots.length}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-black text-[12px] uppercase tracking-widest rounded-xl py-3.5 transition-colors"
          >
            {t('mt.newRecord')}
          </button>
        )}

        {setup && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm font-bold">
            {t('mt.setupNeeded')}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-bold">
            {t('mt.loadErr', { msg: error })}
          </div>
        )}

        {sheet && (
          <WorkSheet
            workType={sheet.workType}
            week={sheet.week}
            weekDates={weekDates(sheet.week, month)}
            month={month}
            tasks={tasksByWeek[sheet.week][sheet.workType.key]}
            batchMap={batchMap}
            today={today}
            saving={saving}
            isAdmin={isAdmin}
            allowPhotos={fnPhotos}
            showBatches={fnBatches}
            showGps={fnGps}
            showRemark={fnRemark}
            workers={fnWorkers && nurseryWorkers.length ? nurseryWorkers : null}
            isDone={(task) => isJobDone(accepted, {
              workTypeKey: sheet.workType.key, plot: task.plot,
              chemical: task.chemical, week: sheet.week, month })}
            onSave={handleSheetSave}
            onClose={() => setSheet(null)}
          />
        )}

        {loading && (
          <div className="text-center text-slate-400 text-xs font-black uppercase tracking-widest py-6 animate-pulse">
            {t('common.loading')}
          </div>
        )}

        {/* Nothing on this page can do anything until somebody opens a
            nursery. Said once, here, rather than as an empty list. */}
        {!loading && allowed !== null && allowed.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm font-bold">
            {t('mt.noNurseryAccess')}
          </div>
        )}
      </div>

      {history && (
        <HistoryDialog
          records={visible}
          today={today}
          mayVerify={mayVerify}
          mayEdit={mayEdit}
          mayDelete={mayDelete}
          onVerify={handleVerify}
          onEdit={(r) => setEditing({ record: r })}
          onDelete={handleDelete}
          onClose={() => setHistory(false)}
        />
      )}

      {editing && (
        <EntrySheet
          record={editing.record}
          plots={visiblePlots}
          batchMap={batchMap}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          allowPhotos={fnPhotos}
          showBatches={fnBatches}
          showGps={fnGps}
          showRemark={fnRemark}
          workers={fnWorkers && nurseryWorkers.length ? nurseryWorkers : null}
          t={t}
          lang={lang}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-xl z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

// Bottom sheet to record a job, or correct one already recorded.
function EntrySheet({ record, plots, batchMap, onClose, onSave, allowPhotos = true, workers = null,
                      showBatches = true, showGps = false, showRemark = true, t, lang }) {
  const [workTypeKey, setWorkTypeKey] = useState(record ? record.work_type : WORK_TYPES[0].key);
  const [plotName, setPlotName] = useState(record ? record.plot_name : '');
  const [date, setDate] = useState(record ? record.work_date : todayStr());
  const [chemical, setChemical] = useState((record && record.chemical) || '');
  const [remark, setRemark] = useState((record && record.remark) || '');
  const [saving, setSaving] = useState(false);
  const [workedBy, setWorkedBy] = useState(
    record && record.worked_by
      ? String(record.worked_by).split(',').map((n) => n.trim()).filter(Boolean)
      : []
  );
  const [batches, setBatches] = useState(
    record && record.batch_name
      ? String(record.batch_name).split(',').map((b) => b.trim()).filter(Boolean)
      : []
  );
  /* The track walked for this job. Only offered when the switch is on, and an
     edit keeps the track the record already carries rather than replacing it
     with a walk round the office. The points come back only when the record
     was read with the full row; without them the summary still shows, so
     correcting a remark never silently drops somebody's track. */
  const [gps, setGps] = useState(
    record && record.gps_lat != null && record.gps_lng != null
      ? {
          track: record.gps_track || null,
          points: record.gps_points ?? null,
          distance_m: record.gps_distance_m ?? null,
          started_at: record.gps_started_at || null,
          ended_at: record.gps_ended_at || null,
          lat: record.gps_lat,
          lng: record.gps_lng,
          accuracy: record.gps_accuracy ?? null,
        }
      : null
  );
  const [photos, setPhotos] = useState(() => {
    const a = Array(MAX_PHOTOS).fill(null);
    if (record && record.photo_urls) {
      String(record.photo_urls).split(',').map((u) => u.trim()).filter(Boolean)
        .forEach((u, i) => { if (i < MAX_PHOTOS) a[i] = u; });
    }
    return a;
  });

  // Spraying and manuring use a product; weeding by hand does not.
  const showChemical = workTypeKey === 'pd' || workTypeKey === 'manuring' || workTypeKey === 'interrow';

  // What is standing in the chosen plot, and what the ticked ones come to.
  // The quantity is that sum, not a number anyone types: the seedlings worked
  // on ARE the batches worked on, and two figures that should agree will not.
  const plotBatches = useMemo(() => batchesIn(batchMap, plotName), [batchMap, plotName]);
  const qty = useMemo(
    () => plotBatches.filter((b) => batches.includes(b.batch))
                     .reduce((sum, b) => sum + Number(b.qty || 0), 0),
    [plotBatches, batches]
  );
  const toggleBatch = (name) =>
    setBatches((b) => (b.includes(name) ? b.filter((x) => x !== name) : [...b, name]));

  // A plot the record was made against but which no longer holds that batch
  // still has to show it, or editing the record would silently drop it.
  const strays = batches.filter((b) => !plotBatches.some((x) => x.batch === b));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 pb-7 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-black text-slate-800 text-[15px] uppercase tracking-wide">
            🛠️ {record ? t('mt.editTitle') : t('mt.newTitle')}
          </h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-500 text-xl">
            ×
          </button>
        </div>

        {/* Big tap targets: this is filled in on a phone, in a nursery. */}
        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
          {t('mt.work')}
        </label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {WORK_TYPES.map((w) => (
            <button
              key={w.key}
              onClick={() => setWorkTypeKey(w.key)}
              className={`rounded-xl border-2 px-3 py-3 text-left transition-colors ${
                workTypeKey === w.key
                  ? 'border-emerald-500 bg-emerald-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <WorkIcon workKey={w.key} className="w-6 h-6" />
              <div className="text-[11px] font-black text-slate-700 leading-tight mt-1">
                {workTypeLabel(w, lang)}
              </div>
            </button>
          ))}
        </div>

        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
          {t('mt.plot')}
        </label>
        <select
          value={plotName}
          onChange={(e) => setPlotName(e.target.value)}
          className="w-full bg-white border border-slate-300 rounded-xl px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 mb-3"
        >
          <option value="">{t('mt.pickPlot')}</option>
          {plots.map((p) => (
            <option key={p.plot_name} value={p.plot_name}>
              {p.plot_name}
              {p.nursery_name ? ` — ${p.nursery_name}` : ''}
            </option>
          ))}
        </select>

        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
          {t('mt.date')}
        </label>
        <input
          type="date"
          value={date}
          max={todayStr()}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-white border border-slate-300 rounded-xl px-3 py-3 text-sm font-bold outline-none focus:border-emerald-500 mb-3"
        />

        {showChemical && (
          <>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
              {t('mt.chemical')} <span className="text-slate-400 normal-case">· {t('mt.chemicalHint')}</span>
            </label>
            <input
              value={chemical}
              onChange={(e) => setChemical(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl px-3 py-3 text-sm font-semibold outline-none focus:border-emerald-500 mb-3"
            />
          </>
        )}

        {showBatches && <>
        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
          {t('mt.batchesInPlot')}
        </label>
        {!plotName ? (
          <div className="text-[12px] font-bold text-slate-400 mb-3">{t('mt.pickPlotFirst')}</div>
        ) : plotBatches.length === 0 && !strays.length ? (
          <div className="text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-3">
            {t('mt.noBatches', { plot: plotName })}
          </div>
        ) : (
          <div className="space-y-1.5 mb-3">
            {plotBatches.map((b) => (
              <label key={b.batch}
                className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 cursor-pointer ${
                  batches.includes(b.batch) ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}>
                <input type="checkbox" className="w-5 h-5 accent-emerald-600 shrink-0"
                  checked={batches.includes(b.batch)} onChange={() => toggleBatch(b.batch)} />
                <span className="font-black text-slate-800 text-[14px] flex-1 min-w-0">{b.batch}</span>
                <span className={`text-[12px] font-bold shrink-0 tabular-nums ${
                  b.qty < 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {b.qty.toLocaleString()}
                </span>
              </label>
            ))}
            {strays.map((b) => (
              <label key={b}
                className="flex items-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 px-3 py-2.5 cursor-pointer">
                <input type="checkbox" className="w-5 h-5 accent-emerald-600 shrink-0"
                  checked onChange={() => toggleBatch(b)} />
                <span className="font-black text-slate-800 text-[14px] flex-1 min-w-0">{b}</span>
                <span className="text-[10px] font-bold text-slate-400 shrink-0">{t('mt.batchGone')}</span>
              </label>
            ))}
          </div>
        )}

        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
          {t('mt.qty')} <span className="text-slate-400 normal-case">· {t('mt.qtyFromBatches')}</span>
        </label>
        <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-3 text-sm font-black text-slate-700 mb-3">
          {qty ? qty.toLocaleString() : '—'}
        </div>
        </>}

        {workers && (
          <WhoDidIt workers={workers} value={workedBy} onChange={setWorkedBy} t={t} />
        )}

        {showGps && <GpsTrack value={gps} onChange={setGps} />}

        {allowPhotos && <>
        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
          {t('mt.photos', { n: MAX_PHOTOS })}
        </label>
        <div className="mb-3">
          <PhotoSlots value={photos} onChange={setPhotos} max={MAX_PHOTOS} />
        </div>
        </>}

        {showRemark && <>
        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
          {t('mt.remark')}
        </label>
        <textarea
          rows={2}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none focus:border-emerald-500 mb-4"
        />
        </>}

        <button
          onClick={async () => {
            setSaving(true);
            await onSave({ workTypeKey, plotName, date, qty, chemical: chemical.trim(),
                           remark: remark.trim(), batches, workedBy, gps,
                           photos: photos.filter(Boolean) });
            setSaving(false);
          }}
          disabled={saving || !plotName || !date || !workTypeKey}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-[12px] uppercase tracking-widest rounded-xl py-3.5 transition-colors"
        >
          {saving ? t('auth.processing') : t('mt.save')}
        </button>
      </div>
    </div>
  );
}
