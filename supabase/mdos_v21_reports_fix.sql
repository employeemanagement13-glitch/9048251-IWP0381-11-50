-- ============================================================================
-- MDOS v21 — Reports Fix
--   Fix 26/27: stock_balance_by_level  → live sell_in_arrived_lines + invoice_line_items + invoice_returns
--   Fix 28:    stock_ledger_view       → same live sources
--   Fix 29:    sale_purchase_summary   → Ret from sell_in_arrived_lines, S.Ret from invoice_returns
--   Fix 30:    empty_ledger_view       → shop→dist from invoice_returns, dist→ccbpl from sell_in_arrived_lines
--   Fix 31:    empty_balance_view      → remove deposit_total
--   Fix 32:    stock_discrepancies_view → system_qty from live tables
-- ============================================================================


-- ============================================================================
-- FIX 28 — STOCK LEDGER VIEW
-- ============================================================================

DROP VIEW IF EXISTS stock_ledger_with_balance CASCADE;
DROP VIEW IF EXISTS stock_ledger_view CASCADE;

CREATE OR REPLACE VIEW stock_ledger_view WITH (security_invoker = TRUE) AS
SELECT
  sio.tenant_id,
  sio.transaction_date                                             AS date,
  p.product_name,
  p.id                                                             AS product_id,
  'IN'::TEXT                                                       AS direction,
  'Sell In — ' || COALESCE(sio.po_no, 'PO-' || SUBSTRING(sio.id::TEXT, 1, 6)) AS source,
  'sell_in'::TEXT                                                  AS source_type,
  COALESCE(sio.po_no, '')                                          AS source_ref,
  (sal.arrived_qty - COALESCE(sal.returned_qty, 0))                AS qty,
  sal.id                                                           AS event_id,
  sal.created_at                                                   AS event_ts
FROM sell_in_arrived_lines sal
JOIN sell_in_lines  sil ON sil.id  = sal.sell_in_line_id
JOIN sell_in_orders sio ON sio.id  = sil.sell_in_order_id
JOIN products       p   ON p.id    = sil.product_id
WHERE (sio.status IN ('stock_arrived', 'on_credit', 'billed') OR sio.status IS NOT NULL)
  AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
  AND (sal.arrived_qty - COALESCE(sal.returned_qty, 0)) > 0

UNION ALL

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

SELECT
  ds.tenant_id,
  ds.recorded_date                                                 AS date,
  p.product_name,
  p.id                                                             AS product_id,
  'OUT'::TEXT                                                      AS direction,
  'Damaged Stock — ' || COALESCE(NULLIF(ds.webspace_ref, ''), 'DMG-' || UPPER(SUBSTRING(ds.id::TEXT, 1, 6))) AS source,
  'damaged_stock'::TEXT                                            AS source_type,
  COALESCE(ds.webspace_ref, '')                                    AS source_ref,
  ds.quantity                                                      AS qty,
  ds.id                                                            AS event_id,
  ds.created_at                                                    AS event_ts
FROM damaged_stock ds
JOIN products p ON p.tenant_id = ds.tenant_id
  AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ds.product_name))
WHERE ds.quantity > 0

UNION ALL

SELECT
  ir.tenant_id,
  ir.return_date                                                   AS date,
  MAX(p.product_name)                                              AS product_name,
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
JOIN products p   ON p.tenant_id = ir.tenant_id
  AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ir.product_name))
WHERE ir.returned_qty > 0
GROUP BY ir.tenant_id, ir.return_date, LOWER(TRIM(p.product_name));


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
-- FIX 26/27 — STOCK BALANCE BY LEVEL
-- ============================================================================

