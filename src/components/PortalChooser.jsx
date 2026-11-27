import { useNavigate } from 'react-router-dom';
import { useLang } from '../context/LanguageContext.jsx';
import { BOOK_COVER_CSS, COVER_BLUE, COVER_OCHRE } from './bookCover.js';

/*
 * The front door both portals share. scan.mjmnursery.com is ONE address for
 * the FC Portal and the Worker Portal, so the first thing it asks is which
 * of the two somebody is: a Field Conductor goes on to the blue e-mail and
 * password cover (AuthScreen), a worker to the ochre PIN cover (/#/worker).
 *
 * It asks nothing else and decides nothing: it is shown only to somebody
 * NOT signed in, and once either login has gone through the app is exactly
 * what it was. Two cases skip it in App.jsx, because both are already an
 * answer: a password-reset link (that is an FC account), and an account
 * that signed in and was refused (the refusal is on the FC cover).
 *
 * Each choice is a strip of that portal's own book colour, so the colour
 * somebody picks here is the colour of the cover they then land on.
 */
export default function PortalChooser({ onFC }) {
  const { t } = useLang();
  const navigate = useNavigate();

  const choice = (cover, label, sub, onClick, id) => (
    <button
      type="button"
      data-pick={id}
      onClick={onClick}
      className="pk-choice"
      style={{ background: cover['--bk-cover'], borderColor: cover['--bk-cover-3'] }}
    >
      <span className="pk-label">{label}</span>
      <span className="pk-sub">{sub}</span>
    </button>
  );

  return (
    <div className="bk-page" style={{ '--bk-cover': '#ece4cf', '--bk-cover-2': '#e2d8bf', '--bk-cover-3': '#d5c9ad' }}>
      <div className="bk-book">
        <div className="bk-edges" aria-hidden="true"><i /><i /><i /></div>
        <div className="bk-cover">
          <div className="bk-smudge" aria-hidden="true" />
          <div className="bk-brand">MJM Nursery</div>
          <div className="bk-logo-wrap">
            <div className="bk-logo">555</div>
          </div>
          <div className="bk-portal">{t('pick.title')}</div>

          <div className="bk-lines">
            {choice(COVER_BLUE, t('pick.fc'), t('pick.fcSub'), onFC, 'fc')}
            {choice(COVER_OCHRE, t('pick.worker'), t('pick.workerSub'), () => navigate('/worker'), 'worker')}
          </div>
        </div>
      </div>

      <style>{BOOK_COVER_CSS + `
        .pk-choice{
          display:flex;flex-direction:column;align-items:flex-start;gap:3px;
          width:100%;margin-top:14px;padding:14px 16px;text-align:left;
          border:2px solid;border-radius:10px 7px 12px 6px / 7px 12px 6px 10px;
          box-shadow:3px 3px 0 rgba(35,48,63,.28);color:var(--bk-ink);cursor:pointer;
          transition:transform .12s,box-shadow .12s;
        }
        .pk-choice:active{transform:translate(3px,3px);box-shadow:0 0 0}
        .pk-label{font-size:16px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
        .pk-sub{font-size:12px;font-weight:600;color:var(--bk-quiet)}
      `}</style>
    </div>
  );
}
