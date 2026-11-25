import { useRef, useState } from 'react';
import { useLang } from '../context/LanguageContext.jsx';
import { workTypeByKey, workTypeLabel } from '../modules/maintenance/helpers.js';
import { tintOf } from '../modules/maintenance/tints.js';
import WorkIcon from '../modules/maintenance/WorkIcons.jsx';
import { formatDistance, formatDuration } from '../modules/maintenance/track/track.js';

/** How far left the row must be dragged before letting go finishes the job. */
const COMMIT_PX = 84;
/** How wide the panel is, and so how far the thumb can pull it in. */
const MAX_PX = 112;

/**
 * One job on the list: what to do, where, with what — and the two ways to
 * finish it.
 *
 * ── Swipe left ──
 *
 * The whole row is the target, because a worker is doing this one-handed with
 * a knapsack sprayer in the other, and a button the size of a thumbnail is a
 * button they will miss. Dragging past COMMIT_PX and letting go records the
 * job. Letting go short of it springs back and leaves a green DONE panel
 * standing open, which is itself tappable — a swipe that did not go far enough
 * should not mean starting again, and it must not mean the row silently did
 * nothing.
 *
 * The thumb pulls the PANEL in from the right; the row itself does not move.
 * Sliding the row the way a mail app does took the icon and the plot name off
 * the left edge, which left a green DONE button beside a row that no longer
 * said which job it was about to finish. What the panel covers instead is the
 * row's own buttons, which have nothing to say while it is open anyway.
 *
 * Pointer events, not touch: the same handler then works under a thumb, under
 * a mouse, and under a test, instead of the row being untestable and dead on
 * anything that is not a phone.
 *
 * ── Start / Pause / Stop ──
 *
 * Start walks a GPS track for this job, and puts the phone away with it.
 * Start becomes PAUSE once it is running, because that is the button the thumb
 * is already over; STOP does what the name says AND finishes the job, saving
 * the walk with the record. That is the whole point of having walked it.
 *
 * Start is grey until the phone has a fix good enough to walk from — under
 * ±30 m — and says so on itself, `⌛ ±35 M`. A Start that presses and then
 * refuses is worse than one that says why it cannot; a paragraph explaining
 * it four rows above the button is clutter on a screen meant to be worked
 * down. The button is the honest place for the answer.
 *
 * The map button opens the satellite view — the nursery outline, where the
 * phone is, and the line walked so far, growing as it is walked. It only ever
 * looks: the walk is run from these buttons, and a second Start on the map
 * would be a rival recording of the same job.
 *
 * ── The camera ──
 *
 * A square at the end of the strip, not another full-width button: with a
 * walk running there are already three, and four labelled buttons across a
 * 390px phone is four buttons nobody can hit. It carries a count once there
 * is something on it, and the pictures show as thumbnails under the row so
 * they can be looked at and taken off again — a photo you cannot see is a
 * photo you will take twice.
 *
 * Nothing is uploaded here. The pictures ride along with the job and go up
 * when it is recorded, which is what makes them survive a plot with no
 * signal.
 *
 * The buttons sit in a row across the bottom of the card rather than stacked
 * down its side: three of them stacked made a row taller than a thumb, and a
 * list where four jobs fit on a screen is a list that can be worked down.
 */
