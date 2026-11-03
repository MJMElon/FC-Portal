import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../../context/LanguageContext.jsx';
import Icon from '../../components/Icon.jsx';
import { monthLabelOf } from './schedule.js';
import {
  TRANSPLANT_FLOW_FROM,
  asksDate,
  TRANSPLANT_JOBS,
  TRANSPLANT_SETUP_NEEDED,
  TRANSPLANT_NOT_DONE_SETUP_NEEDED,
  isNotDone,
  jobByKey,
  jobLabel,
  loadTransplantingSince,
  loadTransplantRecords,
  saveTransplantRecord,
} from './transplantData.js';
import { numText } from '../../lib/numberText.js';
import { missingJobs, owedForJob, owedQty } from '../../components/verify/pending.js';

const num = (n) => numText(Number(n || 0));

/* The batches ONE RECORD was made for, as the ledger spells them. */
const recBatches = (rec) => String((rec && rec.batch_name) || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/* When a record was saved, as a person reads a date. Falls back through the
   columns a row might have: created_at is the first save, work_date is the
   day it was recorded for, and an older row saved before created_at existed
   has only the latter. */
/* A transplanting date from the ledger — a plain YYYY-MM-DD, no time. */
const plantedOn = (raw) => {
  if (!raw) return '';
  const d = new Date(`${String(raw).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

/* Was this record priced on a figure the report has since moved?
   Compared on the number the record STORED, because that is the number the
   payroll divides among the crew — not the one on screen. */
/* COMPARED AGAINST THE BATCHES THIS RECORD IS FOR, not against the plot's
   whole total. A plot that took a second delivery carries one record for
   the first batch and one for the second, and each is priced on its own
   batch — measuring either against the sum would report every one of them
   as a figure the report has moved. A record with no batch on it falls
   back to the plot total, which is what it always compared against. */
const staleQty = (rec, row) => {
  if (!rec || !row) return false;
  const was = Number(rec.source_qty);
  const now = Number(owedQty(row, recBatches(rec)));
  if (!Number.isFinite(was) || !Number.isFinite(now)) return false;
  return Math.round(was) !== Math.round(now);
};

const savedOn = (rec) => {
  const raw = (rec && (rec.created_at || rec.work_date)) || null;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

/* A record is a correction when it was saved again after the day it was
   first made. Only shown when the two differ — "saved 4 Sep, corrected 4 Sep"
   is noise. */
const correctedOn = (rec) => {
  if (!rec || !rec.updated_at || !rec.created_at) return null;
  const a = new Date(rec.created_at), b = new Date(rec.updated_at);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  if (b.getTime() - a.getTime() < 60000) return null;   // the same save
  return b.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * The transplanting jobs, plot by plot.
 *
 * Opens on the month's transplanting — the office's own figures, not a list
 * anybody typed — and works inwards: which plot, then which of the four
 * jobs, then who did it. That is the order a Field Conductor already thinks
 * in, standing in front of a plot that has just been filled.
 *
 * The month is the one the page is showing. Stepping the week board back a
 * month steps this too, so the two screens can never be talking about
 * different months at the same time.
 */
export default function TransplantSheet({ nursery, month, plotNames, workers, staffName,
                                          mayEdit = false, onClose }) {
  const { t, lang } = useLang();
  const today = new Date().toISOString().slice(0, 10);

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [rows, setRows]       = useState([]);   // the month's transplanting
  const [done, setDone]       = useState([]);   // records already saved
  const [plot, setPlot]       = useState(null); // the plot being worked on
  const [job, setJob]         = useState(null); // the job being recorded

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') (job ? setJob(null) : plot ? setPlot(null) : onClose()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [job, plot, onClose]);

  async function reload() {
    setLoading(true);
    try {
      const [tp, recs] = await Promise.all([
        loadTransplantingSince(plotNames),
        loadTransplantRecords(nursery).catch((e) => {
          if (e && e.message === TRANSPLANT_SETUP_NEEDED) { setSetupNeeded(true); return []; }
          throw e;
        }),
      ]);
      setRows(tp);
      setDone(recs);
      setError(null);
    } catch (e) {
      setError((e && e.message) || String(e));
    }
    setLoading(false);
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [nursery, month]);

  // What is recorded, by plot and job, so a chip can say so without a search.
  const recordOf = useMemo(() => {
    const m = new Map();
    done.forEach((r) => m.set(`${r.plot_name}|${r.work_type}`, r));
    return m;
  }, [done]);

  const row = plot ? rows.find((r) => r.plot === plot) : null;

  /* WHICH JOBS THIS PLOT STILL OWES, by the board's own rule — a job is
     owed again when a batch has arrived that no record of it mentions.
     Asked here rather than "has it any record at all", so the sheet and
     the card that opened it cannot disagree about what is left. */
  const owedJobs = useMemo(
    () => new Set(missingJobs(row ? row.plot : '', done, row ? row.batches : []).map((j) => j.key)),
    [row, done]
  );
  /* And what ONE job is owed FOR: the batches outstanding on it and what
     they came to. This is the figure that reaches `source_qty` and is
     divided among the crew, so it is the 135 and never the 3,303. */
  const jobRow = (key) => {
    if (!row) return row;
    const ow = owedForJob(row, done, key);
    if (ow.batches.length) {
      return { ...row, batches: ow.batches, batch: ow.batches.join(', '), qty: ow.qty };
    }
    /* Nothing owed: the form is a VIEW of the record that answered it, so
       it shows the batch and the figure THAT record was made for — not the
       plot's lifetime total, which on a two-delivery plot is a number that
       record was never about. */
    const rb = recBatches(recordOf.get(`${row.plot}|${key}`));
    return rb.length
      ? { ...row, batches: rb, batch: rb.join(', '), qty: owedQty(row, rb) }
      : row;
  };

  /* THE MONTH FOLLOWS THE DATE THE WORK WAS DONE, not the board.
     It used to be the board's month with `today` as the date, which is right
     only while a conductor records a job the same month he does it. He does
     not always: a September job keyed in October filed itself under October,
     so September's salary claim was short by it and October's carried work
     nobody did in October — and neither screen could say so, because the
     record held no date but the day it was keyed.

     UNTIL TRANSPLANT_DATE_FROM the form does not ask, and this falls back to
     exactly what it did before — the board's month, dated today. The office
     asked for the change to start at a month boundary rather than part way
     through a claim that is half made. */
  async function save(payload) {
    const asking = asksDate(today);
    const when = (asking && payload.date) || today;
    /* THE BATCHES AND THE FIGURE ARE THE JOB'S OWN, not the plot's. A
       second delivery is a second crew and a second record: what goes in
       is 135 against batch 271, and September's 3,168 against 269 is left
       exactly as it was. */
    const jr = jobRow(payload.workTypeKey);
    /* ONE RECORD PER PLOT PER JOB PER MONTH is the unique key, so a second
       delivery recorded in the SAME month as the first would REPLACE it —
       a crew's pay overwritten by the next crew's, silently. It cannot be
       merged either: they are two crews. So it is refused, naming the
       record that is in the way; dating the work in the month it was
       actually done is the answer, and that is what the date box is for. */
    const clash = (done || []).find((r) => r
      && r.plot_name === row.plot && r.work_type === payload.workTypeKey
      && r.schedule_month === (asking ? monthLabelOf(when) : month)
      && String(r.id) !== String(payload.id || ''));
    if (clash) {
      throw new Error(t('tp.monthTaken', {
        b: clash.batch_name || '—', d: String(clash.work_date || '').slice(0, 10),
        m: asking ? monthLabelOf(when) : month,
      }));
    }
    await saveTransplantRecord({
      ...payload,
      nursery, month: asking ? monthLabelOf(when) : month, date: when,
      plot: row.plot, batch: jr.batch, sourceQty: jr.qty,
      reportedBy: staffName,
    });
    setJob(null);
    await reload();
  }

  const title = job ? jobLabel(jobByKey(job), lang) : plot || t('tp.title');
  const back  = job ? () => setJob(null) : plot ? () => setPlot(null) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-100 w-full sm:max-w-[640px] rounded-t-3xl sm:rounded-3xl
                      shadow-2xl h-[92vh] sm:h-[86vh] flex flex-col overflow-hidden">

        <div className="shrink-0 bg-white border-b border-slate-200 px-5 pt-4 pb-3 flex items-center gap-3">
          {back && (
            <button onClick={back} aria-label={t('common.back')}
              className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-500 shrink-0 grid place-items-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor"
                   strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 5-7 7 7 7" />
              </svg>
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-black text-slate-800 text-[15px] uppercase tracking-wide truncate">
              <Icon name="seedling" className="w-3.5 h-3.5 inline-block align-[-3px]" /> {title}
            </h3>
            <div className="text-[11px] font-bold text-slate-400 truncate">
              {/* The plot list is not one month's any more, so it must not
                  carry a month over it — a list showing August plots under
                  the word "Sep 2026" is the header contradicting the rows.
                  Inside a plot the month is back, because that IS the month a
                  record saved here is paid in. */}
              {(plot
                ? [nursery, month, row ? t('tp.nPlanted', { n: num(row.qty) }) : null]
                : [nursery, t('tp.since', { d: plantedOn(TRANSPLANT_FLOW_FROM) })]
              ).filter(Boolean).join(' · ')}
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-500 text-xl shrink-0">×</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {setupNeeded ? (
            <Notice text={t('tp.setupNeeded')} />
          ) : loading ? (
            <div className="text-center text-slate-400 text-xs font-black uppercase tracking-widest py-16 animate-pulse">
              {t('common.loading')}
            </div>
          ) : error ? (
            <Notice text={t('mt.loadErr', { msg: error })} />
          ) : job && row ? (
            <JobForm
              job={jobByKey(job)} row={jobRow(job)} workers={workers}
              /* A JOB THAT OWES A NEW BATCH OPENS BLANK. The record on the
                 plot is September's crew for batch 269; opening the form
                 on it would make October's 135 a CORRECTION of it, and
                 saving would overwrite somebody's pay. It is shown as the
                 line above the ticks instead, which is what it is: what
                 was recorded before, for another delivery. */
              existing={owedJobs.has(job) ? null : recordOf.get(`${row.plot}|${job}`)}
              prior={owedJobs.has(job) ? recordOf.get(`${row.plot}|${job}`) : null}
              mayEdit={mayEdit} today={today}
              onSave={save} t={t} lang={lang}
            />
          ) : row ? (
            <JobList row={row} records={done} recordOf={recordOf} owedJobs={owedJobs}
              onPick={setJob} t={t} lang={lang} />
          ) : (
            <PlotList rows={rows} records={done} recordOf={recordOf} onPick={setPlot} t={t} />
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ text }) {
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-4
                    text-[13px] font-bold leading-relaxed">{text}</div>
  );
}

/** Every plot the report says was transplanted this month. */
function PlotList({ rows, records, recordOf, onPick, t }) {
  if (!rows.length) {
    return <Notice text={t('tp.nothingSince', { d: plantedOn(TRANSPLANT_FLOW_FROM) })} />;
  }
  /* Unfinished first, newest of those at the top; everything finished below.
     The list no longer empties at the end of a month, so without this a plot
     still waiting on a job would sink under every plot already done as the
     months went by — which is the one thing this screen exists to surface. */
  /* COUNTED BY WHAT IS STILL OWED, not by what has any record at all. A
     plot whose four jobs were recorded for September's delivery and that
     took another in October owes all four again — it read 4/4 ALL DONE
     while the board beside it was raising it. */
  const doneOf = (r) => TRANSPLANT_JOBS.length - missingJobs(r.plot, records, r.batches).length;
  /* A PLOT WITH A JOB NOBODY DID IS ANSWERED, NOT FINISHED. All four
     questions have been answered, which is what takes it off the
     Verification board and puts it under "finished" here -- but a green
     ALL DONE over a blanket spray that never happened is the list claiming
     work that was not carried out. So it sorts as finished and says
     ANSWERED, in slate, and the job list one tap away says which. */
  const skipOf = (r) => TRANSPLANT_JOBS.some((j) => isNotDone(recordOf.get(`${r.plot}|${j.key}`)));
  const ordered = [...rows].sort((a, b) => {
    const fa = doneOf(a) === TRANSPLANT_JOBS.length, fb = doneOf(b) === TRANSPLANT_JOBS.length;
    if (fa !== fb) return fa ? 1 : -1;
    return String(b.last).localeCompare(String(a.last))
        || a.plot.localeCompare(b.plot, undefined, { numeric: true });
  });
  const firstDone = ordered.findIndex((r) => doneOf(r) === TRANSPLANT_JOBS.length);
  const heading = (i) =>
    i === 0 && firstDone !== 0 ? t('tp.stillToDo')
    : i === firstDone ? t('tp.finished') : null;

  return (
    <div className="space-y-2.5">
      {ordered.map((r, i) => {
        const n = doneOf(r);
        const head = heading(i);
        return (
          <div key={`g-${r.plot}`} className="space-y-2.5">
          {head && (
            <div className={`text-[10px] font-black text-slate-400 uppercase tracking-widest px-1${
              i === 0 ? '' : ' pt-2'}`}>{head}</div>
          )}
          <button key={r.plot} type="button" onClick={() => onPick(r.plot)}
            className="w-full bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)]
                       p-3.5 text-left hover:border-emerald-400 active:scale-[.99] transition">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-black text-slate-800 text-[15px]">{r.plot}</div>
                <div className="text-[11.5px] font-bold text-slate-400 mt-0.5">
                  {[r.batch && t('tp.batchN', { b: r.batch }), t('tp.nPlanted', { n: num(r.qty) })]
                    .filter(Boolean).join(' · ')}
                </div>
                {/* WHEN it was transplanted. The list is no longer one month's,
                    so the date is no longer implied by the board above it —
                    and it is what tells a plot still waiting on a job from
                    last month apart from one filled this morning. */}
                {r.last && (
                  <div className="text-[10.5px] font-bold text-slate-400 mt-0.5">
                    {t('tp.plantedOn', { d: plantedOn(r.last) })}
                  </div>
                )}
              </div>
              {/* How far through the four jobs this plot is — the question
                  the list is scanned for. */}
              <span className={`shrink-0 text-[10px] font-black uppercase tracking-widest rounded-full px-2.5 py-1 ${
                n === TRANSPLANT_JOBS.length
                  ? (skipOf(r) ? 'bg-slate-200 text-slate-600 border border-slate-300'
                               : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
                  : n ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                {n === TRANSPLANT_JOBS.length
                  ? (skipOf(r) ? t('tp.allAnswered')
                               : (<><Icon name="check" className="w-3 h-3 inline-block align-[-2px]" /> {t('tp.allDone')}</>))
                  : `${n}/${TRANSPLANT_JOBS.length}`}
              </span>
              <span className="text-slate-300 text-[18px] shrink-0">›</span>
            </div>
          </button>
          </div>
        );
      })}
    </div>
  );
}

