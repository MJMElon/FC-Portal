import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useLang } from '../../context/LanguageContext.jsx';
import {
  VERIFY_SETUP_NEEDED,
  workTypeByKey,
  workTypeLabel,
} from './data.js';
import { absoluteDay } from './RecordCard.jsx';
import { batchesIn } from './plotBatches.js';
import { tintOf } from './tints.js';
import WorkIcon from './WorkIcons.jsx';

/* Leaflet is most of a megabyte, and a conductor who never opens a track
   never downloads a byte of it. Same lazy import GpsTrack uses. */
const TrackMap = lazy(() => import('./track/TrackMap.jsx'));

/** The batches on a record, as a list — the column stores "225, 226". */
export const batchList = (s) =>
  String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

/* Why a record gets sent back. One tap for the two answers that come up over
   and over, and a box for everything else — a fixed list of six was a list
   nobody read to the end of, and the reason that actually applied was usually
   the seventh. The stored value is English so the office reads one wording
   whatever language the conductor works in; the button is translated. */
export const REJECT_REASONS = [
  { key: 'not_finished', store: 'Work not finished' },
  { key: 'no_track',     store: 'No track record' },
];

/** How far a card has to be dragged before letting go decides anything. */
const THRESHOLD = 110;

/**
 * The morning's submissions, one card at a time, under the week.
 *
 * A Field Conductor with thirty records to check does not want thirty rows
 * with a tick box each — they want the record in front of them, big enough to
 * read at arm's length, and one movement per answer. Right is yes, left is
 * no, and the same two answers are on buttons underneath for a mouse or for
 * anybody who would rather press than swipe.
 *
 * On the page rather than behind a button: checking the morning is part of
 * the morning, and a deck nobody can see is a deck nobody opens.
 *
 * Nothing here is final: every answer raises a banner that takes it back for
 * three seconds, because the cost of a mis-swipe has to be smaller than the
 * cost of being careful, or the deck gets read slowly and nobody uses it.
 */
