import { supabase } from '../../lib/supabase.js';
import { doPdfBlob } from '../../lib/pdf.js';
import { nurseryKey } from '../../lib/access.js';

// ── Active Approval Letters (AL) ──────────────────────────────
export async function loadActiveALs() {
  const { data, error } = await supabase
    .from('shared_al_orders')
    .select('*')
    .not('status', 'in', '("Cancelled","Collected")')
    .gt('balance_quantity', 0)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// AL numbers that have at least one consent record.
export async function loadConsentALSet() {
  const { data } = await supabase.from('mobile_consent_records').select('al_number');
  const set = new Set();
  (data || []).forEach((c) => set.add(c.al_number));
  return set;
}

// Nursery / breed autocomplete data.
export async function loadDropdownData() {
  const [{ data: plots }, { data: breeds }] = await Promise.all([
    supabase.from('shared_plots').select('plot_name, nursery_name'),
    supabase.from('shared_breeds').select('name'),
  ]);
  return { plots: plots || [], breeds: breeds || [] };
}

export async function loadDOsForAL(alNumber) {
  const { data, error } = await supabase
    .from('shared_do_records')
    .select('*')
    .eq('al_number', alNumber)
    .order('delivery_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Same figure loadDOsForAL's caller derives (sum of total_qty) but for every
// AL in one request instead of one request per AL — the Signed Consents list
// needs this for every consent up front to know which are fully collected,
// not just the one consent someone has opened.
export async function loadIssuedQtyByALs(alNumbers) {
  if (!alNumbers || !alNumbers.length) return {};
  const { data, error } = await supabase
    .from('shared_do_records')
    .select('al_number, total_qty')
    .in('al_number', alNumbers);
  if (error) throw error;
  const map = {};
  (data || []).forEach((d) => {
    if (!d.al_number) return;
    map[d.al_number] = (map[d.al_number] || 0) + (Number(d.total_qty) || 0);
  });
  return map;
}

export async function loadConsentsForAL(alNumber) {
  const { data, error } = await supabase
    .from('mobile_consent_records')
    .select('*')
    .eq('al_number', alNumber)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Per-order running DO number: DO-<orderNo>01, DO-<orderNo>02, … The order
// number is the AL number for Sales Web orders, so the DO number itself
// identifies the customer order and the PDF no longer needs a separate
// Order No. field.
export async function generateDONumber(al) {
  const orderNo = String(al?.order_number || al?.al_number || '').trim();
  if (!orderNo) return `DO-${Date.now().toString(36).toUpperCase()}`;
  const prefix = `DO-${orderNo}`;
  const { data } = await supabase
    .from('shared_do_records')
    .select('do_number')
    .ilike('do_number', `${prefix}%`);
  let max = 0;
  (data || []).forEach((r) => {
    const rest = String(r.do_number || '').slice(prefix.length);
    if (/OFF/i.test(rest)) return; // skip offline placeholders
    const num = parseInt(rest.replace(/\D/g, ''), 10) || 0;
    if (num > max) max = num;
  });
  return prefix + String(max + 1).padStart(2, '0');
}

// Upload a DO photo to the `documents` storage bucket; returns a public URL or
// falls back to the raw base64 string if the upload fails.
export async function uploadDOPhoto(base64, alNumber, doNumber) {
  try {
    const filePath = `do_photos/${alNumber}/${doNumber}_${Date.now()}.jpg`;
    const b64 = base64.split(',')[1];
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: 'image/jpeg' });
    const { error } = await supabase.storage
      .from('documents')
      .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) return base64;
    const { data } = supabase.storage.from('documents').getPublicUrl(filePath);
    return data?.publicUrl || base64;
  } catch (e) {
    return base64;
  }
}

// Insert a DO record and deduct the AL balance. Returns { row, balance } — row
// is the inserted record (with its id, needed to open the Who Loaded This DO
// step against it) and balance is the new AL balance (or null when there is
// no linked AL row to deduct from). Same table the mobile DO module writes
// to, so both apps share one database.
//
// insert(...).select().single() rather than a plain insert(): the worker-tick
// step needs the row's id right after save, and a second query for it by
// do_number is a race a request this close behind the write is not
// guaranteed to win — the Mobile app hit exactly this and the fix there was
// the same one applied here, returning the row the insert already has.
export async function saveDORecord(payload, al) {
  const { data: row, error } = await supabase.from('shared_do_records').insert([payload]).select().single();
  if (error) throw error;
  if (al && al.id != null) {
    const newBalance = (al.balance_quantity ?? 0) - (payload.total_qty || 0);
    await supabase.from('shared_al_orders').update({ balance_quantity: newBalance }).eq('id', al.id);
    return { row, balance: newBalance };
  }
  return { row, balance: null };
}

// Look up an approval-letter order by its AL number (for the scan module's
// "Issue DO" flow). Returns the row or null.
export async function loadALByNumber(alNumber) {
  if (!alNumber) return null;
  const { data } = await supabase.from('shared_al_orders').select('*').eq('al_number', alNumber).maybeSingle();
  return data || null;
}

// Attach the issued DO to its Sales Web customer order so the customer portal
// shows it under the order's documents: build the DO PDF, upload it to the
// shared `order-attachments` bucket, then call the attach_do_to_order RPC
// (SECURITY DEFINER on the Sales Web side) which resolves the order from the
// AL number and inserts the salesweb_order_attachments + timeline rows.
// Best-effort: a failure here never blocks the DO itself. Returns true when
// the attachment row landed.
export async function attachDOToOrder({ payload, al, staff, sigDataUrl, photoBase64 }) {
  try {
    const alNumber = payload.al_number || al?.al_number;
    // Manual ALs have no Sales Web order to attach to.
    if (!alNumber || !payload.do_number || /^MANUAL-/i.test(alNumber)) return false;
    const { blob, fileName } = doPdfBlob(payload, al || {}, staff || '—', sigDataUrl || null, photoBase64 || null);
    const path = `do-pdfs/${alNumber}/${payload.do_number.replace(/[/\\]/g, '_')}.pdf`;
    const { error: upErr } = await supabase.storage
      .from('order-attachments')
      .upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (upErr) return false;
    const { data: urlData } = supabase.storage.from('order-attachments').getPublicUrl(path);
    if (!urlData?.publicUrl) return false;
    const { data, error } = await supabase.rpc('attach_do_to_order', {
      _al_number: alNumber,
      _do_number: payload.do_number,
      _file_name: fileName,
      _file_url: urlData.publicUrl,
      _file_size: blob.size,
      _uploaded_by: staff || 'barcode-counter',
    });
    return !error && data === true;
  } catch (e) {
    return false;
  }
}

// Persist a DO: online insert (+ photo upload + balance deduct + customer-order
// attachment) or, on no-network / failure, queue it for the next sync. Shared
// by the DO module and the scan module's Issue DO popup. Returns
// { queued, payload, savedRow } — savedRow is the inserted shared_do_records
// row (with its id) on a fresh online save, or null when queued: a queued DO
// has no server row yet to open the Who Loaded This DO step against, same as
// the Mobile app's equivalent flow.
export async function persistDO({ payload, photoBase64, al, sigDataUrl, staff }) {
  if (navigator.onLine) {
    try {
      const finalPayload = { ...payload };
      if (photoBase64) finalPayload.image_url = await uploadDOPhoto(photoBase64, al.al_number, payload.do_number);
      const { row } = await saveDORecord(finalPayload, al);
      await attachDOToOrder({ payload: finalPayload, al, staff, sigDataUrl, photoBase64 });
      return { queued: false, payload: finalPayload, savedRow: row || null };
    } catch (e) {
      /* fall through to offline queue */
    }
  }
  queueDO({ payload, photoBase64, sigDataUrl, staff });
  return { queued: true, payload, savedRow: null };
}

// ── Offline support ──────────────────────────────────────────────────
// A unique DO number for DOs created while offline (avoids collisions with the
// server sequence until they sync). Distinguishable by the "OFF" marker in the
// suffix; replaced with the real per-order running number on sync.
export function offlineDONumber(al) {
  const orderNo = String(al?.order_number || al?.al_number || '').trim() || 'NA';
  return `DO-${orderNo}OFF${Date.now().toString(36).toUpperCase()}`;
}

const DO_QUEUE_KEY = 'mjm.do.queue.v1';

export function readDOQueue() {
  try {
    return JSON.parse(localStorage.getItem(DO_QUEUE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}
function writeDOQueue(arr) {
  try {
    localStorage.setItem(DO_QUEUE_KEY, JSON.stringify(arr));
  } catch (e) {
    /* ignore */
  }
}
// Queue a DO (with its photo as base64) for later sync. Returns the new length.
export function queueDO(entry) {
  const q = readDOQueue();
  q.push({ ...entry, queuedAt: Date.now() });
  writeDOQueue(q);
  return q.length;
}

// Push every queued DO to Supabase. Offline-placeholder DO numbers (containing
// "OFF") are replaced with a real sequential number before insert so the
// running sequence stays clean. Items that fail stay queued for the next
// attempt. Returns { synced, remaining }.
export async function flushDOQueue() {
  let q = readDOQueue();
  if (!q.length) return { synced: 0, remaining: 0 };
  const remaining = [];
  let synced = 0;
  for (const item of q) {
    try {
      const payload = { ...item.payload };
      const { data: alRow } = await supabase
        .from('shared_al_orders')
        .select('*')
        .eq('al_number', payload.al_number)
        .maybeSingle();
      // Replace offline placeholder numbers with the real per-order running
      // number now that we are online. The loop is sequential so each DO gets
      // a unique number.
      if (payload.do_number && /OFF/i.test(payload.do_number)) {
        payload.do_number = await generateDONumber(alRow || { al_number: payload.al_number });
      }
      if (item.photoBase64) {
        payload.image_url = await uploadDOPhoto(item.photoBase64, payload.al_number, payload.do_number);
      }
      const { error } = await supabase.from('shared_do_records').insert([payload]);
      if (error) {
        remaining.push(item);
        continue;
      }
      if (alRow) {
        await supabase
          .from('shared_al_orders')
          .update({ balance_quantity: (alRow.balance_quantity || 0) - (payload.total_qty || 0) })
          .eq('id', alRow.id);
      }
      await attachDOToOrder({ payload, al: alRow || { al_number: payload.al_number }, staff: item.staff, sigDataUrl: item.sigDataUrl, photoBase64: item.photoBase64 });
      synced++;
    } catch (e) {
      remaining.push(item);
    }
  }
  writeDOQueue(remaining);
  return { synced, remaining: remaining.length };
}

// ── Who loaded this DO ──────────────────────────────────────────────────
// The distinct nurseries a DO's items actually touch, resolved through
// plotMap (plot_name -> nursery_name) the same way itemsFromRecord already
// labels each item's nursery. nurseryKey (lib/access.js) is the same
// letters-and-digits normalisation every other nursery comparison in this
// system uses, so a DO's plot spelling lines up with mjmnpayroll_workers'
// own nursery spelling without trusting either side to be typed the same.
export function nurseriesOfDO(d, plotMap) {
  const keys = [];
  for (let i = 1; i <= 5; i++) {
    const plot = d[`plot_${i}`];
    if (!plot) continue;
    const key = nurseryKey(plotMap[plot] || plot);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Active workers for the "Who Loaded This DO" tick list. Same table, same
// columns, same active-only filter as the maintenance module's own
// loadWorkers() (mjmnpayroll_workers — the roster the 555 Worker Portal
// signs people in against) but written as its own small query rather than
// importing the maintenance data layer, which pulls in offline/batch/
// schedule machinery the DO and Scan modules otherwise never touch — that
// coupling alone used to add several hundred KB to both of their bundles.
export async function loadDOWorkers() {
  const { data, error } = await supabase
    .from('mjmnpayroll_workers')
    .select('id, worker_no, full_name, nursery, section, role, job_title, maint_general, active')
    .eq('active', true)
    .order('full_name');
  if (error) throw error;
  return data || [];
}

// Writes who loaded a DO, grouped by nursery, and locks it — only an admin
// (checked by the caller) may call this again on an already-locked DO.
// Skipping the step writes nothing at all, same as leaving a cell blank: a
// DO with no worked_by_by_nursery and no lock reads identically to one
// nobody has looked at yet.
export async function saveDOWorkers(doId, workedByByNursery, lockedBy) {
  const { error } = await supabase
    .from('shared_do_records')
    .update({
      worked_by_by_nursery: workedByByNursery,
      worked_by_locked_at: new Date().toISOString(),
      worked_by_locked_by: lockedBy || null,
    })
    .eq('id', doId);
  if (error) throw error;
}

// Extract item rows (nursery/breed/qty) from a DO record's plot_n columns.
export function itemsFromRecord(d, plotMap = {}) {
  const lines = [];
  for (let i = 1; i <= 5; i++) {
    const plot = d[`plot_${i}`];
    const breed = d[`breed_${i}`];
    const qty = parseInt(d[`qty_${i}`]) || 0;
    if (plot || breed || qty > 0) {
      lines.push({ nursery: plotMap[plot] || plot || '—', breed: breed || '—', qty });
    }
  }
  return lines;
}
