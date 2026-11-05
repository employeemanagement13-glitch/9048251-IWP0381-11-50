-- Migration v34: Fix Stock Reports (Balance By Level Total IN, Sale/Purchase Summary, Empty Ledger 4 Directions)

-- ============================================================================
-- 1. stock_balance_by_level VIEW & get_stock_balance_filtered RPC
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
    SUM(COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)) AS qty_in
  FROM sell_in_lines sil
  LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
  JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
  JOIN products p ON p.id = sil.product_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
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
  WHERE (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
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

DROP FUNCTION IF EXISTS get_stock_balance_filtered(TEXT, TEXT);

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
      SUM(COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)) AS qty_in
    FROM sell_in_lines sil
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    JOIN products       p   ON p.id   = sil.product_id
    WHERE sio.tenant_id = v_tenant_id
      AND sio.status IN ('stock_arrived', 'on_credit', 'billed')
      AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
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
      AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
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
    v_tenant_id AS tenant_id,
    COALESCE(pm.product_name, INITCAP(an.norm_name)) AS product_name,
    COALESCE(pm.packing_qty, 1)::NUMERIC AS packing_qty,
    COALESCE(ins.qty_in, 0)::NUMERIC AS total_qty_in,
    (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0))::NUMERIC AS total_qty_out,
    (COALESCE(ins.qty_in, 0) - (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0)))::NUMERIC AS net_balance
  FROM all_names an
  LEFT JOIN prod_meta pm   ON pm.norm_name = an.norm_name
  LEFT JOIN ins            ON ins.norm_name = an.norm_name
  LEFT JOIN outs_gross og  ON og.norm_name  = an.norm_name
  LEFT JOIN returns_deduct rd ON rd.norm_name = an.norm_name
  ORDER BY product_name;
END;
$$;


-- ============================================================================
-- 2. sale_purchase_summary VIEW & get_sale_purchase_filtered RPC
-- ============================================================================

DROP VIEW IF EXISTS sale_purchase_summary CASCADE;

