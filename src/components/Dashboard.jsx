import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canBarcode, canCulling, canDo, canMaintain } from '../lib/access.js';
import { useLang } from '../context/LanguageContext.jsx';
import TopNav from './TopNav.jsx';
import CollectionBoard from './CollectionBoard.jsx';
import MaintenanceBoard from './MaintenanceBoard.jsx';
import { lastSync, syncAll } from '../lib/syncAll.js';
import Icon from './Icon.jsx';

/* "31 Aug, 11:42" — enough to trust the stamp, short enough for one line. */
function fmtWhen(at) {
  try {
    return new Date(at).toLocaleString(undefined, {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) {
    return new Date(at).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/* The Sync card, sitting under the Culling Calculator in the module grid.
   One press before walking into the field: queued work up, fresh data down,
   and the stamp only moves when EVERY step succeeded — see syncAll.js. */
let syncNoteTimer = null;

function SyncCard() {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(lastSync);
  const [note, setNote] = useState(null); // transient error / offline line

  async function press() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const r = await syncAll();
    setBusy(false);
    if (r.ok) {
      setStamp({ at: r.at, ok: true });
      return;
    }
    setNote(r.offline ? t('dash.syncOffline') : t('dash.syncFailed'));
    clearTimeout(syncNoteTimer);
    syncNoteTimer = setTimeout(() => setNote(null), 6000);
  }

  return (
    <button
      onClick={press}
      disabled={busy}
      className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] hover:shadow-[0_8px_32px_rgba(0,0,0,.12)] hover:-translate-y-0.5 hover:border-emerald-500 transition-all p-4 flex items-center gap-3.5 text-left cursor-pointer disabled:cursor-default"
    >
      <div className="w-12 h-12 bg-sky-100 rounded-xl flex items-center justify-center shrink-0 text-sky-600">
        <Icon name="refresh" className={`w-6 h-6 ${busy ? 'animate-spin' : ''}`} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-[15px] font-black text-slate-800 uppercase tracking-wide leading-tight">
          {t('dash.syncTitle')}
        </h3>
        <div className="mt-1.5">
          {note ? (
            <span className="text-[10px] font-black text-amber-600 uppercase tracking-wider leading-snug block">
              {note}
            </span>
          ) : busy ? (
            <span className="text-[10px] font-black text-sky-600 uppercase tracking-widest">
              {t('dash.syncing')}
            </span>
          ) : stamp ? (
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest inline-flex items-center gap-1">
              <Icon name="check" className="w-3 h-3" /> {t('dash.syncLast', { when: fmtWhen(stamp.at) })}
            </span>
          ) : (
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {t('dash.syncNever')}
            </span>
          )}
        </div>
      </div>
      <div className="text-slate-300 font-black text-lg shrink-0">›</div>
    </button>
  );
}

/* One row of module tiles. A component of its own, declared at module scope
   rather than inside Dashboard — a component type recreated on every render
   would remount its children on every Dashboard re-render, and SyncCard
   (passed in as `children` below) holds state of its own that must survive
   that. */
function ModuleGrid({ items, children }) {
  const { t } = useLang();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map((m) => (
        <Link
          key={m.to}
          to={m.to}
          className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] hover:shadow-[0_8px_32px_rgba(0,0,0,.12)] hover:-translate-y-0.5 hover:border-emerald-500 transition-all p-4 flex items-center gap-3.5 no-underline"
        >
          <div className={`w-12 h-12 ${m.tint} rounded-xl flex items-center justify-center shrink-0 ${m.fg}`}>
            <Icon name={m.icon} className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-black text-slate-800 uppercase tracking-wide leading-tight">
              {m.title}
            </h3>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">{t('common.active')}</span>
            </div>
          </div>
          <div className="text-slate-300 font-black text-lg shrink-0">›</div>
        </Link>
      ))}
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { staffName, permissions } = useAuth();
  const { t } = useLang();

  // Two groups rather than one grid of four: each sits next to the board it
  // answers to. Scan Barcode Counter and Issue Collection DO go straight
  // under Today's Collection — both are collection-day tools. Maintenance
  // and the Culling Calculator go under Maintenance Status, for the same
  // reason. Every tile is still hidden for anyone whose FC Portal User
  // Access has that module switched off; someone who has never been
  // through that screen still sees all of them.
  const collectionModules = [
    ...(canBarcode(permissions, 'view')
      ? [{ to: '/scan', icon: 'camera', fg: 'text-blue-600', tint: 'bg-blue-100', title: t('dash.scanTitle') }]
      : []),
    ...(canDo(permissions, 'view')
      ? [{ to: '/do', icon: 'clipboard', fg: 'text-emerald-600', tint: 'bg-emerald-100', title: t('dash.doTitle') }]
      : []),
  ];
  const maintModules = [
    ...(canMaintain(permissions, 'view')
      ? [{ to: '/maintenance', icon: 'tool', fg: 'text-teal-600', tint: 'bg-teal-100', title: t('dash.maintTitle') }]
      : []),
    // The Culling Calculator is a tab inside PALMS, but it is a job of its
    // own — a Field Conductor going out to count pokok inang should not have
    // to know it is filed under PALMS to find it. Its own tick and its own
    // nursery list too, for the same reason.
    ...(canCulling(permissions, 'view')
      ? [{ to: '/culling', icon: 'calculator', fg: 'text-rose-600', tint: 'bg-rose-100', title: t('cull.title') }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-100 fade-enter">
      <TopNav title="MJM Nursery" subtitle="FC Portal" user={staffName} book />
      <div className="max-w-[900px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {/* "TV" board: who is coming today to collect seedlings */}
        <CollectionBoard />

        {/* Scan Barcode Counter + Issue Collection DO — the two tools for a
            collection day, so they sit right under the board that shows who
            is coming to collect. */}
        {collectionModules.length > 0 && (
          <div className="mb-4">
            <ModuleGrid items={collectionModules} />
          </div>
        )}

        {/* The month's four maintenance jobs, rolled up out of the module's
            week-by-week timeline. Only for someone who may open Maintenance —
            a summary is still the module's data. */}
        {canMaintain(permissions, 'view') && <MaintenanceBoard />}

        {/* Maintenance + Culling Calculator — both read off plot work, so
            they sit under Maintenance Status. SyncCard rides along at the
            end, for everyone — syncing a phone is nobody's privilege to
            lack. */}
        <ModuleGrid items={maintModules}>
          <SyncCard />
        </ModuleGrid>
      </div>
    </div>
  );
}
