import { PERMANENT, flushOutbox, isOnline, looksOffline, queueJob } from '../../lib/outbox.js';
import { raiseCase } from '../../lib/nelos.js';

/**
 * The Culling Calculator without a signal.
 *
 * Counting pokok inang happens standing in a plot, which is exactly where
 * there is no bar of signal — a nursery is the far end of the coverage, not
 * the near end. A calculator that needs the network to show a plot, or to
 * accept the count that was just walked for, is a calculator that fails at
 * the only moment it is used.
 *
 * Two halves, and neither of them is a separate "offline mode": the same code
 * runs either way, which is the rule the rest of this portal follows.
 *
 *   READING   the blocks are kept on the device after every good read, and
 *             served from there when the network cannot answer.
 *   WRITING   the case goes into the shared outbox and is sent when the
 *             signal returns, exactly like a maintenance record.
 */

/* Bumped when the shape of a block changes, so an old device serving an old
   cache to new code cannot show figures the new code would read differently.
   A missed cache costs one read; a misread one costs a wrong decision. */
const CACHE_KEY = 'mjm_culling_blocks_v1';

/** Keep what was just read, for the next time there is nothing to read. */
export function cacheBlocks(rows) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows: rows || [] }));
  } catch (e) {
    /* A full or refused storage is not a reason to fail the read that just
       succeeded — the person has their figures either way. */
  }
}

/**
 * The blocks from the last good read.
 *
 * @returns {{ rows: Array, at: number } | null} null when there has never
 *   been one, which the screen shows as an empty list rather than as an error:
 *   a Field Conductor who has never opened this with a signal has nothing to
 *   count against, and saying so plainly beats a spinner.
 */
export function cachedBlocks() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!raw || !Array.isArray(raw.rows)) return null;
    return { rows: raw.rows, at: Number(raw.at) || 0 };
  } catch (e) {
    return null;
  }
}

/* One kind of queued job, named so an older build that does not know it
   leaves it alone rather than dropping it. */
const CULL_JOB = 'culling_case';

/* ══════════════════════════════════════════════════════════════════════
   THE CASES THE SERVER WOULD NOT TAKE

   A queued case that the server refuses — row-level security, a category
   nothing routes, a missing column — is not something a retry will fix, so
   the outbox drops it rather than let it block everything behind it. That
   part is right. What was wrong is that it dropped it SILENTLY: the Field
   Conductor had already been told "saved, and sent when the signal returns",
   the signal returned, the case was refused, and nothing on any screen ever
   said so. He believes an auditor is coming and nobody is.

   So a refusal is kept here on the way past. It costs one small localStorage
   entry, the screen can say the request did not go, and the reason the server
   gave is on hand — which is the difference between "why is my case not in
   Nelos" being a mystery and being a sentence.
   ══════════════════════════════════════════════════════════════════════ */

const REFUSED_KEY = 'mjm_culling_refused_v1';
/* Enough to hold a bad afternoon, not enough to fill the quota. The newest
   are kept: an old refusal for a plot since dealt with helps nobody. */
const REFUSED_MAX = 20;

/** Every request the server turned down, newest first. */
export function refusedCases() {
  try {
    const raw = JSON.parse(localStorage.getItem(REFUSED_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function keepRefusal(payload, message) {
  try {
    const all = [{ at: Date.now(), message: String(message || '').slice(0, 300), payload }]
      .concat(refusedCases())
      .slice(0, REFUSED_MAX);
    localStorage.setItem(REFUSED_KEY, JSON.stringify(all));
  } catch (e) {
    /* Nothing to do — the refusal is still reported by whoever is looking at
       the return value; this is only the record that outlives the moment. */
  }
}

/** Forget them, once somebody has dealt with them. */
export function clearRefused() {
  try { localStorage.removeItem(REFUSED_KEY); } catch (e) { /* nothing to clear */ }
}

/**
 * Try the refused ones again.
 *
 * The usual reason a culling case is refused is a database that has not been
 * told about it yet — the Nelos permission, or the routing rules. Both are
 * fixed by somebody in the office, and when they are, the request that was
 * turned down is still wanted. So they are re-raised on demand rather than
 * only wept over.
 *
 * @returns { sent, left } — how many went, and how many are still refused.
 */
export async function retryRefused() {
  const all = refusedCases();
  const left = [];
  let sent = 0;
  for (const r of all) {
    const res = await raiseCase({ ...r.payload, dedupe: true });
    if (res && res.error) {
      left.push({ ...r, at: Date.now(), message: String(res.error.message || res.error).slice(0, 300) });
      // No signal: stop, rather than fail the rest against the same wall.
      if (looksOffline(res.error)) { left.push(...all.slice(all.indexOf(r) + 1)); break; }
    } else {
      sent++;
    }
  }
  try {
    if (left.length) localStorage.setItem(REFUSED_KEY, JSON.stringify(left.slice(0, REFUSED_MAX)));
    else localStorage.removeItem(REFUSED_KEY);
  } catch (e) { /* the sends still happened */ }
  return { sent, left: left.length };
}

/**
 * Raise a case, signal or no signal.
 *
 * Offline it goes straight to the queue; online it is tried and only queued
 * if the attempt failed for a reason a retry could fix. A 400 because a
 * column is missing is not that, and must reach the person instead of sitting
 * in a queue nobody looks at.
 *
 * @returns the same { data, error, deduped } raiseCase gives, plus `queued`.
 */
export async function submitCase(args) {
  if (!isOnline()) {
    await queueJob(CULL_JOB, args);
    return { data: null, error: null, queued: true };
  }
  const res = await raiseCase(args);
  if (res && res.error) {
    if (looksOffline(res.error)) {
      await queueJob(CULL_JOB, args);
      return { data: null, error: null, queued: true };
    }
    /* Refused to its face. The screen says so at once, and it is written down
       as well: the person who has to fix it is not the one holding the phone,
       and by the time they ask, the toast is long gone. */
    keepRefusal(args, res.error.message || res.error);
  }
  return { ...res, queued: false };
}

/**
 * Send whatever the queue is holding.
 *
 * Dedupe is left on for a queued case: the flush may be the second attempt at
 * one the server already took, and an auditor sent twice to the same plot is
 * the cost of getting that wrong.
 */
export function flushCulling() {
  return flushOutbox({
    [CULL_JOB]: async (payload) => {
      const res = await raiseCase({ ...payload, dedupe: true });
      if (res && res.error) {
        // Only a network failure is worth keeping. Anything else would sit in
        // the queue for ever, blocking everything behind it.
        if (looksOffline(res.error)) throw res.error;
        // Dropped from the queue — but not forgotten. See above.
        keepRefusal(payload, res.error.message || res.error);
        throw new Error(PERMANENT);
      }
    },
  });
}
