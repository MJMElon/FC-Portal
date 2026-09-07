import { Suspense, lazy, useEffect, useState } from 'react';
import { useLang } from '../context/LanguageContext.jsx';
import { workTypeByKey, workTypeLabel } from '../modules/maintenance/helpers.js';
import { tintOf } from '../modules/maintenance/tints.js';
import WorkIcon from '../modules/maintenance/WorkIcons.jsx';
import { formatDistance, formatDuration } from '../modules/maintenance/track/track.js';
import { localeOf, shortDate } from '../lib/day.js';

const TrackMap = lazy(() => import('../modules/maintenance/track/TrackMap.jsx'));

// One date format for the whole system — see lib/day.js for why Sept is cut.

/** "3 Aug 2026" — a date a worker reads, not 2026-08-03. */
function dayOf(iso, lang) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return shortDate(d, localeOf(lang), false);
}

/**
 * A finished job, opened.
 *
 * What was done, where, when, with what — and the walk, if one was recorded.
 *
 * The walked line is NOT in the record the list was drawn from: that call
 * carries the summary only, on purpose, because a thousand points on each of
 * two thousand records is tens of megabytes down a nursery's signal. It is
 * fetched here, for this one job, the moment the sheet opens.
 *
 * A job recorded without a walk is not a fault and does not say so as if it
 * were. It simply has no map to offer.
 */