export default function VerifyHub({
  records, columnsReady = true, canReject = true,
  /* plotKey → [{ batch, qty }]. Which batches are standing in the plot the
     record names, so the conductor picks from what is actually there rather
     than typing a number from memory. */
  batchMap = null,
  /* The writes go back through the module's source rather than straight to
     Supabase: the same board serves the Worker Portal through the worker_*
     functions, and a component that reaches for the table directly would work
     on one door and fail silently on the other. */
  onApprove, onReject, onUndo, onChanged,
}) {
  const { t, lang } = useLang();

  /* The deck as it stood when the page last read the records. Held locally so
     a card leaving is an animation rather than the list underneath re-sorting
     mid-swipe — and re-seeded when a genuinely different set arrives, or a
     reload would leave the conductor looking at a stale deck. */
  const [queue, setQueue] = useState(() => [...(records || [])]);
  const seed = useRef(sig(records));
  useEffect(() => {
    const s = sig(records);
    if (s === seed.current) return;
    seed.current = s;
    setQueue([...(records || [])]);
  }, [records]);

  const [drag, setDrag] = useState(null);      // { dx, dy } while a finger is down
  const [flying, setFlying] = useState(null);  // 'left' | 'right' — the card on its way out
  const [asking, setAsking] = useState(null);  // the record waiting for a reason
  const [typed, setTyped] = useState('');      // a reason in the conductor's own words
  const [undo, setUndo] = useState(null);      // { record, verb }
  const [error, setError] = useState(null);
  const [done, setDone] = useState({ ok: 0, back: 0 });
  /* recordId → [batch] while the conductor is deciding. Kept per record and
     not on the top card alone, so flicking back through the deck with Undo
     does not lose an answer already given. Seeded from whatever the record
     already carries — a worker who ticked his own batches has answered, and
     the conductor is confirming rather than starting again. */
  const [picked, setPicked] = useState({});
  const [map, setMap] = useState(null);        // the record whose track is open

  const batchesFor = (r) => (r && batchMap ? batchesIn(batchMap, r.plot_name) : []);
  const pickedOn = (r) => (r && picked[r.id] !== undefined ? picked[r.id] : batchList(r && r.batch_name));

  function toggleBatch(r, name) {
    const now = pickedOn(r);
    setPicked((p) => ({
      ...p,
      [r.id]: now.includes(name) ? now.filter((x) => x !== name) : [...now, name],
    }));
  }

  /* May this card be signed for yet?
   *
   * A batch has to be ticked first — that is the whole point of asking. But
   * "no batch ticked" and "there is no batch to tick" are different answers,
   * and only the first is the conductor's to fix: a plot whose batches have
   * all been culled, sold or moved on offers nothing, and blocking there
   * would leave a record nobody could ever sign. So the gate is on plots that
   * HAVE batches, which is the case the rule was asked for.
   *
   * The same reasoning covers the moment before the batch list has loaded:
   * nothing to tick, nothing withheld. A conductor is never left holding a
   * button that will not go and no way to find out why. */
  const needsBatch = (r) => batchesFor(r).length > 0 && pickedOn(r).length === 0;

  /* Whether the columns are there is the page's answer, not this component's
     — and it arrives AFTER the first paint, because the records have to be
     read before anything can be read off them. Held as state it was captured
     once, while the page was still empty and therefore still hopeful, and
     never corrected: the hub then sat on "nothing left to check" over a list
     of records it could not accept. A write that comes back complaining is
     the only thing this component learns on its own. */
  const [writeRefused, setWriteRefused] = useState(false);
  const setupNeeded = !columnsReady || writeRefused;
  const start = useRef(null);
  const undoTimer = useRef(null);

  const top = queue[0] || null;

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  function raiseUndo(record, verb) {
    clearTimeout(undoTimer.current);
    setUndo({ record, verb });
    undoTimer.current = setTimeout(() => setUndo(null), 3000);
  }

  function fail(e) {
    if (e && e.message === VERIFY_SETUP_NEEDED) { setWriteRefused(true); return; }
    setError((e && e.message) || String(e));
  }

  /* The card leaves first and the write follows. A conductor working through
     thirty records should never be waiting on a round trip to see the next
     one — and if the write does fail, the card comes back and says so.

     The card is thrown off screen before it is dropped from the deck, or it
     would simply disappear: removing it in the same render that starts the
     animation leaves nothing for the animation to move. */
  function settle(record, verb, run) {
    setDrag(null);
    setFlying(verb === 'verified' ? 'right' : 'left');
    setTimeout(() => {
      setQueue((q) => q.filter((r) => r.id !== record.id));
      setFlying(null);
    }, 220);
    setDone((d) => (verb === 'verified' ? { ...d, ok: d.ok + 1 } : { ...d, back: d.back + 1 }));
    raiseUndo(record, verb);
    run()
      .then(() => onChanged && onChanged())
      .catch((e) => {
        setQueue((q) => [record, ...q.filter((r) => r.id !== record.id)]);
        setDone((d) => (verb === 'verified' ? { ...d, ok: d.ok - 1 } : { ...d, back: d.back - 1 }));
        setUndo(null);
        fail(e && e.message === VERIFY_SETUP_NEEDED
          ? e
          : new Error(t('mt.saveErr', { msg: (e && e.message) || String(e) })));
      });
  }

  /* Sign it — with the batches the conductor ticked. They go with the
     signature because they are part of the same answer: he was there, he
     knows which beds were walked, and the record is only complete once he has
     said so. */
  const approve = (record) => {
    if (needsBatch(record)) { setError(t('mt.vfBatchNeeded')); return; }
    settle(record, 'verified', () => onApprove(record, pickedOn(record).join(', ')));
  };

  /* ✕ always opens the sheet. Signing works on any database that has run the
     verify file; sending back needs the later one, and where it is missing
     the sheet says so INSTEAD of the reasons rather than not opening.

     It used to put that message in a strip under the deck and leave the press
     looking like it had done nothing — four hundred pixels of card above it,
     and the one thing a conductor needed to read was off the bottom of the
     screen. A button that opens nothing reads as a broken button, whatever is
     written somewhere else on the page. */
  const askWhy = (record) => setAsking(record);

  const sendBack = (record, reason) => {
    setAsking(null);
    setTyped('');
    settle(record, 'rejected', () => onReject(record, reason));
  };

  /* Taking it back puts the record where it was — waiting — and returns it to
     the front of the deck, so a mis-swipe is corrected by answering again
     rather than by hunting for the record afterwards. */
  function takeBack() {
    if (!undo) return;
    const { record, verb } = undo;
    clearTimeout(undoTimer.current);
    setUndo(null);
    setDone((d) => (verb === 'verified' ? { ...d, ok: d.ok - 1 } : { ...d, back: d.back - 1 }));
    setQueue((q) => [record, ...q.filter((r) => r.id !== record.id)]);
    onUndo(record)
      .then(() => onChanged && onChanged())
      .catch(fail);
  }

  // ── the drag itself ──
  function onDown(e) {
    if (!top || flying || asking) return;
    /* A tick box, a track button, a photo — anything the card offers to be
       pressed keeps its press. Starting a drag from one captures the pointer
       and the tap never lands, which is a checkbox that will not tick. */
    if (e.target.closest('input, button, a, label')) return;
    start.current = { x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, dy: 0 });
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    if (!start.current) return;
    setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y });
  }
  function onUp() {
    if (!start.current) return;
    const moved = (drag && drag.dx) || 0;
    start.current = null;
    if (!top) { setDrag(null); return; }
    /* Swiping right is the same answer as pressing ✓, so it meets the same
       condition. It springs back and says why rather than refusing silently —
       a card that will not go and gives no reason reads as a broken card. */
    if (moved > THRESHOLD && needsBatch(top)) {
      setDrag(null);
      setError(t('mt.vfBatchNeeded'));
      return;
    }
    if (moved > THRESHOLD) { approve(top); return; }
    // Left asks why before it commits, so the card springs back and waits
    // rather than leaving on an answer nobody has given yet.
    setDrag(null);
    if (moved < -THRESHOLD) askWhy(top);
  }

  const dx = flying === 'right' ? 700 : flying === 'left' ? -700 : (drag ? drag.dx : 0);
  const dy = drag && !flying ? drag.dy * 0.35 : 0;
  const tilt = Math.max(-14, Math.min(14, dx / 14));
  const yes = dx > 55, no = dx < -55;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,.06)]">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-emerald-50 flex items-center justify-between gap-2">
        <span className="font-black uppercase tracking-widest text-[11px] sm:text-xs text-emerald-800 truncate">
          ✓ {t('mt.verifyHub')}
        </span>
        <span className="text-[10px] font-black text-emerald-700 shrink-0 tabular-nums">
          {setupNeeded ? '—' : t('mt.verifyLeft', { n: queue.length })}
        </span>
      </div>

      {setupNeeded ? (
        <div className="m-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4
                        text-[13px] font-black text-amber-800 leading-relaxed">
          {t('mt.verifySetupNeeded')}
        </div>
      ) : !queue.length ? (
        <div className="px-4 py-6 text-center">
          <div className="text-[13px] font-black text-emerald-700">{t('mt.verifyAllDone')}</div>
          {(done.ok || done.back) > 0 && (
            <div className="text-[11px] font-bold text-slate-400 mt-1">
              {t('mt.verifyTally', { ok: done.ok, back: done.back })}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Capped and centred: a card deck the full width of a tablet is
              a card nobody can throw, and the record reads better in a column
              than stretched across nine hundred pixels. */}
          <div className="relative mx-auto mt-3 w-[calc(100%-24px)] max-w-[460px] h-[440px] sm:h-[470px]">
            {/* Two cards behind the top one, so the deck reads as a deck and a
                card leaving reveals the next rather than a hole. Reversed, so
                the top card is painted last and takes the drag. */}
            {[...queue.slice(0, 3)].reverse().map((r, idx, arr) => {
              const depth = arr.length - 1 - idx;      // 0 = the top card
              const isTop = depth === 0;
              return (
                <div
                  key={r.id}
                  onPointerDown={isTop ? onDown : undefined}
                  onPointerMove={isTop ? onMove : undefined}
                  onPointerUp={isTop ? onUp : undefined}
                  onPointerCancel={isTop ? onUp : undefined}
                  style={{
                    transform: isTop
                      ? `translate(${dx}px, ${dy}px) rotate(${tilt}deg)`
                      : `translateY(${depth * 14}px) scale(${1 - depth * 0.035})`,
                    transition: isTop && (!drag || flying) ? 'transform .22s ease-out, opacity .22s ease-out' : 'none',
                    opacity: isTop && flying ? 0 : 1,
                    // Vertical scrolling inside a long card has to keep
                    // working on a phone; only the sideways gesture is ours.
                    touchAction: isTop ? 'pan-y' : undefined,
                  }}
                  className={`absolute inset-0 bg-white rounded-2xl border border-slate-200 overflow-hidden
                              ${isTop ? 'shadow-xl cursor-grab active:cursor-grabbing z-10' : 'shadow z-0'}`}
                >
                  <VerifyCard
                    record={r} t={t} lang={lang}
                    yes={isTop && yes} no={isTop && no}
                    batches={batchesFor(r)}
                    picked={pickedOn(r)}
                    onToggleBatch={(name) => toggleBatch(r, name)}
                    onOpenTrack={() => setMap(r)}
                  />
                </div>
              );
            })}
          </div>

          {/* The same two answers, for a mouse. */}
          <div className="flex items-center justify-center gap-5 py-4">
            <button onClick={() => top && askWhy(top)} aria-label={t('mt.reject')}
              className="w-[56px] h-[56px] rounded-full bg-white border border-slate-200 shadow-lg
                         text-rose-600 text-[24px] font-black grid place-items-center
                         hover:bg-rose-50 active:scale-95 transition cursor-pointer">
              ✕
            </button>
            <button onClick={() => top && approve(top)} aria-label={t('mt.approve')}
              disabled={!top || needsBatch(top)}
              title={top && needsBatch(top) ? t('mt.vfBatchNeeded') : undefined}
              className="w-[56px] h-[56px] rounded-full bg-white border border-slate-200 shadow-lg
                         text-emerald-600 text-[24px] font-black grid place-items-center
                         disabled:opacity-40 disabled:cursor-not-allowed
                         hover:bg-emerald-50 active:scale-95 transition cursor-pointer">
              ✓
            </button>
          </div>

          {/* Why the tick is greyed out. Said under the buttons, where the
              hand already is — a disabled control that explains itself only
              in a tooltip explains itself to nobody on a phone. */}
          {top && needsBatch(top) && (
            <div className="px-4 pb-4 -mt-2 text-center text-[11.5px] font-black text-amber-700">
              {t('mt.vfBatchNeeded')}
            </div>
          )}
        </>
      )}

      {/* The walk, on the satellite map. viewOnly — this is a track that
          happened, not one being walked. Outside the deck and above it: the
          cards carry their own stacking and a map painted underneath them is
          a map nobody can use. */}
      {map && (
        <div className="fixed inset-0 z-[70]">
          <Suspense fallback={
            <div className="fixed inset-0 bg-slate-900 grid place-items-center">
              <div className="text-emerald-400 font-mono text-xs uppercase tracking-[0.3em] animate-pulse">
                {t('common.loading')}
              </div>
            </div>
          }>
            <TrackMap
              viewOnly
              initial={{ track: map.gps_track, distance_m: map.gps_distance_m,
                         started_at: map.gps_started_at, ended_at: map.gps_ended_at }}
              onClose={() => setMap(null)}
              onDone={() => setMap(null)}
            />
          </Suspense>
        </div>
      )}

      {/* Why it is going back. */}
      {asking && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
               onClick={() => { setAsking(null); setTyped(''); }} />
          <div className="relative bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 pb-7 shadow-2xl">
            <div className="font-black text-slate-800 text-[15px] uppercase tracking-wide mb-1">
              {t('mt.rejectWhy')}
            </div>
            <div className="text-[12px] font-bold text-slate-400 mb-3">
              {t('mt.rejectHint')}
            </div>

            {!canReject ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4
                              text-[12.5px] font-bold text-amber-800 leading-relaxed">
                {t('mt.rejectSetupNeeded')}
              </div>
            ) : (
              <>
            <div className="space-y-2">
              {REJECT_REASONS.map((r) => (
                <button key={r.key} onClick={() => sendBack(asking, r.store)}
                  className="w-full rounded-xl border-2 border-slate-200 hover:border-rose-400 hover:bg-rose-50
                             px-4 py-3.5 text-[13px] font-black text-slate-700 text-left transition-colors cursor-pointer">
                  {t(`mt.reason.${r.key}`)}
                </button>
              ))}
            </div>

            {/* Everything the two buttons do not cover. Sending back with an
                empty box would file a refusal nobody can act on, so the
                button waits until something has been written. */}
            <div className="mt-3">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                {t('mt.reason.other')}
              </label>
              <textarea
                rows={2}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t('mt.reasonPlaceholder')}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-sm
                           font-semibold outline-none focus:border-rose-400"
              />
              <button
                onClick={() => sendBack(asking, typed.trim())}
                disabled={!typed.trim()}
                className="w-full mt-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-default
                           text-white font-black text-[11px] uppercase tracking-widest rounded-xl py-3 cursor-pointer"
              >
                {t('mt.reject')}
              </button>
            </div>
              </>
            )}

            <button onClick={() => { setAsking(null); setTyped(''); }}
              className="w-full mt-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black
                         text-[11px] uppercase tracking-widest rounded-xl py-3 cursor-pointer">
              {canReject ? t('common.cancel') : t('common.close')}
            </button>
          </div>
        </div>
      )}

      {/* Three seconds to change your mind. */}
      {undo && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3
                        bg-slate-900 text-white rounded-2xl shadow-2xl pl-4 pr-2 py-2.5 max-w-[92vw]">
          <span className="text-[12.5px] font-bold truncate">
            {t(undo.verb === 'verified' ? 'mt.undoVerified' : 'mt.undoSentBack',
               { plot: undo.record.plot_name })}
          </span>
          <button onClick={takeBack}
            className="shrink-0 bg-white/15 hover:bg-white/25 rounded-xl px-3 py-1.5
                       font-black text-[11px] uppercase tracking-widest cursor-pointer">
            {t('mt.undo')}
          </button>
        </div>
      )}

      {error && (
        <div className="mx-3 mb-3 bg-amber-50 border border-amber-200 text-amber-800
                        text-[12.5px] font-bold rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} aria-label={t('common.close')}
            className="shrink-0 text-amber-700 text-lg leading-none cursor-pointer">×</button>
        </div>
      )}
    </div>
  );
}

