import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { allowedNurseries, canDo, canMaintain, nurseryKey } from '../lib/access.js';
import { loadDOsMissingWorkers, loadDOWorkers, loadDropdownData } from '../modules/do/data.js';
import { useWorkerTick } from '../modules/do/useWorkerTick.js';
import WorkerTickModal from '../modules/do/WorkerTickModal.jsx';
import { canMaintCorrect } from '../modules/maintenance/functions.js';
import { todayStr } from '../modules/maintenance/data.js';
import { monthLabelOf } from '../modules/maintenance/schedule.js';
import {
  loadTransplantRecords,
  loadTransplantingSince,
  TRANSPLANT_SETUP_NEEDED,
} from '../modules/maintenance/transplantData.js';
import {
  clampIndex,
  doNeedsWorkers,
  LOADING_WORKERS_FROM,
  plotsOwingJobs,
} from './verify/pending.js';

/* The sheet is most of its own screen and nearly nobody opens it on a given
   morning, so it is not in the bundle until somebody taps a plot -- the same
   lazy import the track map uses. */
const TransplantSheet = lazy(() => import('../modules/maintenance/TransplantSheet.jsx'));

/** One stepper arrow. Copied in shape from the maintenance week stepper so
    the two controls on this page behave identically: greyed at the ends
    rather than disappearing, because a control that changes shape as you
    move it is one people stop trusting. */
/* Tailwind scans the SOURCE for class names, so `border-${tone}-200` is a
   class that is never generated and a border that never appears. Written
   out instead -- the one place in this file where repetition is the
   correct answer. */
const TONE = {
  sky: {
    box:  'border-sky-200 bg-sky-50/40',
    head: 'bg-sky-50 border-sky-200',
    name: 'text-sky-800',
    n:    'text-sky-700',
    foot: 'border-sky-100',
    arrowOff: 'border-sky-100 text-sky-200 cursor-default',
    arrowOn:  'border-sky-300 text-sky-700 hover:bg-sky-100 cursor-pointer',
  },
  emerald: {
    box:  'border-emerald-200 bg-emerald-50/40',
    head: 'bg-emerald-50 border-emerald-200',
    name: 'text-emerald-800',
    n:    'text-emerald-700',
    foot: 'border-emerald-100',
    arrowOff: 'border-emerald-100 text-emerald-200 cursor-default',
    arrowOn:  'border-emerald-300 text-emerald-700 hover:bg-emerald-100 cursor-pointer',
  },
};

function Arrow({ dir, disabled, onClick, label, tone }) {
  const c = TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`grid place-items-center w-6 h-6 rounded-full border shrink-0 transition-colors ${
        disabled ? c.arrowOff : c.arrowOn
      }`}
    >
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor"
        strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dir === 'prev' ? <path d="m15 5-7 7 7 7" /> : <path d="m9 5 7 7-7 7" />}
      </svg>
    </button>
  );
}

