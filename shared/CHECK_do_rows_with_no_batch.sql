-- ════════════════════════════════════════════════════════════════════════
-- DELIVERY ORDER LINES THAT NAME NO BATCH
--
-- batch_N on a delivery order is what tells the Nursery Movement Report
-- which batch the seedlings came off. Every reader of that report applies
-- the same rule -- plotBatches.js in the phone app, shared_plot_movement.js
-- and operation_reports.html in the office:
--
--     a line with no batch key is skipped, not subtracted
--
-- So a line with a plot and a quantity but NO BATCH takes nothing off any
-- batch. The seedlings left the nursery and the balance still carries them.
--
-- Until now the phone DO form had no batch field at all, so every delivery
-- order raised in the field is one of these. This counts them, and what
-- they come to.
--
-- Cancelled orders are left out: they took nothing off anything and are not
-- supposed to.
-- ════════════════════════════════════════════════════════════════════════

-- Read row 1 first -- that is the size of it in seedlings. Rows 3 onward
-- name the plots worst affected, most seedlings first, so a correction can
-- start where it is worth most.
--
-- A good result is row 1 reading 0 lines. Any other number is stock the
-- movement report still shows standing in a batch that has been sold.
WITH lines AS (
  SELECT do_number, delivery_date, status, remark, plot_1 AS plot, qty_1 AS qty, batch_1 AS batch FROM public.shared_do_records
  UNION ALL SELECT do_number, delivery_date, status, remark, plot_2, qty_2, batch_2 FROM public.shared_do_records
  UNION ALL SELECT do_number, delivery_date, status, remark, plot_3, qty_3, batch_3 FROM public.shared_do_records
  UNION ALL SELECT do_number, delivery_date, status, remark, plot_4, qty_4, batch_4 FROM public.shared_do_records
  UNION ALL SELECT do_number, delivery_date, status, remark, plot_5, qty_5, batch_5 FROM public.shared_do_records
),
live AS (
  SELECT * FROM lines
   WHERE COALESCE(qty, 0) > 0
     AND COALESCE(plot, '') <> ''
     AND COALESCE(status, '') <> 'Cancelled'
     AND position('[CANCELLED]' in COALESCE(remark, '')) = 0
),
bad AS (
  SELECT * FROM live WHERE COALESCE(btrim(batch), '') = ''
)
SELECT 1 AS n, 'DO lines naming NO batch: ' || (SELECT count(*)::text FROM bad) ||
       ' of ' || (SELECT count(*)::text FROM live) ||
       ', worth ' || COALESCE((SELECT sum(qty)::text FROM bad), '0') || ' seedlings' ||
       CASE WHEN (SELECT count(*) FROM bad) = 0 THEN ' -- OK' ELSE ' -- these are not off any batch balance' END
       AS result
UNION ALL
SELECT 2, 'earliest and latest of them: ' ||
       COALESCE((SELECT min(delivery_date)::text FROM bad), 'none') || ' to ' ||
       COALESCE((SELECT max(delivery_date)::text FROM bad), 'none')
UNION ALL
SELECT 3, '  ' || plot || ': ' || count(*)::text || ' line(s), ' || sum(qty)::text || ' seedlings'
  FROM bad GROUP BY plot
 ORDER BY 1, 2;
