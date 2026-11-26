import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useLang } from '../context/LanguageContext.jsx';
import { WorkerAuthProvider, useWorker } from './WorkerAuthContext.jsx';
import WorkerCover from './WorkerCover.jsx';
import WorkerHome from './WorkerHome.jsx';
import WorkerSettings from './WorkerSettings.jsx';
import FloatingDock from '../components/FloatingDock.jsx';
import { useAuth } from '../context/AuthContext.jsx';

/* The M coin for a worker signed in with the PIN alone. A phone that also
   holds a staff account already has the app-wide coin (App.jsx), reading the
   Worker Portal column, so this one is drawn only where that one is not.
   It offers only what such a worker can reach: Mata Malam and Siram Go, as
   ticked in the Worker Portal column of Portal View & Function. */
function PinWorkerDock() {
  const { mayEnter } = useAuth() || {};
  const { company, token } = useWorker();
  if (mayEnter) return null;
  return <FloatingDock pinWorker={{ company, token }} />;
}

/*
 * The 555 Worker Portal — the second front door on scan.mjmnursery.com.
 *
 * One app, one build, one domain, two portals:
 *
 *     scan.mjmnursery.com/#/           the FC Portal, blue cover, e-mail login
 *     scan.mjmnursery.com/#/worker     the Worker Portal, green cover, PIN
 *
 * They share the code that is genuinely the same — the cover, the work types,
 * the language switch, the table jobs are written to — and share nothing that
 * only looks the same. In particular they do not share a way in: the FC gate
 * asks Supabase who you are, this one asks the database whose PIN that was.
 *
 * The whole subtree is wrapped in its own provider, so a worker's session and
 * a Field Conductor's can sit on one phone without either noticing the other.
 */

function Loading() {
  const { t } = useLang();
  return (
    <div className="min-h-screen grid place-items-center bg-[#14100e]">
      <div className="text-emerald-400 font-mono text-xs uppercase tracking-[0.3em] animate-pulse">
        {t('common.loading')}
      </div>
    </div>
  );
}

/* Signed in or not. Nothing inside the portal renders until that is known —
   showing the cover to somebody already signed in, and then snatching it
   away, is worse than a moment's wait. */
function Gate({ children }) {
  const { identity, loading } = useWorker();
  if (loading) return <Loading />;
  if (!identity) return <WorkerCover />;
  return children;
}

/* A module the worker's access does not include is not reachable by typing
   its address either. The home screen hides the card; this refuses the room.

   Only Settings is behind it now. Maintenance has no room of its own any
   more — it IS the portal, drawn by WorkerHome, so a worker without it is
   shown the "nothing open" line rather than sent to a URL that no longer
   exists. */
function ModuleGate({ name, children }) {
  const { modules } = useWorker();
  if (!modules[name]) return <Navigate to="/worker" replace />;
  return children;
}

export default function WorkerPortal() {
  /* The tab, and the name a phone puts under the icon when this is added to a
     home screen. app.html carries the FC Portal's title because that is what
     `/` is; a worker who lands here is not in that portal and should not be
     told they are. Put back on the way out, so a Field Conductor who opens
     both on one phone does not find the wrong name on their own tab. */
  useEffect(() => {
    const was = document.title;
    document.title = 'MJM Nursery — Worker Portal';
    return () => { document.title = was; };
  }, []);

  return (
    <WorkerAuthProvider>
      <Gate>
        <Routes>
          <Route index element={<WorkerHome />} />
          <Route
            path="settings"
            element={
              <ModuleGate name="settings">
                <WorkerSettings />
              </ModuleGate>
            }
          />
          <Route path="*" element={<Navigate to="/worker" replace />} />
        </Routes>
        <PinWorkerDock />
      </Gate>
    </WorkerAuthProvider>
  );
}