DROP VIEW IF EXISTS stock_balance_by_level CASCADE;
CREATE OR REPLACE VIEW stock_balance_by_level WITH (security_invoker = TRUE) AS
WITH prod_cats AS (
  SELECT DISTINCT ON (p.tenant_id, LOWER(TRIM(p.product_name)))
    p.tenant_id,
    LOWER(TRIM(p.product_name)) AS norm_name,
    pc.is_returnable,
    pc.is_rgb
  FROM products p
  JOIN product_categories pc ON pc.id = p.category_id
  ORDER BY p.tenant_id, LOWER(TRIM(p.product_name)), p.created_at DESC
),
ins AS (
  SELECT
    sio.tenant_id,
    LOWER(TRIM(p.product_name)) AS norm_name,
    SUM(sal.arrived_qty - COALESCE(sal.returned_qty, 0)) AS qty_in
  FROM sell_in_arrived_lines sal
  JOIN sell_in_lines  sil ON sil.id  = sal.sell_in_line_id
  JOIN sell_in_orders sio ON sio.id  = sil.sell_in_order_id
  JOIN products       p   ON p.id    = sil.product_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND sil.invoice_type = 'purchase'
  GROUP BY sio.tenant_id, LOWER(TRIM(p.product_name))
),
outs_gross AS (
  SELECT
    ili.tenant_id,
    LOWER(TRIM(p.product_name)) AS norm_name,
    SUM(ili.quantity) AS gross_qty_out
  FROM invoice_line_items ili
  JOIN invoices inv ON inv.id = ili.invoice_id
  JOIN products p   ON p.id   = ili.product_id
  GROUP BY ili.tenant_id, LOWER(TRIM(p.product_name))
),
returns_deduct AS (
  SELECT
    ir.tenant_id,
    LOWER(TRIM(ir.product_name)) AS norm_name,
    SUM(ir.returned_qty) AS returned_qty
  FROM invoice_returns ir
  LEFT JOIN prod_cats pc ON pc.tenant_id = ir.tenant_id
    AND pc.norm_name = LOWER(TRIM(ir.product_name))
  WHERE (pc.norm_name IS NULL OR pc.is_returnable = FALSE OR (pc.is_rgb = FALSE AND pc.is_returnable = TRUE))
  GROUP BY ir.tenant_id, LOWER(TRIM(ir.product_name))
),
all_names AS (
  SELECT tenant_id, norm_name FROM ins
  UNION SELECT tenant_id, norm_name FROM outs_gross
  UNION SELECT tenant_id, norm_name FROM returns_deduct
),
prod_meta AS (
  SELECT
    p.tenant_id,
    LOWER(TRIM(p.product_name)) AS norm_name,
    MAX(p.product_name) AS product_name,
    MAX(COALESCE(p.packing_qty, 1)) AS packing_qty
  FROM products p
  GROUP BY p.tenant_id, LOWER(TRIM(p.product_name))
)
SELECT
  an.tenant_id,
  COALESCE(pm.product_name, INITCAP(an.norm_name)) AS product_name,
  COALESCE(pm.packing_qty, 1)::NUMERIC AS packing_qty,
  COALESCE(ins.qty_in, 0)::NUMERIC AS total_qty_in,
  (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0))::NUMERIC AS total_qty_out,
  (COALESCE(ins.qty_in, 0) - (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0)))::NUMERIC AS net_balance
FROM all_names an
LEFT JOIN prod_meta pm   ON pm.tenant_id = an.tenant_id AND pm.norm_name = an.norm_name
LEFT JOIN ins            ON ins.tenant_id = an.tenant_id AND ins.norm_name = an.norm_name
LEFT JOIN outs_gross og  ON og.tenant_id  = an.tenant_id AND og.norm_name  = an.norm_name
LEFT JOIN returns_deduct rd ON rd.tenant_id = an.tenant_id AND rd.norm_name = an.norm_name;


