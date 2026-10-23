/* Seal numbers: one rule, four copies.
 *
 * A seal is a barcode like "0009297". It is counted by its NUMBER, so
 * "0009297" and "9297" are the same seal, and it is shown in its own WIDTH,
 * so a range prints the way the sticker reads. A range is start..end
 * inclusive.
 *
 * The same file lives in all four repositories -- mjm-ai-system
 * (shared/shared_seal_ranges.js), mobile (src/lib/sealRanges.js), fc-portal
 * (src/lib/sealRanges.js) and MJMNursery-Sales-Web (src/lib/sealRanges.js).
 * Change one, change all four.
 */

/** The digits of a scanned code, or null when there are none. A Bluetooth
    gun can send a stray space or a newline; anything that is not a digit is
    dropped rather than refused. */
export function sealDigits(code) {
  const d = String(code == null ? '' : code).replace(/\D+/g, '');
  if (!d || d.length > 15) return null;
  return d;
}

/** The number a code stands for, or null. */
export function sealNo(code) {
  const d = sealDigits(code);
  return d == null ? null : Number(d);
}

/** A number written back out at a width, zero-padded. */
export function sealCode(no, width) {
  const s = String(no);
  return width && s.length < width ? '0'.repeat(width - s.length) + s : s;
}

/** Codes in, runs out: [{ start, end, qty }]. Duplicates count once, and
    every code is written at the widest width seen, so "9299" scanned without
    its zeros still prints as 0009299 beside its neighbours. */
export function compressSeals(codes) {
  const nos = new Set();
  let width = 0;
  for (const c of codes || []) {
    const d = sealDigits(c);
    if (d == null) continue;
    nos.add(Number(d));
    if (d.length > width) width = d.length;
  }
  const sorted = [...nos].sort((a, b) => a - b);
  const out = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n === last.e + 1) { last.e = n; last.qty++; }
    else out.push({ s: n, e: n, qty: 1 });
  }
  return out.map((r) => ({ start: sealCode(r.s, width), end: sealCode(r.e, width), qty: r.qty }));
}

/** Runs written the way a DO prints them: "0009001 - 0009600, 0012345". */
export function formatSealRanges(ranges) {
  return (ranges || [])
    .map((r) => (r.start === r.end || r.qty === 1 ? r.start : r.start + ' - ' + r.end))
    .join(', ');
}

/** How many seals in a start..end range, or 0 when it is not a range. */
export function rangeQty(start, end) {
  const a = sealNo(start), b = sealNo(end);
  if (a == null || b == null || b < a) return 0;
  return b - a + 1;
}

/** Is a code inside any of [{ start_no, end_no }]? Returns that range or null. */
export function rangeHolding(code, ranges) {
  const n = sealNo(code);
  if (n == null) return null;
  return (ranges || []).find((r) => n >= Number(r.start_no) && n <= Number(r.end_no)) || null;
}

// Seal numbers are kept OFF every DO a customer sees, for now (office,
// 14 Oct 2026): the DO PDF, the WhatsApp text, the DO list on the signing
// phone and the customer portal. They are still RECORDED on
// shared_do_records.seal_ranges and still shown in the office DO record
// (Manage DO on operation_delivery.html). Set true to show them again.
// operation_delivery.html carries its own copy of this switch.
export const SHOW_SEALS_ON_DO = false;
