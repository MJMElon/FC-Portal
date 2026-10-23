import { supabase } from '../../lib/supabase.js';
import { batchKey, plotKey } from '../maintenance/plotBatches.js';

/* ══════════════════════════════════════════════════════════════════════
   WHAT WAS SELECTED OUT OF EACH BLOCK, AND WHICH ROUND IT WAS

   The round is the point. A block still over ten percent after a SECOND
   pokok inang selection is one HQ comes and looks at, and no phone can
   answer how many rounds a block has had: the second round is usually keyed
   by somebody else, and often on a different phone. So it is a row on the
   server — one per block of ground, replaced each round rather than added
   to, because the figure that matters is the one standing now and the round
   count is what the button is decided from.

   shared/RUN_ME_culling_inang.sql in mjm-ai-system is the table, its unique
   index on (plot, batch) and its policy. Without the index every save after
   the first is a refused insert, since the upsert below names those two
   columns as its conflict target.
   ══════════════════════════════════════════════════════════════════════ */

const INANG_TABLE = 'fcportal_culling_inang';

/**
 * Every block's selection so far, keyed "PLOT#BATCH".
 *
 * @returns {Promise<Map|null>} null when it could not be read — never an
 *   empty map standing in for "no block has been selected yet". The two are
 *   opposite answers and only one of them may escalate a case to HQ.
 */
export async function loadInangSelections() {
  const res = await supabase
    .from(INANG_TABLE)
    .select('id, plot, batch, qty, attempt, saved_at, saved_by');
  if (res.error) {
    console.warn('[culling] could not read the pokok inang selections:', res.error.message);
    return null;
  }
  const by = new Map();
  (res.data || []).forEach((r) => {
    const plot = plotKey(r.plot);
    if (!plot) return;
    const key = `${plot}#${batchKey(r.batch)}`;
    const attempt = Number(r.attempt) || 0;
    const prev = by.get(key);
    /* One row per block, by the unique index. A database that has not had
       that index yet can hold two, and the HIGHER round is the honest
       answer — a count of rounds that reads low is a case that should have
       gone to HQ going to the auditor again. */
    if (prev && prev.attempt >= attempt) return;
    by.set(key, {
      id: r.id, attempt, qty: Number(r.qty) || 0,
      at: String(r.saved_at || ''), by: String(r.saved_by || ''),
    });
  });
  return by;
}

/**
 * Write down what was selected, and which round that makes it.
 *
 * The round is worked out by the caller from what it was shown, because the
 * screen is the thing that knows whether a count was actually made: a block
 * already under the limit is offered the drone button with nothing keyed,
 * and nothing was selected, so no round has happened.
 *
 * Replaces the block's row rather than adding to it — see the heading above.
 */
export async function saveInangSelection(sel) {
  const plot = plotKey(sel && sel.plot);
  if (!plot) throw new Error('no block named');
  const res = await supabase
    .from(INANG_TABLE)
    .upsert({
      plot,
      batch: batchKey(sel.batch) || '',
      nursery: sel.nursery || null,
      qty: Math.max(0, Number(sel.qty) || 0),
      terms: Array.isArray(sel.terms) ? sel.terms : [],
      balance: Number.isFinite(Number(sel.balance)) ? Number(sel.balance) : null,
      transplant: Number.isFinite(Number(sel.transplant)) ? Number(sel.transplant) : null,
      attempt: Math.max(1, Number(sel.attempt) || 1),
      saved_by: sel.by || null,
      saved_by_id: sel.byId || null,
      saved_at: new Date().toISOString(),
    }, { onConflict: 'plot,batch' });
  if (res.error) throw new Error(res.error.message);
  return true;
}

/**
 * Forget the blocks that have left the calculator.
 *
 * A block is on this screen because a collecting status is open on its plot
 * and its 3rd culling has no drone map yet. Once either of those changes the
 * block has been dealt with, and last month selection against it is a figure
 * waiting to be mistaken for a current one — worse, a round count that would
 * send the next season straight to HQ.
 *
 * ONLY ever against a list read from the SERVER. Swept against a cached one
 * it would delete every block opened since that cache was taken, which is
 * every block somebody else has started on.
 *
 * Best effort and silent: a sweep that fails costs a stale row, which is
 * harmless in the meantime because a row is only ever read for a block that
 * IS on the list.
 */
export async function sweepInangSelections(saved, liveKeys) {
  if (!saved || !saved.size) return 0;
  const gone = [];
  saved.forEach((v, key) => { if (!liveKeys.has(key)) gone.push(v.id); });
  if (!gone.length) return 0;
  try {
    const res = await supabase.from(INANG_TABLE).delete().in('id', gone);
    if (res.error) {
      console.warn('[culling] could not clear old selections:', res.error.message);
      return 0;
    }
  } catch (e) {
    return 0;
  }
  return gone.length;
}

