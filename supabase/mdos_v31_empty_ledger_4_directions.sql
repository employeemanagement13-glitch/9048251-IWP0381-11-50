-- ============================================================================
-- MDOS v31 — Empty Ledger (4 Directions & Unique PO Line Return Upserts)
-- ============================================================================

-- 1. Create table for per-PO line return entries (Unique per sell_in_line_id)
CREATE TABLE IF NOT EXISTS sell_in_return_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  sell_in_order_id UUID NOT NULL REFERENCES sell_in_orders(id) ON DELETE CASCADE,
  sell_in_line_id UUID NOT NULL REFERENCES sell_in_lines(id) ON DELETE CASCADE,
  returned_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  returned_amt NUMERIC(12,2) NOT NULL DEFAULT 0,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_sell_in_return_entries UNIQUE (sell_in_line_id)
);

CREATE INDEX IF NOT EXISTS idx_sell_in_return_entries_line ON sell_in_return_entries(sell_in_line_id);
CREATE INDEX IF NOT EXISTS idx_sell_in_return_entries_order ON sell_in_return_entries(sell_in_order_id);

ALTER TABLE sell_in_return_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sell_in_return_entries_tenant ON sell_in_return_entries;
CREATE POLICY sell_in_return_entries_tenant ON sell_in_return_entries FOR ALL
  USING (tenant_id = (SELECT current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()));

-- Remove any duplicate entries per sell_in_line_id prior to adding unique constraint if upgrading
DELETE FROM sell_in_return_entries a
USING sell_in_return_entries b
WHERE a.created_at < b.created_at
  AND a.sell_in_line_id = b.sell_in_line_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_sell_in_return_entries'
  ) THEN
    ALTER TABLE sell_in_return_entries ADD CONSTRAINT uq_sell_in_return_entries UNIQUE (sell_in_line_id);
  END IF;
END $$;

-- Backfill from existing sell_in_arrived_lines where returned_qty > 0
INSERT INTO sell_in_return_entries (tenant_id, sell_in_order_id, sell_in_line_id, returned_qty, returned_amt, return_date, created_at)
SELECT
  sal.tenant_id,
  sal.sell_in_order_id,
  sal.sell_in_line_id,
  sal.returned_qty,
  COALESCE(sal.returned_amt, 0),
  sio.transaction_date,
  sal.created_at
FROM sell_in_arrived_lines sal
JOIN sell_in_orders sio ON sio.id = sal.sell_in_order_id
WHERE sal.returned_qty > 0
ON CONFLICT (sell_in_line_id) DO UPDATE
SET returned_qty = EXCLUDED.returned_qty,
    returned_amt = EXCLUDED.returned_amt,
    return_date  = EXCLUDED.return_date;


-- 2. Drop and Recreate Views
DROP VIEW IF EXISTS empty_ledger_with_balance CASCADE;
DROP VIEW IF EXISTS empty_ledger_view CASCADE;

CREATE OR REPLACE VIEW empty_ledger_view WITH (security_invoker = TRUE) AS

-- 1. CCBPL → Distribution (+Arrived Qty from POs)
SELECT
  sal.tenant_id,
  sio.transaction_date                                             AS date,
  p.product_name                                                   AS product_name,
  p.id                                                             AS product_id,
  'CCBPL → Distribution'::TEXT                                     AS direction,
  COALESCE(sio.po_no, 'PO-' || SUBSTRING(sio.id::TEXT, 1, 6))       AS reference,
  'po'::TEXT                                                       AS source_type,
  COALESCE(sio.po_no, '')                                          AS source_ref,
  COALESCE(sal.arrived_qty, sil.qty)                               AS qty,
  sal.id                                                           AS event_id,
  sal.created_at                                                   AS event_ts
FROM sell_in_arrived_lines sal
JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
JOIN products       p   ON p.id   = sil.product_id
LEFT JOIN product_categories pc ON pc.id = p.category_id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
  AND (COALESCE(pc.is_returnable, p.is_returnable, FALSE) = TRUE
       OR COALESCE(pc.is_rgb, FALSE) = TRUE
       OR LOWER(TRIM(p.product_name)) LIKE '%rgb%')
  AND COALESCE(sal.arrived_qty, sil.qty) > 0

UNION ALL

-- 2. Distribution → Shop (-Invoiced Qty from delivered/active invoices)
SELECT
  ili.tenant_id,
  inv.invoice_date                                                 AS date,
  MAX(p.product_name)                                              AS product_name,
  (MIN(p.id::TEXT))::UUID                                          AS product_id,
  'Distribution → Shop'::TEXT                                      AS direction,
  'Invoices — View'::TEXT                                          AS reference,
  'invoice'::TEXT                                                  AS source_type,
  ''::TEXT                                                         AS source_ref,
  SUM(ili.quantity)                                                AS qty,
  (MIN(ili.id::TEXT))::UUID                                        AS event_id,
  MIN(ili.created_at)                                               AS event_ts
