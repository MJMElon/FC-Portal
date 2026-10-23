import { Suspense, lazy } from 'react';
import { useLang } from '../context/LanguageContext.jsx';

const MaintenanceModule = lazy(() => import('../modules/maintenance/MaintenanceModule.jsx'));

/**
 * One of Maintenance Status's own dials, popped straight into the record
 * form for that job — no trip through the full module page first.
 *
 * MaintenanceModule already does this when a dial is tapped FROM INSIDE the
 * module (WeekBoard's onOpen sets its own `sheet` state), so this does not
 * reinvent that: it is the real MaintenanceModule, mounted with
 * initialSheet already set and its own TopNav suppressed, fixed over
 * whatever screen was showing. WorkSheet is already a full-screen sheet of
 * its own, so from the first paint this reads as the form popping open,
 * not a page loading behind it.
 *
 * onQuickClose closes this whole overlay the moment that sheet is
 * dismissed — a dial on the dashboard only ever asked for the one form,
 * never a landing on the module behind it.
 */
export default function MaintenanceQuickEntry({ week, workTypeKey, onClose }) {
  const { t } = useLang();
  return (
    <div className="fixed inset-0 z-[55] overflow-y-auto bg-slate-100">
      <Suspense
        fallback={
          <div className="py-16 text-center text-[11px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">
            {t('common.loading')}
          </div>
        }
      >
        <MaintenanceModule
          nav={<></>}
          initialSheet={{ week, workTypeKey }}
          onQuickClose={onClose}
        />
      </Suspense>
    </div>
  );
}
