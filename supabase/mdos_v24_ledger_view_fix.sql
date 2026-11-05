-- ============================================================================
-- MDOS v24 — Stock Ledger View Fix (comprehensive)
--
-- Fix A: Sell In UNION — reversed join order so sell_in_lines is the driver,
--        LEFT JOIN sell_in_arrived_lines so orders marked stock_arrived without
--        going through markSellInArrived() still surface. Falls back to sil.qty.
--
-- Fix B: Damaged Stock UNION — LEFT JOIN products so freetext product_name
--        rows that don't match any products record still surface.
--
-- Fix C: Returns UNION — same LEFT JOIN fix. GROUP BY on source table column.
--
-- Fix D: RPC get_stock_ledger — filters by LOWER(TRIM(product_name)) so
--        whitespace/case differences across product records are normalized.
--        Replaces the fragile PostgREST ilike filter in the server action.
-- ============================================================================

DROP VIEW IF EXISTS stock_ledger_with_balance CASCADE;
DROP VIEW IF EXISTS stock_ledger_view CASCADE;

CREATE OR REPLACE VIEW stock_ledger_view WITH (security_invoker = TRUE) AS

-- ── Sell In ──────────────────────────────────────────────────────────────────
-- Start from sell_in_lines (not sell_in_arrived_lines) so orders that were
-- marked stock_arrived without per-line confirmation still appear.
-- qty = actual arrived qty if confirmation exists, else ordered qty (sil.qty).

SELECT
  sio.tenant_id,
  sio.transaction_date                                             AS date,
  p.product_name,
  p.id                                                             AS product_id,
  'IN'::TEXT                                                       AS direction,
  'Sell In — ' || COALESCE(sio.po_no, 'PO-' || SUBSTRING(sio.id::TEXT, 1, 6)) AS source,
  'sell_in'::TEXT                                                  AS source_type,
  COALESCE(sio.po_no, '')                                          AS source_ref,
  COALESCE(sal.arrived_qty - COALESCE(sal.returned_qty, 0), sil.qty) AS qty,
  COALESCE(sal.id, sil.id)                                         AS event_id,
  COALESCE(sal.created_at, sil.created_at)                         AS event_ts
FROM sell_in_lines sil
JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
JOIN products       p   ON p.id   = sil.product_id
LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
  AND COALESCE(sal.arrived_qty - COALESCE(sal.returned_qty, 0), sil.qty) > 0

UNION ALL

-- ── Invoice ───────────────────────────────────────────────────────────────────
SELECT
  ili.tenant_id,
  inv.invoice_date                                                 AS date,
  MAX(p.product_name)                                              AS product_name,
  (MIN(p.id::TEXT))::UUID                                          AS product_id,
  'OUT'::TEXT                                                      AS direction,
  'Invoice — View'::TEXT                                           AS source,
  'invoice'::TEXT                                                  AS source_type,
  ''::TEXT                                                         AS source_ref,
  SUM(ili.quantity)                                                AS qty,
  (MIN(ili.id::TEXT))::UUID                                        AS event_id,
  MIN(ili.created_at)                                              AS event_ts
FROM invoice_line_items ili
JOIN invoices inv ON inv.id  = ili.invoice_id
JOIN products p   ON p.id   = ili.product_id
WHERE ili.quantity > 0
GROUP BY ili.tenant_id, inv.invoice_date, LOWER(TRIM(p.product_name))

UNION ALL

-- ── Damaged Stock ─────────────────────────────────────────────────────────────
-- LEFT JOIN so freetext ds.product_name that doesn't match products table still
-- surfaces. COALESCE uses canonical p.product_name when match found.

SELECT
  ds.tenant_id,
  ds.recorded_date                                                 AS date,
  COALESCE(p.product_name, ds.product_name)                        AS product_name,
  p.id                                                             AS product_id,
  'OUT'::TEXT                                                      AS direction,
  'Damaged Stock — ' || COALESCE(NULLIF(ds.webspace_ref, ''), 'DMG-' || UPPER(SUBSTRING(ds.id::TEXT, 1, 6))) AS source,
  'damaged_stock'::TEXT                                            AS source_type,
  COALESCE(ds.webspace_ref, '')                                    AS source_ref,
  ds.quantity                                                      AS qty,
  ds.id                                                            AS event_id,
  ds.created_at                                                    AS event_ts
FROM damaged_stock ds
LEFT JOIN (
  SELECT DISTINCT ON (tenant_id, LOWER(TRIM(product_name)))
    id, product_name, tenant_id
  FROM products
  ORDER BY tenant_id, LOWER(TRIM(product_name)), created_at DESC
) p ON p.tenant_id = ds.tenant_id
  AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ds.product_name))
WHERE ds.quantity > 0

UNION ALL

-- ── Returns & Wayback ─────────────────────────────────────────────────────────
-- LEFT JOIN so freetext ir.product_name that doesn't match products table still
-- surfaces. GROUP BY on ir.product_name (source column, not the nullable p column).

SELECT
  ir.tenant_id,
  ir.return_date                                                   AS date,
  COALESCE(MAX(p.product_name), MAX(ir.product_name))              AS product_name,
  (MIN(p.id::TEXT))::UUID                                          AS product_id,
  'IN'::TEXT                                                       AS direction,
  'Returns & Wayback — View'::TEXT                                 AS source,
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
GROUP BY ir.tenant_id, ir.return_date, LOWER(TRIM(ir.product_name));


-- ── Balance view ──────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW stock_ledger_with_balance WITH (security_invoker = TRUE) AS
SELECT
  tenant_id,
  date,
  product_name,
  product_id,
  direction,
  source,
  source_type,
  source_ref,
  qty,
  SUM(
    CASE WHEN direction = 'IN' THEN qty ELSE -qty END
  ) OVER (
    PARTITION BY tenant_id, LOWER(TRIM(product_name))
    ORDER BY date, event_ts, event_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_balance
FROM stock_ledger_view;


-- ============================================================================
-- RPC: get_stock_ledger
-- Replaces the fragile PostgREST ilike filter. Resolves the canonical
-- LOWER(TRIM(product_name)) from the given product_id and matches all rows
-- in stock_ledger_with_balance by that normalized name.
-- Explicitly filters by tenant_id (safe even though view uses security_invoker).
-- ============================================================================

DROP FUNCTION IF EXISTS get_stock_ledger(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_stock_ledger(
  p_product_id UUID,
  p_date_from  TEXT DEFAULT NULL,
  p_date_to    TEXT DEFAULT NULL
)
RETURNS TABLE (
  date            DATE,
  product_name    TEXT,
  direction       TEXT,
  source          TEXT,
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
    slb.date,
    slb.product_name,
    slb.direction,
    slb.source,
    slb.source_type,
    slb.source_ref,
    slb.qty,
    slb.running_balance
  FROM stock_ledger_with_balance slb
  WHERE slb.tenant_id = v_tenant_id
    AND LOWER(TRIM(slb.product_name)) = v_norm_name
    AND (p_date_from IS NULL OR slb.date >= p_date_from::DATE)
    AND (p_date_to   IS NULL OR slb.date <= p_date_to::DATE)
  ORDER BY slb.date ASC, slb.running_balance ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_stock_ledger(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- END MDOS v24
-- ============================================================================
