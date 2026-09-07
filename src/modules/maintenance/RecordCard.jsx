import { useLang } from '../../context/LanguageContext.jsx';
import { localeOf, shortDate } from '../../lib/day.js';
import { workTypeByKey, workTypeLabel } from './data.js';
import { formatDistance, mapsUrl } from './track/track.js';
import { tintOf } from './tints.js';
import WorkIcon from './WorkIcons.jsx';

/* "Today", "Yesterday", then the date. Most of a list is the last day or two,
   and a Field Conductor reads those faster as words than as 2026-08-22.
   Anything older gets the date, because "5 days ago" is a sum nobody wants to
   do. */
/**
 * The date itself, always — never "Today", never "Yesterday".
 *
 * Signing off somebody's morning is a record of WHICH morning, and a card
 * that says "Today" is only readable on the day it was drawn: the same
 * screenshot, the same printout, the same conductor scrolling back a week
 * later cannot tell you what day it means. The Verify Hub uses this; the
 * lists that are plainly about the here and now still use relativeDay.
 */
export function absoluteDay(iso, lang) {
  if (!iso) return '—';
  const d = new Date(Date.parse(iso));
  if (isNaN(d.getTime())) return iso;
  return shortDate(d, localeOf(lang));
}

export function relativeDay(iso, today, t) {
  if (!iso) return '—';
  if (iso === today) return t('mt.today');
  const ms = Date.parse(iso), now = Date.parse(today);
  if (Number.isFinite(ms) && Number.isFinite(now)) {
    if (Math.round((now - ms) / 86400000) === 1) return t('mt.yesterday');
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return shortDate(d, 'en-MY');
  }
  return iso;
}

/**
 * One recorded job, as it appears in every list that shows one.
 *
 * Was written out inside the module's own list; the history dialog needs the
 * same card, and two copies of a card is two chances for the same record to
 * read differently depending on which screen it is opened from.
 */
