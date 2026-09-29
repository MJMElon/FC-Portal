import { useEffect, useMemo, useRef, useState } from 'react';
import CfSelect from '../../components/CfSelect.jsx';
import { areaIndexAt, bbox, loadCachedMaps } from './plotMaps.js';
import {
  ACTIVITIES,
  MAX_CONCURRENT,
  MULTI,
  NURSERIES,
  aKey,
  plotPhoto,
  activityByN,
  applyDailySelection,
  computeStatus,
  currentEntries,
  diffDays,
  effStatus,
  isMulti,
  keysOfPlot,
  nowClock,
  plotsOf,
  prettyD,
  saveDB,
  tickedToday,
  todayStr,
} from './data.js';
import { syncPalms } from './sync.js';

// Update Status — the plots of a nursery are drawn as a train, one carriage
// per plot, each carriage showing what that plot is on right now. Nothing has
// to be opened to read the day's picture.
//
// The day is keyed in as one report, not plot by plot. Every plot starts the
// day carrying yesterday's activities; the Field Conductor only opens the
// plots that changed, then presses save once for the whole nursery. Plots that
// did not change are still recorded as reported for the day.
//
// A plot may run two activities at once — culling still going while the soil
// crew starts angkat tanah. Whatever is left out of the selection is recorded
// as finished, so "angkat tanah is done" needs no extra step.

const DOT = {
  ontrack: 'bg-emerald-500',
  soon: 'bg-amber-500',
  overdue: 'bg-rose-500',
  none: 'bg-slate-300',
};
const CAR = {
  ontrack: { body: 'bg-emerald-400', roof: 'bg-emerald-600' },
  soon: { body: 'bg-amber-400', roof: 'bg-amber-600' },
  overdue: { body: 'bg-rose-400', roof: 'bg-rose-600' },
  none: { body: 'bg-slate-300', roof: 'bg-slate-400' },
};

// Sleepers + rail, drawn per cell so the track runs unbroken across a row and
// starts again cleanly on the next one.
function Track() {
  return (
    <div className="relative h-2.5">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-slate-400/70" />
      <div
        className="absolute inset-x-0 top-[3px] h-1.5"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, rgb(148 163 184 / .55) 0 4px, transparent 4px 13px)',
        }}
      />
    </div>
  );
}

// A cell reads top to bottom: the activity labels, then the carriage, then the
// rail. That order is what puts the train ON the track — the label used to sit
// between the wheels and the rail, holding the carriage up off it.
//
// The carriage is a fixed height; the label strip above it has a floor but may
// grow, because a plot split into three areas needs three lines. It grows
// upwards, since every cell in a grid row stretches to the tallest of them and
// the carriage stays anchored to the rail at the bottom.
const LABEL_H = 'min-h-[32px] sm:min-h-[42px]';
// Exactly as tall as a carriage: roof + body + the wheels showing below it
// (10+42+13 on a phone, 16+66+19 on a laptop). It used to be taller than the
// thing it held, and since the carriage is anchored to the rail at the bottom,
// that surplus opened as a gap between the roof and the label above it.
const CAR_H = 'h-[65px] sm:h-[101px]';
const CELL = 'flex flex-col h-full';

