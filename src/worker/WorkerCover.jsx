import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../context/LanguageContext.jsx';
import { BOOK_COVER_CSS, COVER_OCHRE } from '../components/bookCover.js';
import { compressImage } from '../lib/image.js';
import { useWorker } from './WorkerAuthContext.jsx';

/*
 * The 555 Worker Portal's front door — the same exercise-book cover as the FC
 * Portal, printed on ochre board. Same masthead, same fields, same button;
 * the stylesheet is literally the same file (components/bookCover.js), so
 * when one cover is redesigned this one is redesigned with it.
 *
 * One field on it, and one field only: the PIN. A Field Conductor signs in
 * with an e-mail address and a password because a Field Conductor has an
 * office account; a worker has a number the office wrote on their row of the
 * Payroll register, and asking them for anything more is asking them for
 * something they were never given.
 *
 * Under it, a way to put yourself ON that register: a name, a PIN of your own
 * choosing, and a photograph — and nothing else, because everything else is
 * the office's to decide. What that makes is a row waiting to be allocated,
 * which can see nothing at all until somebody files it — see
 * RUN_ME_worker_signup.sql in the office repository. The form is the same
 * lines of the same cover rather than a second screen: a worker who taps the
 * wrong one should be able to tap back without losing where they were.
 *
 * ── The photograph ──
 *
 * Optional, and offered because the person the office is about to file is a
 * name on a board otherwise. It lands on the same mjmnpayroll_workers.photo_url
 * the office's own Worker System writes, so a name arriving in "Waiting to be
 * allocated" arrives with a face on it and whoever files them can see who they
 * are filing.
 *
 * It goes up AFTER the registration has been accepted, using the session token
 * that comes back with it — which is what keeps the bucket shut to people who
 * have not registered. So the two can fail separately, and they are reported
 * separately: a photograph that will not upload must not undo a registration
 * that worked, and a worker who took one and is shown only "welcome" would
 * reasonably believe the office has their face.
 */