-- RPC: get_stock_balance_filtered
CREATE OR REPLACE FUNCTION get_stock_balance_filtered(
  p_date_from TEXT DEFAULT NULL,
  p_date_to   TEXT DEFAULT NULL
)
RETURNS TABLE (
  tenant_id       UUID,
  product_name    TEXT,
  packing_qty     NUMERIC,
  total_qty_in    NUMERIC,
  total_qty_out   NUMERIC,
  net_balance     NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  v_tenant_id := current_tenant_id();

  RETURN QUERY
  WITH prod_cats AS (
    SELECT DISTINCT ON (p.tenant_id, LOWER(TRIM(p.product_name)))
      p.tenant_id,
      LOWER(TRIM(p.product_name)) AS norm_name,
      pc.is_returnable,
      pc.is_rgb
    FROM products p
    JOIN product_categories pc ON pc.id = p.category_id
    WHERE p.tenant_id = v_tenant_id
    ORDER BY p.tenant_id, LOWER(TRIM(p.product_name)), p.created_at DESC
  ),
  ins AS (
    SELECT
      LOWER(TRIM(p.product_name)) AS norm_name,
      SUM(sal.arrived_qty - COALESCE(sal.returned_qty, 0)) AS qty_in
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    JOIN products       p   ON p.id   = sil.product_id
    WHERE sio.tenant_id = v_tenant_id
      AND sio.status IN ('stock_arrived', 'on_credit', 'billed')
      AND sil.invoice_type = 'purchase'
      AND (p_date_from IS NULL OR sio.transaction_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR sio.transaction_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(p.product_name))
  ),
  outs_gross AS (
    SELECT
      LOWER(TRIM(p.product_name)) AS norm_name,
      SUM(ili.quantity) AS gross_qty_out
    FROM invoice_line_items ili
    JOIN invoices inv ON inv.id = ili.invoice_id
    JOIN products p   ON p.id   = ili.product_id
    WHERE ili.tenant_id = v_tenant_id
      AND (p_date_from IS NULL OR inv.invoice_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR inv.invoice_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(p.product_name))
  ),
  returns_deduct AS (
    SELECT
      LOWER(TRIM(ir.product_name)) AS norm_name,
      SUM(ir.returned_qty) AS returned_qty
    FROM invoice_returns ir
    LEFT JOIN prod_cats pc ON pc.norm_name = LOWER(TRIM(ir.product_name))
    WHERE ir.tenant_id = v_tenant_id
      AND (pc.norm_name IS NULL OR pc.is_returnable = FALSE OR (pc.is_rgb = FALSE AND pc.is_returnable = TRUE))
      AND (p_date_from IS NULL OR ir.return_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR ir.return_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(ir.product_name))
  ),
  all_names AS (
    SELECT norm_name FROM ins
    UNION SELECT norm_name FROM outs_gross
    UNION SELECT norm_name FROM returns_deduct
  ),
  prod_meta AS (
    SELECT
      LOWER(TRIM(p.product_name)) AS norm_name,
      MAX(p.product_name) AS product_name,
      MAX(COALESCE(p.packing_qty, 1)) AS packing_qty
    FROM products p
    WHERE p.tenant_id = v_tenant_id
    GROUP BY LOWER(TRIM(p.product_name))
  )
  SELECT
    v_tenant_id,
    COALESCE(pm.product_name, INITCAP(an.norm_name)) AS product_name,
    COALESCE(pm.packing_qty, 1)::NUMERIC,
    COALESCE(ins.qty_in, 0)::NUMERIC,
    (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0))::NUMERIC,
    (COALESCE(ins.qty_in, 0) - (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0)))::NUMERIC
  FROM all_names an
  LEFT JOIN prod_meta pm   ON pm.norm_name = an.norm_name
  LEFT JOIN ins            ON ins.norm_name = an.norm_name
  LEFT JOIN outs_gross og  ON og.norm_name  = an.norm_name
  LEFT JOIN returns_deduct rd ON rd.norm_name = an.norm_name
  ORDER BY 2;
END;
$$;

GRANT EXECUTE ON FUNCTION get_stock_balance_filtered(TEXT, TEXT) TO authenticated;


-- ============================================================================
-- FIX 29 — SALE / PURCHASE SUMMARY
-- ============================================================================

