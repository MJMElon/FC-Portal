import { savedToken } from '../worker/workerApi.js';
import { supabase } from '../lib/supabase.js';

/* Mata Malam (the night check-in app) lives on its own address and enters with
   the same PIN session as the Worker Portal — its database functions start
   from the same worker_from_token. So a button hands the token over and the
   guard is not asked for a PIN twice. It rides in the FRAGMENT, which a
   browser never sends to a server, and Mata Malam takes it out of the address
   as it reads it. A new tab, so nothing on this screen is left behind.

   TWO DOORS, ONE RULE: the pill in the Worker Portal header (WorkerNav.jsx)
   and a fanned action of the FC Portal dock (FloatingDock.jsx). The dock has
   no worker of its own — the FC Portal signs in with an e-mail — so it hands
   over a staff session instead (below). */
export const MATA_MALAM_URL = 'https://mjmelon.github.io/MataMalam/';

/* THE FC PORTAL OPENS IT AS THE STAFF ACCOUNT. A staff login has no worker
   row and no PIN, so the database hands this account a Mata Malam session of
   its own (mata_malam_staff_session, shared/RUN_ME_mata_malam_staff.sql in
   the office repository) and Mata Malam reads the FC Portal column of System
   Setting for it. A worker token is still what a PIN sign-in hands over.

   The tab is opened FIRST and pointed at the address once the answer is in,
   because a tab opened after a wait is a tab the phone blocks as a popup.
   With no answer (no line, an older database) it opens on its own notice. */
function onWorkerPortal() {
  return /^#\/worker/.test(window.location.hash || '') || /\/worker/.test(window.location.pathname || '');
}

function openTab(url) {
  window.open(url, '_blank', 'noopener');
}

export function openMataMalam(token, { staff = false } = {}) {
  if (token) { openTab(`${MATA_MALAM_URL}#wt=${encodeURIComponent(token)}`); return; }
  // The Worker Portal pill, or a staff coin drawn over the Worker Portal on a
  // phone holding a PIN sign-in too: the worker on this phone goes in.
  const kept = savedToken();
  if (kept && (!staff || onWorkerPortal())) {
    openTab(`${MATA_MALAM_URL}#wt=${encodeURIComponent(kept)}`);
    return;
  }
  if (!staff) { openTab(MATA_MALAM_URL); return; }
  const win = window.open('', '_blank');
  const go = (url) => {
    if (!win || win.closed) { openTab(url); return; }
    try { win.opener = null; } catch { /* nothing to cut */ }
    win.location.href = url;
  };
  supabase.rpc('mata_malam_staff_session')
    .then(({ data, error }) => {
      const tok = !error && typeof data === 'string' ? data : null;
      go(tok ? `${MATA_MALAM_URL}#wt=${encodeURIComponent(tok)}` : MATA_MALAM_URL);
    })
    .catch(() => go(MATA_MALAM_URL));
}

// A moon: Mata Malam is the night check-in app.
export function MoonIcon({ size = 15 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
