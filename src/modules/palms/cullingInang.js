import { supabase } from '../../lib/supabase.js';

/**
 * WHAT WAS SELECTED, AND HOW MANY TIMES.
 *
 * The pokok inang a Field Conductor picks out of a block is not a scratch
 * figure any more. It has to survive the phone being put away, it has to be
 * readable by whoever is sent to the plot next, and above all the SCREEN HAS
 * TO KNOW WHETHER THIS IS THE SECOND TIME — because a plot still over ten
 * percent after a second selection is one that goes to HQ rather than round
 * the same loop again. None of that can be answered from a phone's own
 * storage: the second round is usually keyed by somebody else, often on a
 * different phone.
 *
 * So it is a table, `fcportal_culling_inang`, one row per block of ground
 * (plot + batch), and `attempt` is the round it was saved on. One row per
 * block, updated each round, rather than a row per round: the figure that
 * matters is the one standing now, and the count of rounds is what the
 * button is decided from.
 *
 * It CLEARS when the plot leaves the calculator. A plot is on this screen
 * because a PALMS collecting status is open on it; once that closes the plot
 * has been collected and last month's selection against it is not an answer
 * to anything — it is a figure waiting to be mistaken for a current one.
 * `pruneInang` is that, and it is deliberately driven by the live list the
 * screen just read rather than by a rule of its own, so the two cannot
 * disagree about what "on the list" means.
 *
 * Every call here is BEST EFFORT. A nursery is the far end of the coverage,
 * and a calculator that will not show a figure because it could not reach
 * the server is a calculator that fails where it is used. A read that fails
 * gives nothing saved — the person keys the count again, which is the work
 * they were going to do anyway. A write that fails says so, because a
 * selection the office cannot see is the one thing the person must not be
 * told has been recorded.
 */

const TABLE = 'fcportal_culling_inang';

/**
 * What is saved against a plot.
 *
 * @returns {Promise<{ byBatch: Object, rounds: number }>} byBatch is
 *   { [batch]: { qty, terms, attempt } }; rounds is the highest attempt on
 *   the plot, which is how many times a selection has been sent. Both empty
 *   and nought when nothing is saved OR when the read failed — see above.
 */
export async function loadInang(plot) {
  if (!plot) return { byBatch: {}, rounds: 0 };
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('batch, qty, terms, attempt, sent_qty')
      .eq('plot', plot);
    if (error) throw error;
    const byBatch = {};
    let rounds = 0;
    (data || []).forEach((r) => {
      byBatch[r.batch] = {
        qty: Number(r.qty) || 0,
        terms: Array.isArray(r.terms) ? r.terms.map(Number) : [],
        attempt: Number(r.attempt) || 0,
        /* What the figure was WHEN THE LAST ROUND WENT, which is a
           different thing from what it is now and the only way to tell
           "somebody has keyed again" from "somebody opened the screen".
           Null where no round has gone yet. */
        sentQty: r.sent_qty == null ? null : Number(r.sent_qty),
      };
      if ((Number(r.attempt) || 0) > rounds) rounds = Number(r.attempt) || 0;
    });
    return { byBatch, rounds };
  } catch (e) {
    return { byBatch: {}, rounds: 0 };
  }
}

/**
 * THE DRAFT, written as it is keyed.
 *
 * A count walked in a plot and typed on a phone is work that has been done,
 * and it used to live nowhere until a button was pressed: a phone that died,
 * a screen closed, a plot changed, and the walk had to be walked again. So
 * every keystroke settles into this within the second.
 *
 * It writes the FIGURE and nothing about rounds. `attempt` and `sent_qty`
 * belong to the button presses and are left exactly as they are — a draft
 * is not a round, and counting it as one would light the HQ button over a
 * number nobody has sent anywhere.
 *
 * BEST EFFORT, and quietly. A nursery is the far end of the coverage and a
 * toast on every keystroke would be unreadable; the figure is on screen
 * either way, and the hard save under the button is the one that refuses
 * out loud.
 *
 * @returns true when it landed, false when it did not — the screen says so
 *   once, in a line, rather than per keystroke.
 */
export async function draftInang({ plot, nursery, rows }) {
  const payload = (rows || []).map((r) => ({
    plot,
    batch: r.batch || '',
    nursery: nursery || null,
    qty: Math.max(0, Math.round(Number(r.inang) || 0)),
    terms: (r.terms || []).map((n) => Math.round(Number(n) || 0)),
    balance: Math.round(Number(r.balance) || 0),
    transplant: Math.round(Number(r.transplant) || 0),
    saved_at: new Date().toISOString(),
  }));
  if (!payload.length) return true;
  try {
    const { error } = await supabase.from(TABLE).upsert(payload, { onConflict: 'plot,batch' });
    if (error) throw error;
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Write this round down.
 *
 * One row per block, so a second round REPLACES the figure rather than
 * stacking beside it — what is standing is what matters — and carries the
 * round number with it. The upsert is on (plot, batch), which is the unique
 * index the table is built with.
 *
 * @throws when the server refuses it. The caller must not tell anybody the
 *   selection was recorded on the strength of a call that did not land.
 */
export async function saveInang({ plot, nursery, rows, attempt, by, byId }) {
  const payload = (rows || []).map((r) => ({
    plot,
    batch: r.batch || '',
    nursery: nursery || null,
    qty: Math.max(0, Math.round(Number(r.inang) || 0)),
    /* The separate counts, not just their total: "300 + 250 + 180" is a walk
       round the block in three goes, and a single 730 hides that. */
    terms: (r.terms || []).map((n) => Math.round(Number(n) || 0)),
    balance: Math.round(Number(r.balance) || 0),
    transplant: Math.round(Number(r.transplant) || 0),
    attempt,
    /* The figure AS IT STANDS AT THIS ROUND, kept beside the live one so the
       next person can be told apart from the next round: still over the
       line with the same number is somebody looking at it again, and still
       over with a different one is a second selection — which is the HQ
       button. */
    sent_qty: Math.max(0, Math.round(Number(r.inang) || 0)),
    saved_by: by || null,
    saved_by_id: byId || null,
    saved_at: new Date().toISOString(),
  }));
  if (!payload.length) return 0;
  const { error } = await supabase.from(TABLE).upsert(payload, { onConflict: 'plot,batch' });
  if (error) throw error;
  return payload.length;
}

/**
 * Clear a plot that has left the list.
 *
 * Called with the plots the calculator just read, and deletes the rows of
 * every plot that is NOT among them — which is the office's rule in their own
 * words: the data clears once the plot is no more in the list.
 *
 * NEVER FROM A CACHED READ. The list a phone serves with no signal is
 * whatever it last saw, and deleting against it would wipe the selections of
 * every plot that has opened since. The caller passes `live` only when the
 * read came off the server; with anything less this does nothing, which is
 * the safe direction — a stale row is corrected on the next good read, and a
 * deleted one is gone.
 */
export async function pruneInang(livePlots) {
  const live = [...new Set((livePlots || []).filter(Boolean))];
  if (!live.length) return 0;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .not('plot', 'in', `(${live.map((p) => `"${String(p).replace(/"/g, '')}"`).join(',')})`)
      .select('id');
    if (error) throw error;
    return (data || []).length;
  } catch (e) {
    return 0;
  }
}

/** The same, for one plot an admin has just taken off the list by hand. */
export async function clearInang(plot) {
  if (!plot) return 0;
  try {
    const { error } = await supabase.from(TABLE).delete().eq('plot', plot);
    if (error) throw error;
    return 1;
  } catch (e) {
    return 0;
  }
}
