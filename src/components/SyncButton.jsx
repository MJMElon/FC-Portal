import { useEffect, useRef, useState } from 'react';
import { useLang } from '../context/LanguageContext.jsx';
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

/* Sync, moved into the header bar itself, left of the 555 mark — the one
   press a Field Conductor wants before walking into the field with no
   signal, so it sits where it is reached from every screen rather than
   only the dashboard's own ribbon. A header bar has room for an icon and
   not a label, so the status this used to spell out in words — syncing,
   last synced when, offline — lives in the icon's colour and the title
   a long-press or hover reveals instead. The stamp only moves when EVERY
   step succeeded — see syncAll.js. */
let syncNoteTimer = null;

/* The big tick / cross: a press is a thing the conductor did on purpose,
   standing still for it, and the small icon-colour change in the header
   is easy to miss at arm's length. 2 seconds for a tick, 3 for a cross —
   a failure takes longer to read because it is the one that needs acting
   on. `pointer-events-none` so it never traps a tap on whatever is under
   it; it is a confirmation, not a dialog. */
function SyncFlash({ kind }) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center pointer-events-none">
      <div
        style={{ animation: 'popIn .2s ease' }}
        className={`w-24 h-24 rounded-full grid place-items-center shadow-2xl ${
          kind === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'
        }`}
      >
        <Icon name={kind === 'ok' ? 'check' : 'close'} className="w-12 h-12 text-white" />
      </div>
    </div>
  );
}

export default function SyncButton({ dark }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(lastSync);
  const [note, setNote] = useState(null); // transient error / offline line
  const [flash, setFlash] = useState(null); // 'ok' | 'fail' — the big tick/cross
  const flashTimer = useRef(null);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  function showFlash(kind, ms) {
    clearTimeout(flashTimer.current);
    setFlash(kind);
    flashTimer.current = setTimeout(() => setFlash(null), ms);
  }

  async function press() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    // Guarded end to end: an unexpected throw here used to leave the
    // button stuck mid-spin forever — the same trap as an unguarded save
    // handler anywhere else in this system — and would have read exactly
    // like "sync does nothing" no matter how many times it was pressed.
    try {
      const r = await syncAll();
      if (r.ok) {
        setStamp({ at: r.at, ok: true });
        showFlash('ok', 2000);
        return;
      }
      const failed = (r.steps || []).filter((s) => !s.ok);
      if (failed.length) {
        // The note only ever said "some data" — this is the one place
        // that now names which step actually refused, for the report
        // that follows a "tried many times, still can't sync".
        console.error('[sync] failed:', failed.map((s) => `${s.name} — ${s.error}`).join(' | '));
      }
      setNote(
        r.offline
          ? t('dash.syncOffline')
          : failed.length
          ? t('dash.syncFailedStep', { step: failed[0].name })
          : t('dash.syncFailed')
      );
      clearTimeout(syncNoteTimer);
      syncNoteTimer = setTimeout(() => setNote(null), 6000);
      showFlash('fail', 3000);
    } catch (e) {
      console.error('[sync] threw:', e);
      setNote(t('dash.syncFailed'));
      clearTimeout(syncNoteTimer);
      syncNoteTimer = setTimeout(() => setNote(null), 6000);
      showFlash('fail', 3000);
    } finally {
      setBusy(false);
    }
  }

  const label = note
    ? note
    : busy
    ? t('dash.syncing')
    : stamp
    ? t('dash.syncLast', { when: fmtWhen(stamp.at) })
    : t('dash.syncNever');
  const title = `${t('dash.syncTitle')} — ${label}`;

  const tone = note
    ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
    : stamp
    ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
    : dark
    ? 'bg-[#111821] border border-[#1f2a38] text-slate-300 hover:text-sky-400'
    : 'bg-sky-100 text-sky-600 hover:bg-sky-200';

  return (
    <>
      <button
        onClick={press}
        disabled={busy}
        title={title}
        aria-label={title}
        className={`grid place-items-center rounded-lg w-9 h-9 transition-colors cursor-pointer disabled:cursor-default shrink-0 ${tone}`}
      >
        <Icon name="refresh" className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
      </button>
      {flash && <SyncFlash kind={flash} />}
    </>
  );
}
