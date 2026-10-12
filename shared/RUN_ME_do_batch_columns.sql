-- ════════════════════════════════════════════════════════════════════════
-- THE DELIVERY ORDER REMEMBERS WHICH BATCH THE SEEDLINGS CAME OFF
--
-- The DO form now offers the batches standing in the chosen plot, read from
-- the Nursery Movement Report (shared_plot_batch_balance), and shows the
-- breed of the one picked. This is where that answer is kept.
--
-- Five columns because the form takes five rows, matching plot_1..plot_5 and
-- breed_1..breed_5 beside them.
--
-- THE CUSTOMER PDF DOES NOT CHANGE. src/lib/pdf.js names plot_N, breed_N and
-- qty_N one at a time and never walks the columns, so a new column cannot
-- appear on a delivery order somebody signs.
--
-- Nullable, with no default and no backfill. Every DO already written has no
-- batch recorded and that is the truth about it -- writing one in now would
-- be inventing where seedlings came from months after the lorry left.
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shared_do_records ADD COLUMN IF NOT EXISTS batch_1 TEXT;
ALTER TABLE public.shared_do_records ADD COLUMN IF NOT EXISTS batch_2 TEXT;
ALTER TABLE public.shared_do_records ADD COLUMN IF NOT EXISTS batch_3 TEXT;
ALTER TABLE public.shared_do_records ADD COLUMN IF NOT EXISTS batch_4 TEXT;
ALTER TABLE public.shared_do_records ADD COLUMN IF NOT EXISTS batch_5 TEXT;

NOTIFY pgrst, 'reload schema';

-- ── THE CHECK ───────────────────────────────────────────────────────────
-- Row 1 is the one that matters: all five columns there, and TEXT, because
-- a batch name is not always a number.
--
-- Row 2 counts the delivery orders that now carry a batch. It reads 0 the
-- first time, which is correct -- nothing is backfilled. Save one DO from
-- the phone with a batch picked and it reads 1.
--
-- A good result:
--   1 | batch columns on shared_do_records: 5 of 5 -- OK
--   2 | delivery orders carrying a batch so far: 0
SELECT 1 AS n, 'batch columns on shared_do_records: ' ||
       count(*)::text || ' of 5' ||
       CASE WHEN count(*) = 5 THEN ' -- OK' ELSE ' -- NOT OK' END AS result
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'shared_do_records'
   AND column_name IN ('batch_1','batch_2','batch_3','batch_4','batch_5')
   AND data_type = 'text'
UNION ALL
SELECT 2, 'delivery orders carrying a batch so far: ' || (
         SELECT count(*)::text FROM public.shared_do_records
          WHERE COALESCE(batch_1, batch_2, batch_3, batch_4, batch_5) IS NOT NULL)
 ORDER BY 1;
