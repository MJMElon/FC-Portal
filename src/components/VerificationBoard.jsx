import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import Icon from './Icon.jsx';
import { canDo, canMaintain } from '../lib/access.js';
import { customerOfDO, plotsOfDO } from '../modules/do/data.js';
import { useWorkerTick } from '../modules/do/useWorkerTick.js';
import WorkerTickModal from '../modules/do/WorkerTickModal.jsx';
import { canMaintCorrect } from '../modules/maintenance/functions.js';
import { todayStr } from '../modules/maintenance/data.js';
import { monthLabelOf } from '../modules/maintenance/schedule.js';
import { loadPendingDOs, loadPendingTransplants } from '../lib/verifyCount.js';
import { clampIndex } from './verify/pending.js';

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

/** One half of the board: a heading and arrows, and one card. The count that
    used to sit beside the title is gone — "how many are left" is answered by
    the stepper under the card (1 / 88), so the title was saying it twice. */
function Half({ icon, title, tone, n, i, setI, children, emptyText, prevLabel, nextLabel }) {
  const c = TONE[tone];
  return (
    <div className={`rounded-xl border ${c.box} overflow-hidden flex flex-col`}>
      <div className={`flex items-center gap-1 px-2.5 py-1.5 border-b ${c.head}`}>
        <span className={`inline-flex items-center gap-1 font-black uppercase tracking-wider text-[11px] ${c.name} truncate min-w-0`}>
          {icon} {title}
        </span>
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
 * It USED TO sit on the dashboard itself, last, and disappear when there was
 * nothing to verify — the right default for something that pushed itself in
 * front of you unasked. It is the floating dock's own window now, the same
 * one PALMS and Nelos already open from, so it is opened on purpose rather
 * than pushed — which is also why it no longer disappears when empty: a
 * window somebody chose to open and found blank is a bug, not a quiet
 * success, so it says "Nothing outstanding" instead of rendering nothing.
 * See VerifyWindow.jsx for the chrome and FloatingDock.jsx for the badge
 * that tells you whether to open it at all.
 *
 * The two reads (loadPendingDOs / loadPendingTransplants) are shared with
 * the dock's own badge count now, in lib/verifyCount.js — one copy, so the
 * number on the icon and the cards behind it cannot disagree.
 */
export default function VerificationBoard({ onCount }) {
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
    let live = true;
    loadPendingDOs(permissions).then(({ dos: rows, plotMap: map, workers: ws }) => {
      if (!live) return;
      setPlotMap(map);
      setWorkers(ws);
      setDos(rows);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mayDo, doTick]);

  /* ── The transplanted plots ──────────────────────────────────────── */
  useEffect(() => {
    let live = true;
    loadPendingTransplants(permissions).then((rows) => { if (live) setTp(rows); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mayMaint]);

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
  /* Reports the count up to whoever opened this window — FloatingDock's
     badge is read before this has loaded, off the lighter pendingVerifyCount()
     call; once the real rows are in, this is the figure the cards agree
     with, and the one the badge corrects itself to if the two ever differ
     (a case settled on another screen in the second between the two reads,
     say). */
  useEffect(() => {
    if (ready && onCount) onCount(total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, total]);

  if (!ready) {
    return (
      <div className="py-16 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">
        {t('common.loading')}
      </div>
    );
  }

  if (total === 0) {
    /* Opened on purpose now, through the dock, rather than pushed in front
       of anybody — so finding nothing here is the window working, and it
       says so instead of rendering a blank sheet somebody tapped a button
       to see. */
    return (
      <div className="py-16 text-center">
        <div className="text-[13px] font-black text-slate-500">{t('vrf.allDone')}</div>
        <div className="mt-1 text-[11px] font-bold text-slate-400">{t('vrf.footer')}</div>
      </div>
    );
  }

  return (
    <>
      {/* Side by side on every width, which is what the office asked for.
          The cards inside are built narrow enough to hold a 360px phone. */}
      <div className="grid grid-cols-2 gap-2 p-2">
        <Half
          icon={<Icon name="clipboard" className="w-3.5 h-3.5 shrink-0" />} tone="sky" title={t('vrf.loading')} n={nDo} i={di} setI={setDi}
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
              {/* The CUSTOMER, which is not simply `customer_name`: this
                  portal writes it into the remark and leaves that column
                  empty, so the card used to read out the AL number. See
                  customerOfDO. */}
              <div className="text-[14px] font-bold text-slate-700 truncate">
                {customerOfDO(doCard) || '—'}
              </div>
              {/* And WHICH PLOT, which is what the gang was standing in.
                  Kept to one truncated line: the transplanting card beside
                  this one already taught us that a card which wraps to a
                  paragraph buries the thing somebody is looking for. */}
              <div className="text-[12px] font-bold text-slate-500 truncate">
                {plotsOfDO(doCard).join(' · ') || '—'}
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
          icon={<Icon name="seedling" className="w-3.5 h-3.5 shrink-0" />} tone="emerald" title={t('vrf.transplanting')} n={nTp} i={ti} setI={setTi}
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

      <div className="px-1 py-1.5 text-[10px] font-bold text-slate-400">
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
    </>
  );
}