export default function RecordCard({
  record: r, today, mayVerify, mayEdit, mayDelete, onVerify, onEdit, onDelete,
}) {
  const { t, lang } = useLang();
  const wt = workTypeByKey(r.work_type);

  return (
    <div
      className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] p-3.5"
    >
      <div className="flex items-start gap-3">
        {/* The job's own colour and icon, so the list is scanned
            the same way the week above it is. */}
        <span className={`w-[38px] h-[38px] rounded-xl grid place-items-center shrink-0 ${tintOf(r.work_type).bg}`}>
          <WorkIcon workKey={r.work_type} className={`w-[22px] h-[22px] ${tintOf(r.work_type).fg}`} />
        </span>

        <div className="flex-1 min-w-0">
          <div className="font-black text-slate-800 text-[14px] leading-tight">
            {workTypeLabel(wt, lang) || r.jenis || '—'} · {r.plot_name}
          </div>
          {/* When and what was used. Who did it used to be the
              last item on this grey line; now that workers record
              their own mornings it is the thing a conductor is
              reading the list FOR, so it has a line of its own
              below. */}
          <div className="text-[11.5px] font-bold text-slate-400 mt-0.5">
            {[
              relativeDay(r.work_date, today, t),
              r.chemical || null,
              r.qty != null ? Number(r.qty).toLocaleString() : null,
            ].filter(Boolean).join(' · ')}
          </div>

          {/* Who did the work. worked_by is set only when the
              conductor keyed it for somebody else, so when it is
              there it is the answer and reported_by is merely who
              held the phone — said quietly underneath. */}
          <div className="text-[12.5px] font-black text-slate-600 mt-1">
            {r.worked_by || r.reported_by || t('mt.byNobody')}
          </div>
          {r.worked_by && r.reported_by && r.worked_by !== r.reported_by && (
            <div className="text-[11px] font-semibold text-slate-400">
              {t('mt.keyedBy', { name: r.reported_by })}
            </div>
          )}

          {r.batch_name && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {String(r.batch_name).split(',').map((b) => b.trim()).filter(Boolean).map((b) => (
                <span key={b} className="text-[10px] font-black tabular-nums text-slate-600 bg-slate-100 rounded-md px-2 py-0.5">
                  {b}
                </span>
              ))}
            </div>
          )}
          {r.remark && (
            <div className="text-[12px] text-slate-500 mt-1.5 italic break-words">{r.remark}</div>
          )}

          {/* Sent back says why. Without the reason the card only says the
              conductor was unhappy, which nobody can act on. */}
          {r.rejected_at && (
            <div className="text-[11.5px] font-bold text-rose-600 mt-1.5">
              {t('mt.sentBackBy', {
                who: r.rejected_by || '—',
                why: r.reject_reason || t('mt.noReason'),
              })}
            </div>
          )}

          {/* The track walked while the job was done. Shown to
              whoever can see the record, not only to whoever may
              record one — a conductor checking a morning's work is
              exactly the person it is for.

              The distance is the thing being read; the link opens
              where the track started. The line itself is not drawn
              on a list of five hundred rows. */}
          {r.gps_lat != null && r.gps_lng != null && (
            <a
              href={mapsUrl(r.gps_lat, r.gps_lng)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 mt-1.5 text-[11px] font-bold text-slate-500 tabular-nums"
            >
              <span aria-hidden="true">🛰️</span>
              {r.gps_distance_m != null ? (
                <>
                  {formatDistance(r.gps_distance_m)}
                  {r.gps_points != null && (
                    <span className="text-slate-400">
                      · {t('mt.trkPointsN', { n: r.gps_points })}
                    </span>
                  )}
                </>
              ) : (
                <>{Number(r.gps_lat).toFixed(6)}, {Number(r.gps_lng).toFixed(6)}</>
              )}
            </a>
          )}
          {r.photo_urls && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {String(r.photo_urls).split(',').map((u) => u.trim()).filter(Boolean).map((u) => (
                // Opens full size in a new tab; the card only needs a thumbnail.
                <a key={u} href={u} target="_blank" rel="noreferrer">
                  <img src={u} alt="" loading="lazy"
                       className="w-[42px] h-[42px] object-cover rounded-[9px] border border-slate-200" />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Done, or still on the phone waiting for a signal. */}
        {r._pending ? (
          <span className="shrink-0 text-[9px] font-black uppercase tracking-widest bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-1">
            ⏳ {t('mt.waiting')}
          </span>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"
               className="w-[18px] h-[18px] text-emerald-600 shrink-0 mt-1"
               fill="none" stroke="currentColor" strokeWidth="2.6"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 13 4 4L19 7" />
          </svg>
        )}
      </div>

      {/* Verified, or the button to verify it. Shown to everyone
          — a worker seeing "checked by Encik Ramli" against their
          own morning is the point of the signature — but only a
          conductor with the tick can press it. A queued record has
          not reached the database and cannot be signed for yet. */}
      {!r._pending && (r.verified_at || mayVerify) && (
        <div className="mt-2.5">
          {r.verified_at ? (
            <button
              onClick={() => onVerify(r)}
              disabled={!mayVerify}
              className={`w-full flex items-center justify-center gap-1.5 rounded-xl py-2 border text-[11px] font-black uppercase tracking-widest
                bg-emerald-50 border-emerald-200 text-emerald-700
                ${mayVerify ? 'cursor-pointer hover:bg-emerald-100' : 'cursor-default'}`}
              title={mayVerify ? t('mt.unverify') : undefined}
            >
              <span aria-hidden="true">✓</span>
              {t('mt.verifiedBy', { name: r.verified_by || '—' })}
            </button>
          ) : (
            <button
              onClick={() => onVerify(r)}
              className="w-full rounded-xl py-2 border border-dashed border-slate-300 bg-white hover:bg-slate-50 hover:border-emerald-400 text-slate-500 hover:text-emerald-700 text-[11px] font-black uppercase tracking-widest cursor-pointer transition-colors"
            >
              {t('mt.verify')}
            </button>
          )}
        </div>
      )}

      {/* Each button behind its own tick, so somebody given Edit
          and not Delete gets a full-width Edit rather than an Edit
          with a dead button beside it. */}
      {(mayEdit || mayDelete) && !r._pending && (
        <div className="flex gap-2 mt-2.5">
          {mayEdit && (
            <button
              onClick={() => onEdit(r)}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[11px] uppercase tracking-widest rounded-xl py-2"
            >
              {t('mt.edit')}
            </button>
          )}
          {mayDelete && (
            <button
              onClick={() => onDelete(r)}
              className={`${mayEdit ? 'px-4' : 'flex-1'} bg-rose-50 hover:bg-rose-100 text-rose-600 font-black text-[11px] uppercase tracking-widest rounded-xl py-2`}
            >
              {t('mt.delete')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