DROP VIEW IF EXISTS sale_purchase_summary CASCADE;
CREATE OR REPLACE VIEW sale_purchase_summary WITH (security_invoker = TRUE) AS
WITH pur AS (
  SELECT
    sio.tenant_id,
    sil.product_id,
    SUM(sal.arrived_qty - COALESCE(sal.returned_qty,0)) AS purchase_qty,
    SUM((sal.arrived_qty - COALESCE(sal.returned_qty,0)) * COALESCE(sil.rate,0)) AS purchase_amt
  FROM sell_in_arrived_lines sal
  JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
  JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND sil.invoice_type = 'purchase'
  GROUP BY sio.tenant_id, sil.product_id
),
ret AS (
  SELECT
    sio.tenant_id,
    sil.product_id,
    SUM(COALESCE(sal.returned_qty, 0)) AS pur_return_qty,
    SUM(COALESCE(sal.returned_qty, 0) * COALESCE(sil.rate, 0)) AS pur_return_amt
  FROM sell_in_arrived_lines sal
  JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
  JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
  JOIN products       p   ON p.id   = sil.product_id
  JOIN product_categories pc ON pc.id = p.category_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND pc.is_returnable = TRUE
    AND COALESCE(sal.returned_qty, 0) > 0
  GROUP BY sio.tenant_id, sil.product_id
),
sal AS (
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
sret AS (
  SELECT
    ir.tenant_id,
    p.id AS product_id,
    SUM(ir.returned_qty)                              AS sale_return_qty,
    SUM(ir.returned_qty * COALESCE(p.sale_rate, 0))   AS sale_return_amt
  FROM invoice_returns ir
  JOIN products p ON p.tenant_id = ir.tenant_id
    AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ir.product_name))
  JOIN product_categories pc ON pc.id = p.category_id
  WHERE pc.is_returnable = FALSE
  GROUP BY ir.tenant_id, p.id
),
all_products AS (
  SELECT tenant_id, product_id FROM pur
  UNION SELECT tenant_id, product_id FROM ret
  UNION SELECT tenant_id, product_id FROM sal
  UNION SELECT tenant_id, product_id FROM sret
)
SELECT
  ap.tenant_id,
  p.product_name,
  COALESCE(pur.purchase_qty,     0)                                   AS purchase_qty,
  COALESCE(pur.purchase_amt,     0)                                   AS purchase_amt,
  COALESCE(ret.pur_return_qty,   0)                                   AS pur_return_qty,
  COALESCE(ret.pur_return_amt,   0)                                   AS pur_return_amt,
  COALESCE(pur.purchase_qty,0) - COALESCE(ret.pur_return_qty,0)       AS net_pur_qty,
  COALESCE(pur.purchase_amt,0) - COALESCE(ret.pur_return_amt,0)       AS net_pur_amt,
  COALESCE(sal.sale_qty,         0)                                   AS sale_qty,
  COALESCE(sal.sale_amt,         0)                                   AS sale_amt,
  COALESCE(sret.sale_return_qty, 0)                                   AS sale_return_qty,
  COALESCE(sret.sale_return_amt, 0)                                   AS sale_return_amt,
  COALESCE(sal.sale_qty,0) - COALESCE(sret.sale_return_qty,0)         AS net_sale_qty,
  COALESCE(sal.sale_amt,0) - COALESCE(sret.sale_return_amt,0)         AS net_sale_amt
FROM all_products ap
JOIN products p ON p.id = ap.product_id AND p.tenant_id = ap.tenant_id
LEFT JOIN pur  ON pur.tenant_id  = ap.tenant_id AND pur.product_id  = ap.product_id
LEFT JOIN ret  ON ret.tenant_id  = ap.tenant_id AND ret.product_id  = ap.product_id
LEFT JOIN sal  ON sal.tenant_id  = ap.tenant_id AND sal.product_id  = ap.product_id
LEFT JOIN sret ON sret.tenant_id = ap.tenant_id AND sret.product_id = ap.product_id;


