-- ============================================================================
-- MDOS v62 — Fix warehouse_standard_levels view duplication
-- ============================================================================
-- Problem: v61 incorrectly used CROSS JOIN products p with product_categories pc,
-- which multiplied every product by the total number of categories in the database.
-- This caused warehouse stock quantities and closing stock valuation to be inflated
-- by N times (e.g. 13x), breaking the Income Statement COGS and Balance Sheet.
--
-- Solution: JOIN products p with product_categories pc on pc.id = p.category_id
-- (LEFT JOIN to also include uncategorised active products). Each product appears
-- EXACTLY ONCE.
-- ============================================================================

DROP VIEW IF EXISTS warehouse_standard_levels CASCADE;

CREATE VIEW warehouse_standard_levels WITH (security_invoker = TRUE) AS
SELECT
  p.tenant_id,
  p.category_id                            AS category_id,
  COALESCE(pc.title, 'Uncategorised')      AS category_title,
  COALESCE(pc.set_un_case, 1)              AS set_un_case,
  p.id                                     AS product_id,
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
      WHERE sio.tenant_id = p.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status IN ('stock_arrived','on_credit','billed')
    ), 0)
    + COALESCE((
      SELECT SUM(sre.ph_case)
      FROM stock_report_entries sre
      WHERE sre.tenant_id  = p.tenant_id
        AND sre.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(sel.qty)
      FROM sale_entry_lines sel
      JOIN sale_entries se ON se.id = sel.sale_entry_id
      WHERE se.tenant_id  = p.tenant_id
        AND sel.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(wi.quantity)
      FROM waybill_items wi
      JOIN waybills w ON w.id = wi.waybill_id
      WHERE w.tenant_id  = p.tenant_id
        AND wi.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(GREATEST(0, lei.quantity - lei.returned_qty))
      FROM leased_empty_items lei
      WHERE lei.tenant_id = p.tenant_id
        AND lei.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id = p.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS total_qty,
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
      WHERE sio.tenant_id = p.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status IN ('stock_arrived','on_credit','billed')
    ), 0)
    + COALESCE((
      SELECT SUM(sre.ph_case)
      FROM stock_report_entries sre
      WHERE sre.tenant_id  = p.tenant_id
        AND sre.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(sel.qty)
      FROM sale_entry_lines sel
      JOIN sale_entries se ON se.id = sel.sale_entry_id
      WHERE se.tenant_id  = p.tenant_id
        AND sel.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(wi.quantity)
      FROM waybill_items wi
      JOIN waybills w ON w.id = wi.waybill_id
      WHERE w.tenant_id  = p.tenant_id
        AND wi.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(GREATEST(0, lei.quantity - lei.returned_qty))
      FROM leased_empty_items lei
      WHERE lei.tenant_id = p.tenant_id
        AND lei.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id = p.tenant_id
        AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
    ), 0)
  )                                        AS ph_case,
  GREATEST(0,
    (
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
        WHERE sio.tenant_id = p.tenant_id
          AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
          AND sio.status IN ('stock_arrived','on_credit','billed')
      ), 0)
      + COALESCE((
        SELECT SUM(sre.ph_case)
        FROM stock_report_entries sre
        WHERE sre.tenant_id  = p.tenant_id
          AND sre.product_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(sel.qty)
        FROM sale_entry_lines sel
        JOIN sale_entries se ON se.id = sel.sale_entry_id
        WHERE se.tenant_id  = p.tenant_id
          AND sel.product_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(wi.quantity)
        FROM waybill_items wi
        JOIN waybills w ON w.id = wi.waybill_id
        WHERE w.tenant_id  = p.tenant_id
          AND wi.product_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(GREATEST(0, lei.quantity - lei.returned_qty))
        FROM leased_empty_items lei
        WHERE lei.tenant_id = p.tenant_id
          AND lei.product_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(ds.quantity) FROM damaged_stock ds
        WHERE ds.tenant_id = p.tenant_id
          AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
      ), 0)
    ) * COALESCE(pc.set_un_case, 1)
  )                                        AS unit_case,
  COALESCE((
    SELECT SUM(ds.quantity) FROM damaged_stock ds
    WHERE ds.tenant_id = p.tenant_id
      AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
  ), 0)                                    AS damaged_qty
FROM products p
LEFT JOIN product_categories pc ON pc.id = p.category_id
WHERE p.active = TRUE;
