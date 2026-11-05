-- ============================================================================
-- MDOS v25 — Sale / Purchase Summary Fix
--
-- Fix A: pur CTE — purchase_qty/amt changed to GROSS arrived_qty (not net),
--        so net_pur = purchase - ret_qty is not double-subtracted.
--
-- Fix B: ret CTE — is_returnable check uses COALESCE(pc.is_returnable, p.is_returnable)
--        so products without category_id are not silently excluded.
--        Ret Amt: is_rgb=TRUE → qty * sil.rate (per-PO/truck rate);
--                 is_rgb=FALSE, is_returnable=TRUE → qty * p.purchase_rate.
--
-- Fix C: sret CTE — DISTINCT ON subquery for product join so multiple product
--        records with same name don't multiply returned_qty rows.
--        is_returnable check same COALESCE pattern as above.
--        S.Ret Amt = returned_qty * p.sale_rate.
--
-- Applies to both sale_purchase_summary VIEW and get_sale_purchase_filtered RPC.
-- ============================================================================

DROP VIEW IF EXISTS sale_purchase_summary CASCADE;

CREATE OR REPLACE VIEW sale_purchase_summary WITH (security_invoker = TRUE) AS
WITH pur AS (
  SELECT
    sio.tenant_id,
    sil.product_id,
    SUM(sal.arrived_qty)                                          AS purchase_qty,
    SUM(sal.arrived_qty * COALESCE(sil.rate, 0))                 AS purchase_amt
  FROM sell_in_arrived_lines sal
  JOIN sell_in_lines  sil ON sil.id  = sal.sell_in_line_id
  JOIN sell_in_orders sio ON sio.id  = sil.sell_in_order_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND sil.invoice_type = 'purchase'
  GROUP BY sio.tenant_id, sil.product_id
),
ret AS (
  SELECT
    sio.tenant_id,
    sil.product_id,
    SUM(COALESCE(sal.returned_qty, 0))                           AS pur_return_qty,
    SUM(CASE
      WHEN COALESCE(pc.is_rgb, FALSE) = TRUE
        THEN COALESCE(sal.returned_qty, 0) * COALESCE(sil.rate, 0)
        ELSE COALESCE(sal.returned_qty, 0) * COALESCE(p.purchase_rate, 0)
    END)                                                         AS pur_return_amt
  FROM sell_in_arrived_lines sal
  JOIN sell_in_lines      sil ON sil.id      = sal.sell_in_line_id
  JOIN sell_in_orders     sio ON sio.id      = sil.sell_in_order_id
  JOIN products           p   ON p.id        = sil.product_id
  LEFT JOIN product_categories pc ON pc.id   = p.category_id
  WHERE sio.status IN ('stock_arrived', 'on_credit', 'billed')
    AND COALESCE(pc.is_returnable, p.is_returnable, FALSE) = TRUE
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
    pd.product_id,
    SUM(ir.returned_qty)                                         AS sale_return_qty,
    SUM(ir.returned_qty * COALESCE(pd.sale_rate, 0))            AS sale_return_amt
  FROM invoice_returns ir
  JOIN (
    SELECT DISTINCT ON (p.tenant_id, LOWER(TRIM(p.product_name)))
      p.id       AS product_id,
      p.tenant_id,
      p.sale_rate,
      LOWER(TRIM(p.product_name)) AS norm_name,
      COALESCE(pc.is_returnable, p.is_returnable, FALSE) AS is_returnable
    FROM products p
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    ORDER BY p.tenant_id, LOWER(TRIM(p.product_name)), p.created_at DESC
  ) pd ON pd.tenant_id = ir.tenant_id
       AND pd.norm_name = LOWER(TRIM(ir.product_name))
  WHERE pd.is_returnable = FALSE
  GROUP BY ir.tenant_id, pd.product_id
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
  COALESCE(pur.purchase_qty,    0)::NUMERIC                      AS purchase_qty,
  COALESCE(pur.purchase_amt,    0)::NUMERIC                      AS purchase_amt,
  COALESCE(ret.pur_return_qty,  0)::NUMERIC                      AS pur_return_qty,
  COALESCE(ret.pur_return_amt,  0)::NUMERIC                      AS pur_return_amt,
  (COALESCE(pur.purchase_qty,0) - COALESCE(ret.pur_return_qty,0))::NUMERIC AS net_pur_qty,
  (COALESCE(pur.purchase_amt,0) - COALESCE(ret.pur_return_amt,0))::NUMERIC AS net_pur_amt,
  COALESCE(sal.sale_qty,        0)::NUMERIC                      AS sale_qty,
  COALESCE(sal.sale_amt,        0)::NUMERIC                      AS sale_amt,
  COALESCE(sret.sale_return_qty,0)::NUMERIC                      AS sale_return_qty,
  COALESCE(sret.sale_return_amt,0)::NUMERIC                      AS sale_return_amt,
  (COALESCE(sal.sale_qty,0) - COALESCE(sret.sale_return_qty,0))::NUMERIC  AS net_sale_qty,
  (COALESCE(sal.sale_amt,0) - COALESCE(sret.sale_return_amt,0))::NUMERIC  AS net_sale_amt
FROM all_products ap
JOIN products p ON p.id = ap.product_id AND p.tenant_id = ap.tenant_id
LEFT JOIN pur  ON pur.tenant_id  = ap.tenant_id AND pur.product_id  = ap.product_id
LEFT JOIN ret  ON ret.tenant_id  = ap.tenant_id AND ret.product_id  = ap.product_id
LEFT JOIN sal  ON sal.tenant_id  = ap.tenant_id AND sal.product_id  = ap.product_id
LEFT JOIN sret ON sret.tenant_id = ap.tenant_id AND sret.product_id = ap.product_id;


-- ============================================================================
-- RPC: get_sale_purchase_filtered (same logic, date-filtered, tenant-scoped)
-- ============================================================================

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
      SUM(sal.arrived_qty)                                       AS purchase_qty,
      SUM(sal.arrived_qty * COALESCE(sil.rate, 0))              AS purchase_amt
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id  = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id  = sil.sell_in_order_id
    WHERE sio.tenant_id = v_tenant_id
      AND sio.status IN ('stock_arrived', 'on_credit', 'billed')
      AND sil.invoice_type = 'purchase'
      AND (p_date_from IS NULL OR sio.transaction_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR sio.transaction_date <= p_date_to::DATE)
    GROUP BY sil.product_id
  ),
  ret AS (
    SELECT
      sil.product_id,
      SUM(COALESCE(sal.returned_qty, 0))                        AS pur_return_qty,
      SUM(CASE
        WHEN COALESCE(pc.is_rgb, FALSE) = TRUE
          THEN COALESCE(sal.returned_qty, 0) * COALESCE(sil.rate, 0)
          ELSE COALESCE(sal.returned_qty, 0) * COALESCE(p.purchase_rate, 0)
      END)                                                      AS pur_return_amt
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines      sil ON sil.id    = sal.sell_in_line_id
    JOIN sell_in_orders     sio ON sio.id    = sil.sell_in_order_id
    JOIN products           p   ON p.id      = sil.product_id
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    WHERE sio.tenant_id = v_tenant_id
      AND sio.status IN ('stock_arrived', 'on_credit', 'billed')
      AND COALESCE(pc.is_returnable, p.is_returnable, FALSE) = TRUE
      AND COALESCE(sal.returned_qty, 0) > 0
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
      pd.product_id,
      SUM(ir.returned_qty)                                      AS sale_return_qty,
      SUM(ir.returned_qty * COALESCE(pd.sale_rate, 0))         AS sale_return_amt
    FROM invoice_returns ir
    JOIN (
      SELECT DISTINCT ON (p.tenant_id, LOWER(TRIM(p.product_name)))
        p.id       AS product_id,
        p.tenant_id,
        p.sale_rate,
        LOWER(TRIM(p.product_name)) AS norm_name,
        COALESCE(pc.is_returnable, p.is_returnable, FALSE) AS is_returnable
      FROM products p
      LEFT JOIN product_categories pc ON pc.id = p.category_id
      WHERE p.tenant_id = v_tenant_id
      ORDER BY p.tenant_id, LOWER(TRIM(p.product_name)), p.created_at DESC
    ) pd ON pd.tenant_id = ir.tenant_id
         AND pd.norm_name = LOWER(TRIM(ir.product_name))
    WHERE ir.tenant_id = v_tenant_id
      AND pd.is_returnable = FALSE
      AND (p_date_from IS NULL OR ir.return_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR ir.return_date <= p_date_to::DATE)
    GROUP BY pd.product_id
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
    COALESCE(pur.purchase_qty,    0)::NUMERIC,
    COALESCE(pur.purchase_amt,    0)::NUMERIC,
    COALESCE(ret.pur_return_qty,  0)::NUMERIC,
    COALESCE(ret.pur_return_amt,  0)::NUMERIC,
    (COALESCE(pur.purchase_qty,0) - COALESCE(ret.pur_return_qty,0))::NUMERIC,
    (COALESCE(pur.purchase_amt,0) - COALESCE(ret.pur_return_amt,0))::NUMERIC,
    COALESCE(sal.sale_qty,        0)::NUMERIC,
    COALESCE(sal.sale_amt,        0)::NUMERIC,
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
-- END MDOS v25
-- ============================================================================
