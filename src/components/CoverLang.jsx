import { useLang } from '../context/LanguageContext.jsx';

/* EN | BM on every front-door cover (the portal chooser, the FC login and
   the Worker PIN login). Before sign-in there is no TopNav to carry the
   toggle, and a worker who reads Malay should not have to get through an
   English login to find it. The choice is the same one TopNav sets
   (localStorage mjm.lang), so it carries on past the login. Styled in
   bookCover.js (.bk-lang). */
export default function CoverLang() {
  const { lang, setLang } = useLang();
  const pick = (l, label) => (
    <button
      type="button"
      data-lang={l}
      aria-pressed={lang === l}
      className={'bk-lang-btn' + (lang === l ? ' on' : '')}
      onClick={() => setLang(l)}
    >
      {label}
    </button>
  );
  return (
    <div className="bk-lang" role="group" aria-label="Language / Bahasa">
      {pick('en', 'EN')}
      {pick('ms', 'BM')}
    </div>
  );
}
