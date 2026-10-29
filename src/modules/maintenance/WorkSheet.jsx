import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../../context/LanguageContext.jsx';
import GpsTrack from './GpsTrack.jsx';
import { workTypeLabel } from './helpers.js';
import PhotoSlots from './PhotoSlots.jsx';
import WhoDidIt from './WhoDidIt.jsx';
import { batchesIn } from './plotBatches.js';
import WorkIcon from './WorkIcons.jsx';
import Icon from '../../components/Icon.jsx';
import { numText } from '../../lib/numberText.js';

/** Enough to show the work from more than one angle, few enough that a
    morning in the field does not turn into a bill for storage. */
const MAX_PHOTOS = 3;

/* A job is a plot AND what is being put on it: P & D is two sprays on the
   same plot on the same day, and each is recorded on its own. */
const taskKey = (x) => `${x ? x.plot : ''}|${(x && x.chemical) || ''}`;

/* "Antracol 50gm + Bond 15mL" → "Antracol". Just enough to tell one spray
   from the other on a chip the size of a thumb. */
const shortChemical = (c) => String(c || '').split(/\s*\+\s*/)[0].replace(/\s+[\d.].*$/, '');


/**
 * Recording one job from the schedule.
 *
 * The plots the office asked for are listed at the top — tap one and the form
 * below fills itself in. Date, work, chemical and plot all come from the
 * schedule and cannot be typed over: the Field Conductor is confirming the job
 * was done, not deciding what it was. The only two things they enter are which
 * batches were in the plot and a remark.
 */