export default function WorkerCover() {
  const { t } = useLang();
  const { signIn, signUp, offline } = useWorker();
  const navigate = useNavigate();
  const [mode, setMode] = useState('in');     // 'in' | 'up'
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [photo, setPhoto] = useState(null);   // a data: URL, until it is sent
  const fileRef = useRef(null);

  const cleanPin = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

  function swap(next) {
    setMode(next);
    setErr(null);
    setPin('');
  }

  /* `capture="user"` on the input opens the FRONT camera, which is the one
     somebody photographs themselves with. A phone that does not honour it
     falls back to the picker, which is also fine — plenty of people already
     have a photograph of themselves. */
  async function photoChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      /* Square, small, and shrunk here rather than on the way out: this is a
         face at 22px on the office's board, so 512 is generous, and the
         nursery pays for every megabyte it stores. */
      setPhoto(await compressImage(file, { maxW: 512, maxBytes: 120 * 1024 }));
      setErr(null);
    } catch (_) {
      setErr(t('wk.photoFailed'));
    }
  }

  async function handleSignIn() {
    if (!pin.trim()) return setErr(t('wk.enterPin'));
    setBusy(true);
    setErr(null);
    try {
      await signIn(pin);
      // On success the portal re-renders around the signed-in worker.
    } catch (e) {
      setErr((e && e.message) || t('wk.signInFailed'));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  /* Checked here as well as in the database, and the database is the one that
     counts — this is only so somebody is told before the round trip rather
     than after it. The rules are the same ones worker_signup enforces. */
  async function handleSignUp() {
    if (name.trim().length < 3) return setErr(t('wk.enterName'));
    if (!/^[A-Z0-9]{4,12}$/.test(pin)) return setErr(t('wk.pinRule'));
    setBusy(true);
    setErr(null);
    try {
      /* The photograph goes with it, and the CONTEXT sends it — not this
         screen. Signing up sets the identity, which re-renders the portal
         around the new worker and takes this cover off the screen, so an
         upload started here would finish into a component nobody is looking
         at and an error would be shown to nothing at all. The context does
         both before it hands the portal over, and carries a warning to the
         screen the worker actually lands on if the photo did not make it. */
      await signUp(name.trim(), pin, photo);
    } catch (e) {
      setErr((e && e.message) || t('wk.signInFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bk-page" style={COVER_OCHRE}>

      <div className="bk-book">
        {/* the inside pages, showing past the cover */}
        <div className="bk-edges" aria-hidden="true"><i /><i /><i /></div>

        <div className="bk-cover">
          <div className="bk-smudge" aria-hidden="true" />

          {/* The cover reads top to bottom: who it belongs to, the book, the
              portal it opens. 555 is the hero — the rest is small print. */}
          <div className="bk-brand">MJM Nursery</div>
          <div className="bk-logo-wrap">
            <div className="bk-logo">555</div>
          </div>
          <div className="bk-portal">{t('wk.portal')}</div>

          <div className="bk-lines">
            {offline && <div className="bk-note bk-warn">{t('wk.offline')}</div>}
            {err && <div className="bk-note bk-err">{err}</div>}

            {/* Above the name, because it is the thing that says who this
                is, and because a round photograph at the top of a form is
                read as "you" without a label having to say so. Optional, and
                looks it: an empty circle with a person in it is plainly a
                thing you may fill in, not a field left blank. */}
            {mode === 'up' && (
              <div className="bk-face-row">
                <button
                  type="button"
                  className="bk-face"
                  onClick={() => fileRef.current && fileRef.current.click()}
                  aria-label={t(photo ? 'wk.retakePhoto' : 'wk.addYourPhoto')}
                >
                  {photo
                    ? <img src={photo} alt="" />
                    : <span aria-hidden="true">👤</span>}
                </button>
                <div className="bk-face-side">
                  <span
                    className="bk-link"
                    role="button"
                    tabIndex={0}
                    onClick={() => fileRef.current && fileRef.current.click()}
                    onKeyDown={(e) => e.key === 'Enter' && fileRef.current && fileRef.current.click()}
                  >
                    {t(photo ? 'wk.retakePhoto' : 'wk.addYourPhoto')}
                  </span>
                  <div className="bk-face-note">{t('wk.photoOptional')}</div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="bk-hidden-file"
                  onChange={photoChosen}
                />
              </div>
            )}

            {mode === 'up' && (
              <input
                type="text"
                autoCapitalize="words"
                autoCorrect="off"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSignUp()}
                placeholder={t('wk.yourName')}
                className="bk-field"
              />
            )}

            <input
              /* Not type="password": this is a door number, the worker is
                 standing in a field, and a PIN they cannot see is a PIN they
                 key wrong.

                 Not type="tel" either, though a number pad would suit a PIN
                 of digits. A PIN is letters and digits now (see the office
                 repo's shared/allow_npayroll_worker_pin_letters.sql), and a
                 number pad cannot type AB12 at all — the worker would be left
                 tapping at a keyboard with no way to key their own PIN.

                 Kept to the characters the column actually allows, and
                 uppercased as it is keyed: the register stores capitals, so
                 what a worker sees in the box is what is on their slip. */
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(cleanPin(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && (mode === 'in' ? handleSignIn() : handleSignUp())}
              placeholder={mode === 'in' ? t('wk.pin') : t('wk.choosePin')}
              className="bk-field"
              style={{ letterSpacing: '.18em' }}
            />

            <button
              onClick={mode === 'in' ? handleSignIn : handleSignUp}
              disabled={busy}
              className="bk-btn"
            >
              {busy
                ? t(mode === 'in' ? 'wk.signingIn' : 'wk.signingUp')
                : t(mode === 'in' ? 'wk.signIn' : 'wk.signUpGo')}
            </button>

            <div className="bk-links">
              {mode === 'in' ? (
                <span
                  className="bk-link"
                  role="button"
                  tabIndex={0}
                  onClick={() => swap('up')}
                  onKeyDown={(e) => e.key === 'Enter' && swap('up')}
                >
                  {t('wk.newHere')}
                </span>
              ) : (
                <span
                  className="bk-link"
                  role="button"
                  tabIndex={0}
                  onClick={() => swap('in')}
                  onKeyDown={(e) => e.key === 'Enter' && swap('in')}
                >
                  {t('wk.havePin')}
                </span>
              )}
            </div>
            <div className="bk-links">
              <button type="button" onClick={() => navigate('/')} className="bk-link" data-back-to-chooser>
                ← {t('pick.back')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{BOOK_COVER_CSS}</style>
    </div>
  );
}
