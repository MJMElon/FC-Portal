import { supabase } from '../../lib/supabase.js';
import { cacheGet, cacheSet } from '../../lib/cache.js';
import { PERMANENT, flushOutbox, looksOffline, queueJob } from '../../lib/outbox.js';

// The scan list is now driven by SIGNED CONSENTS from the mobile web
// (mobile_consent_records). When a consent is signed there, it appears here for
// the FC to scan seals against its quantity. Scanning progress (which barcodes
// were counted) is kept locally, keyed by the consent record id, so it survives
// reloads and works offline.

const CONSENTS_CACHE = 'scan_consents';
export const PROGRESS_KEY = 'mjm.scan.progress.v1';

export function defaultProgress() {
  return { seen: [], scans: [], unique: 0, over: 0, completedFired: false, overFired: false, completedAt: null, doIssued: false };
}

export function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

export function saveProgress(map) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch (e) {
    /* ignore */
  }
}

// Last-synced consent list (for instant load + offline).
export function cachedConsents() {
  return cacheGet(CONSENTS_CACHE)?.value || null;
}

// Pull signed consents from Supabase (newest first) and cache them.
export async function fetchConsents() {
  const { data, error } = await supabase
    .from('mobile_consent_records')
    .select('id, al_number, order_number, customer_name, consent_qty, created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  cacheSet(CONSENTS_CACHE, data || []);
  return data || [];
}

// AL numbers that have a collection booking for TODAY → { al_number: 'HH:MM' }
// (earliest slot). Used to push today's collections to the top of the list.
const TODAY_AL_CACHE = 'scan_today_als';

export function cachedTodayALs() {
  return cacheGet(TODAY_AL_CACHE)?.value || {};
}

export async function fetchTodayBookingALs() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('shared_collection_bookings')
    .select('al_number, start_time')
    .eq('booking_date', today)
    .neq('status', 'cancelled');
  if (error) throw error;
  const map = {};
  (data || []).forEach((b) => {
    if (!b.al_number) return;
    const t = (b.start_time || '99:99').slice(0, 5);
    if (!(b.al_number in map) || t < map[b.al_number]) map[b.al_number] = t;
  });
  cacheSet(TODAY_AL_CACHE, map);
  return map;
}

export function statusOf(c) {
  if (c.unique > c.qty) return 'over';
  if (c.unique >= c.qty && c.qty > 0) return 'done';
  if (c.unique > 0) return 'progress';
  return 'pending';
}

// Combine the synced consent records with local scan progress into the view
// models the UI renders (same shape the scanner expects). All consents with a
// customer name are shown — including walk-in (MANUAL-*) consents that have no
// linked AL order.
//
// Signing happens on the Customer Consent screen, which lets a trip be
// consented in more than one pass — the customer signs for part of the
// order now and the rest later, or the office resends a corrected one. Each
// pass writes its own mobile_consent_records row, so the same still-open
// order used to show as that many separate cards here, each "Pending to
// Scan" for its own slice of the quantity — confusing to scan against and
// no sign any of them were the same trip. Rows sharing an al_number that
// are NOT yet DO-issued are grouped into ONE card with their quantities
// summed; a card already issued (doIssued) is left out of the group, same
// as a genuinely separate, finished collection would be.
//
// The group's own id — the one new scans and the DO are recorded against —
// is its OLDEST member's. That stays the same id every time this re-runs
// (a later consent for the same AL only ever joins an existing group, never
// becomes its anchor), so progress keyed by it in localStorage survives a
// resync. memberIds carries every row in the group, for fetchScanRecords /
// subscribeScanRecords to read scans already filed against any of them —
// a scan does not go looking for a NEW row somebody just signed.
export function mergeConsents(serverList, progress) {
  const rows = (serverList || []).filter((s) => s.customer_name);

  const groups = new Map(); // al_number -> rows[], only not-yet-issued ones
  const singles = [];
  rows.forEach((s) => {
    const issued = !!(progress[s.id] || {}).doIssued;
    if (s.al_number && !issued) {
      if (!groups.has(s.al_number)) groups.set(s.al_number, []);
      groups.get(s.al_number).push(s);
    } else {
      singles.push(s);
    }
  });

  const cards = [];
  groups.forEach((members) => {
    members.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const anchor = members[0];
    const p = progress[anchor.id] || defaultProgress();
    cards.push({
      id: anchor.id,
      memberIds: members.map((m) => m.id),
      al_number: anchor.al_number || '',
      order_number: anchor.order_number || '',
      customer: anchor.customer_name || anchor.al_number || '—',
      qty: members.reduce((sum, m) => sum + (m.consent_qty || 0), 0),
      ref: anchor.al_number || '',
      createdAt: anchor.created_at ? new Date(anchor.created_at).getTime() : 0,
      seen: p.seen || [],
      scans: p.scans || [],
      unique: p.unique || 0,
      over: p.over || 0,
      completedFired: !!p.completedFired,
      overFired: !!p.overFired,
      doIssued: !!p.doIssued,
      issuedQty: p.issuedQty || 0,
    });
  });

  singles.forEach((s) => {
    const p = progress[s.id] || defaultProgress();
    cards.push({
      id: s.id,
      memberIds: [s.id],
      al_number: s.al_number || '',
      order_number: s.order_number || '',
      customer: s.customer_name || s.al_number || '—',
      qty: s.consent_qty || 0,
      ref: s.al_number || '',
      createdAt: s.created_at ? new Date(s.created_at).getTime() : 0,
      seen: p.seen || [],
      scans: p.scans || [],
      unique: p.unique || 0,
      over: p.over || 0,
      completedFired: !!p.completedFired,
      overFired: !!p.overFired,
      doIssued: !!p.doIssued,
      issuedQty: p.issuedQty || 0,
    });
  });

  return cards;
}