-- RPC: get_sale_purchase_filtered
CREATE OR REPLACE FUNCTION get_sale_purchase_filtered(
  p_date_from TEXT DEFAULT NULL,
  p_date_to   TEXT DEFAULT NULL
)
RETURNS TABLE (
  tenant_id       UUID,
  product_name    TEXT,
  purchase_qty    NUMERIC,
  purchase_amt    NUMERIC,
  pur_return_qty  NUMERIC,
  pur_return_amt  NUMERIC,
  net_pur_qty     NUMERIC,
  net_pur_amt     NUMERIC,
  sale_qty        NUMERIC,
  sale_amt        NUMERIC,
  sale_return_qty NUMERIC,
  sale_return_amt NUMERIC,
  net_sale_qty    NUMERIC,
  net_sale_amt    NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  v_tenant_id := current_tenant_id();

  RETURN QUERY
  WITH pur AS (
    SELECT
      sil.product_id,
      SUM(sal.arrived_qty - COALESCE(sal.returned_qty,0)) AS purchase_qty,
      SUM((sal.arrived_qty - COALESCE(sal.returned_qty,0)) * COALESCE(sil.rate,0)) AS purchase_amt
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    WHERE sio.tenant_id = v_tenant_id
      AND sio.status IN ('stock_arrived','on_credit','billed')
      AND sil.invoice_type = 'purchase'
      AND (p_date_from IS NULL OR sio.transaction_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR sio.transaction_date <= p_date_to::DATE)
    GROUP BY sil.product_id
  ),
  ret AS (
    SELECT
      sil.product_id,
      SUM(COALESCE(sal.returned_qty,0)) AS pur_return_qty,
      SUM(COALESCE(sal.returned_qty,0) * COALESCE(sil.rate,0)) AS pur_return_amt
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    JOIN products       p   ON p.id   = sil.product_id
    JOIN product_categories pc ON pc.id = p.category_id
    WHERE sio.tenant_id = v_tenant_id
      AND sio.status IN ('stock_arrived','on_credit','billed')
      AND pc.is_returnable = TRUE
      AND COALESCE(sal.returned_qty,0) > 0
      AND (p_date_from IS NULL OR sio.transaction_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR sio.transaction_date <= p_date_to::DATE)
    GROUP BY sil.product_id
  ),
  sal AS (
    SELECT
      ili.product_id,
      SUM(ili.quantity)    AS sale_qty,
      SUM(ili.line_amount) AS sale_amt
    FROM invoice_line_items ili
    JOIN invoices inv ON inv.id = ili.invoice_id
    WHERE ili.tenant_id = v_tenant_id
      AND inv.delivery_status = 'delivered'
      AND (p_date_from IS NULL OR inv.invoice_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR inv.invoice_date <= p_date_to::DATE)
    GROUP BY ili.product_id
  ),
  sret AS (
    SELECT
      p2.id AS product_id,
      SUM(ir.returned_qty) AS sale_return_qty,
      SUM(ir.returned_qty * COALESCE(p2.sale_rate,0)) AS sale_return_amt
    FROM invoice_returns ir
    JOIN products p2 ON p2.tenant_id = v_tenant_id
      AND LOWER(TRIM(p2.product_name)) = LOWER(TRIM(ir.product_name))
    JOIN product_categories pc ON pc.id = p2.category_id
    WHERE ir.tenant_id = v_tenant_id
      AND pc.is_returnable = FALSE
      AND (p_date_from IS NULL OR ir.return_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR ir.return_date <= p_date_to::DATE)
    GROUP BY p2.id
  ),
  all_products AS (
    SELECT product_id FROM pur
    UNION SELECT product_id FROM ret
    UNION SELECT product_id FROM sal
    UNION SELECT product_id FROM sret
  )
  SELECT
    v_tenant_id,
    p.product_name,
    COALESCE(pur.purchase_qty,0)::NUMERIC,
    COALESCE(pur.purchase_amt,0)::NUMERIC,
    COALESCE(ret.pur_return_qty,0)::NUMERIC,
    COALESCE(ret.pur_return_amt,0)::NUMERIC,
    (COALESCE(pur.purchase_qty,0) - COALESCE(ret.pur_return_qty,0))::NUMERIC,
    (COALESCE(pur.purchase_amt,0) - COALESCE(ret.pur_return_amt,0))::NUMERIC,
    COALESCE(sal.sale_qty,0)::NUMERIC,
    COALESCE(sal.sale_amt,0)::NUMERIC,
    COALESCE(sret.sale_return_qty,0)::NUMERIC,
    COALESCE(sret.sale_return_amt,0)::NUMERIC,
    (COALESCE(sal.sale_qty,0) - COALESCE(sret.sale_return_qty,0))::NUMERIC,
    (COALESCE(sal.sale_amt,0) - COALESCE(sret.sale_return_amt,0))::NUMERIC
  FROM all_products ap
  JOIN products p ON p.id = ap.product_id AND p.tenant_id = v_tenant_id
  LEFT JOIN pur  ON pur.product_id  = ap.product_id
  LEFT JOIN ret  ON ret.product_id  = ap.product_id
  LEFT JOIN sal  ON sal.product_id  = ap.product_id
  LEFT JOIN sret ON sret.product_id = ap.product_id
  ORDER BY p.product_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sale_purchase_filtered(TEXT, TEXT) TO authenticated;


-- ============================================================================
-- FIX 30 — EMPTY LEDGER VIEW
-- ============================================================================

DROP VIEW IF EXISTS empty_ledger_view CASCADE;
CREATE OR REPLACE VIEW empty_ledger_view WITH (security_invoker = TRUE) AS
SELECT
  ir.tenant_id,
  ir.return_date                                                    AS date,
  ir.product_name,
  'Shop -> Distribution'::TEXT                                      AS direction_label,
  'shop_to_distribution'::TEXT                                      AS direction,
  COALESCE(inv.invoice_no, ir.invoice_id::TEXT)                     AS reference,
  ir.returned_qty::NUMERIC                                          AS signed_quantity,
  ir.returned_qty::NUMERIC                                          AS quantity,
  ir.id                                                             AS event_id,
  ir.created_at                                                     AS event_ts
FROM invoice_returns ir
JOIN invoices inv ON inv.id = ir.invoice_id
JOIN products p   ON p.tenant_id = ir.tenant_id
  AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ir.product_name))
