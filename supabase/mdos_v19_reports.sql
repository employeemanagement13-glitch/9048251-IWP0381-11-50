-- ============================================================================
-- MDOS v19 — Reports Layer (Stock Reports + Financial Reports)
--
-- Run AFTER mdos_v9.1_consolidated.sql + mdos_v9.1_updates.sql
-- Safe to re-run (OR REPLACE / IF NOT EXISTS / ON CONFLICT).
--
-- What this file does:
--   A. Adds invoice_line_items.unit_rate + line_amount columns (for sale_amt)
--   B. Rewrites sync_invoice_line_items trigger to populate amount columns
--   C. Backfills stock_movements from all pre-migration historical data
--   D. Rewrites stock_ledger_view — proper human-readable source label
--   E. Rewrites stock_balance_by_level — opening/closing + packing_qty base view
--   F. Rewrites sale_purchase_summary — adds sale_amt, sale_return_qty/amt
--   G. Rewrites empty_ledger_view — signed qty, direction labels, proper reference
--   H. Rewrites empty_balance_view — current_balance per product
--   I. Builds stock_discrepancies_view — system_qty from stock_movements
--   J. Rewrites wh_tax_summary — purchase lines only, vendor = CCBPL (517)
--   K. Re-verifies advance_tax_report + discount_report views
--   L. Feature flags for all report tabs
--   M. Realtime publications
-- ============================================================================


-- ============================================================================
-- A. EXTEND invoice_line_items WITH amount COLUMNS
--    unit_rate and line_amount are needed for sale_amt in Sale/Purchase Summary.
--    invoice_line_items currently only has: id, tenant_id, invoice_id,
--    product_id, quantity, created_at — no monetary amounts at all.
-- ============================================================================

ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS unit_rate   NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_amount NUMERIC(14,2) NOT NULL DEFAULT 0;


-- ============================================================================
-- B. REWRITE sync_invoice_line_items TRIGGER
--    Now populates unit_rate and line_amount via proportional grand_total split.
--    Replaces the version from mdos_v9.1_consolidated.sql S5 section.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_invoice_line_items()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_product          TEXT;
  v_parts            TEXT[];
  v_name             TEXT;
  v_qty              NUMERIC(12,2);
  v_pid              UUID;
  v_total_parsed_qty NUMERIC(12,2) := 0;
  v_grand_total      NUMERIC(14,2);
BEGIN
  DELETE FROM invoice_line_items WHERE invoice_id = NEW.id;

  -- First pass: total qty across all line items (for proportional split)
  FOR v_product IN
    SELECT BTRIM(p) FROM UNNEST(string_to_array(NEW.products, ',')) AS p
  LOOP
    IF POSITION(chr(215) IN v_product) > 0 THEN
      v_parts := string_to_array(v_product, chr(215));
      v_total_parsed_qty := v_total_parsed_qty + BTRIM(v_parts[2])::NUMERIC;
    ELSIF v_product ~* ' x [0-9]+$' THEN
      v_parts := regexp_split_to_array(v_product, ' [xX] ');
      v_total_parsed_qty := v_total_parsed_qty + BTRIM(v_parts[2])::NUMERIC;
    ELSE
      v_total_parsed_qty := v_total_parsed_qty + 1;
    END IF;
  END LOOP;

  v_grand_total :=
    COALESCE(NEW.grand_total,
      NEW.invoice_total - COALESCE(NEW.discount_amount, 0) + COALESCE(NEW.advance_tax, 0),
      0);

  -- Second pass: insert rows with proportional amount
  FOR v_product IN
    SELECT BTRIM(p) FROM UNNEST(string_to_array(NEW.products, ',')) AS p
  LOOP
    IF POSITION(chr(215) IN v_product) > 0 THEN
      v_parts := string_to_array(v_product, chr(215));
      v_name  := BTRIM(v_parts[1]);
      v_qty   := BTRIM(v_parts[2])::NUMERIC;
    ELSIF v_product ~* ' x [0-9]+$' THEN
      v_parts := regexp_split_to_array(v_product, ' [xX] ');
      v_name  := BTRIM(v_parts[1]);
      v_qty   := BTRIM(v_parts[2])::NUMERIC;
    ELSE
      v_name := BTRIM(v_product);
      v_qty  := 1;
    END IF;

    v_pid := get_or_create_product_id(NEW.tenant_id, v_name);

    INSERT INTO invoice_line_items (
      tenant_id, invoice_id, product_id, quantity, unit_rate, line_amount
    ) VALUES (
      NEW.tenant_id,
      NEW.id,
      v_pid,
      v_qty,
      -- unit_rate: grand_total / total_qty (proportional estimate)
      CASE WHEN v_total_parsed_qty > 0
           THEN ROUND(v_grand_total / NULLIF(v_total_parsed_qty, 0), 2)
           ELSE 0 END,
      -- line_amount: proportional share of grand_total
      CASE WHEN v_total_parsed_qty > 0
           THEN ROUND(v_grand_total * v_qty / NULLIF(v_total_parsed_qty, 0), 2)
           ELSE 0 END
    );
  END LOOP;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sync_invoice_line_items ON invoices;
