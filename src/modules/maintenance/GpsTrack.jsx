import { Suspense, lazy, useEffect, useState } from 'react';
import { useLang } from '../../context/LanguageContext.jsx';
import { formatDistance, formatDuration } from './track/track.js';
import Icon from '../../components/Icon.jsx';

/* The map brings Leaflet with it, and Leaflet is most of a megabyte. Loaded
   the moment somebody presses the button and not one moment before — a Field
   Conductor with GPS switched off never downloads a byte of it, and neither
   does one who is only keying a remark. */
const TrackMap = lazy(() => import('./track/TrackMap.jsx'));

/**
 * The GPS track on a record: what it says on the form, and the way to walk one.
 *
 * The form itself only ever shows the summary — how far, how many fixes, how
 * long. Walking the track is a full-screen job on a satellite map, because it
 * happens outdoors with the phone held out, and it has no business sharing a
 * screen with a batch list.
 */
export default function GpsTrack({ value, onChange }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  /* Pull the map down as soon as this field is on screen, rather than waiting
     for the button.

     The point is where the two happen. The form is opened at the truck, or in
     the office, or wherever there was enough signal to load the portal at all;
     the button is pressed standing in a plot, which is exactly where there may
     be none. Fetching a megabyte of Leaflet at that moment is the one thing
     that would leave somebody holding a phone that will not open a map.

     Failure is ignored on purpose — this is a head start, not a requirement,
     and the button's own Suspense still does the real load. */
  useEffect(() => { import('./track/TrackMap.jsx').catch(() => {}); }, []);

  const label = 'block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1';

  return (
    <div className="mb-3">
      <span className={label}>{t('mt.gpsTrack')}</span>

      {value && value.points ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-emerald-700" aria-hidden="true"><Icon name="map" className="w-4 h-4" /></span>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-black text-emerald-800 tabular-nums">
                {formatDistance(value.distance_m)}
              </div>
              <div className="text-[10.5px] font-bold text-emerald-700/70">
                {t('mt.trkPointsN', { n: value.points })}
                {' · '}
                {formatDuration(
                  value.started_at && value.ended_at
                    ? (Date.parse(value.ended_at) - Date.parse(value.started_at)) / 1000
                    : 0
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="shrink-0 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-700"
            >
              {t('mt.trkOpen')}
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500"
            >
              {t('mt.trkClear')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-3 py-3 text-[12px] font-black uppercase tracking-widest text-slate-600 hover:border-rose-400 hover:text-rose-700 transition-colors"
        >
          <span aria-hidden="true"><Icon name="map" className="w-4 h-4" /></span>
          {t('mt.trkRecord')}
        </button>
      )}

      {open && (
        <Suspense fallback={
          <div className="fixed inset-0 z-[60] bg-slate-900 grid place-items-center">
            <div className="text-emerald-400 font-mono text-xs uppercase tracking-[0.3em] animate-pulse">
              {t('common.loading')}
            </div>
          </div>
        }>
          <TrackMap
            initial={value}
            onClose={() => setOpen(false)}
            onDone={(payload) => { onChange(payload); setOpen(false); }}
          />
        </Suspense>
      )}
    </div>
  );
}
