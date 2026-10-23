import { CULL_LIMIT } from './cullingActions.js';
import { figuresBroken, hasFigures, rateFor } from './cullingSource.js';

/**
 * ONE LINE PER BATCH — what the table draws, what the buttons are decided
 * from, and what the case and the database record. One list, so the four
 * cannot read different figures.
 *
 * It is here rather than inside the screen because of the fault that put it
 * here. The count being TYPED lived outside the saved list until + or = was
 * pressed, and tapping another batch threw it away — so a Field Conductor
 * who keyed 52 into one batch and moved to the next lost the 52, and the
 * batch went back to red with nothing saying why.
 *
 * TWO RULES, and the first is the whole of that fault:
 *
 *   1. WHAT IS BEING TYPED IS PART OF THE COUNT. Not a draft beside it. It
 *      is folded into the active batch terms here, so the figure on screen,
 *      the rate under it, the row that gets saved and the line in the case
 *      are the same number by construction. Nothing downstream has to know
 *      the keypad exists.
 *   2. EDITABLE is decided on the batch OWN rate, before anything is
 *      selected off it: a batch already under ten percent has nothing to
 *      bring down, so a cell inviting a count there is a count nobody needed
 *      to walk. A batch brought under the line by a selection stays
 *      editable, or there would be no way to correct the figure that got it
 *      there — AND SO DOES ONE CARRYING A FIGURE AT ALL, whatever its rate
 *      now reads, because a selection nobody can reach is one nobody can
 *      take off.
 *
 * @param batches  the blocks standing in the plot, with their figures
 * @param termsBy  { [batch]: number[] } — the counts already entered, in the
 *                 several goes they were walked in
 * @param active   the batch the keypad is typing into, or null
 * @param typing   what is on the keypad right now, as a string
 */
export function cullingLines(batches, termsBy, active, typing) {
  return (batches || []).map((b) => {
    const kept = (termsBy || {})[b.batch] || [];
    /* The in-flight figure is a term like any other. A nought keyed is a
       count — "I looked and there are none" — so it is the empty string
       that means nothing has been typed, never the value. */
    const live = (active === b.batch && typing !== '' && typing != null)
      ? [Number(typing)] : [];
    const terms = kept.concat(live);
    const inang = terms.reduce((a, n) => a + (Number(n) || 0), 0);
    const rate = rateFor({ balance: b.balance, transplant: b.transplant, inang: 0 });
    const finalRate = rateFor({ balance: b.balance, transplant: b.transplant, inang });
    return {
      ...b,
      terms,
      inang,
      rate,
      finalRate,
      finalBalance: hasFigures(b) ? b.balance - inang : 0,
      known: hasFigures(b),
      broken: figuresBroken(b),
      /* 3. A FIGURE THAT EXISTS CAN ALWAYS BE TAKEN OFF. The two tests
            above are about where a count is WORTH walking; neither is a
            reason to strand one already keyed. A batch whose own rate has
            since dropped under the line — the ledger moved, a sale, a
            cull — would otherwise sit there with a selection against it
            and no way to reach it, and the figure goes on coming off the
            final balance. */
      editable: (Number.isFinite(rate) && rate > CULL_LIMIT) || inang > 0,
    };
  });
}
