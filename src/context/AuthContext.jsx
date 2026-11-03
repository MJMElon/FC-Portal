import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { applyCompanySwitches } from '../lib/portalSettings.js';
import { forgetOffline } from '../lib/offlineVault.js';

/**
 * The company's master switches for THIS portal — Worker Portal Manage →
 * System Setting → Portal View & Function.
 *
 * Fails open, and that matters more than it looks. This read sits in front of
 * every page in the portal, so a table that has not been created yet, a
 * policy that refuses, or a nursery connection that drops must all mean "no
 * vetoes" rather than "no access". A switchboard that locks the building when
 * it cannot be reached is worse than no switchboard.
 */
async function loadCompanySwitches() {
  try {
    const { data, error } = await supabase
      .from('shared_portal_settings')
      .select('modules, actions')
      .eq('portal', 'fc')
      .maybeSingle();
    if (error || !data) return null;
    return { modules: data.modules || {}, actions: data.actions || {} };
  } catch (e) {
    console.warn('[portal-switches] unreadable, so nothing is vetoed:', e);
    return null;
  }
}

const AuthContext = createContext(null);

/* The last permissions this device was told about, kept per user.

   Every page in the portal waits behind them — PageGate renders a loading
   screen while they are null — and they arrive over the network. With no
   signal that read never lands, so the whole portal sat on LOADING for ever
   and the Culling Calculator could not be opened standing in the plot it is
   for. A Field Conductor's access does not change between the office and the
   nursery; making him wait on a round trip to learn it does not protect
   anything.

   It is a screen gate, not the security. What a person may actually read and
   write is enforced by row-level security on every table, so a stale copy
   here can hide a page or offer one, and the database still decides. The read
   already fails OPEN on an error for the same reason — a cached answer is
   strictly better than that. */
const PERMS_KEY = 'mjm_fc_permissions_v1';

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(PERMS_KEY));
    return raw && raw.permissions ? raw : null;
  } catch (e) {
    return null;
  }
}

/* What an offline start (or a profile read that failed) may draw the portal
   from. Three refusals, each of which used to be a way in:
     · a different person's copy — the next person on this phone;
     · a copy that names no person at all — nothing says whose it is;
     · a copy that is not STAFF access. Before the customer rule existed this
       cache was written for EVERYBODY who signed in, a Sales Web customer
       included, so an old copy can hold a customer's permissions. Only a copy
       that would have passed the ops gate on its own is good enough to stand
       in for the gate. */
function cachedPermissions(userId) {
  const raw = readCache();
  if (!raw || !userId || raw.userId !== userId) return null;
  if (isCustomer(raw)) return null;
  if (!hasOpsAccess({ permissions: raw.permissions })) return null;
  return raw.permissions;
}

function keepPermissions(userId, permissions, userType) {
  try {
    localStorage.setItem(PERMS_KEY, JSON.stringify({ userId, permissions, userType: userType || null }));
  } catch (e) { /* a full or refused storage is not worth failing over */ }
}

function dropPermissions() {
  try { localStorage.removeItem(PERMS_KEY); } catch (e) { /* nothing to do */ }
}

/* "all staff system. customer only can see sales web and customer portal."
   A Sales Web customer signs in with an ordinary Supabase account, so the
   account itself is no answer — the PROFILE is. user_type is the one column
   that says so, and it is the same word the Sales Web writes. */
function isCustomer(profile) {
  return !!profile && String(profile.user_type || profile.userType || '').trim().toLowerCase() === 'customer';
}

// Staff-grade module access levels — same predicate as the hub / audit / mobile.
const STAFF_LEVELS = ['admin', 'normal', 'view', 'edit', 'manage', 'read', 'write', 'full', 'staff'];

function hasOpsAccess(profile) {
  if (!profile) return false;
  const p = profile.permissions || {};
  if (p.manage_users || p.can_verify_operation) return true;
  if (p.modules && typeof p.modules === 'object') {
    for (const k in p.modules) {
      if (p.modules[k] && STAFF_LEVELS.indexOf(String(p.modules[k]).toLowerCase()) !== -1) return true;
    }
  }
  return false;
}

/* The session Supabase already has in this browser, read synchronously so the
   app can render on the first paint. supabase.auth.getSession() returns the
   same thing but as a promise, and that one tick was long enough to show a
   loading screen in front of every entry. Anything doubtful — no token,
   unparseable — returns null and the normal async path decides.

   An EXPIRED token is trusted, deliberately, online and off. Signed in is
   meant to be a state you stay in — the login screen comes back for a
   pressed Sign Out or a server that actually revoked the account, never for
   a clock. Offline there is no refresh to have and a stale token goes
   nowhere without a network to carry it; online supabase-js refreshes it in
   the background and replaces what this painted, and if the refresh token is
   genuinely dead the SIGNED_OUT event that raises is still honoured below.
   RLS is what actually protects a table — this only decides what to draw. */
function cachedSession() {
  try {
    const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
    if (!key) return null;
    const raw = JSON.parse(localStorage.getItem(key));
    const s = (raw && (raw.currentSession || raw)) || null;
    if (!s || !s.access_token || !s.user) return null;
    return s;
  } catch (e) {
    return null;
  }
}

