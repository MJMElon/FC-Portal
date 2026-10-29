import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canBarcode, canDo, canMaintain } from '../lib/access.js';
import { useLang } from '../context/LanguageContext.jsx';
import TopNav from './TopNav.jsx';
import CollectionBoard from './CollectionBoard.jsx';
import MaintenanceBoard from './MaintenanceBoard.jsx';
import SyncButton from './SyncButton.jsx';
import Icon from './Icon.jsx';

/* One row of module tiles. A component of its own, declared at module scope
   rather than inside Dashboard — a component type recreated on every render
   would remount its children on every Dashboard re-render, which matters
   for components carrying their own state even though this one does not.

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
  // carries its own "See All" link through to /maintenance now. The Culling
  // Calculator's tile went the same way, into the floating dock's own fan —
  // see FloatingDock.jsx — so there is no second grid of tiles left here.

  return (
    <div className="min-h-screen bg-slate-100 fade-enter">
      <TopNav title="MJM Nursery" subtitle="FC Portal" user={staffName} book left={<SyncButton />} />
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
            week-by-week timeline, with its own "See All" through to the
            module. Only for someone who may open Maintenance — a summary
            is still the module's data. */}
        {canMaintain(permissions, 'view') && <MaintenanceBoard />}
      </div>
    </div>
  );
}
