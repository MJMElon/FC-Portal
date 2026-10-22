import { useState } from 'react';
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

export default function SyncButton({ dark }) {
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
    <button
      onClick={press}
      disabled={busy}
      title={title}
      aria-label={title}
      className={`grid place-items-center rounded-lg w-9 h-9 transition-colors cursor-pointer disabled:cursor-default shrink-0 ${tone}`}
    >
      <Icon name="refresh" className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
    </button>
  );
}
