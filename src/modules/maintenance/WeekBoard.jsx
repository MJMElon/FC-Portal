import { useLang } from '../../context/LanguageContext.jsx';
import { WORK_TYPES, workTypeLabel } from './data.js';
import ProgressDial from './ProgressDial.jsx';
import { weekDates } from './schedule.js';
import { tintOf } from './tints.js';
import WorkIcon from './WorkIcons.jsx';

/** One week-stepper arrow, the same control the front page's board uses. */
function NavArrow({ dir, onClick, label }) {
  return (
    <button
      type="button" onClick={onClick} title={label} aria-label={label}
      className="grid place-items-center w-8 h-8 rounded-full border border-teal-300 text-teal-700
                 hover:bg-teal-100 active:scale-95 transition shrink-0 cursor-pointer"
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dir === 'prev' ? <path d="m15 5-7 7 7 7" /> : <path d="m9 5 7 7-7 7" />}
      </svg>
    </button>
  );
}

/**
 * The week's work, as the front page already draws it.
 *
 * The dashboard's Maintenance Status card is the shape this question has
 * settled into — four dials on one row, the week stepped through the header,
 * the ring answering "how far behind" before anybody reads a number. A Field
 * Conductor who has learned that card on the front page should not have to
 * learn a second layout for the same four jobs inside the module.
 *
 * The one difference, and it is the point of the module: here the dials are
 * buttons. Tapping one opens the record form for that job's plots.
 *
 * Unlike the front page's card the arrows never stop — they walk off the end
 * of a month into the one either side, because catching up on the last days
 * of last month is ordinary and the schedule being filed per month is not
 * the conductor's problem.
 */
export default function WeekBoard({
  month, week, isNow, counts, doneCounts, onPrev, onNext, onNow, onOpen,
  /* How much to draw from the store for each job THIS week, as
     { pd: [{ name, text }], … } — see usage.js. Absent on a phone with no
     capacity table and on the Worker Portal, which is not asked to sign
     anything out; the column then simply carries no figures. */
  usage = null,
  /* True when this phone is drawing a plan it has never actually loaded.
     Without it the footer says "you're all clear" over four empty jobs,
     which is the difference between a conductor going home and a conductor
     finding some signal. */
  noPlan = false,
}) {
  const { t, lang } = useLang();
  const wkCounts = counts || {};
  const wkDone = doneCounts || {};

  const totalDue = WORK_TYPES.reduce((n, wt) => n + (wkCounts[wt.key] || 0), 0);
  const totalDone = WORK_TYPES.reduce((n, wt) => n + (wkDone[wt.key] || 0), 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,.06)]">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-teal-50">
        <div className="flex items-center justify-between gap-2">
          <span className="font-black uppercase tracking-widest text-[11px] sm:text-xs text-teal-800 truncate">
            🛠️ {t('mt.weeklyTasks')}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-black text-teal-700">{month}</span>
            {/* Only when it goes somewhere. A dead "Now" on the week you are
                already in is a control that has to be read and discarded. */}
            {!isNow && (
              <button type="button" onClick={onNow}
                className="rounded-full bg-teal-600 hover:bg-teal-700 text-white px-2.5 py-1
                           font-black text-[9px] uppercase tracking-widest cursor-pointer">
                {t('mt.now')}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-2">
          <NavArrow dir="prev" onClick={onPrev} label={t('mt.lastWeek')} />
          <div className="text-center leading-tight min-w-0">
            <div className="text-[12px] font-black text-teal-800 uppercase tracking-wide">
              {t('mt.weekN', { n: week })}
              {isNow && <span className="text-teal-600"> · {t('mt.thisWeek')}</span>}
            </div>
            <div className="text-[10px] font-bold text-teal-600">{weekDates(week, month)}</div>
          </div>
          <NavArrow dir="next" onClick={onNext} label={t('mt.nextWeek')} />
        </div>
      </div>

      {/* All four jobs on one row. Four dials fit a 360px phone at ~78px a
          column, which keeps the ring readable however narrow the screen. */}
      <div className="grid grid-cols-4 gap-1.5 sm:gap-3 p-3">
        {WORK_TYPES.map((wt) => {
          const total = wkCounts[wt.key] || 0;
          const doneN = wkDone[wt.key] || 0;
          const pct = total ? Math.round((doneN / total) * 100) : 0;
          const clear = total > 0 && doneN >= total;
          const tint = tintOf(wt.key);
          return (
            <button
              key={wt.key}
              type="button"
              // Nothing due is nothing to record, so the column is not a
              // target — a form listing no plots is a dead end.
              disabled={!total}
              onClick={() => onOpen(week, wt)}
              className={`flex flex-col items-center rounded-2xl py-1.5 transition ${
                total ? 'hover:bg-slate-50 active:scale-[.97] cursor-pointer' : 'opacity-50 cursor-default'}`}
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
                      {clear ? '✓' : doneN}
                    </span>
                    {!clear && `/${total}`}
                  </>
                ) : (
                  t('mtb.none')
                )}
              </span>

              {/* What this job takes out of the store this week. One line per
                  product — the chemical and the sticker that goes in the tank
                  with it are two different things to sign out, so they are
                  two lines and never one added-up number.

                  Only where something is actually due: a figure under a job
                  with no plots is arithmetic about nothing. */}
              {total > 0 && (usage && usage[wt.key] || []).length > 0 && (
                <span className="mt-1 w-full px-0.5 flex flex-col items-center gap-px">
                  {(usage[wt.key] || []).map((u) => (
                    <span key={u.name + u.text}
                      className="w-full text-[8px] sm:text-[9px] font-bold leading-[1.25] text-center">
                      <span className="block truncate text-slate-400">{u.name}</span>
                      <span className="block tabular-nums text-slate-600">{u.text}</span>
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="px-4 py-1.5 border-t border-slate-100 text-[9px] font-bold text-slate-400 flex justify-between gap-3">
        <span className="truncate">
          {totalDue ? t('mt.tapToRecord')
           : noPlan  ? t('mt.weekNoPlan')
                     : t('mt.weekClear')}
        </span>
        {totalDue > 0 && (
          <span className="shrink-0 tabular-nums">{t('mt.weekTally', { done: totalDone, n: totalDue })}</span>
        )}
      </div>
    </div>
  );
}