CREATE TRIGGER trg_sync_invoice_line_items
  AFTER INSERT OR UPDATE OF products ON invoices
  FOR EACH ROW EXECUTE FUNCTION sync_invoice_line_items();

-- Re-backfill existing invoices to populate the new amount columns
UPDATE invoices SET products = products WHERE products IS NOT NULL;


-- ============================================================================
-- C. HISTORICAL BACKFILL — populate stock_movements from pre-migration data
--    The consolidated trigger fires going forward; this covers history.
--    All inserts use NOT EXISTS guard so re-running is safe.
-- ============================================================================

-- C1. Sell In lines (arrived POs — status stock_arrived / on_credit / billed)
INSERT INTO stock_movements (
  tenant_id, product_id, movement_date, direction, quantity, amount,
  source_table, source_id
)
SELECT
  sio.tenant_id,
  sil.product_id,
  sio.transaction_date,
  CASE WHEN sil.invoice_type = 'purchase' THEN 'in' ELSE 'out' END,
  sil.qty,
  sil.net_bill_amount,
  'sell_in_lines',
  sil.id
FROM sell_in_lines sil
JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements sm
    WHERE sm.source_table = 'sell_in_lines' AND sm.source_id = sil.id
  );

-- C2. Returns & Wayback (approved)
INSERT INTO stock_movements (
  tenant_id, product_id, movement_date, direction, quantity,
  source_table, source_id
)
SELECT
  rw.tenant_id,
  p.id,
  rw.return_date,
  'in',
  rw.received_qty,
  'returns_wayback',
  rw.id
FROM returns_wayback rw
JOIN products p ON p.tenant_id = rw.tenant_id AND p.product_name = rw.product_name
WHERE rw.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements sm
    WHERE sm.source_table = 'returns_wayback' AND sm.source_id = rw.id
  );

-- C3. Damaged stock (all records)
INSERT INTO stock_movements (
  tenant_id, product_id, movement_date, direction, quantity,
  source_table, source_id
)
SELECT
  ds.tenant_id,
  p.id,
  ds.recorded_date,
  'out',
  ds.quantity,
  'damaged_stock',
  ds.id
FROM damaged_stock ds
JOIN products p ON p.tenant_id = ds.tenant_id AND p.product_name = ds.product_name
WHERE NOT EXISTS (
  SELECT 1 FROM stock_movements sm
  WHERE sm.source_table = 'damaged_stock' AND sm.source_id = ds.id
);

-- C4. Delivered invoices → OUT movements
--     source_id = invoice.id (matches Case B reversal pattern in move_stock_on_delivery)
INSERT INTO stock_movements (
  tenant_id, product_id, movement_date, direction, quantity, amount,
  source_table, source_id
)
SELECT
  ili.tenant_id,
  ili.product_id,
  COALESCE(inv.invoice_date, CURRENT_DATE),
  'out',
  ili.quantity,
  ili.line_amount,
  'invoice_line_items',
  inv.id