// Cartoon locomotive at the head of the train. Decorative; only the smoke
// moves.
function Locomotive() {
  return (
    <div className={`select-none ${CELL}`}>
      <div className={`${LABEL_H} flex-1`} />
      <div className={`${CAR_H} flex items-end`}>
        <svg viewBox="0 0 104 78" className="w-full h-full" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          {/* smoke — three puffs leaving the funnel on a stagger */}
          {[0, 0.8, 1.6].map((d, i) => (
            <circle
              key={i}
              cx="24"
              cy="30"
              r={4 + i * 0.6}
              fill="#cbd5e1"
              className="animate-puff"
              style={{ animationDelay: `${d}s` }}
            />
          ))}
          {/* chimney */}
          <rect x="18" y="30" width="12" height="14" rx="2.5" fill="#64748b" />
          {/* boiler */}
          <rect x="8" y="42" width="52" height="22" rx="10" fill="#ef4444" />
          {/* cab + roof */}
          <rect x="50" y="24" width="38" height="40" rx="6" fill="#ef4444" />
          <rect x="46" y="17" width="48" height="9" rx="3.5" fill="#f59e0b" />
          <rect x="58" y="31" width="24" height="17" rx="3.5" fill="#bae6fd" />
          {/* footplate */}
          <rect x="4" y="60" width="90" height="8" rx="3" fill="#f59e0b" />
          {/* wheels */}
          <circle cx="22" cy="70" r="7" fill="#64748b" />
          <circle cx="22" cy="70" r="2.5" fill="#e2e8f0" />
          <circle cx="46" cy="70" r="7" fill="#64748b" />
          <circle cx="46" cy="70" r="2.5" fill="#e2e8f0" />
          <circle cx="74" cy="69" r="8.5" fill="#64748b" />
          <circle cx="74" cy="69" r="3" fill="#e2e8f0" />
          {/* coupling to the first carriage */}
          <rect x="92" y="64" width="12" height="4" rx="2" fill="#94a3b8" />
        </svg>
      </div>
      <Track />
    </div>
  );
}

/* ---------- the day's draft ----------
   A plain map of storage key -> activity numbers, seeded from whatever is
   running. Nothing touches the log until the whole nursery is saved. */
