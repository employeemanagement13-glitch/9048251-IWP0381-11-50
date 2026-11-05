-- Migration v37: Include damaged_stock in Balance by Level Total OUT
-- Both stock_balance_by_level VIEW and get_stock_balance_filtered RPC
-- are patched to add a damaged_out CTE that sums damaged_stock.quantity
-- (all statuses) per product, and adds it to total_qty_out / net_balance.

-- ============================================================================
-- 1. stock_balance_by_level VIEW (no date filter, security_invoker)
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
damaged_out AS (
  SELECT
    ds.tenant_id,
    LOWER(TRIM(ds.product_name)) AS norm_name,
    SUM(ds.quantity) AS damaged_qty
  FROM damaged_stock ds
  GROUP BY ds.tenant_id, LOWER(TRIM(ds.product_name))
),
all_names AS (
  SELECT tenant_id, norm_name FROM ins
  UNION SELECT tenant_id, norm_name FROM outs_gross
  UNION SELECT tenant_id, norm_name FROM returns_deduct
  UNION SELECT tenant_id, norm_name FROM damaged_out
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
  (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0) + COALESCE(dmg.damaged_qty, 0))::NUMERIC AS total_qty_out,
  (COALESCE(ins.qty_in, 0) - (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0) + COALESCE(dmg.damaged_qty, 0)))::NUMERIC AS net_balance
FROM all_names an
LEFT JOIN prod_meta pm   ON pm.tenant_id = an.tenant_id AND pm.norm_name = an.norm_name
LEFT JOIN ins            ON ins.tenant_id = an.tenant_id AND ins.norm_name = an.norm_name
LEFT JOIN outs_gross og  ON og.tenant_id  = an.tenant_id AND og.norm_name  = an.norm_name
LEFT JOIN returns_deduct rd ON rd.tenant_id = an.tenant_id AND rd.norm_name = an.norm_name
LEFT JOIN damaged_out dmg ON dmg.tenant_id = an.tenant_id AND dmg.norm_name = an.norm_name;


-- ============================================================================
-- 2. get_stock_balance_filtered RPC (date-filtered version, SECURITY DEFINER)
-- ============================================================================

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
  damaged_out AS (
    SELECT
      LOWER(TRIM(ds.product_name)) AS norm_name,
      SUM(ds.quantity) AS damaged_qty
    FROM damaged_stock ds
    WHERE ds.tenant_id = v_tenant_id
      AND (p_date_from IS NULL OR ds.recorded_date >= p_date_from::DATE)
      AND (p_date_to   IS NULL OR ds.recorded_date <= p_date_to::DATE)
    GROUP BY LOWER(TRIM(ds.product_name))
  ),
  all_names AS (
    SELECT norm_name FROM ins
    UNION SELECT norm_name FROM outs_gross
    UNION SELECT norm_name FROM returns_deduct
    UNION SELECT norm_name FROM damaged_out
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
    (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0) + COALESCE(dmg.damaged_qty, 0))::NUMERIC AS total_qty_out,
    (COALESCE(ins.qty_in, 0) - (COALESCE(og.gross_qty_out, 0) - COALESCE(rd.returned_qty, 0) + COALESCE(dmg.damaged_qty, 0)))::NUMERIC AS net_balance
  FROM all_names an
  LEFT JOIN prod_meta pm   ON pm.norm_name = an.norm_name
  LEFT JOIN ins            ON ins.norm_name = an.norm_name
  LEFT JOIN outs_gross og  ON og.norm_name  = an.norm_name
  LEFT JOIN returns_deduct rd ON rd.norm_name = an.norm_name
  LEFT JOIN damaged_out dmg ON dmg.norm_name = an.norm_name
  ORDER BY product_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_stock_balance_filtered(TEXT, TEXT) TO authenticated;
