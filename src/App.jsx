import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { startAutoSync } from './lib/syncAll.js';

// Every 30 seconds, anything queued on this phone tries the server — the
// same rhythm the audit module keeps. Module-level on purpose: once per
// app load, whatever screen is open. See startAutoSync for what it does
// NOT do (no pulls on a timer).
startAutoSync();
import AuthScreen from './components/AuthScreen.jsx';
import Dashboard from './components/Dashboard.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import FloatingDock from './components/FloatingDock.jsx';
import { useLang } from './context/LanguageContext.jsx';
import { canScan } from './lib/access.js';

// Heavy modules (camera scanner, PDF generation, Supabase queries) are loaded
// on demand so the initial app shell stays small.
const ScanModule = lazy(() => import('./modules/scan/ScanModule.jsx'));
const DoModule = lazy(() => import('./modules/do/DoModule.jsx'));
const MaintenanceModule = lazy(() => import('./modules/maintenance/MaintenanceModule.jsx'));
const PalmsModule = lazy(() => import('./modules/palms/PalmsModule.jsx'));
const CullingModule = lazy(() => import('./modules/palms/CullingModule.jsx'));
// The 555 Worker Portal — the other front door on this domain. Lazy like the
// rest: a Field Conductor never loads a byte of it, and a worker never loads
// the scanner.
const WorkerPortal = lazy(() => import('./worker/WorkerPortal.jsx'));

function Loading() {
  const { t } = useLang();
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050a0e]">
      <div className="text-emerald-400 font-mono text-xs uppercase tracking-[0.3em] animate-pulse">
        {t('common.loading')}
      </div>
    </div>
  );
}

/* The door shut for a reason the sign-in screen cannot say.
   'customer' — a Sales Web account. Already signed out; this is all it sees.
   'unchecked' — the profile could not be read and this phone holds nothing of
   this person's to go on. The session is kept, so Try again is all it takes
   once there is a line. */
function Refused() {
  const { refusal, retryOpsGate, setRefusal } = useAuth();
  const { t } = useLang();
  const customer = refusal === 'customer';
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050a0e] px-4">
      <div className="max-w-sm w-full text-center space-y-4" data-refusal={refusal}>
        <p className="text-slate-100 text-sm leading-relaxed">
          {customer ? t('auth.customerRefused') : t('auth.uncheckedAccount')}
        </p>
        {customer ? (
          <button
            onClick={() => setRefusal(null)}
            className="text-xs text-slate-400 underline"
          >
            {t('auth.backToSignIn')}
          </button>
        ) : (
          <button
            onClick={retryOpsGate}
            className="px-4 py-2 rounded bg-emerald-600 text-white text-sm"
          >
            {t('auth.tryAgain')}
          </button>
        )}
      </div>
    </div>
  );
}

// Gate for the authenticated area. Bounces to the login screen if there is no
// session or the ops-access check said no, and draws NOTHING behind the door
// while the check is still out for somebody this phone holds no staff access
// for — a customer account must never see the dashboard, not even for the
// second it takes the profile read to come back.
function Protected({ children }) {
  const { session, loading, allowed, refusal, mayEnter } = useAuth();
  if (loading) return <Loading />;
  if (refusal || !session || allowed === false) return <Navigate to="/" replace />;
  if (!mayEnter) return <Loading />;
  return children;
}

// Gate for a single module. The dashboard already hides the card, but the URL
// is still typeable and bookmarks outlive permissions, so the route has to
// refuse too. Waits for permissions to arrive rather than bouncing someone out
// of a page they are allowed to open.
function PageGate({ page, children }) {
  const { permissions } = useAuth();
  if (permissions === null) return <Loading />;
  if (!canScan(permissions, page, 'view')) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { session, loading, allowed, refusal, mayEnter } = useAuth();

  return (
    <>
      <Routes>
      <Route
        path="/"
        element={
          loading ? (
            <Loading />
          ) : refusal ? (
            <Refused />
          ) : // `allowed` is null until the ops gate answers. Somebody this
          // phone already holds staff access for goes straight in; anybody
          // else signed in waits on the loading screen rather than being
          // shown the login (they ARE signed in) or the dashboard (nobody has
          // checked them yet). Only a definite NO puts them on the login.
          mayEnter ? (
            <Navigate to="/dashboard" replace />
          ) : session && allowed === null ? (
            <Loading />
          ) : (
            <AuthScreen />
          )
        }
      />
      <Route
        path="/dashboard"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/scan"
        element={
          <Protected>
            <PageGate page="barcode">
              <ErrorBoundary>
                <Suspense fallback={<Loading />}>
                  <ScanModule />
                </Suspense>
              </ErrorBoundary>
            </PageGate>
          </Protected>
        }
      />
      <Route
        path="/do"
        element={
          <Protected>
            <PageGate page="do">
              <ErrorBoundary>
                <Suspense fallback={<Loading />}>
                  <DoModule />
                </Suspense>
              </ErrorBoundary>
            </PageGate>
          </Protected>
        }
      />
      <Route
        path="/maintenance"
        element={
          <Protected>
            <PageGate page="maintenance">
              <ErrorBoundary>
                <Suspense fallback={<Loading />}>
                  <MaintenanceModule />
                </Suspense>
              </ErrorBoundary>
            </PageGate>
          </Protected>
        }
      />
      <Route
        path="/palms"
        element={
          <Protected>
            <PageGate page="palms">
              <ErrorBoundary>
                <Suspense fallback={<Loading />}>
                  <PalmsModule />
                </Suspense>
              </ErrorBoundary>
            </PageGate>
          </Protected>
        }
      />
      {/* ── The 555 Worker Portal ──
          Outside Protected on purpose. Everything above this line is gated on
          a Supabase session and the ops-access check; a worker has neither,
          and putting them through that gate would bounce every one of them
          to the FC login. The portal brings its own gate — see
          worker/WorkerPortal.jsx — which asks the question that applies to
          the person actually holding the phone. */}
      <Route
        path="/worker/*"
        element={
          <ErrorBoundary>
            <Suspense fallback={<Loading />}>
              <WorkerPortal />
            </Suspense>
          </ErrorBoundary>
        }
      />
      {/* The Culling Calculator is its own page and now its own tick, because
          counting pokok inang and keying the day's plot status are different
          jobs done by different people. canScan fails open on a page nobody
          has configured, so access saved before the split still works. */}
      <Route
        path="/culling"
        element={
          <Protected>
            <PageGate page="culling">
              <ErrorBoundary>
                <Suspense fallback={<Loading />}>
                  <CullingModule />
                </Suspense>
              </ErrorBoundary>
            </PageGate>
          </Protected>
        }
      />
      {/* Plot Status was retired — PALMS does the same job and more. Old
          bookmarks land on the dashboard rather than a blank screen. */}
      <Route path="/plot-status" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* The PALMS train. Outside the routes on purpose: keying the day in is
          the first job of the morning, and a control that only exists on the
          dashboard is one a Field Conductor can walk past all day. It hides
          itself inside PALMS and for anyone without the module. */}
      <FloatingDock />
    </>
  );
}
