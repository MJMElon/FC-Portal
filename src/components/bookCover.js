/*
 * The 555 exercise book cover — one stylesheet, a pile of colours.
 *
 * Every MJM portal signs in on the same cover: the house name, the 555
 * logotype as the hero, the portal name under it, and the boxes you fill
 * in below that. Only the colour of the board differs, exactly like the
 * books themselves:
 *
 *     FC Portal        blue      src/components/AuthScreen.jsx
 *     Worker Portal    ochre     src/worker/WorkerCover.jsx
 *     Auditor Portal   pink      the office repo, audit/audit_index.html
 *     Admin Portal     manila    the office repo
 *
 * The CSS lived inside the FC login until the worker portal wanted the same
 * cover. Copying it would have been two covers that agree today — and the
 * one lesson this system keeps teaching is that a rule written down twice
 * stops being one rule the first time somebody edits the nearer copy.
 *
 * A portal sets its own colour by passing the three --bk-cover values as an
 * inline style on the .bk-page element, which beats the defaults below.
 * Nothing else about the cover is a portal's business.
 */

export const BOOK_COVER_CSS = `
        /* ══ The 555 exercise book — cover ══
           The Auditor Portal's login is the same book in pink — it differs
           only in the three --bk-cover values below, and should stay that
           way: one book, a pile of colours. NOTE: the masthead here has since
           been restacked (house name, then 555, then the portal) and the
           Auditor Portal has not been brought across yet. */
        .bk-page{
          --bk-cover:#a9c5de; --bk-cover-2:#93b3d1; --bk-cover-3:#84a4c3;  /* blue, unless the portal says otherwise */
          --bk-ink:#23303f;
          /* the logotype and the button wear MJM's dark green, not the
             printer's red the books themselves are stamped with */
          --bk-green:#1f7a45; --bk-green-2:#155c33; --bk-green-3:#0f4a29; --bk-green-4:#0b3d21;
          --bk-quiet:rgba(35,48,63,.62);   /* MJM Nursery and the portal line share it */
          --bk-hand:'Caveat','Bradley Hand','Segoe Script','Comic Sans MS',cursive;

          position:relative;min-height:100vh;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          padding:26px 16px 20px;
          background:radial-gradient(ellipse at 50% 34%,#3a322b 0%,#221d19 62%,#14100e 100%);
        }

        .bk-book{position:relative;width:100%;max-width:400px;animation:bkIn .5s ease both}
        @keyframes bkIn{from{opacity:0;transform:translateY(16px) scale(.985)}to{opacity:1;transform:none}}

        .bk-edges{position:absolute;inset:0}
        .bk-edges i{
          position:absolute;top:7px;bottom:5px;border-radius:0 3px 3px 0;
          box-shadow:2px 2px 5px rgba(0,0,0,.35);
        }
        .bk-edges i:nth-child(1){right:-13px;width:15px;background:#d7dfb8}
        .bk-edges i:nth-child(2){right:-9px;width:13px;background:#f2ea9e;top:12px;bottom:10px}
        .bk-edges i:nth-child(3){right:-5px;width:11px;background:#fdf9e6;top:17px;bottom:15px}

        .bk-cover{
          position:relative;
          background:
            radial-gradient(ellipse at 32% 62%,rgba(255,255,255,.18),transparent 46%),
            radial-gradient(ellipse at 78% 18%,rgba(0,0,0,.05),transparent 52%),
            repeating-linear-gradient(101deg,rgba(255,255,255,.045) 0 2px,transparent 2px 6px),
            linear-gradient(160deg,var(--bk-cover) 0%,var(--bk-cover-2) 78%,var(--bk-cover-3) 100%);
          border-radius:3px 6px 6px 3px;
          padding:30px 26px 26px;
          box-shadow:0 26px 60px rgba(0,0,0,.55),
                     inset 0 0 0 1px rgba(255,255,255,.16),
                     inset 3px 0 0 rgba(0,0,0,.10);
          transform:rotate(-.4deg);
        }
        .bk-cover::before{
          content:'';position:absolute;left:0;top:0;bottom:0;width:9px;
          background:linear-gradient(90deg,rgba(0,0,0,.16),transparent);
          border-radius:3px 0 0 3px;
        }
        .bk-smudge{
          position:absolute;left:26%;top:56%;width:46%;height:15%;
          background:radial-gradient(ellipse,rgba(60,55,90,.13),transparent 68%);
          transform:rotate(-7deg);pointer-events:none;
        }

        /* The house name, above the book. Sized to read as a heading and
           still be plainly subordinate to the 555 under it. */
        /* A centred, letter-spaced line is NOT centred: CSS puts the space
           after the last letter too, so the ink sits half a letter-space
           left of the box. An equal text-indent puts it back — indent and
           trailing space cancel, and the ink lands on the real centre.
           Both come off one --ls so a breakpoint cannot change one and
           forget the other. */
        .bk-brand{
          --ls:.26em;
          text-align:center;
          font-size:19px;font-weight:900;
          letter-spacing:var(--ls);text-indent:var(--ls);
          text-transform:uppercase;
          color:var(--bk-quiet);
          margin-bottom:2px;
        }
        .bk-logo-wrap{display:flex;justify-content:center;margin-bottom:4px}
        .bk-logo{
          /* Grows with the phone rather than sitting at one fixed size: on a
             360px screen the cover is ~276px wide inside its padding, which
             27vw comfortably fits, and it stops growing on a tablet. */
          font-family:'Outfit',sans-serif;font-weight:900;font-style:italic;
          /* main's responsive sizing, kept: the shadow offsets are fixed px,
             so the centring correction below holds at every size. */
          font-size:clamp(88px,27vw,116px);line-height:.9;letter-spacing:-.02em;
          color:var(--bk-green);
          -webkit-text-stroke:1.5px #f4fbf6;paint-order:stroke fill;
          text-shadow:
            1px 1px 0 var(--bk-green-2),2px 2px 0 var(--bk-green-2),
            3px 3px 0 var(--bk-green-2),4px 4px 0 var(--bk-green-2),
            5px 5px 0 var(--bk-green-3),6px 6px 0 var(--bk-green-3),
            7px 7px 0 var(--bk-green-4),8px 8px 0 var(--bk-green-4),
            10px 12px 16px rgba(6,42,22,.4);
          /* What the eye centres on is the MIDDLE 5, not the ink of all three
             plus their shadow — centring the whole block pushes the middle
             glyph left, which is what -7px did. So this lines the face of
             the middle 5 up with the centre of MJM NURSERY above it.

             Measured on the built page by diffing renders (the cover is
             textured, so "not the background" does not isolate ink). Once the
             two lines above and below sit on the cover's true centre, so does
             this: the offset is linear in font size, hence the calc, and it
             holds across the whole clamp() range within a third of a pixel. */
          transform:translateX(calc(1.73px - .025em)) rotate(-1.2deg);
        }
        .bk-portal{
          margin-top:14px;text-align:center;
          --ls:.3em;
          font-size:14px;font-weight:900;
          letter-spacing:var(--ls);text-indent:var(--ls);
          text-transform:uppercase;
          color:var(--bk-quiet);
        }

        /* The cover asks for your name on a ruled line; a phone in a
           nursery asks for a box big enough to hit with a thumb. Boxes
           win — drawn freehand, so they still belong on the cover. */
        .bk-lines{margin-top:34px}
        .bk-field{
          display:block;width:100%;height:54px;
          margin-bottom:13px;padding:0 15px;
          background:rgba(255,255,255,.6);
          border:1.5px solid rgba(35,48,63,.32);
          border-radius:10px 7px 12px 6px / 7px 12px 6px 10px;
          font-family:var(--bk-hand);font-size:23px;color:var(--bk-ink);
          outline:none;-webkit-appearance:none;
          transition:border-color .15s,box-shadow .15s,background .15s;
        }
        .bk-field::placeholder{
          font-family:'Outfit',sans-serif;
          font-size:13px;font-weight:700;letter-spacing:.02em;
          color:rgba(35,48,63,.42);
        }
        .bk-field:focus{
          background:rgba(255,255,255,.82);
          border-color:var(--bk-green);
          box-shadow:0 0 0 3px rgba(31,122,69,.16);
        }

        .bk-btn{
          width:100%;height:50px;margin-top:22px;
          background:var(--bk-green-2);color:#f2fbf5;
          border:2px solid rgba(9,58,32,.9);
          border-radius:10px 7px 12px 6px / 7px 12px 6px 10px;
          box-shadow:3px 3px 0 rgba(7,45,25,.35);
          transform:rotate(-.5deg);
          font-size:13px;font-weight:900;letter-spacing:.2em;text-transform:uppercase;
          cursor:pointer;transition:transform .12s,box-shadow .12s,background .15s;
        }
        .bk-btn:hover{background:var(--bk-green)}
        .bk-btn:active{transform:rotate(-.5deg) translate(3px,3px);box-shadow:0 0 0}
        .bk-btn:disabled{opacity:.65;cursor:default;transform:rotate(-.5deg)}

        /* EN | BM, top right of the cover (CoverLang.jsx) */
        .bk-lang{position:absolute;top:8px;right:10px;z-index:2;display:flex;
          border:1.5px solid rgba(35,48,63,.35);border-radius:999px;overflow:hidden;
          background:rgba(255,255,255,.35)}
        .bk-lang-btn{font-size:10px;font-weight:900;letter-spacing:.1em;padding:3px 8px;
          background:none;border:none;color:var(--bk-quiet);cursor:pointer}
        .bk-lang-btn.on{background:var(--bk-green-2);color:#f2fbf5}
        .bk-links{display:flex;align-items:baseline;margin-top:16px}
        .bk-link{
          font-family:var(--bk-hand);font-size:18px;color:var(--bk-ink);
          background:none;border:none;
          border-bottom:1.5px dashed rgba(35,48,63,.4);
          padding:0 1px;cursor:pointer;
        }
        .bk-link:hover{color:var(--bk-green);border-bottom-color:rgba(31,122,69,.6)}
        .bk-link-right{margin-left:auto}

        .bk-note{
          font-family:var(--bk-hand);font-size:19px;line-height:1.15;
          padding:2px 2px 4px;margin-bottom:14px;border-bottom:2px solid;
        }
        /* ── The photograph on the registration form ──────────────────────
           Only the Worker Portal's cover puts a face on itself — a Field
           Conductor already has an office account with a name on it. It
           lives in this shared file anyway, because the cover is one design
           and two copies of a stylesheet are two covers that stop matching
           the first time one is edited.

           A stuck-on photograph, tilted the other way from the button, so
           it reads as something placed on the board rather than printed on
           it. */
        .bk-face-row{display:flex;align-items:center;gap:14px;margin-bottom:16px}
        .bk-face{
          width:74px;height:74px;flex:0 0 74px;border-radius:999px;
          border:2px solid rgba(35,48,63,.25);background:rgba(255,255,255,.55);
          display:grid;place-items:center;overflow:hidden;padding:0;cursor:pointer;
          font-size:30px;color:rgba(35,48,63,.35);
          transform:rotate(-1.5deg);box-shadow:2px 2px 0 rgba(35,48,63,.18);
        }
        .bk-face:active{transform:rotate(-1.5deg) translate(2px,2px);box-shadow:0 0 0}
        .bk-face img{width:100%;height:100%;object-fit:cover;display:block}
        .bk-face-side{min-width:0}
        .bk-face-note{
          font-family:var(--bk-hand);font-size:15px;line-height:1.15;
          color:rgba(35,48,63,.55);margin-top:4px;
        }
        /* Not display:none — a hidden input that is not rendered cannot be
           clicked open by the button beside it in every browser. (And no
           backticks in here: this whole sheet is a template literal.) */
        .bk-hidden-file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}

        .bk-err{color:#8f1120;border-bottom-color:rgba(143,17,32,.45)}
        .bk-ok{color:#12603f;border-bottom-color:rgba(18,96,63,.45)}
        .bk-warn{color:#7a4a06;border-bottom-color:rgba(122,74,6,.45)}


        @media (max-width:360px){
          .bk-cover{padding:26px 20px 22px}
          /* Narrower cover, so ease the ceiling — the 555 still fills it. */
          .bk-logo{font-size:clamp(76px,28vw,96px)}
          .bk-brand{font-size:17px;--ls:.22em}
          .bk-portal{--ls:.24em;font-size:12.5px}
        }
        @media (min-height:800px){
          .bk-lines{margin-top:48px}
          .bk-cover{padding-top:40px;padding-bottom:32px}
        }
      `;

/* The board colours, one entry per portal.
 *
 * The logotype is MJM's dark green on every cover, so a green board was the
 * one colour the worker portal could not have — the 555 disappeared into it.
 * Ochre is the other colour these books actually come in, and dark green
 * reads on it better than on anything else here. */
export const COVER_BLUE  = { '--bk-cover': '#a9c5de', '--bk-cover-2': '#93b3d1', '--bk-cover-3': '#84a4c3' };
export const COVER_OCHRE = { '--bk-cover': '#e6cf92', '--bk-cover-2': '#dac182', '--bk-cover-3': '#ccb272' };