export default function WorkSheet({
  workType, week, weekDates, month, tasks, batchMap, isDone, isAdmin,
  today, saving, onSave, onClose, allowPhotos = true, workers = null,
  /* Which parts of this form the office has left switched on for the person
     holding the phone. All on unless somebody said otherwise; GPS off unless
     somebody asked for it. See modules/maintenance/functions.js. */
  showBatches = true, showGps = false, showRemark = true,
}) {
  const { t, lang } = useLang();
  const [plot, setPlot] = useState(null);      // the task being recorded
  const [batches, setBatches] = useState([]);
  const [remark, setRemark] = useState('');
  // One entry per slot, null where the slot is still empty — so a photo keeps
  // the numbered place it was taken in rather than shuffling up when an
  // earlier one is cleared.
  const [photos, setPhotos] = useState(() => Array(MAX_PHOTOS).fill(null));
  // Whose work this was, when the conductor is keying it for somebody else.
  const [workedBy, setWorkedBy] = useState([]);
  // Where the phone was when the job was written down. Null until the stamp
  // is taken, and null is a perfectly good answer — it never blocks a save.
  const [gps, setGps] = useState(null);


  /* Work already recorded is not re-recordable: a second save would be a
     second record of the same job, and correcting one is the office's to do.
     An admin may still open a done plot, because somebody has to be able to
     put a mistake right. */
  const canOpen = (task) => isAdmin || !isDone(task);

  // Open on the first plot still to do; for an admin, the first one either way.
  useEffect(() => {
    const next = tasks.find((x) => !isDone(x)) || (isAdmin ? tasks[0] : null);
    setPlot(next);
    setBatches([]);
    setRemark('');
    setPhotos(Array(MAX_PHOTOS).fill(null));
    setWorkedBy([]);
    setGps(null);
  }, [workType.key, week]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Plots the schedule asks for twice this week — the pest spray and the
  // disease spray. Only those chips need the chemical spelt out under them.
  const twiceOver = useMemo(() => {
    const seen = new Set(), twice = new Set();
    tasks.forEach((x) => { if (seen.has(x.plot)) twice.add(x.plot); else seen.add(x.plot); });
    return twice;
  }, [tasks]);

  const taken = photos.filter(Boolean);

  const plotBatches = useMemo(
    () => (plot ? batchesIn(batchMap, plot.plot) : []),
    [batchMap, plot]
  );

  function pick(task) {
    setPlot(task);
    setBatches([]);
    setRemark('');
    setPhotos(Array(MAX_PHOTOS).fill(null));
    setWorkedBy([]);
    setGps(null);
  }

  // The seedlings worked on ARE the batches ticked, so the quantity is their
  // sum rather than a second figure that could disagree with the first.
  const qty = useMemo(
    () => plotBatches.filter((b) => batches.includes(b.batch))
                     .reduce((sum, b) => sum + Number(b.qty || 0), 0),
    [plotBatches, batches]
  );

  const toggleBatch = (name) =>
    setBatches((b) => (b.includes(name) ? b.filter((x) => x !== name) : [...b, name]));

  const field = 'w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-[14px] font-bold text-slate-700';
  const label = 'block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
         onClick={onClose}>
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[92vh] overflow-y-auto shadow-2xl"
           onClick={(e) => e.stopPropagation()}>

        {/* What and when */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
            <WorkIcon workKey={workType.key} className="w-7 h-7 text-slate-700" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-black text-slate-800 leading-tight">
              {workTypeLabel(workType, lang)}
            </h3>
            <div className="text-[11px] font-bold text-slate-400">
              {t('mt.weekN', { n: week })} · {weekDates} · {month}
            </div>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 font-black shrink-0 flex items-center justify-center"><Icon name="close" className="w-4 h-4" /></button>
        </div>

        {/* The plots the schedule asks for */}
        <div className="px-5 pt-4">
          <div className={label}>{t('mt.plotsToDo', { n: numText(tasks.length) })}</div>
          {tasks.length === 0 ? (
            <div className="text-[13px] font-bold text-slate-400 py-2">{t('mt.nothingDue')}</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tasks.map((x, i) => {
                const done = isDone(x);
                const on = plot && taskKey(plot) === taskKey(x);
                const locked = done && !isAdmin;
                return (
                  <button key={taskKey(x) + i}
                    disabled={locked}
                    title={locked ? t('mt.alreadyRecorded') : undefined}
                    onClick={() => canOpen(x) && pick(x)}
                    className={`px-3 py-2 rounded-xl text-[13px] font-black border-2 transition-colors text-left ${
                      on ? 'bg-emerald-600 text-white border-emerald-700'
                         : locked ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-default'
                         : done ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-white text-slate-700 border-slate-200'}`}>
                    {done ? <Icon name="check" className="w-3 h-3 inline-block mr-0.5" /> : ''}{x.plot}
                    {twiceOver.has(x.plot) && x.chemical && (
                      <span className={`block text-[9px] font-bold leading-tight ${
                        on ? 'text-emerald-100' : 'text-slate-400'}`}>
                        {shortChemical(x.chemical)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!plot && tasks.length > 0 && (
          <div className="px-5 py-6 text-center">
            <div className="text-[14px] font-black text-emerald-700">{t('mt.allRecorded')}</div>
            <div className="text-[12px] font-bold text-slate-400 mt-1">{t('mt.allRecordedHint')}</div>
          </div>
        )}

        {plot && (
          <div className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={label}>{t('mt.date')}</span>
                {/* Today, as the form is filled in. Not editable: a record is
                    what happened today, not a date someone can move. */}
                <div className={field}>{today}</div>
              </div>
              <div>
                <span className={label}>{t('mt.plot')}</span>
                <div className={field}>{plot.plot}</div>
              </div>
            </div>
            <div>
              <span className={label}>{t('mt.work')}</span>
              <div className={field}>{workTypeLabel(workType, lang)}</div>
            </div>
            <div>
              <span className={label}>{t('mt.chemical')}</span>
              <div className={field}>{plot.chemical || t('mt.noChemical')}</div>
            </div>

            {/* The only real choice on this form */}
            {showBatches && (
            <div>
              <span className={label}>{t('mt.batchesInPlot')}</span>
              {plotBatches.length === 0 ? (
                <div className="text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                  {t('mt.noBatches', { plot: plot.plot })}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {plotBatches.map((b) => (
                    <label key={b.batch}
                      className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 cursor-pointer ${
                        batches.includes(b.batch) ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}>
                      <input type="checkbox" className="w-5 h-5 accent-emerald-600 shrink-0"
                        checked={batches.includes(b.batch)}
                        onChange={() => toggleBatch(b.batch)} />
                      <span className="font-black text-slate-800 text-[14px] flex-1 min-w-0">{b.batch}</span>
                      {/* A negative balance is the office's own figure — the
                          movement report shows it too. Marked so it reads as
                          a number to query, not as stock standing there. */}
                      <span className={`text-[12px] font-bold shrink-0 tabular-nums ${
                        b.qty < 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {numText(b.qty)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* Proof the work was done. Same numbered slots as the plot audit,
                and every picture is shrunk before it leaves the phone. */}
            <div>
              {/* Only where they can actually be uploaded. A worker signed
                  in with a PIN is `anon`, and the documents bucket takes
                  uploads from `authenticated` only — a camera here would
                  fail every time it was pressed. */}
              {/* Only a Field Conductor is handed a roster: a worker
                  recording their own morning is the answer already. */}
              {workers && (
                <WhoDidIt workers={workers} value={workedBy} onChange={setWorkedBy} t={t} />
              )}

              {showGps && <GpsTrack value={gps} onChange={setGps} />}

              {allowPhotos && <>
                <span className={label}>{t('mt.photos', { n: MAX_PHOTOS })}</span>
                <PhotoSlots value={photos} onChange={setPhotos} max={MAX_PHOTOS} />
              </>}
            </div>

            {showRemark && (
            <div>
              <span className={label}>{t('mt.remark')}</span>
              <textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)}
                placeholder={t('mt.remarkHint')}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-[14px] font-semibold text-slate-800 outline-none focus:border-emerald-500" />
            </div>
            )}

            <button
              disabled={saving}
              onClick={() => onSave({ task: plot, batches, remark, photos: taken, qty, workedBy, gps })}
              className="w-full rounded-2xl bg-emerald-600 disabled:bg-slate-300 text-white font-black uppercase tracking-widest text-[13px] py-3.5">
              {saving ? t('common.saving') : isDone(plot) ? t('mt.saveCorrection') : t('mt.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