JOIN product_categories pc ON pc.id = p.category_id
WHERE pc.is_returnable = TRUE

UNION ALL

SELECT
  sio.tenant_id,
  sio.transaction_date                                              AS date,
  p.product_name,
  'Distribution -> CCBPL'::TEXT                                     AS direction_label,
  'distribution_to_ccbpl'::TEXT                                     AS direction,
  COALESCE(sio.po_no, sio.id::TEXT)                                 AS reference,
  -(sal.returned_qty::NUMERIC)                                      AS signed_quantity,
  sal.returned_qty::NUMERIC                                         AS quantity,
  sal.id                                                            AS event_id,
  sal.created_at                                                    AS event_ts
FROM sell_in_arrived_lines sal
JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
JOIN products       p   ON p.id   = sil.product_id
JOIN product_categories pc ON pc.id = p.category_id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  AND pc.is_returnable = TRUE
  AND COALESCE(sal.returned_qty, 0) > 0;


-- ============================================================================
-- FIX 31 — EMPTY BALANCE VIEW (no deposit_total)
-- ============================================================================

DROP VIEW IF EXISTS empty_balance_view CASCADE;
CREATE OR REPLACE VIEW empty_balance_view WITH (security_invoker = TRUE) AS
WITH shop_to_dist AS (
  SELECT ir.tenant_id, ir.product_name, SUM(ir.returned_qty) AS qty_in
  FROM invoice_returns ir
  JOIN products p ON p.tenant_id = ir.tenant_id
    AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(ir.product_name))
  JOIN product_categories pc ON pc.id = p.category_id
  WHERE pc.is_returnable = TRUE
  GROUP BY ir.tenant_id, ir.product_name
),
dist_to_ccbpl AS (
  SELECT sio.tenant_id, p.product_name, SUM(COALESCE(sal.returned_qty,0)) AS qty_out
  FROM sell_in_arrived_lines sal
  JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
  JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
  JOIN products       p   ON p.id   = sil.product_id
  JOIN product_categories pc ON pc.id = p.category_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND pc.is_returnable = TRUE
    AND COALESCE(sal.returned_qty, 0) > 0
  GROUP BY sio.tenant_id, p.product_name
),
all_products AS (
  SELECT tenant_id, product_name FROM shop_to_dist
  UNION SELECT tenant_id, product_name FROM dist_to_ccbpl
)
SELECT
  ap.tenant_id,
  ap.product_name,
  COALESCE(s.qty_in, 0) - COALESCE(d.qty_out, 0) AS current_balance
FROM all_products ap
LEFT JOIN shop_to_dist  s ON s.tenant_id = ap.tenant_id AND s.product_name = ap.product_name
LEFT JOIN dist_to_ccbpl d ON d.tenant_id = ap.tenant_id AND d.product_name = ap.product_name;


-- ============================================================================
-- FIX 32 — STOCK DISCREPANCIES VIEW
-- ============================================================================