/** One half of the board: a heading with its count and arrows, and one card. */
function Half({ icon, title, tone, n, i, setI, children, emptyText, prevLabel, nextLabel }) {
  const c = TONE[tone];
  return (
    <div className={`rounded-xl border ${c.box} overflow-hidden flex flex-col`}>
      <div className={`flex items-center justify-between gap-1 px-2.5 py-1.5 border-b ${c.head}`}>
        <span className={`font-black uppercase tracking-wider text-[11px] ${c.name} truncate min-w-0`}>
          {icon} {title}
        </span>
        {/* HOW MANY ARE LEFT, never how many there were. A conductor wants
            the size of what is in front of him. */}
        <span className={`text-[11px] font-black ${c.n} shrink-0 tabular-nums`}>{n}</span>
      </div>

      {n === 0 ? (
        <div className="px-2.5 py-4 text-center text-[12px] font-bold text-slate-400 uppercase tracking-wider">
          {emptyText}
        </div>
      ) : (
        <>
          <div className="flex-1 px-2.5 py-2 min-w-0">{children}</div>
          {/* The arrows sit UNDER the card rather than beside it: a 360px
              phone split in two leaves about 150px a column, and two
              arrows either side of that leave no room for the record they
              are stepping through. */}
          <div className={`flex items-center justify-between gap-1 px-2.5 py-1.5 border-t ${c.foot}`}>
            <Arrow dir="prev" tone={tone} disabled={i <= 0}
              onClick={() => setI((x) => Math.max(0, x - 1))} label={prevLabel} />
            <span className="text-[11px] font-black text-slate-400 tabular-nums">{i + 1} / {n}</span>
            <Arrow dir="next" tone={tone} disabled={i >= n - 1}
              onClick={() => setI((x) => Math.min(n - 1, x + 1))} label={nextLabel} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * PENDING VERIFICATION — the work that happened and nobody signed for.
 *
 * Two gaps, one shape. A delivery order whose loading gang was never ticked,
 * and a transplanted plot whose four jobs were never recorded. Both are work
 * that was really done, by people who are really owed for it, and in both
 * cases the only trace of the gap is a column nothing was looking at.
 *
 * It sits between today's collections and the maintenance status because
 * that is the order of the morning: who is coming, what is owed, what is
 * planned.
 *
 * IT DISAPPEARS WHEN THERE IS NOTHING TO VERIFY, which the office asked for
 * and which is the right default for a prompt: a card reading "nothing to
 * do" every day is a card nobody reads on the day it says something else.
 * The cost is that the transplanting sheet has no door on a nursery-month
 * where everything is recorded -- taken knowingly; see CLAUDE.md.
 */
export default function VerificationBoard() {
  const { permissions, staffName } = useAuth();
  const { t } = useLang();

  const mayDo = canDo(permissions, 'view');
  const mayMaint = canMaintain(permissions, 'view');

  const [dos, setDos] = useState(null);
  const [plotMap, setPlotMap] = useState({});
  const [workers, setWorkers] = useState([]);
  const [tp, setTp] = useState(null);          // [{ plot, qty, batches, missing }]
  const [di, setDi] = useState(0);
  const [ti, setTi] = useState(0);
  const [sheetFor, setSheetFor] = useState(null);   // { nursery, plotNames }
  /* Bumped when the worker popup CLOSES, which re-reads the delivery
     orders. See the effect below for why it is not a callback. */
  const [doTick, setDoTick] = useState(0);

  const month = monthLabelOf(todayStr());
  const allowed = allowedNurseries(permissions, 'maintenance');
  const allowedSig = allowed === null ? '*' : [...allowed].sort().join('|');

  const wt = useWorkerTick(workers);

  /* A DO ANSWERED HAS TO LEAVE THE LIST, and the only honest way to know
     whether it was answered is to ask again.

     openWorkerTick takes an `after` callback, but it is the wrong tool:
     closeWorkerTick runs it on BOTH routes, so a DO somebody skipped a
     second time would vanish exactly like one they filled in -- the card
     would be gone and the work still owed, which is the fault this whole
     board exists to stop.

     So the popup closing simply re-reads. One query, only on close, and it
     cannot be wrong in either direction: saved and it drops, skipped and it
     stays. */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !wt.wtOpen) setDoTick((n) => n + 1);
    wasOpen.current = wt.wtOpen;
  }, [wt.wtOpen]);

  /* ── The delivery orders ─────────────────────────────────────────── */
  useEffect(() => {
    if (!mayDo) { setDos([]); return; }
    let live = true;
    (async () => {
      try {
        const [rows, { plots }, ws] = await Promise.all([
          loadDOsMissingWorkers(LOADING_WORKERS_FROM),
          loadDropdownData().catch(() => ({ plots: [] })),
          loadDOWorkers().catch(() => []),
        ]);
        if (!live) return;
        const map = {};
        (plots || []).forEach((p) => { map[p.plot_name] = p.nursery_name; });
        setPlotMap(map);
        setWorkers(ws || []);
        setDos((rows || []).filter(doNeedsWorkers));
      } catch (e) {
        /* Offline, or the column is not on this project yet. An empty half
           is the safe answer: this card exists to raise work, and raising
           none is better than raising a wrong one. */
        if (live) setDos([]);
      }
    })();
    return () => { live = false; };
  }, [mayDo, doTick]);

  /* ── The transplanted plots ──────────────────────────────────────── */
  useEffect(() => {
    if (!mayMaint) { setTp([]); return; }
    let live = true;
    (async () => {
      try {
        const { plots } = await loadDropdownData();
        /* Scoped the same way the module scopes itself, and through
           nurseryKey: the access tick list is typed by hand and says
           "UNN1" where shared_plots says "UNN 1". */
        const mine = (plots || []).filter((p) => allowed === null
          || allowed.some((a) => nurseryKey(a) === nurseryKey(p.nursery_name)));
        const names = mine.map((p) => p.plot_name);
        if (!names.length) { if (live) setTp([]); return; }

        const nurseries = [...new Set(mine.map((p) => p.nursery_name).filter(Boolean))];
        const [rows, ...recsPer] = await Promise.all([
          loadTransplantingSince(names),
          ...nurseries.map((n) => loadTransplantRecords(n).catch((e) => {
            if (e && e.message === TRANSPLANT_SETUP_NEEDED) return [];
            throw e;
          })),
        ]);
        if (!live) return;
        const recs = recsPer.flat();
        const nurseryOf = {};
        mine.forEach((p) => { nurseryOf[p.plot_name] = p.nursery_name; });
        setTp(plotsOwingJobs(rows, recs).map((r) => ({
          ...r,
          nursery: nurseryOf[r.plot] || '',
          plotNames: mine
            .filter((p) => nurseryKey(p.nursery_name) === nurseryKey(nurseryOf[r.plot] || ''))
            .map((p) => p.plot_name),
        })));
      } catch (e) {
        if (live) setTp([]);
      }
    })();
    return () => { live = false; };
  }, [mayMaint, allowedSig]);

  /* A list that SHRANK under the card you are on -- answering a DO takes it
     off -- must not leave the stepper pointing past the end. */
  const nDo = (dos || []).length;
  const nTp = (tp || []).length;
  useEffect(() => { setDi((i) => clampIndex(i, nDo)); }, [nDo]);
  useEffect(() => { setTi((i) => clampIndex(i, nTp)); }, [nTp]);

  const doCard = (dos || [])[clampIndex(di, nDo)] || null;
  const tpCard = (tp || [])[clampIndex(ti, nTp)] || null;

  const total = nDo + nTp;
  /* Still loading is not the same as nothing to do: a card that appears a
     second after the page has settled is one that reads as an alert. Held
     back until both halves have answered. */
  const ready = dos !== null && tp !== null;
  if (!ready || total === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden mb-4 shadow-[0_4px_16px_rgba(0,0,0,.06)]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-amber-50">
        <span className="font-black uppercase tracking-widest text-[11px] sm:text-xs text-amber-800 truncate">
          ⏳ {t('vrf.title')}
        </span>
        <span className="text-[10px] font-black text-amber-700 shrink-0">
          {t('vrf.count', { n: total })}
        </span>
      </div>

      {/* Side by side on every width, which is what the office asked for.
          The cards inside are built narrow enough to hold a 360px phone. */}
      <div className="grid grid-cols-2 gap-2 p-2">
        <Half
          icon="📋" tone="sky" title={t('vrf.loading')} n={nDo} i={di} setI={setDi}
          emptyText={t('vrf.allDone')} prevLabel={t('vrf.prev')} nextLabel={t('vrf.next')}
        >
          {doCard && (
            <button
              type="button"
              onClick={() => wt.openWorkerTick(doCard, plotMap)}
              className="w-full text-left"
            >
              <div className="font-mono font-black text-[16px] text-sky-800 truncate">
                {doCard.do_number || '—'}
              </div>
              <div className="text-[14px] font-bold text-slate-700 truncate">
                {doCard.customer_name || doCard.al_number || '—'}
              </div>
              <div className="text-[12px] text-slate-400 truncate">
                {(doCard.delivery_date || '—')}{doCard.total_qty ? ' · ' + doCard.total_qty : ''}
              </div>
              <div className="mt-2 text-[11px] font-black uppercase tracking-wider text-sky-700">
                {t('vrf.pickWorkers')} ›
              </div>
            </button>
          )}
        </Half>

        <Half
          icon="🌱" tone="emerald" title={t('vrf.transplanting')} n={nTp} i={ti} setI={setTi}
          emptyText={t('vrf.allDone')} prevLabel={t('vrf.prev')} nextLabel={t('vrf.next')}
        >
          {tpCard && (
            <button
              type="button"
              onClick={() => setSheetFor({ nursery: tpCard.nursery, plotNames: tpCard.plotNames })}
              className="w-full text-left"
            >
              <div className="font-mono font-black text-[16px] text-emerald-800 truncate">
                {tpCard.plot}
              </div>
              <div className="text-[14px] font-bold text-slate-700 truncate">
                {tpCard.nursery || '—'}
              </div>
              <div className="text-[12px] text-slate-400 truncate">
                {(tpCard.qty || 0)}{tpCard.batch ? ' · ' + tpCard.batch : ''}
              </div>
              {/* The job NAMES were here and the office asked for them out.
                  Four of them spelt in full -- "Lining & Arranging Polybag
                  15" x 18"" among them -- wrapped to three lines and made
                  the card a paragraph: the plot, which is what somebody is
                  looking for, had the least weight on it. Which jobs are
                  missing is the first thing the sheet says anyway, one tap
                  away. */}
              <div className="mt-2 text-[11px] font-black uppercase tracking-wider text-emerald-700">
                {t('vrf.openSheet')} ›
              </div>
            </button>
          )}
        </Half>
      </div>

      <div className="px-4 py-1.5 border-t border-slate-100 text-[10px] font-bold text-slate-400">
        {t('vrf.footer')}
      </div>

      {wt.wtOpen && <WorkerTickModal wt={wt} staffName={staffName} />}

      {sheetFor && (
        <Suspense fallback={null}>
          <TransplantSheet
            nursery={sheetFor.nursery}
            month={month}
            plotNames={sheetFor.plotNames}
            workers={workers}
            staffName={staffName}
            mayEdit={canMaintCorrect(permissions, 'transplant_edit')}
            onClose={() => setSheetFor(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