function savedActs(db, key) {
  return currentEntries(db, key)
    .map((e) => e.actN)
    .sort((a, b) => a - b);
}
function seedDraft(db, keys) {
  const d = {};
  keys.forEach((k) => (d[k] = savedActs(db, k)));
  return d;
}
function sameSel(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

const shortNames = (acts) =>
  acts
    .slice()
    .sort((a, b) => a - b)
    .map((n) => activityByN(n))
    .filter(Boolean)
    .map((a) => a.mShort);

// The lines printed under a carriage. A whole plot gets one line per activity;
// a plot split into areas gets one line per area, prefixed with the area
// letter, so "A: Culling / B: Meracun selingan" reads as two places doing two
// different things rather than one plot doing both.
function labelLines(pid, keys, draft) {
  if (!isMulti(pid)) return shortNames(draft[keys[0]] || []);
  return MULTI[pid].areas
    .map((a) => ({ a, names: shortNames(draft[aKey(pid, a)] || []) }))
    .filter((x) => x.names.length)
    .map((x) => `${x.a}: ${x.names.join(' + ')}`);
}

export default function EntryTab({ db, t, staffName, refresh, flash, nurseryKeys }) {
  // Start on the first nursery this user may see, not always BNN — which a
  // UNN-only Field Conductor is not allowed to open.
  const [nursery, setNursery] = useState(() => nurseryKeys[0] || 'BNN');
  const [open, setOpen] = useState(null); // plot id shown in the sheet
  const [confirming, setConfirming] = useState(false);

  const plots = plotsOf(nursery);
  const allKeys = useMemo(() => plots.flatMap(keysOfPlot), [nursery]);

  const [draft, setDraft] = useState(() => seedDraft(db, allKeys));
  /* Which units somebody has actually keyed on this screen. Anything not in
     here is only a copy of the day as the device knows it, and is safe to
     replace when the device learns better. Per unit rather than one flag for
     the screen: keying B1 must not freeze B2 to B21 at whatever they happened
     to say at the time. */
  const touched = useRef(new Set());
  // Switching nursery starts a fresh draft for that nursery's plots.
  useEffect(() => {
    setDraft(seedDraft(db, allKeys));
    touched.current = new Set();
    setConfirming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nursery]);

  /* The day arrives AFTER this screen does.

     PALMS syncs on open, and the pull lands a moment later — so a device with
     nothing stored yet, or a stale copy of the day, seeds its draft from that
     and then keeps it. The carriages read their labels from the draft while
     the ticks beside them read the freshly synced day, and the two disagree in
     the worst possible direction: every plot ticked as reported, every plot
     showing no activity running. Other Field Conductors, whose phones already
     held the day when they opened it, see the real statuses.

     Worse than looking wrong, it is dangerous to save. Anything left out of a
     selection is recorded as FINISHED, so pressing save on an empty draft
     closes every activity in the nursery — for everybody.

     So every unit nobody has keyed follows the device; the ones somebody has
     keyed are theirs, and a late sync leaves those alone. */
  const savedSig = allKeys.map((k) => savedActs(db, k).join('.')).join('|');
  const seeded = useRef(savedSig);
  useEffect(() => {
    if (savedSig === seeded.current) return;
    seeded.current = savedSig;
    setDraft((d) => {
      const next = { ...d };
      allKeys.forEach((k) => { if (!touched.current.has(k)) next[k] = savedActs(db, k); });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSig]);

  const setActs = (key, acts) => {
    touched.current.add(key);
    setDraft((d) => ({ ...d, [key]: acts }));
  };

  const dirtyKeys = allKeys.filter((k) => !sameSel(draft[k] || [], savedActs(db, k)));
  const doneToday = allKeys.filter((k) => tickedToday(db, k)).length;
  const today = todayStr();

  // When the nursery was last put in today. Saving a fresh day goes straight
  // through; a second save is an amendment, and that is the one worth asking
  // about.
  const savedAt = allKeys
    .map((k) => db.updated[k])
    .filter((u) => u && u.at === today)
    .map((u) => u.ts || '')
    .sort()
    .pop();
  const alreadySaved = doneToday > 0;

  function saveAll() {
    const ts = nowClock();
    allKeys.forEach((k) => applyDailySelection(db, k, draft[k] || [], staffName || 'FC', today, ts));
    saveDB(db);
    /* Straight up to the server, so the office sees the day within seconds
       rather than whenever this phone next opens PALMS. Deliberately not
       awaited and never blocking the save: the record is already safe on the
       device, and a Field Conductor with no signal must not be left watching
       a spinner. syncPalms swallows its own failures and the next open
       retries. */
    syncPalms(db).then((r) => { if (r) refresh(); });
    refresh();
    setDraft(seedDraft(db, allKeys));
    setConfirming(false);
    flash(t('pm.savedAll', { n: plots.length }));
  }

  return (
    <>
      {/* Header: the date being keyed in, the nursery, and today's progress */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-black text-slate-800 text-[15px]">{t('pm.tabEntry')}</h2>
          {/* The date the day is being keyed in against — the one fact on
              this screen a Field Conductor filling in last night's round
              needs to read at a glance. */}
          <div className="text-[15px] sm:text-[18px] font-black text-emerald-700 leading-tight">
            {t('pm.forDate', { date: prettyD(today) })}
          </div>
          <div className="text-[11px] font-bold text-slate-400">
            {t('pm.progress', { done: doneToday, total: allKeys.length })}
          </div>
        </div>
        <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
          {t('pm.nursery')}
          <CfSelect
            value={nursery}
            onChange={(e) => setNursery(e.target.value)}
          >
            {nurseryKeys.map((k) => (
              <option key={k} value={k}>
                {NURSERIES[k].label}
              </option>
            ))}
          </CfSelect>
        </label>
      </div>

      {/* Legend + hint */}
      <div className="flex items-center justify-center gap-3 flex-wrap text-[10px] font-bold text-slate-400">
        {['ontrack', 'soon', 'overdue'].map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${DOT[s]}`} />
            {t(`pm.state.${s}`)}
          </span>
        ))}
      </div>
      <div className="text-center text-[11px] font-semibold text-slate-400 -mt-1">{t('pm.railHint')}</div>

      {/* The train: a locomotive pulling one carriage per plot, each carriage
          carrying the activities that plot is on. Carriages wrap onto the next
          length of track. */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] px-2 py-4 sm:px-4 overflow-hidden">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-y-3">
          <Locomotive />
          {plots.map((pid) => {
            const st = effStatus(db, pid);
            const keys = keysOfPlot(pid);
            const changed = keys.some((k) => !sameSel(draft[k] || [], savedActs(db, k)));
            const done = keys.every((k) => tickedToday(db, k));
            // What the plot will be on once the day is saved — the draft, not
            // the log, so an edit shows on the train straight away.
            //
            // A plot split into areas gets one line per area, named: "A:
            // Culling", "B: Meracun selingan". Merging them into one list read
            // as though the whole plot were doing both.
            const lines = labelLines(pid, keys, draft);
            const c = CAR[st.state];
            return (
              <button key={pid} onClick={() => setOpen(pid)} title={pid} className={`cursor-pointer group ${CELL}`}>
                {/* What this plot is on — readable without opening anything.
                    It sits above the carriage and grows upwards, so the wheels
                    stay on the rail whether a plot shows one line or three. */}
                <div
                  className={`${LABEL_H} flex-1 px-0.5 pb-1 flex flex-col items-center justify-end leading-[1.15]`}
                >
                  {lines.length === 0 ? (
                    <span className="text-[10px] sm:text-[14px] font-bold text-slate-300">—</span>
                  ) : (
                    // Area lines are left-aligned as one block, centred over
                    // the carriage. Centring each line on its own left the A:,
                    // B: and C: prefixes stepping in and out down the column
                    // instead of stacking. A single line has nothing to align
                    // against, so it stays centred.
                    <div className={isMulti(pid) ? 'text-left' : 'text-center'}>
                      {lines.map((line, i) => (
                        <span
                          key={i}
                          // An area line carries a letter prefix as well as the
                          // activity — "B: Meracun selingan" is the longest
                          // label the train has to fit — so it drops a point on
                          // a phone and wraps rather than being cut off.
                          className={`block break-words sm:text-[14px] font-black ${
                            isMulti(pid) ? 'text-[9px]' : 'text-[10px]'
                          } ${changed ? 'text-amber-600' : 'text-slate-500'}`}
                        >
                          {line}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={`${CAR_H} flex flex-col items-center justify-end`}>
                  <div className="relative w-[92%] max-w-[86px] sm:max-w-[150px]">
                    {/* roof */}
                    <div className={`w-full h-[10px] sm:h-[16px] rounded-t-lg sm:rounded-t-xl ${c.roof}`} />
                    {/* body + window carrying the plot number */}
                    <div
                      className={`w-[92%] mx-auto h-[42px] sm:h-[66px] rounded-md sm:rounded-lg ${c.body} flex items-center justify-center transition-transform group-hover:-translate-y-0.5`}
                    >
                      <span className="w-[78%] h-[27px] sm:h-[42px] rounded sm:rounded-md bg-sky-50 border border-white/70 grid place-items-center">
                        <span className="font-black text-slate-800 text-[14px] sm:text-[22px] leading-none tracking-wide">
                          {pid}
                        </span>
                      </span>
                    </div>
                    {/* wheels */}
                    <div className="w-[92%] mx-auto flex justify-around -mt-[3px] sm:-mt-[5px]">
                      {[0, 1].map((i) => (
                        <span
                          key={i}
                          className="w-4 h-4 sm:w-6 sm:h-6 rounded-full bg-slate-500 grid place-items-center"
                        >
                          <span className="w-1.5 h-1.5 sm:w-2.5 sm:h-2.5 rounded-full bg-slate-200" />
                        </span>
                      ))}
                    </div>
                    {/* edited-today / done / multi-area badge */}
                    {(changed || done || isMulti(pid)) && (
                      // On the carriage, not above it: the label now sits
                      // right on the roof, and a badge hanging over the top
                      // landed in the middle of it.
                      <span className="absolute top-0 -right-1 text-[10px] sm:text-[13px] leading-none bg-white rounded-full px-1.5 py-1 shadow-sm border border-slate-200">
                        {changed ? '✏️' : done ? '✅' : `${MULTI[pid].areas.length}⬦`}
                      </span>
                    )}
                  </div>
                </div>
                <Track />
              </button>
            );
          })}
        </div>
      </div>

      {/* One save for the whole nursery */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] px-4 py-3">
        {confirming ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-[12px] font-bold text-amber-900 mb-2.5">
              {t('pm.confirmAmend', { date: prettyD(today), time: savedAt || '—' })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 bg-white border border-slate-300 text-slate-600 font-black text-[11px] uppercase tracking-widest rounded-xl py-2.5 cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={saveAll}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-widest rounded-xl py-2.5 cursor-pointer"
              >
                {t('pm.yesSave')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={() => (alreadySaved ? setConfirming(true) : saveAll())}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[12px] uppercase tracking-widest rounded-xl py-3 transition-colors cursor-pointer"
            >
              {t('pm.saveAll', { n: plots.length })}
            </button>
            <p className="text-[10px] font-semibold text-slate-400 text-center mt-2">
              {alreadySaved
                ? t('pm.savedAtNote', { date: prettyD(today), time: savedAt || '—' })
                : dirtyKeys.length > 0
                  ? t('pm.changedCount', { n: dirtyKeys.length })
                  : t('pm.noChangeOk')}
            </p>
          </>
        )}
      </div>

      {open && (
        <PlotSheet
          db={db}
          pid={open}
          t={t}
          draft={draft}
          setActs={setActs}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/* ================= PLOT SHEET ================= */
// One plot at a time. Multi-area plots open on their map so the area is picked
// off the picture. Choices land in the day's draft; nothing is written to the
// log until the nursery is saved.
function PlotSheet({ db, pid, t, draft, setActs, onClose }) {
  const multi = isMulti(pid);
  const areas = multi ? MULTI[pid].areas : [null];

  const [area, setArea] = useState(areas[0]);
  const [step, setStep] = useState(multi ? 'map' : 'pick');
  const key = area ? aKey(pid, area) : pid;

  if (multi && step === 'map') {
    return (
      <AreaMapStep
        db={db}
        pid={pid}
        areas={areas}
        t={t}
        draft={draft}
        onPick={(a) => {
          setArea(a);
          setStep('pick');
        }}
        onClose={onClose}
      />
    );
  }

  const sel = draft[key] || [];
  const open = currentEntries(db, key);
  const st = computeStatus(db, key);
  // How long the longest-running activity has been going, for context.
  const dayN = open.length ? Math.max(...open.map((e) => diffDays(e.start, todayStr()) + 1)) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[94vh] flex flex-col">
        {/* Compact header: plot and what it is on sit on one line so the
            activity picker starts as high up the screen as possible. */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <div className="shrink-0">
            <div className="text-[9px] font-black text-emerald-600 uppercase tracking-widest leading-none">
              {NURSERIES[nurseryKeyOf(pid)].label}
            </div>
            <div className="font-black text-slate-800 text-xl leading-tight">{pid}</div>
          </div>
          <div className="flex-1 min-w-0 border-l border-slate-200 pl-3">
            {open.length ? (
              <>
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">
                  {t('pm.currentLabel')}
                </div>
                <div className="font-black text-slate-800 text-[13px] leading-tight truncate">
                  {open
                    .map((e) => activityByN(e.actN))
                    .filter(Boolean)
                    .sort((a, b) => a.n - b.n)
                    .map((a) => a.mShort)
                    .join(' + ')}
                </div>
                <div className="text-[10px] font-bold text-slate-500 leading-tight">
                  {t('pm.dayN', { n: dayN })}
                  {st.state === 'overdue' && (
                    <span className="text-rose-600"> · {t('pm.lateBy', { n: Math.abs(st.left) })}</span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-[12px] font-bold text-slate-400 italic">{t('pm.state.none')}</div>
            )}
          </div>
          {multi && (
            <button
              onClick={() => setStep('map')}
              title={t('pm.areaMap')}
              aria-label={t('pm.areaMap')}
              className="shrink-0 bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-700 text-[10px] font-black uppercase tracking-wider rounded-lg px-2 py-1.5 cursor-pointer"
            >
              {t('pm.area', { a: area })}
            </button>
          )}
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 text-xl leading-none cursor-pointer"
          >
            ×
          </button>
        </div>

        <ActivityPicker
          key={key}
          sel={sel}
          t={t}
          onChange={(acts) => setActs(key, acts)}
          onDone={() => (multi ? setStep('map') : onClose())}
        />
      </div>
    </div>
  );
}

// Step one for a multi-area plot: the map itself. Each area carries the
// activities picked for it, so the split reads without tapping through.
//
// Where Settings has drawn the dividing lines, the plot's real outline from
// the main portal is shown and a tap is placed against those lines. Plots
// still on the older left-to-right bands fall back to the shipped photo.
const AREA_TINT = ['rgba(16,185,129,.28)', 'rgba(245,158,11,.28)', 'rgba(56,189,248,.28)', 'rgba(217,70,239,.28)', 'rgba(244,63,94,.28)'];

function AreaMapStep({ db, pid, areas, t, draft, onPick, onClose }) {
  const cfg = MULTI[pid];
  const maps = useMemo(() => loadCachedMaps(), []);
  const drawn = cfg.dividers && cfg.dividers.length === areas.length - 1;
  const pm = maps && maps.plots ? maps.plots[pid] : null;
  const own = plotPhoto(pid); // a close-up of this plot beats the nursery map
  const mapUrl = own || (pm && maps.nurseries ? maps.nurseries[pm.nursery] : null);
  const useDrawn = drawn && !!mapUrl;

  // The short activity names picked for an area, for its label on the map.
  const actLabel = (a) =>
    (draft[aKey(pid, a)] || [])
      .map((n) => activityByN(n))
      .filter(Boolean)
      .map((x) => x.mShort)
      .join(' + ');

  const view = useMemo(() => {
    if (own || !pm) return { x: 0, y: 0, w: 100, h: 100 };
    const b = bbox(pm.poly);
    const pad = Math.max(b.w, b.h) * 0.12;
    return {
      x: Math.max(0, b.x - pad),
      y: Math.max(0, b.y - pad),
      w: Math.min(100, b.w + pad * 2),
      h: Math.min(100, b.h + pad * 2),
    };
  }, [pm, own]);

  const [aspect, setAspect] = useState(1.6);
  const wrapRef = useRef(null);

  function tap(e) {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pt = {
      x: view.x + ((e.clientX - r.left) / r.width) * view.w,
      y: view.y + ((e.clientY - r.top) / r.height) * view.h,
    };
    onPick(areas[Math.min(areas.length - 1, areaIndexAt(cfg.dividers, pt))]);
  }

  // Tint each area, clipped to the plot outline, so the split reads at a glance.
  const cells = useMemo(() => {
    if (!useDrawn) return [];
    const out = [];
    const N = 24;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const pt = { x: view.x + ((i + 0.5) / N) * view.w, y: view.y + ((j + 0.5) / N) * view.h };
        out.push({ i, j, a: Math.min(areas.length - 1, areaIndexAt(cfg.dividers, pt)) });
      }
    }
    return out;
  }, [useDrawn, cfg.dividers, areas.length, view]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[94vh] flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <div className="shrink-0">
            <div className="text-[9px] font-black text-emerald-600 uppercase tracking-widest leading-none">
              {NURSERIES[nurseryKeyOf(pid)].label}
            </div>
            <div className="font-black text-slate-800 text-xl leading-tight">{pid}</div>
          </div>
          <div className="flex-1 min-w-0 border-l border-slate-200 pl-3">
            <div className="text-[11px] font-bold text-slate-500 leading-tight">{t('pm.pickArea')}</div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 text-xl leading-none cursor-pointer"
          >
            ×
          </button>
        </div>

        <div className="px-4 py-3 overflow-y-auto flex-1">
          {useDrawn ? (
            <div
              ref={wrapRef}
              onClick={tap}
              className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 cursor-pointer select-none"
              style={{ aspectRatio: `${(view.w * aspect) / view.h}` }}
            >
              <img
                src={mapUrl}
                alt={`Peta ${pid}`}
                draggable="false"
                onLoad={(e) => setAspect(e.target.naturalWidth / e.target.naturalHeight || 1.6)}
                className="absolute origin-top-left max-w-none block pointer-events-none"
                style={{
                  width: `${(100 / view.w) * 100}%`,
                  left: `${(-view.x / view.w) * 100}%`,
                  top: `${(-view.y / view.h) * 100}%`,
                  height: `${(100 / view.h) * 100}%`,
                }}
              />
              <svg
                viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full pointer-events-none"
              >
                {!own && pm && (
                  <defs>
                    <clipPath id={`clip-${pid}`}>
                      <polygon points={pm.poly.map((p) => `${p.x},${p.y}`).join(' ')} />
                    </clipPath>
                  </defs>
                )}
                {cells.map((c) => {
                  const has = (draft[aKey(pid, areas[c.a])] || []).length > 0;
                  return (
                    <rect
                      key={`${c.i}-${c.j}`}
                      x={view.x + (c.i / 24) * view.w}
                      y={view.y + (c.j / 24) * view.h}
                      width={view.w / 24}
                      height={view.h / 24}
                      fill={has ? 'rgba(16,185,129,.45)' : AREA_TINT[c.a % AREA_TINT.length]}
                      clipPath={!own && pm ? `url(#clip-${pid})` : undefined}
                    />
                  );
                })}
                {!own && pm && (
                  <polygon
                    points={pm.poly.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#0f172a"
                    strokeWidth={view.w * 0.006}
                  />
                )}
                {cfg.dividers.map((line, i) => (
                  <polyline
                    key={i}
                    points={line.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={view.w * 0.012}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </svg>
              {areas.map((a, i) => {
                const label = actLabel(a);
                const lx = i === 0 ? view.x : dividerXAtLocal(cfg.dividers, i - 1, view.y + view.h / 2);
                const rx =
                  i === areas.length - 1 ? view.x + view.w : dividerXAtLocal(cfg.dividers, i, view.y + view.h / 2);
                const mid = (lx + rx) / 2;
                return (
                  <span
                    key={a}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2.5 py-1 text-[12px] font-black shadow-sm pointer-events-none max-w-[46%] truncate ${
                      label ? 'bg-emerald-600 text-white' : 'bg-white/90 text-slate-800'
                    }`}
                    style={{ left: `${((mid - view.x) / view.w) * 100}%`, top: '50%' }}
                  >
                    {a}
                    {label && ` · ${label}`}
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="relative rounded-xl overflow-hidden border border-slate-200">
              <img src={plotPhoto(pid) || ''} alt={`Peta kawasan ${pid}`} className="w-full block" />
              {areas.map((a) => {
                const label = actLabel(a);
                const [l, r] = (cfg.band || {})[a] || [0, 100];
                return (
                  <button
                    key={a}
                    onClick={() => onPick(a)}
                    title={t('pm.area', { a })}
                    aria-label={t('pm.area', { a })}
                    style={{ left: `${l}%`, width: `${r - l}%` }}
                    className={`absolute inset-y-0 grid place-items-center cursor-pointer transition-colors ${
                      label
                        ? 'bg-emerald-500/30 ring-2 ring-inset ring-emerald-400'
                        : 'bg-transparent hover:bg-white/20'
                    }`}
                  >
                    <span
                      className={`rounded-full px-2.5 py-1 text-[12px] font-black shadow-sm max-w-full truncate ${
                        label ? 'bg-emerald-600 text-white' : 'bg-white/90 text-slate-800'
                      }`}
                    >
                      {a}
                      {label && ` · ${label}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {cfg.cap && <p className="text-[11px] font-semibold text-slate-500 mt-2">{cfg.cap}</p>}
        </div>
      </div>
    </div>
  );
}

// The divider's x at a given height, used to centre each area's label.
function dividerXAtLocal(dividers, i, y) {
  const line = dividers[i];
  if (!line || !line.length) return 50;
  const pts = [...line].sort((a, b) => a.y - b.y);
  if (y <= pts[0].y) return pts[0].x;
  if (y >= pts[pts.length - 1].y) return pts[pts.length - 1].x;
  for (let k = 1; k < pts.length; k++) {
    if (y <= pts[k].y) {
      const a = pts[k - 1];
      const b = pts[k];
      const span = b.y - a.y;
      return span === 0 ? b.x : a.x + ((y - a.y) / span) * (b.x - a.x);
    }
  }
  return pts[pts.length - 1].x;
}

function nurseryKeyOf(pid) {
  for (const k in NURSERIES) if (pid.startsWith(NURSERIES[k].prefix)) return k;
  return 'BNN';
}

/* ================= ACTIVITY PICKER FOR ONE UNIT ================= */
// Up to two activities at once.
//
// Tapping the only activity a plot has does nothing — a plot on Transplanting
// should stay on Transplanting if the Field Conductor taps it again by
// accident. Moving it means tapping the activity it moved to.
//
// With two running, tapping one does turn it off: that is how "angkat tanah
// finished today" gets said. Choosing a third replaces the one picked longest
// ago rather than refusing the tap.
function ActivityPicker({ sel, t, onChange, onDone }) {
  function toggle(n) {
    if (sel.includes(n)) {
      if (sel.length > 1) onChange(sel.filter((x) => x !== n));
    } else if (sel.length < MAX_CONCURRENT) {
      onChange([...sel, n]);
    } else {
      onChange([...sel.slice(1), n]);
    }
  }

  return (
    <>
      <div className="px-4 py-2.5 overflow-y-auto flex-1">
        <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
          {t('pm.pickActivityMax', { n: MAX_CONCURRENT })}
        </div>
        {/* Phones get two columns filled downwards — 1–6 left, 7–11 right —
            so every activity is reachable without a scroll. On a laptop
            there is room for the original single full-width list. */}
        <div className="grid grid-rows-6 grid-flow-col gap-1 sm:grid-rows-none sm:grid-flow-row sm:grid-cols-1 sm:gap-1.5">
          {ACTIVITIES.map((a) => {
            const on = sel.includes(a.n);
            return (
              <button
                key={a.n}
                onClick={() => toggle(a.n)}
                className={`w-full flex items-center gap-1.5 sm:gap-2.5 rounded-lg px-2 sm:px-3 py-2 sm:py-2.5 border-2 text-left transition-colors cursor-pointer ${
                  on ? 'bg-emerald-50 border-emerald-500' : 'bg-white border-slate-200 hover:border-emerald-300'
                }`}
              >
                <span
                  className={`shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-full grid place-items-center text-[10px] sm:text-[11px] font-black ${
                    on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {on ? '✓' : a.n}
                </span>
                <span
                  className={`flex-1 min-w-0 text-[12px] sm:text-[13px] leading-tight font-black ${
                    on ? 'text-emerald-800' : 'text-slate-700'
                  }`}
                >
                  {/* Short label on phones, full name once there is room */}
                  <span className="sm:hidden">{a.mShort}</span>
                  <span className="hidden sm:inline">{a.name}</span>
                </span>
                {/* The ideal-day count is hidden on phones: the width it takes
                    is what forces the longer names onto a second line. */}
                <span className="hidden sm:inline shrink-0 text-[10px] font-bold text-slate-400">
                  {t('pm.idealDays', { d: a.days })}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-slate-100">
        <p className="text-[10px] font-semibold text-slate-400 text-center mb-2">{t('pm.autoDoneNote')}</p>
        <div className="flex gap-2">
          {/* The only way to empty a plot, now that tapping its single
              activity leaves it alone. Deliberate, so it is never an
              accidental tap. */}
          {sel.length === 1 && (
            <button
              onClick={() => onChange([])}
              className="shrink-0 bg-white border border-slate-300 text-slate-500 hover:text-rose-600 hover:border-rose-300 font-black text-[11px] uppercase tracking-widest rounded-xl px-3 py-3 cursor-pointer"
            >
              {t('pm.clearActivity')}
            </button>
          )}
          <button
            onClick={onDone}
            className="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-black text-[12px] uppercase tracking-widest rounded-xl py-3 transition-colors cursor-pointer"
          >
            {t('common.ok')}
          </button>
        </div>
      </div>
    </>
  );
}