FROM invoice_line_items ili
JOIN invoices inv ON inv.id = ili.invoice_id
WHERE inv.delivery_status = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements sm
    WHERE sm.source_table = 'invoice_line_items' AND sm.source_id = inv.id
  );


-- ============================================================================
-- D. STOCK LEDGER VIEW — human-readable source label + direction label
--    Blueprint §9.1 View 1:
--      Date | Product | Direction | Source | Qty | Running Balance
-- ============================================================================

DROP VIEW IF EXISTS stock_ledger_view CASCADE;
CREATE OR REPLACE VIEW stock_ledger_view WITH (security_invoker = TRUE) AS
SELECT
  sm.tenant_id,
  sm.movement_date                                  AS date,
  p.product_name,
  p.id                                              AS product_id,
  UPPER(sm.direction)                               AS direction,
  CASE sm.source_table
    WHEN 'sell_in_lines'      THEN 'Sell In — '          || COALESCE(sio.po_no,        sm.source_id::TEXT)
    WHEN 'invoice_line_items' THEN 'Invoice — '           || COALESCE(inv.invoice_no,   sm.source_id::TEXT)
    WHEN 'damaged_stock'      THEN 'Damaged Stock — '     || COALESCE(ds.id::TEXT,      sm.source_id::TEXT)
    WHEN 'returns_wayback'    THEN 'Returns & Wayback — ' || COALESCE(rw.id::TEXT,      sm.source_id::TEXT) || ' (Approved)'
    ELSE sm.source_table || ' — ' || sm.source_id::TEXT
  END                                               AS source,
  sm.quantity                                       AS qty,
  sm.amount,
  SUM(
    CASE WHEN sm.direction = 'in' THEN sm.quantity ELSE -sm.quantity END
  ) OVER (
    PARTITION BY sm.tenant_id, sm.product_id
    ORDER BY sm.movement_date, sm.created_at, sm.id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  )                                                 AS running_balance
FROM stock_movements sm
JOIN products p ON p.id = sm.product_id
LEFT JOIN sell_in_lines sil
  ON sm.source_table = 'sell_in_lines'      AND sil.id = sm.source_id
LEFT JOIN sell_in_orders sio
  ON sil.sell_in_order_id = sio.id
LEFT JOIN invoices inv
  ON sm.source_table = 'invoice_line_items' AND inv.id = sm.source_id
LEFT JOIN damaged_stock ds
  ON sm.source_table = 'damaged_stock'      AND ds.id  = sm.source_id
LEFT JOIN returns_wayback rw
  ON sm.source_table = 'returns_wayback'    AND rw.id  = sm.source_id;


-- ============================================================================
-- E. STOCK BALANCE BY LEVEL — base + summary views
--    Blueprint §9.1 View 2:
--      Product | Packing Qty | Opening Balance | IN | OUT | Closing Balance
--
--    Period filtering: the app queries stock_balance_by_level_base and
--    aggregates with WHERE movement_date filters:
--      Opening  = SUM(signed_qty WHERE movement_date <  :date_from)
--      IN       = SUM(quantity   WHERE movement_date BETWEEN :from AND :to AND direction='in')
--      OUT      = SUM(quantity   WHERE movement_date BETWEEN :from AND :to AND direction='out')
--      Closing  = Opening + IN - OUT  (= SUM(signed_qty WHERE movement_date <= :date_to))
-- ============================================================================

-- Base view: one row per movement with all columns needed for period aggregation
DROP VIEW IF EXISTS stock_balance_by_level_base CASCADE;
CREATE OR REPLACE VIEW stock_balance_by_level_base WITH (security_invoker = TRUE) AS
SELECT
  sm.tenant_id,
  sm.movement_date,
  sm.direction,
  sm.quantity,
  CASE WHEN sm.direction = 'in' THEN sm.quantity ELSE -sm.quantity END AS signed_qty,
  p.id                                              AS product_id,
  p.product_name,
  COALESCE(p.packing_qty, 1)                        AS packing_qty,
  COALESCE(pc.title, 'Uncategorised')               AS category_title