FROM invoice_line_items ili
JOIN invoices inv ON inv.id = ili.invoice_id
JOIN products p   ON p.id   = ili.product_id
LEFT JOIN product_categories pc ON pc.id = p.category_id
WHERE (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
  AND (COALESCE(pc.is_returnable, p.is_returnable, FALSE) = TRUE
       OR COALESCE(pc.is_rgb, FALSE) = TRUE
       OR LOWER(TRIM(p.product_name)) LIKE '%rgb%')
  AND ili.quantity > 0
GROUP BY ili.tenant_id, inv.invoice_date, LOWER(TRIM(p.product_name))

UNION ALL

-- 3. Shop → Distribution (+Returned Qty from invoice_returns)
SELECT
  ir.tenant_id,
  ir.return_date                                                   AS date,
  COALESCE(MAX(p.product_name), MAX(ir.product_name))              AS product_name,
  (MIN(p.id::TEXT))::UUID                                          AS product_id,
  'Shop → Distribution'::TEXT                                      AS direction,
  'Invoices — View'::TEXT                                          AS reference,
  'returns'::TEXT                                                  AS source_type,
  ''::TEXT                                                         AS source_ref,
  SUM(ir.returned_qty)                                             AS qty,
  (MIN(ir.id::TEXT))::UUID                                         AS event_id,
  MIN(ir.created_at)                                               AS event_ts
FROM invoice_returns ir
JOIN invoices inv ON inv.id = ir.invoice_id
LEFT JOIN (
  SELECT DISTINCT ON (tenant_id, LOWER(TRIM(product_name)))
    id, product_name, tenant_id
  FROM products
  ORDER BY tenant_id, LOWER(TRIM(product_name)), created_at DESC
) p ON p.tenant_id = ir.tenant_id
  AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ir.product_name))
WHERE ir.returned_qty > 0
GROUP BY ir.tenant_id, ir.return_date, LOWER(TRIM(ir.product_name))

UNION ALL

-- 4. Distribution → CCBPL (-Returned Qty from sell_in_return_entries)
SELECT
  sre.tenant_id,
  sre.return_date                                                  AS date,
  p.product_name                                                   AS product_name,
  p.id                                                             AS product_id,
  'Distribution → CCBPL'::TEXT                                     AS direction,
  COALESCE(sio.po_no, 'PO-' || SUBSTRING(sio.id::TEXT, 1, 6))       AS reference,
  'po'::TEXT                                                       AS source_type,
  COALESCE(sio.po_no, '')                                          AS source_ref,
  sre.returned_qty                                                 AS qty,
  sre.id                                                           AS event_id,
  sre.created_at                                                   AS event_ts
FROM sell_in_return_entries sre
JOIN sell_in_lines  sil ON sil.id = sre.sell_in_line_id
JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
JOIN products       p   ON p.id   = sil.product_id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  AND sre.returned_qty > 0;


-- 3. Balance View
CREATE OR REPLACE VIEW empty_ledger_with_balance WITH (security_invoker = TRUE) AS
SELECT
  tenant_id,
  event_id,
  date,
  product_name,
  product_id,
  direction,
  reference,
  source_type,
  source_ref,
  qty,
  SUM(
    CASE
      WHEN direction IN ('CCBPL → Distribution', 'Shop → Distribution') THEN qty
      WHEN direction IN ('Distribution → Shop', 'Distribution → CCBPL') THEN -qty
      ELSE 0
    END
  ) OVER (
    PARTITION BY tenant_id, LOWER(TRIM(product_name))
    ORDER BY date, event_ts, event_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM empty_ledger_view;


-- 4. RPC Function get_empty_ledger
DROP FUNCTION IF EXISTS get_empty_ledger(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_empty_ledger(
  p_product_id UUID,
  p_date_from  TEXT DEFAULT NULL,
  p_date_to    TEXT DEFAULT NULL
)
RETURNS TABLE (
  event_id        UUID,
  date            DATE,
  product_name    TEXT,
  direction       TEXT,
  reference       TEXT,
  source_type     TEXT,
  source_ref      TEXT,
  qty             NUMERIC,
  running_balance NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_norm_name TEXT;
  v_tenant_id UUID;
BEGIN
  v_tenant_id := current_tenant_id();

  SELECT LOWER(TRIM(p.product_name)) INTO v_norm_name
  FROM products p
  WHERE p.id = p_product_id AND p.tenant_id = v_tenant_id;

  IF v_norm_name IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    elb.event_id,
    elb.date,
    elb.product_name,
    elb.direction,
    elb.reference,
    elb.source_type,
    elb.source_ref,
    elb.qty,
    elb.running_balance
  FROM empty_ledger_with_balance elb
  WHERE elb.tenant_id = v_tenant_id
    AND LOWER(TRIM(elb.product_name)) = v_norm_name
    AND (p_date_from IS NULL OR elb.date >= p_date_from::DATE)
    AND (p_date_to   IS NULL OR elb.date <= p_date_to::DATE)
  ORDER BY elb.date ASC, elb.running_balance ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_empty_ledger(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- END MDOS v31
-- ============================================================================
