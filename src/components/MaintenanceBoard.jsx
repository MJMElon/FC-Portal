import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { allowedNurseries } from '../lib/access.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import {
  WORK_TYPES,
  loadCapacity,
  loadMaintenanceData,
  loadSchedules,
  nurseryKey,
  pendingRecords,
  todayStr,
  withQueued,
  workTypeLabel,
} from '../modules/maintenance/data.js';
import { canMaintFn } from '../modules/maintenance/functions.js';
import MaintenanceQuickEntry from './MaintenanceQuickEntry.jsx';
import {
  WEEKS,
  isDone as isJobDone,
  mergeWeekTasks,
  monthLabelOf,
  weekDates,
  weekOfDate,
} from '../modules/maintenance/schedule.js';
import { tintOf } from '../modules/maintenance/tints.js';
import { makeCapacity, makeCoverage, weekUsage } from '../modules/maintenance/usage.js';
import ProgressDial from '../modules/maintenance/ProgressDial.jsx';
import WorkIcon from '../modules/maintenance/WorkIcons.jsx';
import Icon from './Icon.jsx';

/* v3: the cached shape gained usageByWeek. An older cache would simply have
   no figures, which is survivable — but a new key means the first load after
   a deploy fetches them rather than showing a card that never has them. */
const CACHE_KEY = 'maintenance_board_month_v3';

/** One week-stepper arrow. Greys out at the ends of the month instead of
    disappearing, so the control does not change shape as you move. Plain
    triple-chevron text, no circle and no border — the office asked for the
    round button gone and the arrow itself smaller. */
function NavArrow({ dir, disabled, onClick, label }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`shrink-0 px-1 py-0.5 text-[11px] font-black tracking-tighter leading-none transition-colors ${
        disabled
          ? 'text-teal-200 cursor-default'
          : 'text-teal-600 hover:text-teal-800 cursor-pointer'
      }`}
    >
      {dir === 'prev' ? '<<<' : '>>>'}
    </button>
  );
}

/**
 * The month's maintenance, on the portal's front page.
 *
 * The Maintenance module already answers "how much of this job is done" — but
 * a week at a time, four weeks down a screen you have to open the module to
 * reach. What a Field Conductor actually wants before deciding where to walk
 * is the one-line version: of everything the office asked for this month, how
 * much of each of the four jobs is behind. So the same sum is rolled up over
 * all four weeks and shown here, beside today's collections.
 *
 * Deliberately the SAME arithmetic as the module's timeline — mergeWeekTasks
 * for what is due, isDone for what is recorded, withQueued so work saved
 * offline still counts. Two screens answering one question must not be able
 * to disagree; anything else and the front page becomes a number nobody
 * trusts.
 *
 * Reads once on mount and caches, like the collection board: a month's totals
 * do not move minute to minute, and this is the heavier of the two reads.
 */