FROM stock_movements sm
JOIN products p ON p.id = sm.product_id
LEFT JOIN product_categories pc ON pc.id = p.category_id;

-- All-time summary view (use base view with date WHERE for period reports)
DROP VIEW IF EXISTS stock_balance_by_level CASCADE;
CREATE OR REPLACE VIEW stock_balance_by_level WITH (security_invoker = TRUE) AS
SELECT
  sm.tenant_id,
  p.product_name,
  COALESCE(p.packing_qty, 1)                                              AS packing_qty,
  SUM(CASE WHEN sm.direction = 'in'  THEN sm.quantity ELSE 0 END)         AS total_qty_in,
  SUM(CASE WHEN sm.direction = 'out' THEN sm.quantity ELSE 0 END)         AS total_qty_out,
  SUM(CASE WHEN sm.direction = 'in'  THEN sm.quantity ELSE -sm.quantity END) AS net_balance
FROM stock_movements sm
JOIN products p ON p.id = sm.product_id
GROUP BY sm.tenant_id, p.product_name, p.packing_qty;


-- ============================================================================
-- F. SALE / PURCHASE SUMMARY — full rebuild with all columns
--    Blueprint §9.1 View 3:
--      Product | Purchase Qty | Purchase Amt | Pur. Return Qty | Pur. Return Amt |
--      Net Purchase Qty | Net Purchase Amt | Sale Qty | Sale Amt |
--      Sale Return Qty | Sale Return Amt | Net Sale Qty | Net Sale Amt
--
--    Note on Purchase Amt: uses bill_amount (rate * qty, before deductions)
--    to match Ittehad's report which shows gross purchase amount.
--    Net Purchase Amt uses net_bill_amount (after WH tax / commission / scheme).
-- ============================================================================

DROP VIEW IF EXISTS sale_purchase_summary CASCADE;
CREATE OR REPLACE VIEW sale_purchase_summary WITH (security_invoker = TRUE) AS
WITH pur AS (
  -- Purchase & Purchase Return (from CCBPL, arrived POs only)
  SELECT
    sil.tenant_id,
    sil.product_id,
    SUM(CASE WHEN sil.invoice_type = 'purchase' THEN sil.qty           ELSE 0 END) AS purchase_qty,
    SUM(CASE WHEN sil.invoice_type = 'purchase' THEN sil.bill_amount   ELSE 0 END) AS purchase_amt,
    SUM(CASE WHEN sil.invoice_type = 'return'   THEN sil.qty           ELSE 0 END) AS pur_return_qty,
    SUM(CASE WHEN sil.invoice_type = 'return'   THEN sil.bill_amount   ELSE 0 END) AS pur_return_amt
  FROM sell_in_lines sil
  JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  GROUP BY sil.tenant_id, sil.product_id
),
sal AS (
  -- Sale (delivered invoices)
  SELECT
    ili.tenant_id,
    ili.product_id,
    SUM(ili.quantity)    AS sale_qty,
    SUM(ili.line_amount) AS sale_amt
  FROM invoice_line_items ili
  JOIN invoices inv ON inv.id = ili.invoice_id
  WHERE inv.delivery_status = 'delivered'
  GROUP BY ili.tenant_id, ili.product_id
),
ret AS (
  -- Sale Return (approved returns from shops)
  SELECT
    rw.tenant_id,
    p.id AS product_id,
    SUM(rw.received_qty)  AS sale_return_qty,
    -- Amount: most recent purchase rate for this product as proxy
    SUM(rw.received_qty * COALESCE((
      SELECT sil2.rate
      FROM sell_in_lines sil2
      JOIN sell_in_orders sio2 ON sio2.id = sil2.sell_in_order_id
      WHERE sil2.product_id    = p.id
        AND sil2.tenant_id     = rw.tenant_id
        AND sil2.invoice_type  = 'purchase'
        AND sio2.status IN ('stock_arrived','on_credit','billed')
      ORDER BY sio2.transaction_date DESC
      LIMIT 1
    ), 0)) AS sale_return_amt
  FROM returns_wayback rw
  JOIN products p ON p.tenant_id = rw.tenant_id AND p.product_name = rw.product_name
  WHERE rw.status = 'approved'
  GROUP BY rw.tenant_id, p.id
),
all_products AS (
  SELECT tenant_id, product_id FROM pur
  UNION
  SELECT tenant_id, product_id FROM sal
  UNION
  SELECT tenant_id, product_id FROM ret
)
SELECT
  ap.tenant_id,
  p.product_name,
  COALESCE(pur.purchase_qty,    0)                                   AS purchase_qty,
  COALESCE(pur.purchase_amt,    0)                                   AS purchase_amt,
  COALESCE(pur.pur_return_qty,  0)                                   AS pur_return_qty,
  COALESCE(pur.pur_return_amt,  0)                                   AS pur_return_amt,
  COALESCE(pur.purchase_qty,0)  - COALESCE(pur.pur_return_qty,  0)  AS net_pur_qty,
  COALESCE(pur.purchase_amt,0)  - COALESCE(pur.pur_return_amt,  0)  AS net_pur_amt,
  COALESCE(sal.sale_qty,        0)                                   AS sale_qty,
  COALESCE(sal.sale_amt,        0)                                   AS sale_amt,
  COALESCE(ret.sale_return_qty, 0)                                   AS sale_return_qty,
  COALESCE(ret.sale_return_amt, 0)                                   AS sale_return_amt,
  COALESCE(sal.sale_qty,  0) - COALESCE(ret.sale_return_qty, 0)     AS net_sale_qty,
  COALESCE(sal.sale_amt,  0) - COALESCE(ret.sale_return_amt, 0)     AS net_sale_amt
