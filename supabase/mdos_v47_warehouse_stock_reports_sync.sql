-- ============================================================================
-- MDOS v47 — Warehouse Stock & Stock Reports 1:1 Synchronization
--
-- Unifies stock calculation formulas across:
-- 1. warehouse_standard_levels (Non-Returnable physical stock levels)
-- 2. warehouse_rgb_levels      (RGB returnable bottle physical stock levels)
-- 3. warehouse_empties_levels  (Empties crates/shells physical stock levels)
--
-- Formulas:
-- Non-Returnable: Total Qty = (Arrived Purchases - PO Returns) - (Invoiced - Shop Returns) - Damaged Stock
-- Returnable/RGB: Total Qty = Arrived Purchases - PO Returns
--                 Returned  = Shop Returns
--                 Unreturned = MAX(0, Invoiced - Shop Returns)
--                 Available = MAX(0, Total Qty - Unreturned - Damaged Stock)
-- ============================================================================

DROP VIEW IF EXISTS warehouse_rgb_levels CASCADE;
DROP VIEW IF EXISTS warehouse_empties_levels CASCADE;
DROP VIEW IF EXISTS warehouse_standard_levels CASCADE;

-- ----------------------------------------------------------------------------
-- 1. warehouse_standard_levels
-- ----------------------------------------------------------------------------
CREATE VIEW warehouse_standard_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  pc.id                                    AS category_id,
  pc.title                                 AS category_title,
  p.id                                     AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  GREATEST(0,
    -- Arrived purchases minus PO returns
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -COALESCE(sal.arrived_qty, sil.qty)
          ELSE 0
        END
      )
      FROM sell_in_lines sil
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
      JOIN products sil_p ON sil_p.id = sil.product_id
      WHERE sio.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    -- Deduct net invoiced (Invoiced - Shop Returns)
    - GREATEST(0,
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          JOIN products ili_p ON ili_p.id = ili.product_id
          WHERE ili.tenant_id  = pc.tenant_id
            AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
            AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
        ), 0)
        - COALESCE((
          SELECT SUM(ir.returned_qty) FROM invoice_returns ir
          WHERE ir.tenant_id    = pc.tenant_id
            AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
        ), 0)
      )
    -- Deduct damaged stock
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS total_qty,
  COALESCE((
    SELECT SUM(ds.quantity) FROM damaged_stock ds
    WHERE ds.tenant_id    = pc.tenant_id
      AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
      AND ds.status       <> 'adjusted'
  ), 0)                                    AS flappy
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = FALSE
  AND p.active = TRUE;


-- ----------------------------------------------------------------------------
-- 2. warehouse_rgb_levels
-- ----------------------------------------------------------------------------
CREATE VIEW warehouse_rgb_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  p.id                                     AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  -- Total physical quantity arrived in warehouse
  GREATEST(0, COALESCE((
    SELECT SUM(
      CASE
        WHEN sil.invoice_type = 'purchase'
          THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -COALESCE(sal.arrived_qty, sil.qty)
        ELSE 0
      END
    )
    FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN products sil_p ON sil_p.id = sil.product_id
    WHERE sio.tenant_id  = pc.tenant_id
      AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
      AND sio.status     IN ('stock_arrived','on_credit','billed')
  ), 0))                                   AS total_qty,
  -- Returned empties from shops
  GREATEST(0, COALESCE((
    SELECT SUM(ir.returned_qty) FROM invoice_returns ir
    WHERE ir.tenant_id    = pc.tenant_id
      AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
  ), 0))                                   AS returned,
  -- Unreturned with shops: Invoiced - Returned
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      JOIN products ili_p ON ili_p.id = ili.product_id
      WHERE ili.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
        AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
    ), 0)
    - COALESCE((
      SELECT SUM(ir.returned_qty) FROM invoice_returns ir
      WHERE ir.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS unreturned,
  -- Available in warehouse: Total arrived - Unreturned with shops - Damaged stock
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -COALESCE(sal.arrived_qty, sil.qty)
          ELSE 0
        END
      )
      FROM sell_in_lines sil
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
      JOIN products sil_p ON sil_p.id = sil.product_id
      WHERE sio.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    - GREATEST(0,
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          JOIN products ili_p ON ili_p.id = ili.product_id
          WHERE ili.tenant_id  = pc.tenant_id
            AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
            AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
        ), 0)
        - COALESCE((
          SELECT SUM(ir.returned_qty) FROM invoice_returns ir
          WHERE ir.tenant_id    = pc.tenant_id
            AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
        ), 0)
      )
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS available
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = TRUE
  AND pc.is_rgb = TRUE
  AND p.active = TRUE;


-- ----------------------------------------------------------------------------
-- 3. warehouse_empties_levels
-- ----------------------------------------------------------------------------
CREATE VIEW warehouse_empties_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  p.id                                     AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
  -- Total physical quantity arrived in warehouse
  GREATEST(0, COALESCE((
    SELECT SUM(
      CASE
        WHEN sil.invoice_type = 'purchase'
          THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -COALESCE(sal.arrived_qty, sil.qty)
        ELSE 0
      END
    )
    FROM sell_in_lines sil
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
    JOIN products sil_p ON sil_p.id = sil.product_id
    WHERE sio.tenant_id  = pc.tenant_id
      AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
      AND sio.status     IN ('stock_arrived','on_credit','billed')
  ), 0))                                   AS total_qty,
  -- Returned empties from shops
  GREATEST(0, COALESCE((
    SELECT SUM(ir.returned_qty) FROM invoice_returns ir
    WHERE ir.tenant_id    = pc.tenant_id
      AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
  ), 0))                                   AS returned,
  -- Unreturned with shops: Invoiced - Returned
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      JOIN products ili_p ON ili_p.id = ili.product_id
      WHERE ili.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
        AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
    ), 0)
    - COALESCE((
      SELECT SUM(ir.returned_qty) FROM invoice_returns ir
      WHERE ir.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS unreturned,
  -- Available in warehouse: Total arrived - Unreturned with shops - Damaged stock
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN COALESCE(sal.arrived_qty, sil.qty) - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -COALESCE(sal.arrived_qty, sil.qty)
          ELSE 0
        END
      )
      FROM sell_in_lines sil
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
      JOIN products sil_p ON sil_p.id = sil.product_id
      WHERE sio.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    - GREATEST(0,
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          JOIN products ili_p ON ili_p.id = ili.product_id
          WHERE ili.tenant_id  = pc.tenant_id
            AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
            AND (inv.delivery_status IS NULL OR inv.delivery_status <> 'cancelled')
        ), 0)
        - COALESCE((
          SELECT SUM(ir.returned_qty) FROM invoice_returns ir
          WHERE ir.tenant_id    = pc.tenant_id
            AND LOWER(TRIM(ir.product_name)) = LOWER(TRIM(p.product_name))
        ), 0)
      )
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS available
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = TRUE
  AND (pc.is_rgb = FALSE OR pc.is_rgb IS NULL)
  AND p.active = TRUE;

NOTIFY pgrst, 'reload schema';
