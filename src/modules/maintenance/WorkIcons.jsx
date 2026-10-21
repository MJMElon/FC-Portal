/**
 * The four maintenance jobs, drawn.
 *
 * Plain drawings of the work kept coming out as near-identical smudges once
 * shrunk to icon size — two of the jobs are the same man with the same tank
 * pointed somewhere else, and two happen over the same grass — so each
 * picture here is built from a small, deliberately different object (a
 * handheld sprayer, a hand with a sprout, a hook, a ringed spray head)
 * rather than a figure, and every job still carries the word the office
 * writes on the schedule and says out loud underneath it:
 *
 *   pd        the hand sprayer, spraying      · P&D
 *   manuring  a sprout in a cupped hand       · BAJA
 *   weeding   the hook that cuts it           · CABUT
 *   interrow  the spray head, ringed          · RACUN
 *
 * The two grass jobs used to share one word (RUMPUT) because both are done
 * to the grass — the office asked for the two to read apart instead: CABUT
 * (pulled out) for the knife job, RACUN (poisoned) for the sprayed one, each
 * still carrying the picture that was already its own.
 *
 * Every word is forced to an exact width with textLength, so a six-letter
 * word and a three-letter one both fill the frame and none of them depends on
 * the metrics of whatever font is loaded. Everything inherits currentColor.
 */

const svg = {
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true,
};
const line = { stroke: 'currentColor', fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };

/* The word itself. `w` is the width it is stretched to rather than a font
   size to guess at: RUMPUT has twice the letters of P&D and still has to sit
   in the same 24-wide box. */
function Word({ text, y, size, w = 21 }) {
  return (
    <text
      x="12"
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={size}
      fontWeight="900"
      textLength={w}
      lengthAdjust="spacingAndGlyphs"
      fill="currentColor"
    >
      {text}
    </text>
  );
}

/* P & D — the hand sprayer, trigger up and three drops leaving the nozzle.
   The same drops-off-a-nozzle motif interrow uses, because both are
   something being sprayed — what tells the two apart is the canister
   itself: a handheld bottle here, the overhead head on a pipe there. */
export function PdIcon({ className = 'w-7 h-7' }) {
  return (
    <svg {...svg} className={className}>
      {/* the bottle */}
      <rect x="9.3" y="8.3" width="4.4" height="6.6" rx="1.2" />
      {/* the trigger/nozzle, angled up */}
      <rect x="10.1" y="6.1" width="1.7" height="2.6" rx=".5" transform="rotate(18 10.1 6.1)" />
      {/* the spray leaving it */}
      <path {...line} strokeWidth="1.1" d="M14.2 6.0 16.0 4.8" />
      <path {...line} strokeWidth="1.1" d="M14.7 7.5 16.7 7.1" />
      <path {...line} strokeWidth="1.1" d="M14.5 9.0 16.3 9.5" />
      <Word text="P&D" y={18.5} size={8.5} w={13} />
    </svg>
  );
}

/* Manuring — BAJA, a sprout rising out of a cupped hand. The office's own
   picture for this job: fertiliser is something put IN a plant's hand, not
   sprayed over it, so this is the one job here that is not a nozzle and
   drops. */
export function ManuringIcon({ className = 'w-7 h-7' }) {
  return (
    <svg {...svg} className={className}>
      {/* the cupped palm */}
      <path {...line} strokeWidth="1.3" d="M7.2 12c0 2.7 2.1 4.1 4.8 4.1s4.8-1.4 4.8-4.1" />
      {/* the stem */}
      <path {...line} strokeWidth="1.3" d="M12 12.3V6.8" />
      {/* the two leaves */}
      <path d="M12 6.8c-2.6 0-4-1.8-4-4 2.6 0 4 1.3 4 4z" />
      <path d="M12 6.8c2.6 0 4-1.8 4-4-2.6 0-4 1.3-4 4z" />
      <Word text="BAJA" y={19.4} size={7.8} w={17} />
    </svg>
  );
}