// ── Multi-device sync via Supabase (fcportal_scan_records table) ──────────────

// Persist a single scan event. ON CONFLICT DO NOTHING → unique(consent_id, barcode)
// prevents double-counting when two devices scan the same seal.
export async function insertScanRecord(consentId, alNumber, barcode) {
  const { error } = await supabase
    .from('fcportal_scan_records')
    .insert({ consent_id: consentId, al_number: alNumber, barcode });
  if (error && error.code !== '23505') throw error; // 23505 = unique_violation (safe to ignore)
}

/* A scan made with no line still reaches the server, later.
 *
 * The local progress is what THIS phone counts by, and it never needed the
 * network — but fcportal_scan_records is how OTHER devices hear a barcode
 * has been taken, and a scan made offline used to be skipped rather than
 * queued: the count survived on one phone while every other phone stayed
 * free to accept the same seedling again. Now it queues like everything
 * else in this repository and flushes on sync, on reconnect, and on the
 * 30-second tick. The unique index (23505 ignored above) makes a retry of
 * a row the server already took a no-op rather than a duplicate.
 */
export const SCAN_JOB = 'scan_record';

export async function saveScanRecord(consentId, alNumber, barcode) {
  try {
    await insertScanRecord(consentId, alNumber, barcode);
  } catch (e) {
    if (looksOffline(e)) {
      await queueJob(SCAN_JOB, { consentId, alNumber, barcode });
      return;
    }
    // The server refused it for a reason of its own; the local progress
    // still holds the scan, which is the behaviour this call always had.
  }
}

export function flushScanRecords() {
  return flushOutbox({
    [SCAN_JOB]: async (p) => {
      try {
        await insertScanRecord(p.consentId, p.alNumber, p.barcode);
      } catch (e) {
        if (looksOffline(e)) throw e;      // try again later
        throw new Error(PERMANENT);        // the server refused the row itself
      }
    },
  });
}

// Pull all barcodes already stored for a consent (from any device). Takes
// either one consent id or an array — a merged card's scans can be filed
// against any of its member rows, not only the group's anchor.
export async function fetchScanRecords(consentIds) {
  const ids = Array.isArray(consentIds) ? consentIds : [consentIds];
  const { data, error } = await supabase
    .from('fcportal_scan_records')
    .select('barcode, scanned_at')
    .in('consent_id', ids)
    .order('scanned_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Has this barcode already been scanned under a DIFFERENT order? The
// table's own unique index is (consent_id, barcode) — it stops the SAME
// order's seal being double-counted, but nothing stops the same physical
// seal being filed a second time under a different consent_id entirely,
// which is exactly a seal reused on the wrong customer's order. This is the
// app-level check for that: excludeConsentIds is the scanning card's own
// member ids, so its own rows (and any sibling row from the same merged
// consent group) never flag themselves. Returns the first other row found
// (consent_id, al_number, scanned_at) or null.
export async function findBarcodeElsewhere(barcode, excludeConsentIds) {
  const { data, error } = await supabase
    .from('fcportal_scan_records')
    .select('consent_id, al_number, scanned_at')
    .eq('barcode', barcode)
    .order('scanned_at', { ascending: true })
    .limit(10);
  if (error) throw error;
  const exclude = new Set((excludeConsentIds || []).map(String));
  return (data || []).find((r) => !exclude.has(String(r.consent_id))) || null;
}

// Subscribe to live INSERTs across one or more consent ids. callback(barcode)
// fires when another device scans a new seal against any of them. Returns
// the channel — pass to unsubscribeScanRecords().
export function subscribeScanRecords(consentIds, callback) {
  const ids = Array.isArray(consentIds) ? consentIds : [consentIds];
  return supabase
    .channel('fcportal_scan:' + ids.join(','))
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'fcportal_scan_records',
      filter: `consent_id=in.(${ids.join(',')})`,
    }, (payload) => callback(payload.new.barcode))
    .subscribe();
}

export function unsubscribeScanRecords(channel) {
  if (channel) supabase.removeChannel(channel);
}