FROM all_products ap
JOIN products p ON p.id = ap.product_id AND p.tenant_id = ap.tenant_id
LEFT JOIN pur ON pur.tenant_id = ap.tenant_id AND pur.product_id = ap.product_id
LEFT JOIN sal ON sal.tenant_id = ap.tenant_id AND sal.product_id = ap.product_id
LEFT JOIN ret ON ret.tenant_id = ap.tenant_id AND ret.product_id = ap.product_id;


-- ============================================================================
-- G. EMPTY LEDGER VIEW — direction labels, signed qty, proper reference
--    Blueprint §9.1 View 4:
--      Date | Product | Direction | Reference | Quantity | Running Balance
--
--    Quantity shown as signed:
--      Shop → Distribution  = +qty  (empties arriving at warehouse)
--      Distribution → CCBPL = -qty  (empties leaving warehouse)
--    Reference:
--      Shop → Distribution  = '{shop_name} / {invoice_no}'
--      Distribution → CCBPL = ccbpl_reference (PO no)
-- ============================================================================

DROP VIEW IF EXISTS empty_ledger_view CASCADE;
CREATE OR REPLACE VIEW empty_ledger_view WITH (security_invoker = TRUE) AS
SELECT
  el.tenant_id,
  el.log_date                                            AS date,
  el.product_name,
  CASE el.direction
    WHEN 'shop_to_distribution'  THEN 'Shop → Distribution'
    WHEN 'distribution_to_ccbpl' THEN 'Distribution → CCBPL'
    ELSE el.direction
  END                                                    AS direction_label,
  el.direction,
  CASE el.direction
    WHEN 'shop_to_distribution'  THEN
      COALESCE(s.shop_name, '') ||
      CASE WHEN inv.invoice_no IS NOT NULL THEN ' / ' || inv.invoice_no ELSE '' END
    WHEN 'distribution_to_ccbpl' THEN COALESCE(el.ccbpl_reference, '')
    ELSE ''
  END                                                    AS reference,
  CASE el.direction
    WHEN 'shop_to_distribution'  THEN  el.quantity
    WHEN 'distribution_to_ccbpl' THEN -el.quantity
    ELSE el.quantity
  END                                                    AS signed_quantity,
  el.quantity,
  el.deposit_amount,
  el.shop_id,
  el.invoice_id,
  el.ccbpl_reference,
  SUM(
    CASE el.direction
      WHEN 'shop_to_distribution'  THEN  el.quantity
      WHEN 'distribution_to_ccbpl' THEN -el.quantity
      ELSE el.quantity
    END
  ) OVER (
    PARTITION BY el.tenant_id, el.product_name
    ORDER BY el.log_date, el.created_at, el.id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  )                                                      AS running_balance
