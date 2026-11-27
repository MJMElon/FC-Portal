import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import CoverLang from './CoverLang.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import { BOOK_COVER_CSS, COVER_BLUE } from './bookCover.js';
import { hasOffline, openOffline, sealOffline } from '../lib/offlineVault.js';
import { isOnline } from '../lib/outbox.js';

/* A login that never reached the server, as opposed to one the server
   refused. Supabase reports a dead network as status 0 or a fetch failure;
   a wrong password comes back as a real answer (400). Only the first kind
   is worth retrying against the phone's sealed copy. */
function neverReachedServer(error) {
  return !!error && (error.status === 0 || error.status === undefined ||
    /fetch|network|load failed/i.test(String(error.message || '')));
}

// Login / Sign-up / Forgot-password / Recovery screen, on the shared Supabase
// project — the same accounts as ai.mjmnursery.com.
//
// Dressed as the cover of the 555 exercise book everyone in the nursery
// already writes in: the red logotype across the top, a lot of blank cover,
// and "Name……………" ruled near the foot — which is where you sign in.
//
// The Auditor Portal wears the same cover in pink. Only the colour differs,
// exactly like the books themselves.
//
// Nothing on this screen but signing in, and the EN | BM toggle (CoverLang),
// which the office asked for on every front-door cover. Everything else the
// app does appears once you are through the door.
export default function AuthScreen({ onBack } = {}) {
  const { recovering, setRecovering, allowed } = useAuth();
  const { t } = useLang();
  const [mode, setMode] = useState('login'); // login | signup
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { kind: 'error'|'ok', text }

  const note = (kind, text) => setMsg({ kind, text });

  /* Sign in against the phone's sealed copy — the no-line path. The typed
     password either decrypts the session saved at the last ONLINE login, or
     nothing happens; see offlineVault.js. On success the saved session is
     put back where supabase-js keeps it and the app reboots onto it. */
  async function offlineUnlock() {
    if (!hasOffline(email)) {
      note('error', t('auth.offlineFirstNeedsLine'));
      return;
    }
    const saved = await openOffline(email, password);
    if (!saved || !saved.storageKey || !saved.session) {
      note('error', t('auth.offlineWrongPw'));
      return;
    }
    try { localStorage.setItem(saved.storageKey, JSON.stringify(saved.session)); } catch (e) { /* */ }
    window.location.reload();
  }

  /* After a successful ONLINE login, seal what supabase-js just wrote so the
     NEXT login can happen with no line. Best effort — a phone that cannot
     seal simply keeps needing signal to sign in, which is where it started. */
  async function sealAfterLogin(data) {
    try {
      const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
      const raw = key ? JSON.parse(localStorage.getItem(key)) : null;
      const session = raw || (data && data.session) || null;
      if (key && session) await sealOffline(email, password, { storageKey: key, session });
    } catch (e) { /* nothing to do */ }
  }

  async function handleMain() {
    if (!email || !password) return note('error', t('auth.enterEmailPw'));
    setBusy(true);
    setMsg(null);
    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (error) note('error', t('auth.signupErr', { msg: error.message }));
      else {
        note('ok', t('auth.accountCreated'));
        setMode('login');
      }
    } else if (!isOnline()) {
      await offlineUnlock();
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        /* navigator.onLine says true on plenty of dead connections, so a
           login that never reached the server also falls back to the sealed
           copy — a server that ANSWERED "wrong password" never does. */
        if (neverReachedServer(error) && hasOffline(email)) await offlineUnlock();
        else note('error', t('auth.loginErr', { msg: error.message }));
      } else {
        await sealAfterLogin(data);
        // On success the AuthContext listener flips the view.
      }
    }
    setBusy(false);
  }

  async function handleForgot() {
    if (!email) return note('error', t('auth.enterEmailFirst'));
    setBusy(true);
    // Pin the reset link to THIS app. Without an explicit redirectTo,
    // Supabase falls back to the project-wide Site URL (a different MJM app).
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/',
    });
    note(error ? 'error' : 'ok', error ? error.message : t('auth.resetSent'));
    setBusy(false);
  }

  async function handleUpdatePassword() {
    if (!newPassword || newPassword.length < 6) return note('error', t('auth.pwTooShort'));
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) note('error', error.message);
    else {
      note('ok', t('auth.pwUpdated'));
      setRecovering(false);
      window.location.hash = '';
    }
    setBusy(false);
  }

  return (
    <div className="bk-page" style={COVER_BLUE}>

      <div className="bk-book">
        {/* the inside pages, showing past the cover */}
        <div className="bk-edges" aria-hidden="true"><i /><i /><i /></div>

        <div className="bk-cover">
          <div className="bk-smudge" aria-hidden="true" />
          <CoverLang />

          {/* The cover reads top to bottom: who it belongs to, the book, the
              portal it opens. 555 is the hero — the rest is small print. */}
          <div className="bk-brand">MJM Nursery</div>
          <div className="bk-logo-wrap">
            <div className="bk-logo">555</div>
          </div>
          <div className="bk-portal">{t('auth.portal')}</div>

          <div className="bk-lines">
            {allowed === false && <div className="bk-note bk-warn">{t('auth.noAccess')}</div>}
            {msg && (
              <div className={`bk-note ${msg.kind === 'error' ? 'bk-err' : 'bk-ok'}`}>
                {msg.text}
              </div>
            )}

            {recovering ? (
              <>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('auth.newPasswordTitle')}
                  className="bk-field"
                />
                <button onClick={handleUpdatePassword} disabled={busy} className="bk-btn">
                  {busy ? t('auth.updating') : t('auth.savePassword')}
                </button>
              </>
            ) : (
              <>
                {mode === 'signup' && (
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('auth.fullName')}
                    className="bk-field"
                  />
                )}

                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoCapitalize="none"
                  autoComplete="email"
                  placeholder={t('auth.email')}
                  className="bk-field"
                />

                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleMain()}
                  autoComplete="current-password"
                  placeholder={t('auth.password')}
                  className="bk-field"
                />

                <button onClick={handleMain} disabled={busy} className="bk-btn">
                  {busy ? t('auth.processing') : mode === 'signup' ? t('auth.signup') : t('auth.login')}
                </button>

                <div className="bk-links">
                  {mode === 'login' && (
                    <button onClick={handleForgot} className="bk-link">
                      {t('auth.forgot')}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMode(mode === 'login' ? 'signup' : 'login');
                      setMsg(null);
                    }}
                    className="bk-link bk-link-right"
                  >
                    {mode === 'login' ? t('auth.createAccount') : t('auth.backToLogin')}
                  </button>
                </div>
              </>
            )}
            {onBack && (
              <div className="bk-links">
                <button type="button" onClick={onBack} className="bk-link" data-back-to-chooser>
                  ← {t('pick.back')}
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      <style>{BOOK_COVER_CSS}</style>
    </div>
  );
}
