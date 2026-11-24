import { moduleVetoed } from '../lib/portalSettings.js';

/* Siram Go is the watering log, a page of its own on another address. It
   carries no login of ours, so the button hands nothing over: it only opens
   the form, in a new tab, so the portal is still here to come back to.

   WHICH PORTAL SHOWS IT is the office's: System Setting → Portal View &
   Function has a Siram Go row with a switch per portal, stored as
   modules.siram_go in shared_portal_settings (the FC Portal column for the
   FC Portal, the Worker Portal column for the Worker Portal). Only an
   explicit OFF hides it, the rule every switch on that screen follows, so a
   database nobody has saved the row on shows the button. The key is spelled
   in PORTAL_MODULES in mjm-ai-system/scan/scan_system_setting.html too.
   Change one, change the other.

   WHERE IT IS DRAWN differs by portal, at the office own ask: in the FC
   Portal it is one of the fanned actions of the floating dock
   (FloatingDock.jsx), and in the Worker Portal, which has no dock, it is
   the pill in the header (WorkerNav.jsx). */
export const SIRAM_GO_URL = 'https://mjmelon.github.io/watering-log/form.html';
export const SIRAM_GO_KEY = 'siram_go';

export const siramGoOn = (company) => !moduleVetoed(company, SIRAM_GO_KEY);

/* A new tab, never this one: the portal is still here to come back to. */
export function openSiramGo() {
  window.open(SIRAM_GO_URL, '_blank', 'noopener');
}

// A drop: Siram Go is the watering log.
export function DropIcon({ size = 15 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.7C9 6.6 6 10 6 14a6 6 0 0 0 12 0c0-4-3-7.4-6-11.3z" />
    </svg>
  );
}

/* Icon only on phones, like Mata Malam and Sign Out beside it. */
export default function SiramGoButton({ dark }) {
  const cls = dark
    ? 'text-sky-300 hover:text-white bg-[#111821] hover:bg-sky-600 border-[#1f2a38]'
    : 'text-sky-700 hover:text-white bg-sky-50 hover:bg-sky-600 border-sky-200';
  return (
    <a
      href={SIRAM_GO_URL}
      target="_blank"
      rel="noopener"
      title="Siram Go"
      aria-label="Siram Go"
      data-testid="open-siram-go"
      className={`flex items-center gap-1.5 text-[10px] font-bold ${cls} uppercase tracking-wider sm:tracking-widest px-2.5 sm:px-3 py-2 rounded-full border cursor-pointer transition-colors shrink-0 no-underline`}
    >
      <DropIcon />
      <span className="hidden sm:inline">Siram Go</span>
    </a>
  );
}