FROM empties_log el
LEFT JOIN shops s    ON s.id    = el.shop_id
LEFT JOIN invoices inv ON inv.id = el.invoice_id;


-- ============================================================================
-- H. EMPTY BALANCE VIEW — current on-hand per returnable product
--    Blueprint §9.1 View 5:
--      Product | Current Balance
-- ============================================================================

DROP VIEW IF EXISTS empty_balance_view CASCADE;
CREATE OR REPLACE VIEW empty_balance_view WITH (security_invoker = TRUE) AS
SELECT
  el.tenant_id,
  el.product_name,
  SUM(
    CASE el.direction
      WHEN 'shop_to_distribution'  THEN  el.quantity
      WHEN 'distribution_to_ccbpl' THEN -el.quantity
      ELSE el.quantity
    END
  )                      AS current_balance,
  SUM(el.deposit_amount) AS deposit_total
FROM empties_log el
GROUP BY el.tenant_id, el.product_name;


-- ============================================================================
-- I. STOCK DISCREPANCIES VIEW — system_qty from stock_movements
--    Blueprint §9.1 View 6:
--      Product | System Qty | Physical Qty | Diff | Audit Date | Status
--
--    system_qty = cumulative net stock movements up to the audit date.
--    diff       = physical_qty − system_qty (positive = surplus, negative = shortage).
-- ============================================================================

DROP VIEW IF EXISTS stock_discrepancies_view CASCADE;
CREATE OR REPLACE VIEW stock_discrepancies_view WITH (security_invoker = TRUE) AS
SELECT
  sd.id,
  sd.tenant_id,
  sd.audit_id,
  sd.product_name,
  COALESCE(sa.audit_date, sd.audit_date, CURRENT_DATE)   AS audit_date,
  sd.status,
  sd.reason,
  sd.created_at,
  -- system_qty: net movements up to audit_date
  COALESCE((
    SELECT SUM(
      CASE sm.direction WHEN 'in' THEN sm.quantity ELSE -sm.quantity END
    )
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.tenant_id    = sd.tenant_id
      AND p.product_name  = sd.product_name
      AND sm.movement_date <= COALESCE(sa.audit_date, sd.audit_date, CURRENT_DATE)
  ), 0)                                                   AS system_qty,
  sd.physical_qty,
  sd.physical_qty - COALESCE((
    SELECT SUM(
      CASE sm.direction WHEN 'in' THEN sm.quantity ELSE -sm.quantity END
    )
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.tenant_id    = sd.tenant_id
      AND p.product_name  = sd.product_name
      AND sm.movement_date <= COALESCE(sa.audit_date, sd.audit_date, CURRENT_DATE)
  ), 0)                                                   AS diff
FROM stock_discrepancies sd
LEFT JOIN stock_audits sa ON sa.id = sd.audit_id;


-- ============================================================================
-- J. WH TAX SUMMARY — corrected: purchase lines only, vendor = CCBPL (517)
--    Blueprint §9.2:
--      Date | Voucher | Vendor | CCBPL Invoice # | W.H. Tax
--    WH Tax = 0.1% of bill_amount per purchase line (generated column)
--    Return lines excluded per spec.
-- ============================================================================

DROP VIEW IF EXISTS wh_tax_summary CASCADE;
CREATE OR REPLACE VIEW wh_tax_summary WITH (security_invoker = TRUE) AS
SELECT
  sio.tenant_id,
  sio.transaction_date                              AS date,
  sio.po_no                                         AS voucher,
  'CCBPL (517)'::TEXT                               AS vendor,
  sio.company_inv_no                                AS ccbpl_invoice_no,
  COALESCE(SUM(
    CASE WHEN sil.invoice_type = 'purchase' THEN sil.wh_tax_amount ELSE 0 END
  ), 0)                                             AS wh_tax_total