export default function DoneSheet({ record, task, source, onClose }) {
  const { t, lang } = useLang();
  const [track, setTrack] = useState(undefined);   // undefined = still asking
  const [map, setMap] = useState(false);

  const wt = workTypeByKey(record.work_type || (task && task.workTypeKey));
  const tone = tintOf(record.work_type || (task && task.workTypeKey));

  /* Only worth asking when the record says a walk exists. A job with no
     points has nothing to fetch, and asking anyway is a round trip on a
     nursery's signal to be told what the row already said. */
  const walked = Number(record.gps_points || 0) > 0;

  /* A record still sitting in the outbox carries its photos as data: URLs
     rather than links, and those render in an <img> exactly the same way —
     so a job finished in a plot with no signal shows its pictures back
     immediately instead of looking as though they were lost. */
  const photoUrls = String(record.photo_urls || '')
    .split(',').map((u) => u.trim()).filter(Boolean)
    .concat((record.photos || []).filter(Boolean));

  useEffect(() => {
    if (!walked || !source.loadTrack || record._pending) { setTrack(null); return undefined; }
    let live = true;
    source.loadTrack(record.id)
      .then((x) => { if (live) setTrack(x || null); })
      .catch(() => { if (live) setTrack(null); });
    return () => { live = false; };
  }, [record.id, walked]);   // eslint-disable-line react-hooks/exhaustive-deps

  const seconds = record.gps_started_at && record.gps_ended_at
    ? (Date.parse(record.gps_ended_at) - Date.parse(record.gps_started_at)) / 1000
    : (track && track.started_at && track.ended_at
        ? (Date.parse(track.ended_at) - Date.parse(track.started_at)) / 1000
        : 0);

  const label = 'text-[10px] font-black uppercase tracking-widest text-slate-400';
  const value = 'text-[14px] font-bold text-slate-700 mt-0.5 break-words';

  return (
    <>
    <div className="fixed inset-0 z-[65] bg-slate-900/50 flex items-end sm:items-center sm:justify-center"
         onClick={onClose}>
      <div
        className="bg-slate-50 w-full sm:max-w-[520px] rounded-t-3xl sm:rounded-3xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-50 px-4 pt-4 pb-3 flex items-start gap-3 border-b border-slate-200">
          <span className={`w-11 h-11 rounded-2xl grid place-items-center shrink-0 ${tone.bg}`}>
            <WorkIcon workKey={record.work_type || (task && task.workTypeKey)}
                      className={`w-7 h-7 ${tone.fg}`} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-black text-slate-800 leading-none">
              {record.plot_name || (task && task.plot)}
            </div>
            <div className={`text-[12px] font-black mt-1 ${tone.fg}`}>{workTypeLabel(wt, lang)}</div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="shrink-0 w-9 h-9 rounded-xl bg-slate-200 text-slate-600 text-[17px] font-black"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-4 space-y-3.5">
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <div className={label}>{t('wk.date')}</div>
              <div className={value}>{dayOf(record.work_date, lang)}</div>
            </div>
            <div>
              <div className={label}>{t('wk.nursery')}</div>
              <div className={value}>{record.nursery_name || (task && task.nursery) || '—'}</div>
            </div>
          </div>

          {(record.chemical || (task && task.chemical)) && (
            <div>
              <div className={label}>{t('wk.chemical')}</div>
              <div className={value}>{record.chemical || (task && task.chemical)}</div>
            </div>
          )}

          <div>
            <div className={label}>{t('wk.doneBy')}</div>
            <div className={value}>{record.worked_by || record.reported_by || '—'}</div>
          </div>

          {record.remark && (
            <div>
              <div className={label}>{t('wk.remark')}</div>
              <div className={value}>{record.remark}</div>
            </div>
          )}

          {/* The pictures taken while the job was done. Shown only when there
              are some: an empty "Photos" heading on every job that never had
              any reads as something missing rather than something absent.

              A comma-separated list of links, the same way the FC Portal's
              own board reads this column — the pictures live in the bucket,
              and the row holds nothing but where they are. */}
          {photoUrls.length > 0 && (
            <div>
              <div className={label}>{t('wk.donePhotos')}</div>
              <div className="mt-1.5 flex gap-2 flex-wrap">
                {photoUrls.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer"
                     className="w-[86px] h-[86px] rounded-2xl overflow-hidden border border-slate-200 bg-slate-100">
                    <img src={u} alt="" loading="lazy" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Whether the conductor has been past it yet. Read only — signing
              off is not a worker's to do.

              THREE answers, not two. Rejecting a record clears verified_at —
              deliberately, a record is in exactly one of three states — so a
              record that had been SENT BACK fell into the else branch and
              read "not checked yet": the most reassuring of the three things
              this box could say, and the only false one. A worker whose work
              had been refused was told it was still in the queue. */}
          <div className={`rounded-2xl px-4 py-3 border ${
            record.rejected_at ? 'bg-rose-50 border-rose-200'
            : record.verified_at ? 'bg-emerald-50 border-emerald-200'
                                 : 'bg-slate-100 border-slate-200'}`}>
            <div className={`text-[12px] font-black ${
              record.rejected_at ? 'text-rose-800' : 'text-slate-700'}`}>
              {record.rejected_at
                ? t('wk.sentBackBy', { name: record.rejected_by || '' })
                : record.verified_at
                  ? t('wk.verifiedBy', { name: record.verified_by || '' })
                  : t('wk.notVerifiedYet')}
            </div>
            {record.rejected_at && record.reject_reason && (
              <div className="text-[12.5px] font-bold text-rose-900 mt-1 leading-snug">
                {record.reject_reason}
              </div>
            )}
          </div>

          {/* The walk. */}
          <div>
            <div className={label}>{t('wk.gpsTrack')}</div>
            {!walked ? (
              <div className="text-[13px] font-bold text-slate-400 mt-1">{t('wk.noTrack')}</div>
            ) : (
              <div className="mt-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-[20px] font-black tabular-nums text-emerald-800">
                    {formatDistance(record.gps_distance_m)}
                  </span>
                  <span className="text-[13px] font-bold text-emerald-700/80 tabular-nums">
                    {formatDuration(seconds)}
                  </span>
                  <span className="text-[11px] font-bold text-emerald-700/60 tabular-nums">
                    {t('wk.trkPointsN', { n: record.gps_points })}
                  </span>
                </div>

                <button
                  onClick={() => setMap(true)}
                  disabled={track === undefined || !track}
                  className="mt-3 w-full bg-emerald-700 disabled:bg-slate-300 text-white font-black
                             text-[11px] uppercase tracking-widest rounded-xl px-4 py-3"
                >
                  {track === undefined ? t('common.loading')
                   : track ? `🗺️ ${t('wk.seeTrack')}`
                   : t('wk.trackUnavailable')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>

    {/* OUTSIDE the sheet, not inside it. The sheet's backdrop closes on a
        click, and the map was a child of it — so every tap on the map bubbled
        up, shut the sheet, and took the map down with it. Wrapped in a layer
        above the sheet's own, because TrackMap carries z-60 for the FC Portal
        and would otherwise be painted underneath. */}
    {map && track && (
      <div className="fixed inset-0 z-[75]">
        <Suspense fallback={
          <div className="fixed inset-0 bg-slate-900 grid place-items-center">
            <div className="text-emerald-400 font-mono text-xs uppercase tracking-[0.3em] animate-pulse">
              {t('common.loading')}
            </div>
          </div>
        }>
          {/* viewOnly: this is a walk that happened, not one being walked. */}
          <TrackMap viewOnly initial={track} onClose={() => setMap(false)} onDone={() => setMap(false)} />
        </Suspense>
      </div>
    )}
    </>
  );
}
