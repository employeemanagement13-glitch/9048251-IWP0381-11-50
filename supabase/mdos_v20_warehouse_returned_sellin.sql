-- ============================================================================
-- MDOS v20 (FIXED) — warehouse_rgb_levels & warehouse_empties_levels
--
-- ERROR THIS FIXES:
--   ERROR: 42P16: cannot change data type of view column "returned"
--          from bigint to numeric
--
-- WHY IT HAPPENED:
--   Postgres' CREATE OR REPLACE VIEW can only swap out the *query* behind
--   a view — it is NOT allowed to change the data type of an existing
--   output column. These two views already exist in your DB from an
--   earlier deploy, where the "returned" column resolved to bigint
--   (SUM() over integer columns). Since then, upstream columns
--   (sell_in_lines.qty / arrived/returned qty, etc.) were widened to
--   NUMERIC in later migrations (v9.1 consolidated), so this new
--   definition's "returned" column now resolves to numeric instead of
--   bigint — a type change CREATE OR REPLACE VIEW refuses to perform.
--
-- FIX:
--   Explicitly DROP the views first, then CREATE them. This is safe —
--   it does not change any column, calculation, or filter versus the
--   original v20 definitions below. DROP ... CASCADE is used defensively
--   in case any downstream report view was built on top of these (none
--   currently are, based on the supplied schema files), so nothing else
--   is expected to break; if it does, the dependent object(s) simply need
--   re-running afterward.
-- ============================================================================

DROP VIEW IF EXISTS warehouse_rgb_levels CASCADE;
DROP VIEW IF EXISTS warehouse_empties_levels CASCADE;

-- ----------------------------------------------------------------------------
-- warehouse_rgb_levels (unchanged logic from original v20)
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
          THEN sal.arrived_qty - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -sal.arrived_qty
        ELSE 0
      END
    )
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    WHERE sil.product_id = p.id
      AND sio.tenant_id  = pc.tenant_id
      AND sio.status     IN ('stock_arrived','on_credit','billed')
  ), 0))               AS total_qty,
  COALESCE((
    SELECT SUM(COALESCE(sal.returned_qty, 0))
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    WHERE sil.product_id = p.id
      AND sio.tenant_id  = pc.tenant_id
      AND sio.status     IN ('stock_arrived','on_credit','billed')
  ), 0)
  + COALESCE((
    SELECT SUM(rw.received_qty) FROM returns_wayback rw
    WHERE rw.tenant_id    = pc.tenant_id
      AND rw.product_name = p.product_name
      AND rw.status       = 'approved'
  ), 0)                AS returned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      WHERE ili.tenant_id  = pc.tenant_id
        AND ili.product_id = p.id
        AND inv.delivery_status = 'delivered'
    ), 0)
    - COALESCE((
      SELECT SUM(rw.received_qty) FROM returns_wayback rw
      WHERE rw.tenant_id    = pc.tenant_id
        AND rw.product_name = p.product_name
        AND rw.status       = 'approved'
    ), 0)
  )                    AS unreturned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN sal.arrived_qty - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -sal.arrived_qty
          ELSE 0
        END
      )
      FROM sell_in_arrived_lines sal
      JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      WHERE sil.product_id = p.id
        AND sio.tenant_id  = pc.tenant_id
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    - (
      COALESCE((
        SELECT SUM(COALESCE(sal.returned_qty, 0))
        FROM sell_in_arrived_lines sal
        JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
        JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
        WHERE sil.product_id = p.id
          AND sio.tenant_id  = pc.tenant_id
          AND sio.status     IN ('stock_arrived','on_credit','billed')
      ), 0)
      + COALESCE((
        SELECT SUM(rw.received_qty) FROM returns_wayback rw
        WHERE rw.tenant_id    = pc.tenant_id
          AND rw.product_name = p.product_name
          AND rw.status       = 'approved'
      ), 0)
    )
    - GREATEST(0,
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          WHERE ili.tenant_id  = pc.tenant_id
            AND ili.product_id = p.id
            AND inv.delivery_status = 'delivered'
        ), 0)
        - COALESCE((
          SELECT SUM(rw.received_qty) FROM returns_wayback rw
          WHERE rw.tenant_id    = pc.tenant_id
            AND rw.product_name = p.product_name
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
-- warehouse_empties_levels (unchanged logic from original v20)
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
          THEN sal.arrived_qty - COALESCE(sal.returned_qty, 0)
        WHEN sil.invoice_type = 'return'
          THEN -sal.arrived_qty
        ELSE 0
      END
    )
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    WHERE sil.product_id = p.id
      AND sio.tenant_id  = pc.tenant_id
      AND sio.status     IN ('stock_arrived','on_credit','billed')
  ), 0))               AS total_qty,
  COALESCE((
    SELECT SUM(COALESCE(sal.returned_qty, 0))
    FROM sell_in_arrived_lines sal
    JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
    JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
    WHERE sil.product_id = p.id
      AND sio.tenant_id  = pc.tenant_id
      AND sio.status     IN ('stock_arrived','on_credit','billed')
  ), 0)
  + COALESCE((
    SELECT SUM(rw.received_qty) FROM returns_wayback rw
    WHERE rw.tenant_id    = pc.tenant_id
      AND rw.product_name = p.product_name
      AND rw.status       = 'approved'
  ), 0)                AS returned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(ili.quantity) FROM invoice_line_items ili
      JOIN invoices inv ON inv.id = ili.invoice_id
      WHERE ili.tenant_id  = pc.tenant_id
        AND ili.product_id = p.id
        AND inv.delivery_status = 'delivered'
    ), 0)
    - COALESCE((
      SELECT SUM(rw.received_qty) FROM returns_wayback rw
      WHERE rw.tenant_id    = pc.tenant_id
        AND rw.product_name = p.product_name
        AND rw.status       = 'approved'
    ), 0)
  )                    AS unreturned,
  GREATEST(0,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN sil.invoice_type = 'purchase'
            THEN sal.arrived_qty - COALESCE(sal.returned_qty, 0)
          WHEN sil.invoice_type = 'return'
            THEN -sal.arrived_qty
          ELSE 0
        END
      )
      FROM sell_in_arrived_lines sal
      JOIN sell_in_lines  sil ON sil.id = sal.sell_in_line_id
      JOIN sell_in_orders sio ON sio.id = sil.sell_in_order_id
      WHERE sil.product_id = p.id
        AND sio.tenant_id  = pc.tenant_id
        AND sio.status     IN ('stock_arrived','on_credit','billed')
    ), 0)
    - GREATEST(0,
        COALESCE((
          SELECT SUM(ili.quantity) FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          WHERE ili.tenant_id  = pc.tenant_id
            AND ili.product_id = p.id
            AND inv.delivery_status = 'delivered'
        ), 0)
        - COALESCE((
          SELECT SUM(rw.received_qty) FROM returns_wayback rw
          WHERE rw.tenant_id    = pc.tenant_id
            AND rw.product_name = p.product_name
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
-- END OF FIX
-- ============================================================================