/** The four jobs for one plot. */
function JobList({ row, records, recordOf, owedJobs, onPick, t, lang }) {
  return (
    <div className="space-y-2.5">
      {TRANSPLANT_JOBS.map((j) => {
        const rec = recordOf.get(`${row.plot}|${j.key}`);
        const who = rec ? (rec.workers || []).map((w) => w.name) : [];
        /* OWED AGAIN IS NOT DONE. A job recorded for an earlier delivery
           still has a record, so the tick used to go green over a batch
           nobody has been paid for. The crew that DID do it stays on the
           row — it is their work — with the outstanding batch under it. */
        const owes = owedJobs ? owedJobs.has(j.key) : !rec;
        const ow = owes && records ? owedForJob(row, records, j.key) : null;
        /* ANSWERED WITH "NOBODY DID IT" IS NOT THE SAME AS ANSWERED, and it
           must not wear the same tick: a green ✓ against a blanket spray
           that never happened is the screen saying the work was done. It is
           not a TO DO either -- somebody has answered the question, which is
           the whole reason the plot is off the board. So it is its own
           state, in slate, saying what it says. */
        const skipped = isNotDone(rec);
        return (
          <button key={j.key} type="button" onClick={() => onPick(j.key)}
            className="w-full bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)]
                       p-3.5 text-left hover:border-emerald-400 active:scale-[.99] transition">
            <div className="flex items-start gap-3">
              <span className="w-[38px] h-[38px] rounded-xl bg-slate-100 grid place-items-center shrink-0 text-[18px]">
                {j.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-black text-slate-800 text-[14px] leading-tight">
                  {jobLabel(j, lang)}
                </div>
                <div className={`text-[11.5px] font-bold mt-0.5 break-words ${
                  skipped ? 'text-slate-500' : 'text-slate-400'}`}>
                  {skipped ? t('tp.notDoneWho')
                    : who.length ? who.join(', ') : t('tp.notRecorded')}
                </div>
                {/* WHICH DELIVERY IS STILL OWED, and what it came to. On a
                    job with a crew already on it this is the whole reason
                    the row is not finished, and the figure is what the next
                    crew will be paid — so it is the one that has to be on
                    screen, not the plot's lifetime total. */}
                {ow && rec && ow.batches.length > 0 && (
                  <div className="text-[11.5px] font-black text-amber-700 mt-1 leading-snug">
                    {t('tp.owesBatch', { b: ow.batches.join(', '), n: num(ow.qty) })}
                  </div>
                )}
                {/* WHEN it was saved, on the list. A record's date is the
                    first thing asked about it and the last thing anybody
                    wants to open four forms to find. */}
                {rec && savedOn(rec) && (
                  <div className="text-[10.5px] font-bold text-slate-400 mt-1">
                    <Icon name="lock" className="w-3 h-3 inline-block align-[-2px]" /> {t('tp.savedOn', { d: savedOn(rec) })}
                    {correctedOn(rec) ? ` · ${t('tp.correctedOn', { d: correctedOn(rec) })}` : ''}
                    {rec.reported_by ? ` · ${rec.reported_by}` : ''}
                  </div>
                )}
                {/* The record stored the plot's quantity as it stood when it
                    was saved, and the payroll prices from THAT, not from the
                    report. So a plot whose report figure has since moved —
                    a delivery keyed in late, a row that was undated until
                    now — has records that quietly pay the old number. Said
                    here, on the job, because that is where it is fixed. */}
                {rec && staleQty(rec, row) && (
                  <div className="text-[10.5px] font-black text-amber-700 mt-1 leading-snug">
                    <Icon name="warning" className="w-3 h-3 inline-block align-[-2px]" /> {t('tp.qtyMoved', { was: num(rec.source_qty), now: num(row.qty) })}
                  </div>
                )}
                {/* The split, where there is one. Seeing it on the list is
                    what stops somebody opening all four to find it. A job
                    nobody did has no split to show. */}
                {rec && j.split && !skipped && (
                  <div className="text-[11px] font-black text-slate-600 mt-1 tabular-nums">
                    {(rec.workers || []).map((w) => `${w.name} ${num(w.qty)}`).join('  ·  ')}
                  </div>
                )}
              </div>
              <span className={`shrink-0 text-[9px] font-black uppercase tracking-widest rounded-full px-2 py-1 ${
                owes ? (rec ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200')
                : skipped ? 'bg-slate-200 text-slate-600 border border-slate-300'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                {owes ? t('tp.todo')
                  : skipped ? t('tp.notDoneTag')
                  : <Icon name="check" className="w-3 h-3 inline-block" />}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Recording one job.
 *
 * The plot and the quantity are shown and not editable — they are the
 * report's, and a figure somebody can nudge on a phone is a figure the
 * office has to reconcile later. What is asked for is who.
 *
 * ONCE SAVED, THE RECORD IS CLOSED. The payroll pays a month on the strength
 * of these names: the plot's quantity is divided among the people ticked here
 * and that is what each of them is paid. A record anybody can reopen and
 * retick is a month's pay anybody can move from one name to another, after
 * the claim has been read and possibly after it has been paid — and nothing
 * on either screen would say it had happened.
 *
 * So a saved record is read-only, and reopening it takes its own tick:
 * Setting → a person → Maintenance → Edit transplanting record. The tick
 * fails closed, like the other two corrections — see canMaintCorrect.
 */
function JobForm({ job, row, workers, existing, prior, mayEdit, today, onSave, t, lang }) {
  const split = !!job.split;
  /* Saved, and this person may not reopen it. Not the same as "no existing
     record": the form still shows everything, it just cannot be changed. */
  const locked = !!existing && !mayEdit;
  /* Already answered with "nobody did it". The form then shows the ticks
     again where this person may correct it, because the one thing a
     not-done record has to be is reversible: the grass came after all, the
     crew went out, and the work has to be payable. */
  const skipped = isNotDone(existing);
  const [picked, setPicked] = useState(() => {
    const m = {};
    (existing ? existing.workers || [] : []).forEach((w) => { m[w.name] = w.qty == null ? '' : String(w.qty); });
    return m;
  });
  const [remark, setRemark] = useState((existing && existing.remark) || '');
  /* The day the work was DONE. It decides which month's salary claim this
     record is paid in, so it is keyed rather than assumed — a conductor
     catching up on last month's jobs would otherwise file them all under
     this month and nothing would say so. Today is only the default. */
  const [date, setDate] = useState(() =>
    String((existing && existing.work_date) || today || '').slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  /* THE SECOND STEP OF SAYING NOBODY DID IT. One tap writes a record
     against somebody's plot, and the button sits under the Save it is the
     opposite of, so it is confirmed -- and confirmed in a panel of this
     screen's own rather than a `confirm()`, because what has to be read is
     three lines: which plot, which job, and that it can be undone. No
     prompt asks for a reason: a prompt somebody dismisses out of habit is a
     cancel that looks like a save, and the remark box above is already
     where a reason goes. */
  const [confirmSkip, setConfirmSkip] = useState(false);

  const names = Object.keys(picked);
  const total = names.reduce((n, k) => n + (Number(picked[k]) || 0), 0);
  const left  = Number(row.qty || 0) - total;
  // Only the split job has a sum to get right. The others just need a name.
  // A date as well as a crew: without one the record has no month to be paid
  // in, and the field is pre-filled, so an empty one is somebody clearing it.
  const balanced = !!date
    && (split ? names.length > 0 && left === 0 : names.length > 0);

  const toggle = (name) =>
    setPicked((p) => {
      const next = { ...p };
      if (name in next) delete next[name]; else next[name] = '';
      return next;
    });

  async function submit() {
    setSaving(true); setErr(null);
    try {
      await onSave({
        workTypeKey: job.key,
        workers: names.map((n) => ({ name: n, qty: split ? Number(picked[n]) : null })),
        remark: remark.trim(),
        date,
        /* Which row this is, so a correction that moves the month updates it
           in place. The conflict key carries the month, so an upsert would
           leave the old month's row standing and pay the job twice —
           see saveTransplantRecord. */
        id: existing && existing.id,
        /* CLEARED EXPLICITLY, and only where it was set. A crew saved over a
           not-done record is the work having happened after all, and a row
           left flagged would show the names and pay nobody. Left undefined
           on an ordinary save so the column is not named at all — see
           saveTransplantRecord. */
        notDone: skipped ? false : undefined,
      });
    } catch (e) {
      setErr((e && e.message) || String(e));
      setSaving(false);
    }
  }

  /* NOBODY DID THIS JOB, and that is an answer rather than a gap.
     A blanket spray is not always needed — the grass does not always come —
     so a plot can genuinely never have one. With no way to say so the plot
     owed four jobs for ever: it sat on the Verification board, no card could
     ever be cleared, and now that a new delivery owes its jobs again it
     would come back every time. The office asked for it in one line: 要有
     option是没有做.
     It is a RECORD and never a deletion, the same choice the admin-closed
     plot and the rejected signup made — it goes through the one door
     everything else goes through, it carries who said so and when, and it
     can be reversed. The crew is EMPTY, which is what keeps it off every
     claim line by construction rather than by a rule somebody has to
     remember. */
  async function submitNotDone() {
    setSaving(true); setErr(null);
    try {
      await onSave({
        workTypeKey: job.key,
        workers: [],
        remark: remark.trim(),
        date,
        id: existing && existing.id,
        notDone: true,
      });
    } catch (e) {
      setErr((e && e.message) || String(e));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* The report's figures, as read. The BATCH and the quantity are the
          ones this job still owes — on a plot that took a second delivery
          that is the new batch and what it brought, never the two added
          together, because this figure is what the crew is paid on. */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
          {t('tp.fromReport')}
        </div>
        <Row label={t('mt.plot')}    value={row.plot} />
        {row.batch && <Row label={t('tp.batch')} value={row.batch} />}
        <Row label={t('tp.planted')} value={num(row.qty)} />
      </div>

      {/* WHAT WAS RECORDED FOR THE EARLIER DELIVERY. Without it the form
          looks like a plot nobody has ever worked, and the conductor has
          no way of knowing he is keying the SECOND crew rather than
          correcting the first. It is not editable here — that record
          belongs to its own batch and is reached by its own month. */}
      {prior && (
        <div className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-3
                        text-[11.5px] font-bold text-slate-600 leading-snug">
          {t('tp.priorBatch', {
            b: recBatches(prior).join(', ') || '—',
            n: num(prior.source_qty),
            d: savedOn(prior) || '—',
            w: (prior.workers || []).map((x) => x.name).join(', ') || '—',
          })}
        </div>
      )}

      {/* WHEN. The one field on this form that is not the report's and not a
          name, and the one that decides which month's claim pays it. It sits
          above the crew because it is read first: a conductor catching up on
          last month's work has to change it before he starts ticking.

          The month it lands in is printed under the box rather than left to
          be worked out, because getting it wrong is silent — the claim it
          should have been on simply stays short. The range is the window the
          sheet itself can read back (TRANSPLANT_FLOW_FROM to today), so a
          date that would hide the record cannot be keyed.

          Not shown before TRANSPLANT_DATE_FROM: until then the record is
          dated today and paid in the board's month, exactly as it always
          was. One habit changing at a month boundary rather than half way
          through a claim. */}
      {asksDate(today) && (
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
          {t('tp.whenDone')}
        </label>
        <input
          type="date" value={date} readOnly={locked} disabled={locked}
          min={TRANSPLANT_FLOW_FROM} max={today}
          onChange={(e) => setDate(e.target.value)}
          className={`w-full border rounded-xl px-3 py-2.5 text-sm font-black outline-none ${
            locked ? 'bg-slate-50 border-slate-200 text-slate-500'
                   : 'bg-white border-slate-300 focus:border-emerald-500'}`}
        />
        <div className={`mt-2 text-[11.5px] font-bold leading-snug ${
          date && today && date.slice(0, 7) !== today.slice(0, 7)
            ? 'text-amber-700' : 'text-slate-400'}`}>
          {date ? t('tp.paidIn', { m: monthLabelOf(date) }) : t('tp.whenHint')}
        </div>
      </div>
      )}

      {/* WHO. Left off a CLOSED not-done record altogether: "who was
          credited" over an empty list reads as a crew somebody forgot to
          fill in, which is the one thing this record must not look like.
          The panel at the foot says what it is instead. Where this person
          MAY correct it the ticks are shown, because that is the way back. */}
      {!(locked && skipped) && (
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
          {locked ? t('tp.whoWasCredited') : split ? t('tp.whoAndHowMany') : t('tp.whoDidIt')}
        </div>
        {/* No instruction on a closed record. "Tick everybody who worked on
            this plot" above ticks that cannot be tapped is the screen asking
            for something it will not accept. */}
        {!locked && (
          <div className="text-[11.5px] font-semibold text-slate-400 mb-3 leading-snug">
            {split ? t('tp.splitHint') : t('tp.pickHint')}
          </div>
        )}
        {locked && <div className="mb-3" />}

        {!workers || !workers.length ? (
          <div className="text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            {t('tp.noWorkers')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {workers.filter((w) => !locked || w.full_name in picked).map((w) => {
              const on = w.full_name in picked;
              return (
                <div key={w.id || w.full_name}
                  className={`rounded-xl border-2 transition-colors ${
                    on ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                  <button type="button" onClick={() => !locked && toggle(w.full_name)}
                    disabled={locked}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left${
                      locked ? ' cursor-default' : ''}`}>
                    <span className={`w-5 h-5 rounded-md border-2 grid place-items-center shrink-0 text-[12px] ${
                      on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300'}`}>
                      {on ? <Icon name="check" className="w-3 h-3 inline-block" /> : ''}
                    </span>
                    <span className="font-black text-slate-800 text-[14px] flex-1 min-w-0 truncate">
                      {w.full_name}
                    </span>
                    {split && on && (
                      <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest shrink-0">
                        {t('tp.howMany')}
                      </span>
                    )}
                  </button>
                  {/* The box appears when the name is picked, and not before:
                      a column of empty boxes beside unticked names is a form
                      that looks half filled in. */}
                  {split && on && (
                    <div className="px-3 pb-3 pl-11">
                      <input
                        type="number" min="0" inputMode="numeric"
                        value={picked[w.full_name]}
                        readOnly={locked}
                        onChange={(e) => setPicked((p) => ({ ...p, [w.full_name]: e.target.value }))}
                        placeholder="0"
                        className={`w-full border rounded-xl px-3 py-2.5 text-sm font-black tabular-nums
                                    outline-none ${locked
                                      ? 'bg-slate-50 border-slate-200 text-slate-500'
                                      : 'bg-white border-slate-300 focus:border-emerald-500'}`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* The sum, against the report. Red until it agrees — this is the
            whole reason the split is keyed here rather than guessed later. */}
        {split && (
          <div className={`mt-3 rounded-xl px-3.5 py-3 flex items-center justify-between gap-3 border ${
            left === 0 && names.length
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
            <span className="text-[11.5px] font-black uppercase tracking-widest">
              {left === 0 && names.length ? t('tp.balances') : t('tp.mustMatch')}
            </span>
            <span className="text-[13px] font-black tabular-nums shrink-0">
              {num(total)} / {num(row.qty)}
              {left !== 0 && (
                <span className="ml-2">{left > 0 ? `−${num(left)}` : `+${num(-left)}`}</span>
              )}
            </span>
          </div>
        )}
      </div>
      )}

      {(!locked || remark) && (
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
          {t('mt.remark')}
        </label>
        <textarea rows={2} value={remark} readOnly={locked}
          onChange={(e) => setRemark(e.target.value)}
          placeholder={locked ? '' : t('mt.remarkHint')}
          className={`w-full border rounded-xl px-3 py-2.5 text-sm font-semibold outline-none ${
            locked ? 'bg-slate-50 border-slate-200 text-slate-500'
                   : 'bg-white border-slate-300 focus:border-emerald-500'}`} />
      </div>
      )}

      {existing && staleQty(existing, row) && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3
                        text-[11.5px] font-bold leading-snug">
          {t('tp.qtyMovedLong', { was: num(existing.source_qty), now: num(row.qty) })}
        </div>
      )}

      {existing && mayEdit && (
        /* Reopening a closed record is a deliberate act, so it says what it
           is. Without this the form looks exactly like a blank one and a
           correction looks exactly like a first record.
           A not-done record says something else again: what ticking a crew
           here MEANS, which is that the work happened after all and is going
           back onto a claim. */
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3
                        text-[11.5px] font-bold leading-snug">
          {skipped ? t('tp.undoNotDone', { d: savedOn(existing) || '—' })
                   : t('tp.correcting', { d: savedOn(existing) || '—' })}
        </div>
      )}

      {err && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-[12.5px] font-bold">
          {/* The one refusal that is not a database fault but a file nobody
              has run. Said as what to do about it, because "could not find
              the not_done column" means nothing to a conductor. */}
          {err === TRANSPLANT_NOT_DONE_SETUP_NEEDED
            ? t('tp.notDoneSetup')
            : t('mt.saveErr', { msg: err })}
        </div>
      )}

      {locked ? (
        /* No button at all, rather than one that is greyed out. A disabled
           Save reads as "not yet" — something is missing, fill it in — and
           the truth is the opposite: this is finished, and finished is why
           it cannot be pressed. */
        <div className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-3.5">
          <div className="text-[12px] font-black text-slate-600 uppercase tracking-widest">
            <Icon name="lock" className="w-3.5 h-3.5 inline-block align-[-3px]" /> {
              skipped ? t('tp.notDoneTitle') : t('tp.lockedTitle')}
          </div>
          <div className="text-[11.5px] font-semibold text-slate-500 mt-1 leading-snug">
            {t('tp.savedOn', { d: savedOn(existing) || '—' })}
            {correctedOn(existing) ? ` · ${t('tp.correctedOn', { d: correctedOn(existing) })}` : ''}
            {existing.reported_by ? ` · ${existing.reported_by}` : ''}
          </div>
          <div className="text-[11.5px] font-semibold text-slate-400 mt-1.5 leading-snug">
            {skipped ? t('tp.notDoneLockedHint') : t('tp.lockedHint')}
          </div>
        </div>
      ) : confirmSkip ? (
        /* THE CONFIRM NAMES WHAT IT IS ABOUT TO DO — the plot, the job, and
           that nobody is paid for it. The same rule the admin-closed plot
           follows, and for the same reason: a row of similar-looking
           buttons on a phone is not necessarily pressed where it was
           aimed. Cancel writes nothing. */
        <div className="bg-slate-100 border border-slate-300 rounded-xl px-4 py-3.5 space-y-3">
          <div className="text-[12px] font-black text-slate-700 uppercase tracking-widest">
            {t('tp.notDoneConfirmTitle')}
          </div>
          <div className="text-[12px] font-bold text-slate-600 leading-snug">
            {t('tp.notDoneConfirm', { p: row.plot, j: jobLabel(job, lang) })}
          </div>
          <div className="text-[11.5px] font-semibold text-slate-500 leading-snug">
            {t('tp.notDoneConfirmHint')}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setConfirmSkip(false)} disabled={saving}
              className="flex-1 bg-white border border-slate-300 text-slate-600 font-black text-[12px]
                         uppercase tracking-widest rounded-xl py-3 disabled:opacity-40">
              {t('common.cancel')}
            </button>
            <button onClick={submitNotDone} disabled={saving || !date}
              className="flex-1 bg-slate-700 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-default
                         text-white font-black text-[12px] uppercase tracking-widest rounded-xl py-3 transition-colors">
              {saving ? t('auth.processing') : t('tp.notDoneGo')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button onClick={submit} disabled={saving || !balanced}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-default
                       text-white font-black text-[12px] uppercase tracking-widest rounded-xl py-3.5 transition-colors">
            {saving ? t('auth.processing') : existing ? t('mt.saveCorrection') : t('mt.save')}
          </button>
          {/* NOBODY DID IT. Offered only where there is nothing recorded yet:
              a job already recorded with a crew is corrected by changing the
              crew, and one already answered this way is already answered.
              Quiet and underneath, because it is the rarer answer of the two
              and the destructive-looking one — the same shape as Resume
              sitting above Start again on the parked walk. */}
          {!existing && (
            <button onClick={() => setConfirmSkip(true)} disabled={saving}
              className="w-full bg-white border border-slate-300 text-slate-500 hover:text-slate-700
                         font-black text-[11px] uppercase tracking-widest rounded-xl py-3 disabled:opacity-40">
              {t('tp.notDoneBtn')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline gap-3 py-0.5">
      {/* Wide enough for TRANSPLANTED at this tracking; at 86px it ran into
          its own value. */}
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-[112px] shrink-0 leading-tight">
        {label}
      </span>
      <span className="text-[14px] font-black text-slate-800 min-w-0 break-words tabular-nums">{value}</span>
    </div>
  );
}