export default function TaskRow({
  task, tint, tracking, session, elapsed, denied, busy,
  onStart, onPause, onResume, onStop, onComplete, onMap, canStart = true, waitFor = null,
  onPhoto, onDropPhoto, photos = null, sentBack = null,
}) {
  const { t, lang } = useLang();
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);   // the DONE panel, left standing
  const from = useRef(null);
  const moved = useRef(false);

  const wt = workTypeByKey(task.workTypeKey);
  const tone = tint || tintOf(task.workTypeKey);

  const down = (e) => {
    if (busy) return;
    from.current = e.clientX;
    moved.current = false;
  };
  const move = (e) => {
    if (from.current == null) return;
    const d = e.clientX - from.current;
    if (d < -4) moved.current = true;
    setDx(Math.max(-MAX_PX, Math.min(0, d)));
  };
  const up = () => {
    if (from.current == null) return;
    const d = dx;
    from.current = null;
    setDx(0);
    if (d <= -COMMIT_PX) { setOpen(false); onComplete(); return; }
    /* Short of the line: leave the panel open rather than snapping shut. The
       swipe was an attempt to finish the job, and answering it with nothing at
       all is how somebody decides the app is broken. */
    setOpen(d < -12);
  };

  /* A tap does nothing but shut the DONE panel if it is standing open.
   *
   * It used to open the full record form, and that was wrong. A swipe the
   * browser judged too small to be a drag is a tap, and so is a thumb landing
   * a little heavily — so finishing a job would every so often throw the
   * worker onto the FC Portal's month planner, which is the one screen this
   * portal exists to keep them off. A gesture nobody asked for must not be
   * able to change which app you appear to be in. There is no other screen to
   * be thrown onto now — the full form has gone — but the rule stands. */
  const click = () => {
    /* A drag is followed by a click on the way up, so a swipe that left the
       panel standing open would otherwise shut it again in the same gesture. */
    if (moved.current) { moved.current = false; return; }
    if (open) setOpen(false);
  };

  const why = session && session.why;
  /* How far the panel has come in. While a thumb is down it follows the drag;
     once it is lifted it is either shut or standing open. */
  const pulled = from.current != null ? -dx : (open ? MAX_PX : 0);

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={click}
        style={{ touchAction: 'pan-y' }}
        className={`relative bg-white rounded-2xl px-3.5 py-3 overflow-hidden
                    shadow-[0_2px_10px_rgba(0,0,0,.05)] select-none border
                    ${sentBack ? 'border-rose-300' : 'border-slate-200'}
                    ${busy ? 'opacity-60' : ''}`}
      >
        {/* A job the conductor refused, come back to be done again.
            Across the top of the card rather than tucked beside the plot
            name: this is not a detail of the row, it is what the row IS —
            the difference between walking out to spray a plot and walking
            out to put right what was wrong with it. The REASON is on it,
            because "work not finished" and "wrong plot" send somebody to do
            very different things. */}
        {sentBack && (
          <div className="-mx-3.5 -mt-3 mb-3 px-3.5 py-2 rounded-t-2xl bg-rose-50 border-b border-rose-200">
            <div className="text-[10px] font-black uppercase tracking-widest text-rose-700">
              {t('wk.sentBack')}
            </div>
            <div className="text-[12px] font-bold text-rose-900 leading-snug mt-0.5">
              {sentBack.reason || t('wk.sentBackNoReason')}
              {sentBack.by ? ` — ${sentBack.by}` : ''}
            </div>
          </div>
        )}

        <div className="flex items-start gap-3">
          <span className={`w-11 h-11 rounded-2xl grid place-items-center shrink-0 ${tone.bg}`}>
            <WorkIcon workKey={task.workTypeKey} className={`w-7 h-7 ${tone.fg}`} />
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[17px] font-black text-slate-800 leading-none">{task.plot}</span>
              {/* A ROW THE OFFICE DID NOT KEY SAYS SO. This one was derived
                  from its parent's round because the replant appeared after
                  the schedule was written and has seedlings standing in it
                  (see periodTasks) — so without a word on it, a worker meets
                  a plot on their list that was not there yesterday and has
                  nothing to read about why. It names the PARENT, which is
                  the thing that answers the question. */}
              {task.replantOf && (
                <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-1.5 py-0.5 uppercase tracking-wide shrink-0">
                  {t('wk.replantOf', { plot: task.replantOf })}
                </span>
              )}
              {task.nursery && (
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">
                  {task.nursery}
                </span>
              )}
            </div>
            <div className={`text-[12px] font-black mt-1 leading-tight ${tone.fg}`}>
              {workTypeLabel(wt, lang)}
            </div>
            {/* The chemical and its dose, exactly as the office planned them.
                Nobody types this — that is what makes the row a to-do and not
                a form. */}
            {task.chemical && (
              <div className="text-[12px] font-bold text-slate-500 mt-0.5 leading-snug break-words">
                {task.chemical}
              </div>
            )}

            {tracking && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  session.status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span className="text-[12px] font-black text-slate-700 tabular-nums">
                  {formatDistance(session.distance)} · {formatDuration(elapsed)}
                </span>
                <span className="text-[10px] font-bold text-slate-400 tabular-nums">
                  {t('wk.trkPointsN', { n: session.points.length })}
                </span>
                {session.status === 'paused' && (
                  <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">
                    {t('wk.paused')}
                  </span>
                )}
                {denied && (
                  <span className="text-[10px] font-black text-red-500">{t('wk.gpsDenied')}</span>
                )}
                {!denied && why && (
                  <span className="text-[10px] font-bold text-slate-400">{t(`wk.trk_${why}`)}</span>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Across the bottom, not down the side. The CLICK is stopped, so
            pressing one never also counts as a tap on the row — but the
            pointer-DOWN is not, deliberately: a right-handed thumb begins a
            leftward swipe over exactly this strip, and swallowing the press
            here made the swipe do nothing from the most natural place to
            start it. A drag that leaves a button never becomes a click on it,
            so both gestures still work. */}
        <div
          className={`mt-3 flex gap-2 [&>button]:flex-1 transition-opacity ${
            pulled > 12 ? 'opacity-0 pointer-events-none' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          {!tracking && onStart && (
            <button
              type="button" onClick={onStart} disabled={busy || !canStart}
              /* Named for what it IS, not for what it currently says — while
                 it is waiting for a fix its face reads "⌛ Wait · ±35 m". */
              aria-label={t('wk.start')}
              className="bg-emerald-600 active:bg-emerald-700 disabled:bg-slate-200
                         disabled:text-slate-400 text-white
                         font-black text-[11px] uppercase tracking-widest rounded-xl py-3"
            >
              {waitFor ? `⌛ ${waitFor}` : `▶ ${t('wk.start')}`}
            </button>
          )}
          {tracking && session.status === 'running' && (
            <button
              type="button" onClick={onPause} disabled={busy}
              className="bg-amber-500 active:bg-amber-600 disabled:opacity-50 text-white
                         font-black text-[11px] uppercase tracking-widest rounded-xl py-3"
            >
              ⏸ {t('wk.pause')}
            </button>
          )}
          {tracking && session.status === 'paused' && (
            <button
              type="button" onClick={onResume} disabled={busy}
              className="bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 text-white
                         font-black text-[11px] uppercase tracking-widest rounded-xl py-3"
            >
              ▶ {t('wk.resume')}
            </button>
          )}
          {tracking && (
            <button
              type="button" onClick={onStop} disabled={busy}
              className="bg-slate-800 active:bg-slate-900 disabled:opacity-50 text-white
                         font-black text-[11px] uppercase tracking-widest rounded-xl py-3"
            >
              ⏹ {t('wk.stop')}
            </button>
          )}
          {onMap && (
            <button
              type="button" onClick={onMap}
              aria-label={t('wk.openMap')}
              className="bg-white border border-slate-200 active:bg-slate-50 text-slate-600
                         font-black text-[11px] uppercase tracking-widest rounded-xl py-3"
            >
              🗺️ {t('wk.openMap')}
            </button>
          )}
          {onPhoto && (
            <button
              type="button" onClick={onPhoto} disabled={busy}
              aria-label={t('wk.addPhoto')}
              /* Fixed and square, and outside the flex-1 sharing above, so
                 adding it never squeezes Start into something unreadable. */
              className="!flex-none w-[52px] shrink-0 bg-white border border-slate-200
                         active:bg-slate-50 text-slate-600 disabled:opacity-50
                         font-black text-[11px] rounded-xl py-3 tabular-nums"
            >
              📷{photos && photos.length ? ` ${photos.length}` : ''}
            </button>
          )}
        </div>

        {/* What has been taken for this job, small, and removable. */}
        {photos && photos.length > 0 && (
          <div
            className={`mt-2 flex gap-2 flex-wrap transition-opacity ${
              pulled > 12 ? 'opacity-0 pointer-events-none' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            {photos.map((src, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onDropPhoto && onDropPhoto(i)}
                aria-label={t('wk.dropPhoto', { n: i + 1 })}
                className="relative w-14 h-14 rounded-xl overflow-hidden border border-slate-200"
              >
                <img src={src} alt="" className="w-full h-full object-cover" />
                <span className="absolute top-0 right-0 bg-slate-900/70 text-white
                                 text-[11px] font-black leading-none px-1.5 py-1 rounded-bl-lg">
                  ×
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pulled in from the right by the thumb, and tappable once it is
          showing. `pulled` is how far in it has come: 0 shut, MAX_PX open. */}
      <button
        type="button"
        onClick={() => { setOpen(false); onComplete(); }}
        aria-label={t('wk.markDone')}
        style={{ transform: `translateX(${MAX_PX - pulled}px)`,
                 transition: from.current ? 'none' : 'transform .18s ease-out' }}
        className={`absolute inset-y-0 right-0 w-[112px] bg-emerald-600 text-white
                    rounded-2xl flex flex-col items-center justify-center gap-0.5
                    cursor-pointer ${pulled > 12 ? '' : 'pointer-events-none'}`}
      >
        <span className="text-[19px] leading-none" aria-hidden="true">✓</span>
        <span className="text-[10px] font-black uppercase tracking-widest">{t('wk.markDone')}</span>
      </button>
    </div>
  );
}
