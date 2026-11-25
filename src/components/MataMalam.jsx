import { savedToken } from '../worker/workerApi.js';

/* Mata Malam (the night check-in app) lives on its own address and enters with
   the same PIN session as the Worker Portal — its database functions start
   from the same worker_from_token. So a button hands the token over and the
   guard is not asked for a PIN twice. It rides in the FRAGMENT, which a
   browser never sends to a server, and Mata Malam takes it out of the address
   as it reads it. A new tab, so nothing on this screen is left behind.

   TWO DOORS, ONE RULE: the pill in the Worker Portal header (WorkerNav.jsx)
   and a fanned action of the FC Portal dock (FloatingDock.jsx). The dock has
   no worker of its own — the FC Portal signs in with an e-mail — so it hands
   over the worker token THIS PHONE holds, if any. With none, Mata Malam opens
   on its own notice saying to come in from the Worker Portal, which is the
   one sign-in it has. */
export const MATA_MALAM_URL = 'https://mjmelon.github.io/MataMalam/';

export function openMataMalam(token = savedToken()) {
  const url = token ? `${MATA_MALAM_URL}#wt=${encodeURIComponent(token)}` : MATA_MALAM_URL;
  window.open(url, '_blank', 'noopener');
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