/** Which records these are, so a reload that changed nothing does not throw
    away a deck the conductor is halfway through. */
function sig(rows) {
  return (rows || []).map((r) => r.id).join(',');
}

/** The record itself, filling the card. */
function VerifyCard({ record: r, t, lang, yes, no, batches, picked, onToggleBatch, onOpenTrack }) {
  const wt = workTypeByKey(r.work_type);
  const tint = tintOf(r.work_type);
  const hasMap = r.gps_lat != null && r.gps_lng != null;
  const mapUrl = hasMap ? `https://www.google.com/maps?q=${r.gps_lat},${r.gps_lng}` : null;
  /* The walk itself, not just where it started. A conductor checking that a
     round was actually walked needs the LINE — "2946 m" is a number anybody
     could have, and the shape of it on the plot is the thing that answers the
     question. Drawn on the same satellite map the worker recorded it on. */
  const hasTrack = !!(r.gps_track && r.gps_track.length);
  const photos = String(r.photo_urls || '').split(',').map((u) => u.trim()).filter(Boolean);

  return (
    <div className="h-full flex flex-col">
      {/* Which way this card is going, while it is being pushed. */}
      <div className={`absolute top-[86px] left-5 z-10 rounded-xl border-4 px-3 py-1 font-black text-[15px]
                       uppercase tracking-widest rotate-[-12deg] transition-opacity
                       border-emerald-500 text-emerald-600 ${yes ? 'opacity-100' : 'opacity-0'}`}>
        {t('mt.approve')}
      </div>
      <div className={`absolute top-[86px] right-5 z-10 rounded-xl border-4 px-3 py-1 font-black text-[15px]
                       uppercase tracking-widest rotate-[12deg] transition-opacity
                       border-rose-500 text-rose-600 ${no ? 'opacity-100' : 'opacity-0'}`}>
        {t('mt.reject')}
      </div>

      <div className={`px-4 pt-4 pb-3 ${tint.bg}`}>
        <div className="flex items-center gap-3">
          <span className="w-[48px] h-[48px] rounded-2xl bg-white/70 grid place-items-center shrink-0">
            <WorkIcon workKey={r.work_type} className={`w-7 h-7 ${tint.fg}`} />
          </span>
          <div className="min-w-0">
            {/* The worker, first and biggest: this is a signature on somebody's
                morning, and whose morning it is comes before what was done. */}
            <div className="text-[16px] font-black text-slate-900 truncate">
              {r.worked_by || r.reported_by || t('mt.unknownWorker')}
            </div>
            <div className={`text-[12px] font-black ${tint.fg} truncate`}>
              {workTypeLabel(wt, lang) || r.jenis || '—'} · {r.plot_name}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5">
        {/* The date, spelt out. Not "Today" — see absoluteDay. */}
        <Row label={t('mt.date')} value={absoluteDay(r.work_date, lang)} />
        {/* The plot, not the nursery. A conductor signing off a morning is
            standing in the nursery; which of its plots was worked is the thing
            he is actually being asked about, and the nursery was the same
            answer on every card in the deck. */}
        <Row label={t('mt.plot')} value={r.plot_name || '—'} />
        <Row label={t('mt.chemical')} value={r.chemical || t('mt.noChemical')} />

        {/* Where the work happened.
            With a track: open it on the satellite map and walk the line.
            With only a starting fix: the device's own map, as before — there
            is no line to draw, and pretending otherwise would be worse than
            saying so. */}
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
            {t('mt.mapLabel')}
          </div>
          {hasTrack || hasMap ? (
            <button
              type="button"
              onClick={hasTrack ? onOpenTrack
                                : () => window.open(mapUrl, '_blank', 'noopener')}
              className="w-full flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50
                         hover:bg-slate-100 px-3.5 py-2.5 transition-colors text-left cursor-pointer">
              <span className="w-9 h-9 rounded-xl bg-white grid place-items-center shrink-0 text-[18px]">
                {hasTrack ? '🛰️' : '📍'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-black text-slate-700 truncate">
                  {hasTrack ? t('wk.seeTrack')
                            : `${Number(r.gps_lat).toFixed(5)}, ${Number(r.gps_lng).toFixed(5)}`}
                </span>
                <span className="block text-[11px] font-bold text-slate-400">
                  {[
                    r.gps_distance_m != null ? t('mt.walked', { m: Math.round(r.gps_distance_m) }) : null,
                    r.gps_points != null ? t('mt.fixes', { n: r.gps_points }) : null,
                  ].filter(Boolean).join(' · ') || t('mt.openMap')}
                </span>
              </span>
              <span className="text-slate-300 text-[18px] shrink-0">›</span>
            </button>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 px-3.5 py-2.5
                            text-[12px] font-bold text-slate-400">
              {t('mt.noTrack')}
            </div>
          )}
        </div>

        {/* Which batch was worked — the conductor's answer, not the worker's.
            He was there and knows which beds were walked, and until he says so
            the record names a plot and nothing finer. Nothing is pre-ticked:
            an answer nobody gave must not look like one somebody did. */}
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
            {t('mt.batches')}
          </div>
          {batches.length ? (
            <div className="space-y-1.5">
              {batches.map((b) => {
                const on = picked.includes(b.batch);
                return (
                  <label key={b.batch}
                    className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2 cursor-pointer
                                ${on ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}>
                    <input type="checkbox" className="w-5 h-5 accent-emerald-600 shrink-0"
                           checked={on} onChange={() => onToggleBatch(b.batch)} />
                    <span className="font-black text-slate-800 text-[13.5px] flex-1 min-w-0 truncate">
                      {b.batch}
                    </span>
                    <span className={`text-[11.5px] font-bold shrink-0 tabular-nums
                                      ${b.qty < 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {b.qty.toLocaleString()}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            /* Nothing standing in the plot — culled, sold or moved on. Said
               plainly, because this is also why the tick is NOT withheld here:
               there is no answer to give. */
            <div className="rounded-xl border border-dashed border-slate-200 px-3.5 py-2.5
                            text-[12px] font-bold text-slate-400">
              {r.batch_name || t('mt.vfNoBatches')}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
            {t('mt.remark')}
          </div>
          <div className={`text-[13px] ${r.remark ? 'text-slate-700 font-semibold' : 'text-slate-400 font-bold'}`}>
            {r.remark || t('mt.noRemark')}
          </div>
        </div>

        {!!photos.length && (
          <div className="flex flex-wrap gap-2">
            {photos.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                <img src={u} alt="" loading="lazy"
                     className="w-[68px] h-[68px] object-cover rounded-xl border border-slate-200" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-[92px] shrink-0">
        {label}
      </span>
      <span className="text-[13.5px] font-black text-slate-800 min-w-0 break-words">{value}</span>
    </div>
  );
}