/* Weeding — RUMPUT under the sickle that cuts it.
   A sabit / 镰刀: a hooked blade, not a curved one. Three straight knives and
   a shallow crescent all failed before this. A chef's knife loses its taper
   at 17px and becomes a wedge; a cleaver reads as a flag; and a crescent
   with only a gentle bow reads as a bent stick, because nothing about it
   says the curve is the point.

   A hook does. The blade sweeps 210 degrees, so the shape closes back on
   itself and cannot be read as anything but a hook, and the handle carries
   on along the tangent at the heel rather than being dropped on top of the
   blade — sitting it at the heel put it lying across the inside of the hook.

   The outline is generated rather than drawn by hand: the arc is sampled at
   26 steps with the width tapering from nothing at the tip to full at the
   heel, which is a shape that can be reasoned about in numbers instead of
   guessed at with bezier handles. 26 steps is indistinguishable from 44 at
   the sizes this is read, and 40% less path. */
export function WeedingIcon({ className = 'w-7 h-7' }) {
  return (
    <svg {...svg} className={className}>
      {/* the blade */}
      <path d="M6.4 10.2 L6.8 10.9 L7.2 11.5 L7.7 12.0 L8.3 12.5 L9.0 12.8 L9.7 13.1 L10.4 13.2 L11.2 13.3 L11.9 13.3 L12.6 13.1 L13.3 12.8 L14.0 12.5 L14.6 12.1 L15.1 11.5 L15.6 11.0 L16.0 10.3 L16.2 9.6 L16.4 8.9 L16.5 8.1 L16.5 7.4 L16.3 6.7 L16.1 6.0 L15.8 5.3 L15.3 4.7 L14.8 4.1 L14.2 3.7 L12.2 6.6 L12.4 6.7 L12.7 6.8 L12.9 7.0 L13.1 7.2 L13.3 7.4 L13.5 7.7 L13.6 8.1 L13.7 8.4 L13.7 8.8 L13.7 9.2 L13.6 9.6 L13.4 10.0 L13.2 10.4 L12.9 10.7 L12.5 11.0 L12.1 11.3 L11.7 11.6 L11.2 11.7 L10.6 11.8 L10.1 11.8 L9.5 11.8 L8.9 11.6 L8.3 11.4 L7.7 11.1 L7.1 10.7 L6.4 10.2 Z" />
      {/* the handle, continuing off the heel */}
      <rect x="13.2" y="3.7" width="6.6" height="2.9" rx="1.45" transform="rotate(-145.0 13.2 5.1)" />
      <Word text="CABUT" y={16.8} size={7.6} w={19} />
    </svg>
  );
}

/* Inter-row — RACUN, the spray head ringed like the hazard label on the
   chemical itself. The head and its drops are the same drawing interrow has
   always had; the ring is what turns "something is being sprayed" into
   "this is the poisoning job" without redrawing a shape that already read
   fine on its own. */
export function InterrowIcon({ className = 'w-7 h-7' }) {
  return (
    <svg {...svg} className={className}>
      {/* the hazard ring */}
      <circle cx="12" cy="6.6" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.1" />
      {/* the pipe it hangs from */}
      <rect x="11.1" y="2.4" width="1.8" height="2.4" rx=".9" />
      {/* the head */}
      <path d="M7.4 4.8h9.2a.85.85 0 0 1 .76 1.27l-.74 1.32a.85.85 0 0 1-.76.46H8.44a.85.85 0 0 1-.76-.46l-.74-1.32A.85.85 0 0 1 7.4 4.8Z" />
      {/* the spray coming off it */}
      <path {...line} strokeWidth="1.1" d="M9 9.4 8.5 10.6" />
      <path {...line} strokeWidth="1.1" d="M11.4 9.5 11.2 10.8" />
      <path {...line} strokeWidth="1.1" d="M13.6 9.5l.2 1.3" />
      <path {...line} strokeWidth="1.1" d="M15.5 9.4l.5 1.2" />
      <Word text="RACUN" y={17.6} size={7.6} w={19} />
    </svg>
  );
}

/** By the work-type key the schedule and the records use. */
export const WORK_ICONS = {
  pd: PdIcon,
  manuring: ManuringIcon,
  weeding: WeedingIcon,
  interrow: InterrowIcon,
};

/** One icon by key, sized by the caller. Falls back to nothing rather than
    to a wrong picture, so an unknown job never says it is another one. */
export default function WorkIcon({ workKey, className }) {
  const Icon = WORK_ICONS[workKey];
  return Icon ? <Icon className={className} /> : null;
}
