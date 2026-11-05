-- ============================================================================
-- MDOS v27 — Warehouse RGB Levels & PO Returned Qty Deduction Fix
--
-- Fix 1: warehouse_rgb_levels SQL view — uses sell_in_lines LEFT JOIN
--        sell_in_arrived_lines with product name matching.
--        Total Qty = Gross Arrived Qty - PO Returned Qty.
--        Returned  = GREATEST(0, Approved Shop Returns - PO Returned Qty).
--
-- Fix 2: Applies same robust LEFT JOIN pattern to warehouse_standard_levels
--        and warehouse_empties_levels views.
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
  pc.id                AS category_id,
  pc.title             AS category_title,
  p.id                 AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
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
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
        AND ds.status       = 'adjusted'
    ), 0)
  )                    AS total_qty,
  COALESCE((
    SELECT SUM(ds.quantity) FROM damaged_stock ds
    WHERE ds.tenant_id    = pc.tenant_id
      AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
      AND ds.status       <> 'adjusted'
  ), 0)                AS flappy
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
  p.id                 AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
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
  ), 0))               AS total_qty,
  GREATEST(0,
    COALESCE((
      SELECT SUM(rw.received_qty) FROM returns_wayback rw
      WHERE rw.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(rw.product_name)) = LOWER(TRIM(p.product_name))
        AND rw.status       = 'approved'
    ), 0)
    - COALESCE((
      SELECT SUM(COALESCE(sal.returned_qty, 0))
      FROM sell_in_lines sil
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
      JOIN products sil_p ON sil_p.id = sil.product_id
      WHERE sio.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
  )                    AS returned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      JOIN products ili_p ON ili_p.id = ili.product_id
      WHERE ili.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
        AND inv.delivery_status = 'delivered'
    ), 0)
    - COALESCE((
      SELECT SUM(rw.received_qty) FROM returns_wayback rw
      WHERE rw.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(rw.product_name)) = LOWER(TRIM(p.product_name))
        AND rw.status       = 'approved'
    ), 0)
  )                    AS unreturned,
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
            AND inv.delivery_status = 'delivered'
        ), 0)
        - COALESCE((
          SELECT SUM(rw.received_qty) FROM returns_wayback rw
          WHERE rw.tenant_id    = pc.tenant_id
            AND LOWER(TRIM(rw.product_name)) = LOWER(TRIM(p.product_name))
            AND rw.status       = 'approved'
        ), 0)
      )
  )                    AS available
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
  p.id                 AS product_id,
  COALESCE(p.product_code, p.product_name) AS code,
  p.product_name,
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
  ), 0))               AS total_qty,
  GREATEST(0,
    COALESCE((
      SELECT SUM(rw.received_qty) FROM returns_wayback rw
      WHERE rw.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(rw.product_name)) = LOWER(TRIM(p.product_name))
        AND rw.status       = 'approved'
    ), 0)
    - COALESCE((
      SELECT SUM(COALESCE(sal.returned_qty, 0))
      FROM sell_in_lines sil
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      LEFT JOIN sell_in_arrived_lines sal ON sal.sell_in_line_id = sil.id
      JOIN products sil_p ON sil_p.id = sil.product_id
      WHERE sio.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
  )                    AS returned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      JOIN products ili_p ON ili_p.id = ili.product_id
      WHERE ili.tenant_id  = pc.tenant_id
        AND LOWER(TRIM(ili_p.product_name)) = LOWER(TRIM(p.product_name))
        AND inv.delivery_status = 'delivered'
    ), 0)
    - COALESCE((
      SELECT SUM(rw.received_qty) FROM returns_wayback rw
      WHERE rw.tenant_id    = pc.tenant_id
        AND LOWER(TRIM(rw.product_name)) = LOWER(TRIM(p.product_name))
        AND rw.status       = 'approved'
    ), 0)
  )                    AS unreturned,
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
            AND inv.delivery_status = 'delivered'
        ), 0)
        - COALESCE((
          SELECT SUM(rw.received_qty) FROM returns_wayback rw
          WHERE rw.tenant_id    = pc.tenant_id
            AND LOWER(TRIM(rw.product_name)) = LOWER(TRIM(p.product_name))
            AND rw.status       = 'approved'
        ), 0)
      )
  )                    AS available
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE pc.is_returnable = TRUE
  AND pc.is_rgb = FALSE
  AND p.active = TRUE;

-- ============================================================================
-- END MDOS v27
-- ============================================================================