DROP VIEW IF EXISTS stock_discrepancies_view CASCADE;
CREATE OR REPLACE VIEW stock_discrepancies_view WITH (security_invoker = TRUE) AS
SELECT
  sd.id,
  sd.tenant_id,
  sd.audit_id,
  sd.product_name,
  COALESCE(sa.audit_date, sd.audit_date, CURRENT_DATE)              AS audit_date,
  sd.status,
  sd.reason,
  sd.created_at,
  sd.physical_qty,
  COALESCE((
    SELECT
      COALESCE(SUM(sal.arrived_qty - COALESCE(sal.returned_qty,0)),0)
      - COALESCE((
          SELECT SUM(ili2.quantity) FROM invoice_line_items ili2
          JOIN invoices inv2 ON inv2.id = ili2.invoice_id
          JOIN products p2   ON p2.id   = ili2.product_id
          WHERE p2.tenant_id    = sd.tenant_id
            AND LOWER(TRIM(p2.product_name)) = LOWER(TRIM(sd.product_name))
            AND inv2.delivery_status = 'delivered'
            AND inv2.invoice_date <= COALESCE(sa.audit_date, sd.audit_date, CURRENT_DATE)
        ),0)
      + COALESCE((
          SELECT SUM(ir.returned_qty) FROM invoice_returns ir
          JOIN products p3 ON p3.tenant_id = ir.tenant_id
            AND LOWER(TRIM(p3.product_name)) = LOWER(TRIM(ir.product_name))
          JOIN product_categories pc3 ON pc3.id = p3.category_id
          WHERE ir.tenant_id    = sd.tenant_id
            AND LOWER(TRIM(p3.product_name)) = LOWER(TRIM(sd.product_name))
            AND pc3.is_returnable = TRUE
            AND ir.return_date <= COALESCE(sa.audit_date, sd.audit_date, CURRENT_DATE)
        ),0)
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    JOIN products       p   ON p.id   = sil.product_id
    WHERE p.tenant_id     = sd.tenant_id
      AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(sd.product_name))
      AND sio.status IN ('stock_arrived','on_credit','billed')
      AND sil.invoice_type = 'purchase'
      AND sio.transaction_date <= COALESCE(sa.audit_date, sd.audit_date, CURRENT_DATE)
  ),0) AS system_qty,
  sd.physical_qty - COALESCE((
    SELECT
      COALESCE(SUM(sal.arrived_qty - COALESCE(sal.returned_qty,0)),0)
      - COALESCE((
          SELECT SUM(ili2.quantity) FROM invoice_line_items ili2
          JOIN invoices inv2 ON inv2.id = ili2.invoice_id
          JOIN products p2   ON p2.id   = ili2.product_id
          WHERE p2.tenant_id    = sd.tenant_id
            AND LOWER(TRIM(p2.product_name)) = LOWER(TRIM(sd.product_name))
            AND inv2.delivery_status = 'delivered'
            AND inv2.invoice_date <= COALESCE(sa.audit_date, sd.audit_date, CURRENT_DATE)
        ),0)
      + COALESCE((
          SELECT SUM(ir.returned_qty) FROM invoice_returns ir
          JOIN products p3 ON p3.tenant_id = ir.tenant_id
            AND LOWER(TRIM(p3.product_name)) = LOWER(TRIM(ir.product_name))
          JOIN product_categories pc3 ON pc3.id = p3.category_id
          WHERE ir.tenant_id    = sd.tenant_id
            AND LOWER(TRIM(p3.product_name)) = LOWER(TRIM(sd.product_name))
            AND pc3.is_returnable = TRUE
            AND ir.return_date <= COALESCE(sa.audit_date, sd.audit_date, CURRENT_DATE)
        ),0)
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    JOIN products       p   ON p.id   = sil.product_id
    WHERE p.tenant_id     = sd.tenant_id
      AND LOWER(TRIM(p.product_name)) = LOWER(TRIM(sd.product_name))
      AND sio.status IN ('stock_arrived','on_credit','billed')
      AND sil.invoice_type = 'purchase'
      AND sio.transaction_date <= COALESCE(sa.audit_date, sd.audit_date, CURRENT_DATE)
  ),0) AS diff
FROM stock_discrepancies sd
LEFT JOIN stock_audits sa ON sa.id = sd.audit_id;

-- ============================================================================
-- END MDOS v21
-- ============================================================================