/* How long the app will wait for Supabase to say whether somebody is signed
   in before drawing itself anyway. Long enough that a slow phone on a nursery
   connection is not pushed to the sign-in screen while its answer is still in
   flight, short enough that a check which is never coming does not cost a
   Field Conductor his morning. */
export const AUTH_WAIT_MS = 8000;

export function AuthProvider({ children }) {
  const [session, setSessionState] = useState(cachedSession);
  /* Whose session the app is drawn for right now, read synchronously. A
     profile read is a round trip, and one started for somebody who has since
     signed out (or been signed out by it) must not land on the next person. */
  const sessionUser = useRef(((cachedSession() || {}).user || {}).id || null);
  function setSession(s) {
    sessionUser.current = (s && s.user && s.user.id) || null;
    setSessionState(s);
  }
  /* Why the door is shut, when it is shut for a reason the sign-in screen
     cannot say: 'customer' (a Sales Web account — signed out, and told where
     its shop is) or 'unchecked' (the profile could not be read and this phone
     has nothing of this person's to go on — the session is kept, and the
     check can be asked again). Survives the SIGNED_OUT a customer refusal
     causes, which is the whole point of it being separate from `allowed`. */
  const [refusal, setRefusal] = useState(null);
  // Already signed in ⇒ nothing to wait for before drawing the app.
  const [loading, setLoading] = useState(() => !cachedSession());
  // null = not yet checked, true / false = ops-gate result
  const [allowed, setAllowed] = useState(null);
  // The user's permissions JSONB from shared_profiles (set by the ops gate).
  // Modules read finer-grained flags from here, e.g. plot_status_nurseries.
  const [permissions, setPermissions] = useState(() => {
    const s0 = cachedSession();
    return s0 ? cachedPermissions(s0.user && s0.user.id) : null;
  });
  const [recovering, setRecovering] = useState(
    typeof window !== 'undefined' && window.location.hash.includes('type=recovery')
  );

  /* The ops-access gate.

     It used to fail OPEN on anything: `ok` started true and only a read that
     came back clean could make it false — so a read that RETURNED an error
     (supabase-js does not throw; it hands back { error }) let anybody in, a
     Sales Web customer included. A returned error is now exactly a thrown
     one, and either is answered from this phone's own copy of THIS person's
     staff access when it has one — a Field Conductor loses signal for hours
     and must still open the portal — and otherwise not answered at all: the
     session stays, the screen says the account could not be checked, and the
     check can be asked again. Not knowing is not a yes.

     Runs deferred (outside onAuthStateChange) to avoid the supabase-js
     auth-lock deadlock. */
  async function runOpsGate(sess) {
    const uid = sess && sess.user && sess.user.id;
    if (!uid) return;
    let resp = null;
    let company = null;
    let failed = false;
    try {
      /* Both at once. The company's switches are a second round trip that
         every page waits behind, and asking for them after the profile would
         put one on top of the other for no reason. */
      [resp, company] = await Promise.all([
        supabase
          .from('shared_profiles')
          .select('role, user_type, permissions')
          .eq('id', uid)
          .maybeSingle(),
        loadCompanySwitches(),
      ]);
      if (!resp || resp.error) {
        failed = true;
        console.warn('[ops-gate] profile read returned an error:', resp && resp.error);
      }
    } catch (e) {
      failed = true;
      console.warn('[ops-gate] profile read failed:', e);
    }

    // Somebody else's (or nobody's) by the time it answered — not ours to apply.
    if (sessionUser.current !== uid) return;

    if (failed) {
      const cached = cachedPermissions(uid);
      if (cached) {
        setPermissions(applyCompanySwitches(cached, company));
        setRefusal(null);
        setAllowed(true);
      } else {
        setPermissions(null);
        setAllowed(null);
        setRefusal('unchecked');
      }
      setLoading(false);
      return;
    }

    const profile = resp.data;
    if (isCustomer(profile)) {
      /* A customer account. Signed out here and now, with nothing of theirs
         left behind on this phone, and told where they CAN go. */
      setRefusal('customer');
      setAllowed(false);
      setLoading(false);
      try { forgetOffline(sess.user.email); } catch (e) { /* best effort */ }
      await signOut();
      return;
    }

    const ok = hasOpsAccess(profile);
    /* The person's own access, with the company's vetoes taken out of it.
       Applied HERE, at the one place permissions enter the app, rather
       than in each module: every screen then reads one answer and none of
       them has to remember there are two layers. Off beats on. */
    const own = (profile && profile.permissions) || {};
    setPermissions(applyCompanySwitches(own, company));
    /* Kept BEFORE the company's switches are applied: the switches are read
       fresh each time and are the company's to change, while this is the
       person's own access, which is what the next offline start needs to get
       past the gate. Only STAFF access is kept — a copy that would not pass
       the gate is not something the next offline start should be drawn from,
       and a person whose access was taken away loses the offline copy too. */
    if (ok) keepPermissions(uid, own, profile && profile.user_type);
    else dropPermissions();
    setRefusal(null);
    setAllowed(ok);
    setLoading(false);
  }

  /* The "try again" on the could-not-check screen. */
  function retryOpsGate() {
    if (!session) return;
    setRefusal(null);
    runOpsGate(session);
  }

  useEffect(() => {
    let answered = false;
    supabase.auth.getSession().then(
      ({ data: { session: sess } }) => {
        answered = true;
        /* supabase-js answers null here for two very different reasons: nobody
           has ever signed in on this device, or somebody has but the token had
           expired and the refresh it tried failed — no network, or a slow one.
           So any null falls back to the tolerant read cachedSession() above
           already does: if storage still has a token for SOMEBODY, that is who
           is standing here, expired clock or not. A refresh token the server
           actually REFUSED raises SIGNED_OUT below, and that still signs out. */
        const useSess = sess || cachedSession();
        // Knowing there IS a session is enough to stop waiting on THIS. The
        // ops gate is a network round-trip and resolves behind the app — but
        // the app is only drawn behind it for somebody this phone already
        // holds staff access for (see mayEnter). Anybody else waits for it.
        setSession(useSess);
        setLoading(false);
        if (useSess) runOpsGate(useSess);
      },
      (e) => {
        /* It failed rather than hung. Stop waiting, but do NOT throw away the
           session read out of storage — a failed check is not a sign-out. */
        answered = true;
        console.warn('[auth] the session check failed:', e);
        setLoading(false);
      }
    );

    /* And a promise can fail to settle at all. supabase-js takes a cross-tab
       lock before reading the token and goes to the network to refresh one
       that has expired, so a lock another tab never released, or a request
       that neither answers nor fails, leaves this pending for as long as the
       browser is open. Neither handler above ever runs, `loading` stays true,
       and the portal sits on its loading screen with no way past it — not
       even a reload, which begins the same wait again.

       So the waiting ends. Whatever has arrived by then is what the app is
       drawn from: with a session it opens, without one it shows the sign-in
       screen, and either is somewhere a person can act. A late answer is
       still honoured — the handler above and onAuthStateChange below both
       apply it whenever it comes. */
    const watchdog = setTimeout(() => {
      if (!answered) {
        console.warn('[auth] the session check did not answer in ' + AUTH_WAIT_MS +
                     'ms — drawing the app with what we have');
      }
      setLoading(false);
    }, AUTH_WAIT_MS);

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecovering(true);
        setSession(null);
        setLoading(false);
        return;
      }
      /* INITIAL_SESSION can report null for the same reason getSession()
         above can — an expired token whose refresh did not land, not a real
         sign-out. Only an actual SIGNED_OUT means somebody signed out (the
         button, or the server refusing the refresh token); anything else
         null falls back to the same tolerant read, so it does not undo what
         getSession() already recovered. */
      const useSess = sess || (event !== 'SIGNED_OUT' ? cachedSession() : null);
      setSession(useSess);
      setLoading(false);
      if (event === 'SIGNED_IN') setRefusal(null);
      if (event === 'SIGNED_OUT' || !useSess) {
        setAllowed(null);
        setPermissions(null);
        /* The cached permissions used to be removed here too. They stay now:
           an offline re-login (offlineVault.js) puts the same person back in
           with no way to re-fetch them, and without this cache every module
           page would sit on LOADING. Keeping it is safe — cachedPermissions()
           refuses to answer for a different userId, so the next person to
           sign in on this phone cannot inherit them, and it is a screen gate,
           not the security: RLS decides what actually reads and writes. */
        return;
      }
      // Defer to release the auth lock before querying shared_profiles.
      setTimeout(() => runOpsGate(useSess), 0);
    });

    return () => { clearTimeout(watchdog); sub.subscription.unsubscribe(); };
  }, []);

  async function signOut() {
    Object.keys(localStorage).forEach((k) => {
      /* The remembered permissions go with the token. They are what an
         offline start draws the portal from and they outlive a closed
         browser on purpose, so a pressed Sign Out is the one thing that has
         to take them — otherwise the next person to pick this phone up
         inherits the last one's pages. cachedPermissions already refuses to
         hand them to a DIFFERENT account, so this is the second lock rather
         than the only one; sign out should still mean sign out. */
      if (k.startsWith('sb-') || k === PERMS_KEY) localStorage.removeItem(k);
    });
    sessionStorage.clear();
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      /* ignore */
    }
    setSession(null);
    setAllowed(null);
    setPermissions(null);
  }

  /* May the portal be DRAWN for this person right now? Yes once the gate has
     said yes; and, while it has not answered yet, only for somebody this
     phone already holds staff access for (permissions are seeded from that
     copy at start-up). Everybody else waits on the loading screen — nothing
     behind the door is drawn for an account nobody has checked. */
  const mayEnter = !!session && !refusal &&
    (allowed === true || (allowed === null && permissions != null));

  const staffName = session
    ? session.user.user_metadata?.full_name || session.user.email
    : '';

  return (
    <AuthContext.Provider
      value={{ session, loading, allowed, permissions, refusal, mayEnter, retryOpsGate, setRefusal, recovering, setRecovering, signOut, staffName }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