FROM sell_in_orders sio
JOIN sell_in_lines sil ON sil.sell_in_order_id = sio.id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
GROUP BY
  sio.tenant_id,
  sio.id,
  sio.transaction_date,
  sio.po_no,
  sio.company_inv_no
ORDER BY sio.transaction_date;


-- ============================================================================
-- K. ADVANCE TAX REPORT — re-verified (was correct in v9.1_updates.sql)
--    Blueprint §2.1 v9.1_Updates:
--      Date | Sale | Cash Collection | Tax Collected
--    Tax Collected = SUM(advance_tax) unconditionally (no payment gate)
-- ============================================================================

DROP VIEW IF EXISTS advance_tax_report CASCADE;
CREATE OR REPLACE VIEW advance_tax_report WITH (security_invoker = TRUE) AS
SELECT
  tenant_id,
  invoice_date                                      AS date,
  SUM(COALESCE(grand_total, 0))                     AS sale,
  SUM(
    CASE
      WHEN invoice_type = 'cash'   THEN COALESCE(grand_total,    0)
      WHEN invoice_type = 'credit' THEN COALESCE(amount_received, 0)
      ELSE 0
    END
  )                                                 AS cash_collection,
  SUM(COALESCE(advance_tax, 0))                     AS tax_collected
FROM invoices
GROUP BY tenant_id, invoice_date;


-- ============================================================================
-- L. DISCOUNT REPORT — re-verified (was correct in v9.1_updates.sql)
--    Blueprint §2.2 v9.1_Updates:
--      Date | Sale | Cash Collection | Discount Given
--    Discount Given = SUM(discount_amount) unconditionally
-- ============================================================================

DROP VIEW IF EXISTS discount_report CASCADE;
CREATE OR REPLACE VIEW discount_report WITH (security_invoker = TRUE) AS
SELECT
  tenant_id,
  invoice_date                                      AS date,
  SUM(COALESCE(grand_total, 0))                     AS sale,
  SUM(
    CASE
      WHEN invoice_type = 'cash'   THEN COALESCE(grand_total,    0)
      WHEN invoice_type = 'credit' THEN COALESCE(amount_received, 0)
      ELSE 0
    END
  )                                                 AS cash_collection,
  SUM(COALESCE(discount_amount, 0))                 AS discount_given
FROM invoices
GROUP BY tenant_id, invoice_date;


-- ============================================================================
-- M. FEATURE FLAGS — register all report tab keys
-- ============================================================================

INSERT INTO global_feature_flags (flag_key, label, enabled) VALUES
  ('tab_stock_ledger',          'Stock Reports — Stock Ledger',            TRUE),
  ('tab_stock_balance_level',   'Stock Reports — Stock Balance by Level',   TRUE),
  ('tab_sale_purchase_summary', 'Stock Reports — Sale/Purchase Summary',    TRUE),
  ('tab_empty_ledger',          'Stock Reports — Empty Ledger',             TRUE),
  ('tab_empty_balance',         'Stock Reports — Empty Balance',            TRUE),
  ('tab_discrepancies',         'Stock Reports — Discrepancies',            TRUE),
  ('tab_wh_tax_summary',        'Financial Reports — WH Tax Summary',       TRUE),
  ('tab_advance_tax_report',    'Financial Reports — Advance Tax Report',   TRUE),
  ('tab_discount_report',       'Financial Reports — Discount Report',      TRUE),
  ('tab_trial_balance',         'Financial Reports — Trial Balance',        TRUE)
ON CONFLICT (flag_key) DO UPDATE SET label = EXCLUDED.label;


-- ============================================================================
-- N. REALTIME PUBLICATIONS
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'stock_movements'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE stock_movements; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'invoice_line_items'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE invoice_line_items; END IF;
END $$;


-- ============================================================================
-- END OF MDOS v19 — Reports Layer
-- ============================================================================
