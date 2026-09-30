import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../../context/LanguageContext.jsx';
import {
  TRANSPLANT_FLOW_FROM,
  TRANSPLANT_JOBS,
  TRANSPLANT_SETUP_NEEDED,
  jobByKey,
  jobLabel,
  loadTransplantingSince,
  loadTransplantRecords,
  saveTransplantRecord,
} from './transplantData.js';

const num = (n) => Number(n || 0).toLocaleString();

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
const staleQty = (rec, row) => {
  if (!rec || !row) return false;
  const was = Number(rec.source_qty);
  const now = Number(row.qty);
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

  async function save(payload) {
    await saveTransplantRecord({
      ...payload,
      nursery, month, date: today,
      plot: row.plot, batch: row.batch, sourceQty: row.qty,
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
              🌱 {title}
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
              job={jobByKey(job)} row={row} workers={workers}
              existing={recordOf.get(`${row.plot}|${job}`)}
              mayEdit={mayEdit}
              onSave={save} t={t} lang={lang}
            />
          ) : row ? (
            <JobList row={row} recordOf={recordOf} onPick={setJob} t={t} lang={lang} />
          ) : (
            <PlotList rows={rows} recordOf={recordOf} onPick={setPlot} t={t} />
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
function PlotList({ rows, recordOf, onPick, t }) {
  if (!rows.length) {
    return <Notice text={t('tp.nothingSince', { d: plantedOn(TRANSPLANT_FLOW_FROM) })} />;
  }
  /* Unfinished first, newest of those at the top; everything finished below.
     The list no longer empties at the end of a month, so without this a plot
     still waiting on a job would sink under every plot already done as the
     months went by — which is the one thing this screen exists to surface. */
  const doneOf = (r) => TRANSPLANT_JOBS.filter((j) => recordOf.has(`${r.plot}|${j.key}`)).length;
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
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : n ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                {n === TRANSPLANT_JOBS.length ? `✓ ${t('tp.allDone')}` : `${n}/${TRANSPLANT_JOBS.length}`}
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
function JobList({ row, recordOf, onPick, t, lang }) {
  return (
    <div className="space-y-2.5">
      {TRANSPLANT_JOBS.map((j) => {
        const rec = recordOf.get(`${row.plot}|${j.key}`);
        const who = rec ? (rec.workers || []).map((w) => w.name) : [];
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
                <div className="text-[11.5px] font-bold text-slate-400 mt-0.5 break-words">
                  {who.length ? who.join(', ') : t('tp.notRecorded')}
                </div>
                {/* WHEN it was saved, on the list. A record's date is the
                    first thing asked about it and the last thing anybody
                    wants to open four forms to find. */}
                {rec && savedOn(rec) && (
                  <div className="text-[10.5px] font-bold text-slate-400 mt-1">
                    🔒 {t('tp.savedOn', { d: savedOn(rec) })}
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
                    ⚠ {t('tp.qtyMoved', { was: num(rec.source_qty), now: num(row.qty) })}
                  </div>
                )}
                {/* The split, where there is one. Seeing it on the list is
                    what stops somebody opening all four to find it. */}
                {rec && j.split && (
                  <div className="text-[11px] font-black text-slate-600 mt-1 tabular-nums">
                    {(rec.workers || []).map((w) => `${w.name} ${num(w.qty)}`).join('  ·  ')}
                  </div>
                )}
              </div>
              <span className={`shrink-0 text-[9px] font-black uppercase tracking-widest rounded-full px-2 py-1 ${
                rec ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                {rec ? '✓' : t('tp.todo')}
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
function JobForm({ job, row, workers, existing, mayEdit, onSave, t, lang }) {
  const split = !!job.split;
  /* Saved, and this person may not reopen it. Not the same as "no existing
     record": the form still shows everything, it just cannot be changed. */
  const locked = !!existing && !mayEdit;
  const [picked, setPicked] = useState(() => {
    const m = {};
    (existing ? existing.workers || [] : []).forEach((w) => { m[w.name] = w.qty == null ? '' : String(w.qty); });
    return m;
  });
  const [remark, setRemark] = useState((existing && existing.remark) || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const names = Object.keys(picked);
  const total = names.reduce((n, k) => n + (Number(picked[k]) || 0), 0);
  const left  = Number(row.qty || 0) - total;
  // Only the split job has a sum to get right. The others just need a name.
  const balanced = split ? names.length > 0 && left === 0 : names.length > 0;

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
      });
    } catch (e) {
      setErr((e && e.message) || String(e));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* The report's figures, as read. */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
          {t('tp.fromReport')}
        </div>
        <Row label={t('mt.plot')}    value={row.plot} />
        {row.batch && <Row label={t('tp.batch')} value={row.batch} />}
        <Row label={t('tp.planted')} value={num(row.qty)} />
      </div>

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
                      {on ? '✓' : ''}
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
           correction looks exactly like a first record. */
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3
                        text-[11.5px] font-bold leading-snug">
          {t('tp.correcting', { d: savedOn(existing) || '—' })}
        </div>
      )}

      {err && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-[12.5px] font-bold">
          {t('mt.saveErr', { msg: err })}
        </div>
      )}

      {locked ? (
        /* No button at all, rather than one that is greyed out. A disabled
           Save reads as "not yet" — something is missing, fill it in — and
           the truth is the opposite: this is finished, and finished is why
           it cannot be pressed. */
        <div className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-3.5">
          <div className="text-[12px] font-black text-slate-600 uppercase tracking-widest">
            🔒 {t('tp.lockedTitle')}
          </div>
          <div className="text-[11.5px] font-semibold text-slate-500 mt-1 leading-snug">
            {t('tp.savedOn', { d: savedOn(existing) || '—' })}
            {correctedOn(existing) ? ` · ${t('tp.correctedOn', { d: correctedOn(existing) })}` : ''}
            {existing.reported_by ? ` · ${existing.reported_by}` : ''}
          </div>
          <div className="text-[11.5px] font-semibold text-slate-400 mt-1.5 leading-snug">
            {t('tp.lockedHint')}
          </div>
        </div>
      ) : (
        <button onClick={submit} disabled={saving || !balanced}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-default
                     text-white font-black text-[12px] uppercase tracking-widest rounded-xl py-3.5 transition-colors">
          {saving ? t('auth.processing') : existing ? t('mt.saveCorrection') : t('mt.save')}
        </button>
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