CREATE OR REPLACE VIEW sale_purchase_summary WITH (security_invoker = TRUE) AS
WITH pd AS (
  SELECT DISTINCT ON (p.tenant_id, LOWER(TRIM(p.product_name)))
    p.id                                               AS product_id,
    p.tenant_id,
    p.product_name,
    LOWER(TRIM(p.product_name))                        AS norm_name,
    COALESCE(
      NULLIF(p.sale_rate, 0),
      (
        SELECT (ili_fb.line_amount / NULLIF(ili_fb.quantity, 0))
        FROM invoice_line_items ili_fb
        JOIN products p_fb ON p_fb.id = ili_fb.product_id
        WHERE p_fb.tenant_id = p.tenant_id
          AND LOWER(TRIM(p_fb.product_name)) = LOWER(TRIM(p.product_name))
          AND ili_fb.quantity > 0
        ORDER BY ili_fb.created_at DESC
        LIMIT 1
      ),
      0
    )                                                  AS sale_rate,
    COALESCE(p.purchase_rate, 0)                       AS purchase_rate,
    (
      COALESCE(pc.is_returnable, FALSE) = TRUE
      OR COALESCE(p.is_returnable, FALSE) = TRUE
      OR LOWER(TRIM(p.product_name)) LIKE '%rgb%'
      OR LOWER(TRIM(p.product_name)) LIKE '%pallet%'
      OR LOWER(TRIM(p.product_name)) LIKE '%shell%'
      OR LOWER(TRIM(p.product_name)) LIKE '%sheet%'
      OR LOWER(TRIM(p.product_name)) LIKE '%empties%'
      OR LOWER(TRIM(p.product_name)) LIKE '%crate%'
    )                                                  AS is_returnable,
    (
      COALESCE(pc.is_rgb, FALSE) = TRUE
      OR LOWER(TRIM(p.product_name)) LIKE '%rgb%'
    )                                                  AS is_rgb
  FROM products p
  LEFT JOIN product_categories pc ON pc.id = p.category_id
  ORDER BY p.tenant_id, LOWER(TRIM(p.product_name)), p.created_at DESC
),
pur AS (
  SELECT
    sio.tenant_id,
    LOWER(TRIM(p.product_name))                        AS norm_name,
    SUM(COALESCE(sal.arrived_qty, sil.qty))            AS purchase_qty,
    SUM(COALESCE(sal.arrived_qty, sil.qty) * COALESCE(sil.rate, 0)) AS purchase_amt
  FROM sell_in_lines sil
  LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
  JOIN sell_in_orders sio ON sio.id  = sil.sell_in_order_id
  JOIN products       p   ON p.id    = sil.product_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
  GROUP BY sio.tenant_id, LOWER(TRIM(p.product_name))
),
ret AS (
  SELECT
    sio.tenant_id,
    LOWER(TRIM(p.product_name))                        AS norm_name,
    SUM(
      COALESCE(sre.returned_qty, sal.returned_qty, CASE WHEN sil.invoice_type = 'return' THEN ABS(sil.qty) ELSE 0 END)
    )                                                  AS pur_return_qty,
    SUM(
      CASE
        WHEN pd.is_rgb = TRUE
          THEN COALESCE(
            NULLIF(sre.returned_amt, 0),
            NULLIF(sal.returned_amt, 0),
            COALESCE(sre.returned_qty, sal.returned_qty, CASE WHEN sil.invoice_type = 'return' THEN ABS(sil.qty) ELSE 0 END) * COALESCE(pd.purchase_rate, 0),
            0
          )
        ELSE
          COALESCE(sre.returned_qty, sal.returned_qty, CASE WHEN sil.invoice_type = 'return' THEN ABS(sil.qty) ELSE 0 END) * COALESCE(pd.purchase_rate, 0)
      END
    )                                                  AS pur_return_amt
  FROM sell_in_lines sil
  LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
  LEFT JOIN sell_in_return_entries sre ON sre.sell_in_line_id = sil.id
  JOIN sell_in_orders sio ON sio.id  = sil.sell_in_order_id
  JOIN products       p   ON p.id    = sil.product_id
  JOIN pd ON pd.tenant_id = sio.tenant_id AND pd.norm_name = LOWER(TRIM(p.product_name))
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND pd.is_returnable = TRUE
    AND (
      COALESCE(sre.returned_qty, sal.returned_qty, 0) > 0
      OR sil.invoice_type = 'return'
    )
  GROUP BY sio.tenant_id, LOWER(TRIM(p.product_name))
),
sal AS (
  SELECT
    ili.tenant_id,
    LOWER(TRIM(p.product_name))                        AS norm_name,
    SUM(ili.quantity)                                  AS sale_qty
  FROM invoice_line_items ili
  JOIN invoices inv ON inv.id = ili.invoice_id
  JOIN products p   ON p.id   = ili.product_id
  WHERE (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
  GROUP BY ili.tenant_id, LOWER(TRIM(p.product_name))
),
sret AS (
  SELECT
    ir.tenant_id,
    LOWER(TRIM(ir.product_name))                       AS norm_name,
    SUM(ir.returned_qty)                               AS sale_return_qty
  FROM invoice_returns ir
  JOIN pd ON pd.tenant_id = ir.tenant_id AND pd.norm_name = LOWER(TRIM(ir.product_name))
  WHERE pd.is_returnable = FALSE
    AND pd.is_rgb = FALSE
    AND ir.returned_qty > 0
  GROUP BY ir.tenant_id, LOWER(TRIM(ir.product_name))
),
all_names AS (
  SELECT tenant_id, norm_name FROM pur
  UNION SELECT tenant_id, norm_name FROM ret
  UNION SELECT tenant_id, norm_name FROM sal
  UNION SELECT tenant_id, norm_name FROM sret
)
SELECT
  an.tenant_id,
  pd.product_name,
  COALESCE(pur.purchase_qty,    0)::NUMERIC                      AS purchase_qty,
  COALESCE(pur.purchase_amt,    0)::NUMERIC                      AS purchase_amt,
  COALESCE(ret.pur_return_qty,  0)::NUMERIC                      AS pur_return_qty,
  COALESCE(ret.pur_return_amt,  0)::NUMERIC                      AS pur_return_amt,
  (COALESCE(pur.purchase_qty,0) - COALESCE(ret.pur_return_qty,0))::NUMERIC AS net_pur_qty,
  (COALESCE(pur.purchase_amt,0) - COALESCE(ret.pur_return_amt,0))::NUMERIC AS net_pur_amt,
  COALESCE(sal.sale_qty,        0)::NUMERIC                      AS sale_qty,
  (COALESCE(sal.sale_qty, 0) * pd.sale_rate)::NUMERIC            AS sale_amt,
  COALESCE(sret.sale_return_qty,0)::NUMERIC                      AS sale_return_qty,
  (COALESCE(sret.sale_return_qty, 0) * pd.sale_rate)::NUMERIC    AS sale_return_amt,
  (COALESCE(sal.sale_qty,0) - COALESCE(sret.sale_return_qty,0))::NUMERIC  AS net_sale_qty,
  ((COALESCE(sal.sale_qty, 0) * pd.sale_rate) - (COALESCE(sret.sale_return_qty, 0) * pd.sale_rate))::NUMERIC AS net_sale_amt
FROM all_names an
JOIN pd ON pd.tenant_id = an.tenant_id AND pd.norm_name = an.norm_name
LEFT JOIN pur  ON pur.tenant_id  = an.tenant_id AND pur.norm_name  = an.norm_name
LEFT JOIN ret  ON ret.tenant_id  = an.tenant_id AND ret.norm_name  = an.norm_name
LEFT JOIN sal  ON sal.tenant_id  = an.tenant_id AND sal.norm_name  = an.norm_name
LEFT JOIN sret ON sret.tenant_id = an.tenant_id AND sret.norm_name = an.norm_name;

DROP FUNCTION IF EXISTS get_sale_purchase_filtered(TEXT, TEXT);

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
  WITH pd AS (
    SELECT DISTINCT ON (p.tenant_id, LOWER(TRIM(p.product_name)))
      p.id                                               AS product_id,
      p.tenant_id,
      p.product_name,
      LOWER(TRIM(p.product_name))                        AS norm_name,
      COALESCE(
        NULLIF(p.sale_rate, 0),
        (
          SELECT (ili_fb.line_amount / NULLIF(ili_fb.quantity, 0))
          FROM invoice_line_items ili_fb
          JOIN products p_fb ON p_fb.id = ili_fb.product_id
          WHERE p_fb.tenant_id = p.tenant_id
            AND LOWER(TRIM(p_fb.product_name)) = LOWER(TRIM(p.product_name))
            AND ili_fb.quantity > 0
          ORDER BY ili_fb.created_at DESC
          LIMIT 1
        ),
        0
      )                                                  AS sale_rate,
      COALESCE(p.purchase_rate, 0)                       AS purchase_rate,
      (
        COALESCE(pc.is_returnable, FALSE) = TRUE
        OR COALESCE(p.is_returnable, FALSE) = TRUE
        OR LOWER(TRIM(p.product_name)) LIKE '%rgb%'
        OR LOWER(TRIM(p.product_name)) LIKE '%pallet%'
        OR LOWER(TRIM(p.product_name)) LIKE '%shell%'
        OR LOWER(TRIM(p.product_name)) LIKE '%sheet%'
        OR LOWER(TRIM(p.product_name)) LIKE '%empties%'
        OR LOWER(TRIM(p.product_name)) LIKE '%crate%'
      )                                                  AS is_returnable,
      (
        COALESCE(pc.is_rgb, FALSE) = TRUE
        OR LOWER(TRIM(p.product_name)) LIKE '%rgb%'
      )                                                  AS is_rgb
    FROM products p
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    WHERE p.tenant_id = v_tenant_id
    ORDER BY p.tenant_id, LOWER(TRIM(p.product_name)), p.created_at DESC
  ),
  pur AS (
    SELECT
      LOWER(TRIM(p.product_name))                        AS norm_name,
      SUM(COALESCE(sal.arrived_qty, sil.qty))            AS purchase_qty,
      SUM(COALESCE(sal.arrived_qty, sil.qty) * COALESCE(sil.rate, 0)) AS purchase_amt
    FROM sell_in_lines sil
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN sell_in_orders sio ON sio.id  = sil.sell_in_order_id
    JOIN products       p   ON p.id    = sil.product_id
    WHERE sio.tenant_id = v_tenant_id
      AND sio.status IN ('stock_arrived', 'on_credit', 'billed')
      AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
      AND (p_date_from IS NULL OR sio.transaction_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR sio.transaction_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(p.product_name))
  ),
  ret AS (
    SELECT
      LOWER(TRIM(p.product_name))                        AS norm_name,
      SUM(
        COALESCE(sre.returned_qty, sal.returned_qty, CASE WHEN sil.invoice_type = 'return' THEN ABS(sil.qty) ELSE 0 END)
      )                                                  AS pur_return_qty,
      SUM(
        CASE
          WHEN pd.is_rgb = TRUE
            THEN COALESCE(
              NULLIF(sre.returned_amt, 0),
              NULLIF(sal.returned_amt, 0),
              COALESCE(sre.returned_qty, sal.returned_qty, CASE WHEN sil.invoice_type = 'return' THEN ABS(sil.qty) ELSE 0 END) * COALESCE(pd.purchase_rate, 0),
              0
            )
          ELSE
            COALESCE(sre.returned_qty, sal.returned_qty, CASE WHEN sil.invoice_type = 'return' THEN ABS(sil.qty) ELSE 0 END) * COALESCE(pd.purchase_rate, 0)
        END
      )                                                  AS pur_return_amt
    FROM sell_in_lines sil
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    LEFT JOIN sell_in_return_entries sre ON sre.sell_in_line_id = sil.id
    JOIN sell_in_orders sio ON sio.id  = sil.sell_in_order_id
    JOIN products       p   ON p.id    = sil.product_id
    JOIN pd ON pd.norm_name = LOWER(TRIM(p.product_name))
    WHERE sio.tenant_id = v_tenant_id
      AND sio.status IN ('stock_arrived', 'on_credit', 'billed')
      AND pd.is_returnable = TRUE
      AND (
        COALESCE(sre.returned_qty, sal.returned_qty, 0) > 0
        OR sil.invoice_type = 'return'
      )
      AND (p_date_from IS NULL OR COALESCE(sre.return_date, sio.transaction_date) >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR COALESCE(sre.return_date, sio.transaction_date) <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(p.product_name))
  ),
  sal AS (
    SELECT
      LOWER(TRIM(p.product_name))                        AS norm_name,
      SUM(ili.quantity)                                  AS sale_qty
    FROM invoice_line_items ili
    JOIN invoices inv ON inv.id = ili.invoice_id
    JOIN products p   ON p.id   = ili.product_id
    WHERE ili.tenant_id = v_tenant_id
      AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
      AND (p_date_from IS NULL OR inv.invoice_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR inv.invoice_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(p.product_name))
  ),
  sret AS (
    SELECT
      LOWER(TRIM(ir.product_name))                       AS norm_name,
      SUM(ir.returned_qty)                               AS sale_return_qty
    FROM invoice_returns ir
    JOIN pd ON pd.norm_name = LOWER(TRIM(ir.product_name))
    WHERE ir.tenant_id = v_tenant_id
      AND pd.is_returnable = FALSE
      AND pd.is_rgb = FALSE
      AND ir.returned_qty > 0
      AND (p_date_from IS NULL OR ir.return_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR ir.return_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(ir.product_name))
  ),
  all_names AS (
    SELECT norm_name FROM pur
    UNION SELECT norm_name FROM ret
    UNION SELECT norm_name FROM sal
    UNION SELECT norm_name FROM sret
  )
  SELECT
    v_tenant_id AS tenant_id,
    pd.product_name,
    COALESCE(pur.purchase_qty,    0)::NUMERIC                      AS purchase_qty,
    COALESCE(pur.purchase_amt,    0)::NUMERIC                      AS purchase_amt,
    COALESCE(ret.pur_return_qty,  0)::NUMERIC                      AS pur_return_qty,
    COALESCE(ret.pur_return_amt,  0)::NUMERIC                      AS pur_return_amt,
    (COALESCE(pur.purchase_qty,0) - COALESCE(ret.pur_return_qty,0))::NUMERIC AS net_pur_qty,
    (COALESCE(pur.purchase_amt,0) - COALESCE(ret.pur_return_amt,0))::NUMERIC AS net_pur_amt,
    COALESCE(sal.sale_qty,        0)::NUMERIC                      AS sale_qty,
    (COALESCE(sal.sale_qty, 0) * pd.sale_rate)::NUMERIC            AS sale_amt,
    COALESCE(sret.sale_return_qty,0)::NUMERIC                      AS sale_return_qty,
    (COALESCE(sret.sale_return_qty, 0) * pd.sale_rate)::NUMERIC    AS sale_return_amt,
    (COALESCE(sal.sale_qty,0) - COALESCE(sret.sale_return_qty,0))::NUMERIC  AS net_sale_qty,
    ((COALESCE(sal.sale_qty, 0) * pd.sale_rate) - (COALESCE(sret.sale_return_qty, 0) * pd.sale_rate))::NUMERIC AS net_sale_amt
  FROM all_names an
  JOIN pd ON pd.norm_name = an.norm_name
  LEFT JOIN pur  ON pur.norm_name  = an.norm_name
  LEFT JOIN ret  ON ret.norm_name  = an.norm_name
  LEFT JOIN sal  ON sal.norm_name  = an.norm_name
  LEFT JOIN sret ON sret.norm_name = an.norm_name
  ORDER BY pd.product_name;
END;
$$;


-- ============================================================================
-- 3. empty_ledger_view, empty_ledger_with_balance & get_empty_ledger RPC
-- ============================================================================

DROP VIEW IF EXISTS empty_ledger_with_balance CASCADE;
DROP VIEW IF EXISTS empty_ledger_view CASCADE;

CREATE OR REPLACE VIEW empty_ledger_view WITH (security_invoker = TRUE) AS

-- 1. CCBPL → Distribution (+Arrived Qty from POs)
SELECT
  sil.tenant_id,
  sio.transaction_date                                             AS date,
  p.product_name                                                   AS product_name,
  p.id                                                             AS product_id,
  'CCBPL → Distribution'::TEXT                                     AS direction,
  COALESCE(sio.po_no, 'PO-' || SUBSTRING(sio.id::TEXT, 1, 6))       AS reference,
  'po'::TEXT                                                       AS source_type,
  COALESCE(sio.po_no, '')                                          AS source_ref,
  COALESCE(sal.arrived_qty, sil.qty)                               AS qty,
  COALESCE(sal.id, sil.id)                                         AS event_id,
  COALESCE(sal.created_at, sil.created_at)                         AS event_ts
FROM sell_in_lines sil
LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
JOIN products       p   ON p.id   = sil.product_id
LEFT JOIN product_categories pc ON pc.id = p.category_id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  AND (sil.invoice_type IS NULL OR sil.invoice_type = 'purchase')
  AND (COALESCE(pc.is_returnable, p.is_returnable, FALSE) = TRUE
       OR COALESCE(pc.is_rgb, FALSE) = TRUE
       OR LOWER(TRIM(p.product_name)) LIKE '%rgb%'
       OR LOWER(TRIM(p.product_name)) LIKE '%pallet%'
       OR LOWER(TRIM(p.product_name)) LIKE '%shell%'
       OR LOWER(TRIM(p.product_name)) LIKE '%sheet%'
       OR LOWER(TRIM(p.product_name)) LIKE '%empties%'
       OR LOWER(TRIM(p.product_name)) LIKE '%crate%')
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
       OR LOWER(TRIM(p.product_name)) LIKE '%rgb%'
       OR LOWER(TRIM(p.product_name)) LIKE '%pallet%'
       OR LOWER(TRIM(p.product_name)) LIKE '%shell%'
       OR LOWER(TRIM(p.product_name)) LIKE '%sheet%'
       OR LOWER(TRIM(p.product_name)) LIKE '%empties%'
       OR LOWER(TRIM(p.product_name)) LIKE '%crate%')
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

-- 4. Distribution → CCBPL (-Returned Qty from sell_in_return_entries and sell_in_arrived_lines)
SELECT
  sil.tenant_id,
  COALESCE(sre.return_date, sio.transaction_date)                 AS date,
  p.product_name                                                   AS product_name,
  p.id                                                             AS product_id,
  'Distribution → CCBPL'::TEXT                                     AS direction,
  COALESCE(sio.po_no, 'PO-' || SUBSTRING(sio.id::TEXT, 1, 6))       AS reference,
  'po'::TEXT                                                       AS source_type,
  COALESCE(sio.po_no, '')                                          AS source_ref,
  COALESCE(sre.returned_qty, sal.returned_qty, 0)                 AS qty,
  COALESCE(sre.id, sal.id, sil.id)                                 AS event_id,
  COALESCE(sre.created_at, sal.created_at, sil.created_at)         AS event_ts
FROM sell_in_lines sil
LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
LEFT JOIN sell_in_return_entries sre ON sre.sell_in_line_id = sil.id
JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
JOIN products       p   ON p.id   = sil.product_id
WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
  AND COALESCE(sre.returned_qty, sal.returned_qty, 0) > 0;


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
