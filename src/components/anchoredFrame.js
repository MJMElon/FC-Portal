/* ONE POP-OUT SHAPE FOR EVERY DOCK WINDOW.

   Anchored to the dock icon, the way the portal's own Nelos dock
   (shared/shared_nelos_dock.js, in mjm-ai-system) has always worked: the
   button and its panel are one thing, and the panel opens attached to
   wherever the button currently is — not a dialog that appears somewhere
   else on the screen, unrelated to what was tapped.

   That file keeps the fab and the panel as flex siblings inside one
   positioned wrapper, so the panel simply falls in beside the button. A
   window opened from a separate React tree cannot be a flex sibling of
   the button that opened it, so this gets the same result with maths
   instead: given where the button sits (anchor) and which quarter of the
   screen its centre is in, pick the edge of the button the panel grows
   away from, and how much room that direction actually has.

   This was NelosWindow's own helper first. The office then asked for the
   other three dock windows — PALMS, Pending Verification, the Culling
   Calculator — to present the same way (a floating card, no darkened or
   blurred backdrop, not a sheet glued to the screen edge) while each KEEPS
   ITS OWN SIZE, so the maths moved here and takes the panel's measurements
   as an argument instead of hard-coding Nelos's. */

const GAP = 10;

export default function anchoredFrame(anchor, panel = {}) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = panel.w ?? 370;
  const minW = panel.minW ?? 280;
  const minH = panel.minH ?? 220;
  const ax = anchor?.x ?? vw - 78, ay = anchor?.y ?? vh - 168;
  const size = anchor?.size ?? 62;
  const cx = ax + size / 2, cy = ay + size / 2;

  const openLeft = cx <= vw / 2;   // icon on the left half -> panel grows rightward from it
  const openUp = cy > vh / 2;      // icon in the bottom half -> panel grows upward from it

  const width = Math.max(minW, Math.min(w, vw - 24));
  const maxHeight = openUp
    ? Math.max(minH, ay - GAP - 12)
    : Math.max(minH, vh - (ay + size) - GAP - 12);

  /* Always resolved to a single 'left' value, clamped inside the viewport,
     rather than picking 'left' or 'right' the way the vertical axis picks
     'top' or 'bottom'. The reference dock (shared_nelos_dock.js) can get
     away with that because its fab naturally rests in a corner; this one
     can be dragged anywhere along the width of the screen, including the
     middle, where a panel aligned flush to one edge of a 62px icon would
     run off the OTHER edge of a narrow phone. Clamping keeps it beside the
     icon everywhere that fits, and at the nearest screen edge instead of
     off it everywhere else. */
  const idealLeft = openLeft ? ax : ax + size - width;
  const left = Math.min(Math.max(idealLeft, 12), Math.max(12, vw - width - 12));

  const frame = { position: 'fixed', left, width, maxWidth: 'calc(100vw - 24px)', maxHeight };
  frame[openUp ? 'bottom' : 'top'] = openUp
    ? Math.max(12, vh - ay + GAP) : Math.max(12, ay + size + GAP);
  return frame;
}
