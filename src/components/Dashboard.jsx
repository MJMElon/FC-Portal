import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canBarcode, canCulling, canDo, canMaintain } from '../lib/access.js';
import { useLang } from '../context/LanguageContext.jsx';
import TopNav from './TopNav.jsx';
import CollectionBoard from './CollectionBoard.jsx';
import MaintenanceBoard from './MaintenanceBoard.jsx';
import VerificationBoard from './VerificationBoard.jsx';
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

/* The Sync bar, first thing on the page, above even Today's Collection —
   this is the one press a Field Conductor wants before walking into
   the field with no signal, so it comes before anything else asks to
   be read. A thin full-width ribbon rather than a square tile: it is
   one action, not a module, and does not need a tile's worth of room
   to say so. The stamp only moves when EVERY step succeeded — see
   syncAll.js. */
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
      className="w-full bg-white rounded-xl border border-slate-200 shadow-[0_2px_10px_rgba(0,0,0,.05)] hover:shadow-[0_6px_20px_rgba(0,0,0,.1)] hover:border-emerald-500 transition-all px-3 py-1.5 flex items-center gap-2.5 text-left cursor-pointer disabled:cursor-default"
    >
      <div className="w-6 h-6 bg-sky-100 rounded-md flex items-center justify-center shrink-0 text-sky-600">
        <Icon name="refresh" className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2.5">
        <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-wide leading-tight shrink-0">
          {t('dash.syncTitle')}
        </h3>
        <div className="min-w-0 truncate">
          {note ? (
            <span className="text-[10px] font-black text-amber-600 uppercase tracking-wider">
              {note}
            </span>
          ) : busy ? (
            <span className="text-[10px] font-black text-sky-600 uppercase tracking-widest">
              {t('dash.syncing')}
            </span>
          ) : stamp ? (
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest inline-flex items-center gap-1">
              <Icon name="check" className="w-3 h-3 shrink-0" /> {t('dash.syncLast', { when: fmtWhen(stamp.at) })}
            </span>
          ) : (
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {t('dash.syncNever')}
            </span>
          )}
        </div>
      </div>
      <div className="text-slate-300 font-black text-base shrink-0">›</div>
    </button>
  );
}

/* One row of module tiles. A component of its own, declared at module scope
   rather than inside Dashboard — a component type recreated on every render
   would remount its children on every Dashboard re-render, which would cost
   SyncCard its state back when it lived in here. It has its own ribbon now,
   so this grid is only ever the module tiles.

   Always two columns, even on a phone — the row stays the same total width
   it always had, split in half rather than widened, so each tile is shorter
   and smaller to fit it: a shrunk icon, a shrunk badge, and a title that
   wraps to two lines instead of forcing the tile wide. A single tile (the
   Culling Calculator on its own) simply sits in the first slot. */
function ModuleGrid({ items }) {
  const { t } = useLang();
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {items.map((m) => (
        <Link
          key={m.to}
          to={m.to}
          className="bg-white rounded-2xl border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,.06)] hover:shadow-[0_8px_32px_rgba(0,0,0,.12)] hover:-translate-y-0.5 hover:border-emerald-500 transition-all p-2.5 flex items-center gap-2 no-underline min-w-0"
        >
          <div className={`w-9 h-9 ${m.tint} rounded-lg flex items-center justify-center shrink-0 ${m.fg}`}>
            <Icon name={m.icon} className="w-[18px] h-[18px]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[11.5px] font-black text-slate-800 uppercase tracking-wide leading-[1.15] line-clamp-2">
              {m.title}
            </h3>
            <div className="flex items-center gap-1 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-[8.5px] font-black text-emerald-600 uppercase tracking-widest">{t('common.active')}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { staffName, permissions } = useAuth();
  const { t } = useLang();

  // Two groups rather than one grid of four: each sits next to the board it
  // answers to. Scan Barcode Counter and Issue Collection DO go straight
  // under Today's Collection — both are collection-day tools. Every tile is
  // still hidden for anyone whose FC Portal User Access has that module
  // switched off; someone who has never been through that screen still
  // sees all of them.
  const collectionModules = [
    ...(canBarcode(permissions, 'view')
      ? [{ to: '/scan', icon: 'camera', fg: 'text-blue-600', tint: 'bg-blue-100', title: t('dash.scanTitle') }]
      : []),
    ...(canDo(permissions, 'view')
      ? [{ to: '/do', icon: 'clipboard', fg: 'text-emerald-600', tint: 'bg-emerald-100', title: t('dash.doTitle') }]
      : []),
  ];
  // Maintenance no longer has a tile of its own here — Maintenance Status
  // already answers "how much is done" and opening the module from a
  // second button beside it was two tiles for one question. MaintenanceBoard
  // carries its own "See All" link through to /maintenance now.
  const maintModules = [
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
        {/* Sync, first thing on the page — see SyncCard's own comment for why. */}
        <div className="mb-4">
          <SyncCard />
        </div>

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
            week-by-week timeline, with its own "See All" through to the
            module. Only for someone who may open Maintenance — a summary
            is still the module's data. */}
        {canMaintain(permissions, 'view') && <MaintenanceBoard />}

        {/* The Culling Calculator — reads off plot work like Maintenance
            Status above it, but is its own job and keeps its own tile. */}
        {maintModules.length > 0 && (
          <div className="mb-4">
            <ModuleGrid items={maintModules} />
          </div>
        )}

        {/* What was done and never signed for: a delivery order whose loading
            gang was never ticked, and a transplanted plot whose jobs were
            never recorded. Last on the page now rather than between the
            collections and the plan — the office asked for it moved; see
            CLAUDE.md. It hides itself when there is nothing outstanding, so
            its own gate is inside it rather than here. */}
        <VerificationBoard />
      </div>
    </div>
  );
}
