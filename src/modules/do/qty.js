/* ── HOW MANY WENT OUT ────────────────────────────────────────────────
   The quantity arithmetic of a delivery order, in one place, because it
   is asked three ways: by the form while it is being filled, by the
   save, and by the test.

   A row names a plot and can name several BATCHES standing in it, each
   with its own quantity -- one delivery order LINE per batch, because
   that is the only shape the readers can take (EntryModal says why). So
   a row is worth the sum of its picks, or its own box when the plot
   offers no batches at all. */
export const rowQty = (r) => (r.picks && r.picks.length
  ? r.picks.reduce((s, p) => s + (parseInt(p.qty) || 0), 0)
  : parseInt(r.qty) || 0);

/* Five slots on the record -- plot_1..plot_5 -- so five LINES, not five
   rows. A row naming three batches spends three of them. */
export const lineCount = (rows) => rows.reduce((s, r) => s + Math.max(1, (r.picks || []).length), 0);

export const totalQty = (rows) => rows.reduce((s, r) => s + rowQty(r), 0);

/* ── A SCANNED DELIVERY ORDER IS ISSUED FOR WHAT WAS SCANNED ──────────
   The barcode counter has already counted the seedlings onto the lorry.
   So on a delivery order opened out of a scan the quantity is not a
   suggestion somebody re-keys -- it is the answer, and the form's job is
   to say where it came FROM, not how many there were.

   Which gives the two cases:

   - **ONE line.** There is nothing to decide: the whole scanned count
     came off that one batch. The box fills itself and is not keyed,
     which is also what stops a conductor quietly signing a delivery
     order for a figure the scanner never saw.

   - **MORE THAN ONE line.** Only the conductor knows how many came off
     each, so the boxes are keyed by hand -- and the SUM has to come back
     to the scanned count. A delivery order whose lines do not add up to
     what was scanned is one that cannot say what left the gate.

   An auto-filled figure is the SCAN's answer and is marked `_auto`, so
   picking a second batch withdraws it rather than leaving the first
   batch holding the whole lorry and the second one nought. A figure the
   conductor keyed carries no mark and is never touched -- the house rule
   that a lookup fills an empty cell and never writes over a full one.

   None of this runs for a delivery order with no scan behind it (the DO
   module's own manual entry): there `scannedQty` is 0, nothing is
   filled, nothing has to tally, and the form works exactly as it did. */
export function scanTally(rows, scannedQty) {
  const scanned = Math.max(0, parseInt(scannedQty) || 0);
  const total = totalQty(rows);
  return {
    scanned,
    total,
    lines: lineCount(rows),
    /* The scan is answering the quantity itself. */
    auto: scanned > 0 && lineCount(rows) === 1,
    /* Still to be keyed across the batches; negative is more keyed than
       was scanned. */
    left: scanned - total,
    tallies: scanned === 0 || total === scanned,
  };
}

export function applyScannedQty(rows, scannedQty) {
  const scanned = Math.max(0, parseInt(scannedQty) || 0);
  const one = scanned > 0 && lineCount(rows) === 1;
  const want = String(scanned);

  const fix = (o) => {
    if (one) return (o.qty === want && o._auto) ? o : { ...o, qty: want, _auto: true };
    if (!o._auto) return o;
    const out = { ...o, qty: '' };
    delete out._auto;
    return out;
  };

  /* The SAME array back when there is nothing to do, so the effect that
     calls this cannot set state in a loop. */
  let moved = false;
  const next = rows.map((r) => {
    const picks = r.picks || [];
    if (picks.length) {
      const np = picks.map(fix);
      if (np.every((p, i) => p === picks[i])) return r;
      moved = true;
      return { ...r, picks: np };
    }
    const nr = fix(r);
    if (nr !== r) moved = true;
    return nr;
  });
  return moved ? next : rows;
}
