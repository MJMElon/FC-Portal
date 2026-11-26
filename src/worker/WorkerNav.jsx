import { Link } from 'react-router-dom';
import { useLang, LangToggle } from '../context/LanguageContext.jsx';
import { useWorker } from './WorkerAuthContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import SiramGoButton, { siramGoOn } from '../components/SiramGo.jsx';
import { MoonIcon, openMataMalam } from '../components/MataMalam.jsx';

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

// A cog. Settings is a place you visit rarely and leave again, so it rides in
// the bar rather than taking a card on a screen meant to be a to-do list.
function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  );
}

/*
 * The worker portal's ribbon — the FC Portal's TopNav, in every measurement.
 *
 * Not "like" it: the same two layouts, the same classes, the same paddings,
 * the same controls in the same order. `book` centres the stacked 555 mark on
 * the bar the way the FC dashboard's does; every other screen keeps the plain
 * row with the page name beside the back arrow it came in through. Changing
 * one bar and not the other is how two portals stop looking like one system,
 * so the two files are meant to be read side by side.
 *
 * It stays a separate component rather than TopNav with a flag for one
 * reason: TopNav signs out of Supabase, and there is no Supabase session here
 * to sign out of. Everything else it does, it does the same way.
 */
/* Mata Malam: the pill below hands this worker's token over. The button,
   the address and the hand-over are in components/MataMalam.jsx, shared with
   the FC Portal dock. */

export default function WorkerNav({ title, subtitle, back, book, onSettings, settingsOn }) {
  const { t } = useLang();
  const { worker, signOut, token, company } = useWorker();
  /* Mata Malam and Siram Go live in the M coin (FloatingDock.jsx). The coin is
     drawn over this portal only for a phone also signed in with a staff
     account, so the header keeps the two buttons ONLY where there is no coin:
     a worker signed in with the PIN alone, who would otherwise have no way to
     reach either. */
  const { mayEnter } = useAuth() || {};
  const inCoin = !!mayEnter;

  const sub = subtitle || t('wk.portal');

  const backCls = 'bg-slate-100 hover:bg-emerald-100 text-slate-500 hover:text-emerald-700';

  /* The 555 mark, stacked: the book on top and biggest, the screen's name
     under it, then the portal it opens. Every line leading-none with its own
     margin — three stacked lines of very different sizes are where default
     leading quietly adds air and pushes a sticky bar down the page. */
  const wordmark = (
    <div className="min-w-0 text-center">
      <div className="font-black italic text-[#065f46] text-[27px] sm:text-[34px] leading-none tracking-tight">
        555
      </div>
      <div className="font-black text-slate-800 text-[11px] sm:text-[13px] tracking-[0.14em] uppercase leading-none mt-1 whitespace-nowrap">
        {title}
      </div>
      <div className="font-black text-emerald-600 text-[9px] sm:text-[10px] uppercase tracking-[0.18em] sm:tracking-[0.25em] leading-none mt-1 whitespace-nowrap">
        {sub}
      </div>
    </div>
  );

  const leftControls = back ? (
    <Link
      to={back}
      title={t('common.back')}
      aria-label={t('common.back')}
      className={`grid place-items-center ${backCls} rounded-lg w-9 h-9 transition-colors no-underline shrink-0`}
    >
      <BackArrow />
    </Link>
  ) : null;

  const rightControls = (
    <>
      {/* Dropped on phones. It was competing with the title for a 360px bar. */}
      {worker && (
        <span className="hidden sm:inline text-[11px] font-bold text-slate-500 truncate">
          {t('dash.welcome', { name: worker.name })}
        </span>
      )}
      {onSettings && (
        <button
          onClick={onSettings}
          title={t('wk.settingsTitle')}
          aria-label={t('wk.settingsTitle')}
          className={`grid place-items-center rounded-full w-9 h-9 border transition-colors cursor-pointer shrink-0 ${
            settingsOn
              ? 'bg-emerald-600 border-emerald-600 text-white'
              : `${backCls} border-slate-200`
          }`}
        >
          <CogIcon />
        </button>
      )}
      {/* Icon only on phones, like Sign Out beside it. */}
      {worker && !inCoin && (
        <button
          onClick={() => openMataMalam(token)}
          title="Mata Malam"
          aria-label="Mata Malam"
          data-testid="open-mata-malam"
          className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-700 hover:text-white bg-indigo-50 hover:bg-indigo-600 border-indigo-200 uppercase tracking-wider sm:tracking-widest px-2.5 sm:px-3 py-2 rounded-full border cursor-pointer transition-colors shrink-0"
        >
          <MoonIcon />
          <span className="hidden sm:inline">Mata Malam</span>
        </button>
      )}
      {worker && !inCoin && siramGoOn(company) && <SiramGoButton />}
      <LangToggle />
      {/* Icon only on phones — the words cost ~55px the title needs more. */}
      <button
        onClick={signOut}
        title={t('common.signOut')}
        aria-label={t('common.signOut')}
        className="text-[10px] font-bold text-slate-500 hover:text-red-500 bg-slate-50 border-slate-200 uppercase tracking-wider sm:tracking-widest px-2.5 sm:px-3 py-2 rounded-full border cursor-pointer transition-colors shrink-0"
      >
        <span className="hidden sm:inline">{t('common.signOut')}</span>
        <span className="sm:hidden text-[13px] leading-none">⏻</span>
      </button>
    </>
  );

  /* Side columns `auto`, not `1fr` — the same fix, for the same reason, as
     TopNav's own book layout: equal flexible columns made the empty left side
     match the controls on the right, which on a 390px phone pushed Sign Out
     off the screen. Change one, change the other. */
  if (book) {
    return (
      <div className="bg-white border-slate-200 border-b px-3 sm:px-6 py-2.5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-2 sm:gap-3 justify-self-start">{leftControls}</div>
        <div className="justify-self-center min-w-0">{wordmark}</div>
        <div className="flex items-center gap-2 sm:gap-3 justify-self-end">{rightControls}</div>
      </div>
    );
  }

  return (
    <div className="bg-white border-slate-200 border-b px-3 sm:px-6 py-3 flex justify-between items-center gap-2 sticky top-0 z-30 shadow-sm">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {leftControls}
        <div className="leading-tight min-w-0">
          <div className="font-black text-slate-800 text-sm sm:text-lg truncate">
            {title || 'MJM Nursery'}
          </div>
          <div className="font-black text-emerald-600 text-[10px] uppercase tracking-[0.18em] sm:tracking-[0.25em] leading-none mt-0.5 whitespace-nowrap truncate">
            {sub}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">{rightControls}</div>
    </div>
  );
}