export default function MaintenanceBoard() {
  const { permissions } = useAuth();
  const { t, lang } = useLang();

  const month = monthLabelOf(todayStr());

  // Last month's totals under this month's heading would be a lie, so a cache
  // from a month that has turned over is dropped rather than shown.
  const cached = cacheGet(CACHE_KEY);
  const fresh = cached && cached.value && cached.value.month === month ? cached : null;
  // { totals: {key:n}, done: {key:n}, month, scheduled }
  const [sum, setSum] = useState(fresh?.value || null);
  const [failed, setFailed] = useState(false);
  // A restricted user must be summed over their own nurseries only, exactly
  // as the module scopes them — otherwise the front page quotes a total for
  // plots they are not allowed to see.
  // Opens on the week you are actually in; stepping is per-visit, not saved.
  const [week, setWeek] = useState(() => weekOfDate(todayStr()) || 1);
  const [showInfo, setShowInfo] = useState(false);
  /* { workTypeKey } — which dial popped the record form open, if any. The
     week it opens on is this card's own `week` above: whichever one is on
     screen when the dial is tapped. */
  const [quickEntry, setQuickEntry] = useState(null);

  const allowed = allowedNurseries(permissions, 'maintenance');
  const allowedSig = allowed === null ? '*' : [...allowed].sort().join('|');
  /* Same switch the module's own "+ New Record" button is gated on — a
     dial that cannot be tapped through to anything is worse than one that
     is plainly not a button, so the dials only become clickable here. */
  const mayRecord = canMaintFn(permissions, 'record');

  /* Pulled out into its own function so closing the quick-entry popup (see
     quickEntry/MaintenanceQuickEntry further down) can ask for the same
     read again — a record just saved there should not leave this card's
     own dials reading what they did before it was recorded.

     `live` is the effect's own mount-guard object, `{ current: true }`
     until cleanup flips it — shared this way rather than a plain closed-
     over boolean so a manual call (no cleanup to guard with) can simply
     leave it out and default to "always live". */
  const loadBoard = async (live = { current: true }) => {
    try {
      const [{ plots, records }, queued] = await Promise.all([
        loadMaintenanceData(),
        pendingRecords().catch(() => []),
      ]);
      const nurseries = [
        ...new Set(
          plots
            /* Through nurseryKey, like every other nursery comparison in
               this repository: the tick list on the User Access screen is
               typed by hand and says "UNN1" where shared_plots says
               "UNN 1". Compared as spelt, a person ticked for a nursery
               is shown none of it. It cannot widen access — two names with
               different letters or digits give different keys. */
            .filter((p) => allowed === null
              || allowed.some((a) => nurseryKey(a) === nurseryKey(p.nursery_name)))
            .map((p) => p.nursery_name)
            .filter(Boolean)
        ),
      ];
      if (!nurseries.length) {
        if (live.current) setSum({ totals: {}, done: {}, month, scheduled: false });
        return;
      }
      // The office files under BNN / UNN1; shared_plots says "UNN 1". Ask
      // for both spellings and keep whichever comes back.
      const keys = [...new Set(nurseries.flatMap((n) => [n, nurseryKey(n)]))];
      /* The plan, and what the week's work takes out of the store. The
         capacity read is allowed to fail on its own: a card that shows the
         counts is worth having even where the figures cannot be worked
         out, and they are the optional half of it. */
      const [schedule, cap] = await Promise.all([
        loadSchedules(keys, month),
        loadCapacity().catch(() => null),
      ]);
      const all = withQueued(records, queued);
      const capacityOf = cap ? makeCapacity(cap) : null;
      const coverageOf = cap ? makeCoverage(cap.chemicals, cap.preset) : null;

      // Kept week by week rather than summed. The board shows one week at
      // a time and you step between them, so a month-wide total would have
      // to be un-summed again to answer "what is due now".
      const byWeek = {};
      WEEKS.forEach((w) => {
        const tasks = mergeWeekTasks(schedule, w);
        const totals = {};
        const done = {};
        WORK_TYPES.forEach((wt) => {
          const list = tasks[wt.key] || [];
          totals[wt.key] = list.length;
          done[wt.key] = list.filter((x) =>
            isJobDone(all, {
              workTypeKey: wt.key, plot: x.plot, chemical: x.chemical, week: w, month,
            })
          ).length;
        });
        byWeek[w] = { totals, done };
        /* How much chemical, fertiliser and sticker this week comes to —
           the same arithmetic the office prints under each work and the
           module's own board shows under each job. See usage.js. */
        if (capacityOf) {
          byWeek[w].usage = weekUsage(schedule, w, { capacityOf, coverageOf });
        }
      });

      const next = { byWeek, month, scheduled: schedule.length > 0 };
      if (!live.current) return;
      setSum(next);
      setFailed(false);
      cacheSet(CACHE_KEY, next);
    } catch (e) {
      // Offline, or the tables are not set up on this project yet. Whatever
      // was cached stays on screen; a portal that cannot reach the office
      // must still show the modules below.
      if (live.current) setFailed(true);
    }
  };

  useEffect(() => {
    const live = { current: true };
    loadBoard(live);
    return () => { live.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedSig, month]);

  // A month the office has not planned yet, or one with nothing due, has no
  // dials to draw. The card itself stays up regardless — it carries the one
  // "See All" door through to the module now that the module has no tile of
  // its own on the dashboard, and a card that vanished with nothing due
  // would take that door away exactly when there is nothing on screen to
  // explain where it went.
  const anyWork = useMemo(
    () =>
      !!sum &&
      WEEKS.some((w) =>
        WORK_TYPES.some((wt) => ((sum.byWeek?.[w]?.totals || {})[wt.key] || 0) > 0)
      ),
    [sum]
  );

  const thisWeek = weekOfDate(todayStr());
  const wk = (sum && sum.byWeek && sum.byWeek[week]) || { totals: {}, done: {} };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden mb-4 shadow-[0_4px_16px_rgba(0,0,0,.06)]">
      {/* Same strip as Today's Collection — bg-emerald-50, the same
          px-4 py-2.5 border-b — so the two cards read as one family rather
          than one tinted and one plain. Its own border-b is the line
          between the title and the week stepper below; the stepper gets a
          second one of its own, separating it from the dials in turn. */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 bg-emerald-50">
        <span className="font-black uppercase tracking-widest text-[11px] sm:text-xs text-teal-800 truncate flex items-center gap-1.5">
          <Icon name="tool" className="w-3.5 h-3.5 shrink-0" /> {t('mtb.title')}
        </span>
        {/* The month badge used to sit here on its own, just a label. The
            card's one door into the module belongs on its own header —
            the ordinary place a "See All" sits on a summary card — so it
            takes the month's place instead. The ⓘ that stood beside it
            moves down to the foot of the card; see there for why. */}
        <Link to="/maintenance"
          className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-black text-teal-700 uppercase tracking-widest hover:text-teal-900 no-underline">
          {t('mtb.footer')} <span aria-hidden="true">›</span>
        </Link>
      </div>

      {/* Which week. The arrows stop at the ends rather than wrapping —
          week 4 rolling round to week 1 reads as the month having changed. */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200">
        <NavArrow
          dir="prev"
          disabled={week <= WEEKS[0]}
          onClick={() => setWeek((w) => Math.max(WEEKS[0], w - 1))}
          label={t('mtb.prevWeek')}
        />
        <div className="text-center leading-tight min-w-0">
          <div className="text-[12px] font-black text-teal-800 uppercase tracking-wide">
            {t('mt.weekN', { n: week })}
            {week === thisWeek && <span className="text-teal-600"> · {t('mt.thisWeek')}</span>}
          </div>
          <div className="text-[10px] font-bold text-teal-600">{weekDates(week, month)}</div>
        </div>
        <NavArrow
          dir="next"
          disabled={week >= WEEKS[WEEKS.length - 1]}
          onClick={() => setWeek((w) => Math.min(WEEKS[WEEKS.length - 1], w + 1))}
          label={t('mtb.nextWeek')}
        />
      </div>

      {!sum ? (
        <div className="px-4 py-5 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest">
          {failed ? t('mtb.unavailable') : t('common.loading')}
        </div>
      ) : !anyWork ? (
        <div className="px-4 py-5 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest">
          {t('mtb.noProgram')}
        </div>
      ) : (
        /* All four jobs on one row. Four dials fit a 360px phone at ~78px a
           column, which keeps the ring readable and the whole board shorter
           than the stack of bars it replaced. */
        <div className="grid grid-cols-4 gap-1.5 sm:gap-3 p-3">
          {WORK_TYPES.map((wt) => {
            const total = wk.totals[wt.key] || 0;
            const doneN = wk.done[wt.key] || 0;
            const pct = total ? Math.round((doneN / total) * 100) : 0;
            const clear = total > 0 && doneN >= total;
            const tint = tintOf(wt.key);
            /* Tapping a dial pops the record form straight open, for this
               job and whichever week is on screen — the same thing tapping
               it does from inside the module itself (WeekBoard's own
               onOpen), just reached one tap sooner. A login without record
               permission gets the plain, unclickable dial it always had. */
            const Dial = mayRecord ? 'button' : 'div';
            return (
              <Dial
                key={wt.key}
                type={mayRecord ? 'button' : undefined}
                onClick={mayRecord ? () => setQuickEntry({ workTypeKey: wt.key }) : undefined}
                className={`flex flex-col items-center ${total ? '' : 'opacity-50'} ${
                  mayRecord ? 'cursor-pointer' : ''
                }`}
              >
                <ProgressDial
                  pct={pct}
                  ringCls={clear ? 'text-emerald-500' : total ? tint.ring : 'text-slate-200'}
                >
                  <WorkIcon
                    workKey={wt.key}
                    className={`w-[26px] h-[26px] sm:w-8 sm:h-8 ${total ? tint.fg : 'text-slate-300'}`}
                  />
                </ProgressDial>

                {/* Two lines reserved for the name so all four columns line
                    their numbers up, and clamped there so the Malay names —
                    "Penyemburan Racun Kulat & Serangga" — cannot push one
                    column taller than the rest. */}
                <span className="mt-1.5 text-[9px] sm:text-[10px] font-black uppercase tracking-wide text-slate-500 leading-[1.2] text-center line-clamp-2 min-h-[22px]">
                  {workTypeLabel(wt, lang)}
                </span>

                <span className="text-[10px] sm:text-[11px] font-black tabular-nums leading-none text-slate-400">
                  {total ? (
                    <>
                      <span className={clear ? 'text-emerald-600' : 'text-slate-700'}>
                        {clear ? <Icon name="check" className="w-3 h-3 inline-block" /> : doneN.toLocaleString()}
                      </span>
                      {!clear && `/${total.toLocaleString()}`}
                    </>
                  ) : (
                    t('mtb.none')
                  )}
                </span>
              </Dial>
            );
          })}
        </div>
      )}

      {/* The "Updated HH:MM" stamp used to read here. The ⓘ that opens what
          the week takes out of the store moves down to take its place —
          the header's top-right is the one door into the module now (the
          See All link above), so the card's other button, the one that
          opens something ON this card rather than leaving it, belongs at
          the card's own foot instead. */}
      <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-end">
        <button
          onClick={() => setShowInfo(true)}
          title={t('mtb.maxUse')}
          aria-label={t('mtb.maxUse')}
          className="grid place-items-center w-6 h-6 rounded-full border border-teal-200 text-teal-600 text-[11px] font-black italic hover:bg-teal-50 transition-colors cursor-pointer shrink-0"
        >
          i
        </button>
      </div>

      {showInfo && (
        <SchedulePopover
          t={t} lang={lang} month={month} week={week}
          usage={wk.usage} totals={wk.totals}
          onClose={() => setShowInfo(false)}
        />
      )}

      {quickEntry && (
        <MaintenanceQuickEntry
          week={week}
          workTypeKey={quickEntry.workTypeKey}
          onClose={() => { setQuickEntry(null); loadBoard(); }}
        />
      )}
    </div>
  );
}

/** What the i button opens. There is no programme feed behind it yet, so it
    says so plainly instead of showing an empty list that looks broken. */
/**
 * What this week takes out of the store.
 *
 * The ⓘ said "no programme listed yet" whatever the month held — a button
 * that only ever had one answer. The question worth asking of the front page
 * is how much to sign out, so that is what it answers now: per job, each
 * chemical, fertiliser and sticker with the amount that week's plots come to.
 *
 * One line per product, never one added-up number. Two products are two
 * things to draw, and litres of Becker do not add to kilograms of Antracol.
 */
function SchedulePopover({ t, lang, month, week, usage, totals, onClose }) {
  const jobs = WORK_TYPES
    .map((wt) => ({ wt, rows: (usage && usage[wt.key]) || [], due: (totals || {})[wt.key] || 0 }))
    .filter((j) => j.rows.length > 0);
  /* Nothing to show has two different causes, and they are not the same
     sentence. No plan at all is the office's; a plan whose figures could not
     be worked out is this phone's, and saying "no programme" for it would
     send a Field Conductor asking the office about a schedule that exists. */
  const anyDue = WORK_TYPES.some((wt) => ((totals || {})[wt.key] || 0) > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 pb-7 shadow-2xl
                      max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-black text-slate-800 text-[14px] uppercase tracking-wide">
            {t('mtb.maxUse')}
          </h3>
          <button
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer shrink-0"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">
          {month} · {t('mt.weekN', { n: week })}
        </div>

        {jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-[12px] font-bold text-slate-400">
            {anyDue ? t('mtb.noFigures') : t('mtb.noProgram')}
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map(({ wt, rows, due }) => {
              const tint = tintOf(wt.key);
              return (
                <div key={wt.key} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className={`flex items-center gap-2 px-3 py-2 ${tint.bg || 'bg-slate-50'}`}>
                    <WorkIcon workKey={wt.key} className={`w-4 h-4 shrink-0 ${tint.fg}`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 truncate">
                      {workTypeLabel(wt, lang)}
                    </span>
                    <span className="ml-auto text-[10px] font-black tabular-nums text-slate-400 shrink-0">
                      {t('mtb.plotsN', { n: due.toLocaleString() })}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <div key={r.name} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                        <span className="text-[12px] font-bold text-slate-600 truncate">{r.name}</span>
                        <span className="text-[12px] font-black tabular-nums text-slate-800 shrink-0">
                          {r.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {/* A plot whose capacity this phone has no figure for is left out
                of the sums rather than counted as nothing, so a partial answer
                says that it is partial. */}
            {(usage && usage.missing && usage.missing.length > 0) && (
              <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {t('mtb.noCap', { plots: usage.missing.join(', ') })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
