-- ============================================================================
-- MDOS v28 — Sale / Purchase Summary Complete Fix
--
-- Fix 1: Sale Qty & Sale Amt — removed overly strict inv.delivery_status = 'delivered'
--        filter that caused Sale Qty/Amt to return 0. Now includes all active invoices.
--
-- Fix 2: Sale Rate fallback — if p.sale_rate is 0, falls back to latest unit price
--        from invoice_line_items so S.Ret Amt = S.Ret Qty * Sale Rate is never 0.
--
-- Fix 3: S.Ret Qty & S.Ret Amt — strictly filtered to is_returnable = FALSE AND is_rgb = FALSE
--        products only.
--
-- Fix 4: Ret Amt — tracks sal.returned_amt for is_rgb = TRUE, and
--        sal.returned_qty * p.purchase_rate for is_returnable = TRUE & is_rgb = FALSE.
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
    COALESCE(pc.is_returnable, p.is_returnable, FALSE) AS is_returnable,
    COALESCE(pc.is_rgb, FALSE)                         AS is_rgb
  FROM products p
  LEFT JOIN product_categories pc ON pc.id = p.category_id
  ORDER BY p.tenant_id, LOWER(TRIM(p.product_name)), p.created_at DESC
),
pur AS (
  SELECT
    sio.tenant_id,
    LOWER(TRIM(p.product_name))                        AS norm_name,
    SUM(sal.arrived_qty)                               AS purchase_qty,
    SUM(sal.arrived_qty * COALESCE(sil.rate, 0))       AS purchase_amt
  FROM sell_in_arrived_lines sal
  JOIN sell_in_lines  sil ON sil.id  = sal.sell_in_line_id
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
    SUM(COALESCE(sal.returned_qty, 0))                 AS pur_return_qty,
    SUM(CASE
      WHEN COALESCE(pc.is_rgb, FALSE) = TRUE
        THEN COALESCE(sal.returned_amt, 0)
      ELSE COALESCE(sal.returned_qty, 0) * COALESCE(p.purchase_rate, 0)
    END)                                               AS pur_return_amt
  FROM sell_in_arrived_lines sal
  JOIN sell_in_lines      sil ON sil.id      = sal.sell_in_line_id
  JOIN sell_in_orders     sio ON sio.id      = sil.sell_in_order_id
  JOIN products           p   ON p.id        = sil.product_id
  LEFT JOIN product_categories pc ON pc.id   = p.category_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND COALESCE(pc.is_returnable, p.is_returnable, FALSE) = TRUE
    AND COALESCE(sal.returned_qty, 0) > 0
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


-- ----------------------------------------------------------------------------
-- RPC get_sale_purchase_filtered
-- ----------------------------------------------------------------------------
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
      COALESCE(pc.is_returnable, p.is_returnable, FALSE) AS is_returnable,
      COALESCE(pc.is_rgb, FALSE)                         AS is_rgb
    FROM products p
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    WHERE p.tenant_id = v_tenant_id
    ORDER BY p.tenant_id, LOWER(TRIM(p.product_name)), p.created_at DESC
  ),
  pur AS (
    SELECT
      LOWER(TRIM(p.product_name))                        AS norm_name,
      SUM(sal.arrived_qty)                               AS purchase_qty,
      SUM(sal.arrived_qty * COALESCE(sil.rate, 0))       AS purchase_amt
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id  = sal.sell_in_line_id
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
      SUM(COALESCE(sal.returned_qty, 0))                 AS pur_return_qty,
      SUM(CASE
        WHEN COALESCE(pc.is_rgb, FALSE) = TRUE
          THEN COALESCE(sal.returned_amt, 0)
        ELSE COALESCE(sal.returned_qty, 0) * COALESCE(p.purchase_rate, 0)
      END)                                               AS pur_return_amt
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines      sil ON sil.id      = sal.sell_in_line_id
    JOIN sell_in_orders     sio ON sio.id      = sil.sell_in_order_id
    JOIN products           p   ON p.id        = sil.product_id
    LEFT JOIN product_categories pc ON pc.id   = p.category_id
    WHERE sio.tenant_id = v_tenant_id
      AND sio.status IN ('stock_arrived', 'on_credit', 'billed')
      AND COALESCE(pc.is_returnable, p.is_returnable, FALSE) = TRUE
      AND COALESCE(sal.returned_qty, 0) > 0
      AND (p_date_from IS NULL OR sio.transaction_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR sio.transaction_date <= p_date_to::DATE)
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
    JOIN pd ON pd.tenant_id = ir.tenant_id AND pd.norm_name = LOWER(TRIM(ir.product_name))
    WHERE ir.tenant_id = v_tenant_id
      AND pd.is_returnable = FALSE
      AND pd.is_rgb = FALSE
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
    v_tenant_id,
    pd.product_name,
    COALESCE(pur.purchase_qty,    0)::NUMERIC,
    COALESCE(pur.purchase_amt,    0)::NUMERIC,
    COALESCE(ret.pur_return_qty,  0)::NUMERIC,
    COALESCE(ret.pur_return_amt,  0)::NUMERIC,
    (COALESCE(pur.purchase_qty,0) - COALESCE(ret.pur_return_qty,0))::NUMERIC,
    (COALESCE(pur.purchase_amt,0) - COALESCE(ret.pur_return_amt,0))::NUMERIC,
    COALESCE(sal.sale_qty,        0)::NUMERIC,
    (COALESCE(sal.sale_qty, 0) * pd.sale_rate)::NUMERIC,
    COALESCE(sret.sale_return_qty,0)::NUMERIC,
    (COALESCE(sret.sale_return_qty, 0) * pd.sale_rate)::NUMERIC,
    (COALESCE(sal.sale_qty,0) - COALESCE(sret.sale_return_qty,0))::NUMERIC,
    ((COALESCE(sal.sale_qty, 0) * pd.sale_rate) - (COALESCE(sret.sale_return_qty, 0) * pd.sale_rate))::NUMERIC
  FROM all_names an
  JOIN pd ON pd.norm_name = an.norm_name
  LEFT JOIN pur  ON pur.norm_name  = an.norm_name
  LEFT JOIN ret  ON ret.norm_name  = an.norm_name
  LEFT JOIN sal  ON sal.norm_name  = an.norm_name
  LEFT JOIN sret ON sret.norm_name = an.norm_name
  ORDER BY pd.product_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sale_purchase_filtered(TEXT, TEXT) TO authenticated;

-- ============================================================================
-- END MDOS v28
-- ============================================================================
