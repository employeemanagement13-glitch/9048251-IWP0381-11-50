-- ============================================================================
-- MDOS v75 — Leased empty returned_date
--
-- A lease leaves warehouse stock on the lease date. The return does not
-- restore stock until returned_date. Reports as-of a date before the return
-- still treat the quantity as outstanding at the outlet.
--
-- Backup/restore already dumps leased_empty_items via SELECT *, so the new
-- column is included automatically after this migration.
-- ============================================================================

ALTER TABLE leased_empty_items
  ADD COLUMN IF NOT EXISTS returned_date DATE;

COMMENT ON COLUMN leased_empty_items.returned_date IS
  'Date the returned_qty came back to the warehouse. NULL = legacy net-on-lease-date behaviour.';

CREATE INDEX IF NOT EXISTS idx_leased_empty_items_returned_date
  ON leased_empty_items(tenant_id, returned_date);

CREATE OR REPLACE FUNCTION leased_empty_outstanding(
  qty numeric,
  ret numeric,
  ret_date date
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(0,
    COALESCE(qty, 0) - CASE
      WHEN COALESCE(ret, 0) <= 0 THEN 0
      WHEN ret_date IS NULL OR ret_date <= CURRENT_DATE THEN ret
      ELSE 0
    END
  );
$$;

-- ============================================================================
-- warehouse_standard_levels: outstanding leases honour returned_date
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
      WHERE w.tenant_id = p.tenant_id
        AND (
          wi.product_id = p.id
          OR (
            COALESCE(wi.product_name, '') <> ''
            AND LOWER(TRIM(wi.product_name)) = LOWER(TRIM(p.product_name))
          )
        )
    ), 0)
    - COALESCE((
      SELECT SUM(leased_empty_outstanding(lei.quantity, lei.returned_qty, lei.returned_date))
      FROM leased_empty_items lei
      WHERE lei.tenant_id = p.tenant_id
        AND (
          lei.product_id = p.id
          OR (
            COALESCE(lei.product_name, '') <> ''
            AND LOWER(TRIM(lei.product_name)) = LOWER(TRIM(p.product_name))
          )
        )
    ), 0)
    - COALESCE((
      SELECT SUM(sei.quantity)
      FROM sold_empty_items sei
      JOIN sold_empties se ON se.id = sei.sold_empty_id
      WHERE se.tenant_id = p.tenant_id
        AND (
          sei.product_id = p.id
          OR (
            COALESCE(sei.product_name, '') <> ''
            AND LOWER(TRIM(sei.product_name)) = LOWER(TRIM(p.product_name))
          )
        )
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
      WHERE w.tenant_id = p.tenant_id
        AND (
          wi.product_id = p.id
          OR (
            COALESCE(wi.product_name, '') <> ''
            AND LOWER(TRIM(wi.product_name)) = LOWER(TRIM(p.product_name))
          )
        )
    ), 0)
    - COALESCE((
      SELECT SUM(leased_empty_outstanding(lei.quantity, lei.returned_qty, lei.returned_date))
      FROM leased_empty_items lei
      WHERE lei.tenant_id = p.tenant_id
        AND (
          lei.product_id = p.id
          OR (
            COALESCE(lei.product_name, '') <> ''
            AND LOWER(TRIM(lei.product_name)) = LOWER(TRIM(p.product_name))
          )
        )
    ), 0)
    - COALESCE((
      SELECT SUM(sei.quantity)
      FROM sold_empty_items sei
      JOIN sold_empties se ON se.id = sei.sold_empty_id
      WHERE se.tenant_id = p.tenant_id
        AND (
          sei.product_id = p.id
          OR (
            COALESCE(sei.product_name, '') <> ''
            AND LOWER(TRIM(sei.product_name)) = LOWER(TRIM(p.product_name))
          )
        )
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
        WHERE w.tenant_id = p.tenant_id
          AND (
            wi.product_id = p.id
            OR (
              COALESCE(wi.product_name, '') <> ''
              AND LOWER(TRIM(wi.product_name)) = LOWER(TRIM(p.product_name))
            )
          )
      ), 0)
      - COALESCE((
        SELECT SUM(leased_empty_outstanding(lei.quantity, lei.returned_qty, lei.returned_date))
        FROM leased_empty_items lei
        WHERE lei.tenant_id = p.tenant_id
          AND (
            lei.product_id = p.id
            OR (
              COALESCE(lei.product_name, '') <> ''
              AND LOWER(TRIM(lei.product_name)) = LOWER(TRIM(p.product_name))
            )
          )
      ), 0)
      - COALESCE((
        SELECT SUM(sei.quantity)
        FROM sold_empty_items sei
        JOIN sold_empties se ON se.id = sei.sold_empty_id
        WHERE se.tenant_id = p.tenant_id
          AND (
            sei.product_id = p.id
            OR (
              COALESCE(sei.product_name, '') <> ''
              AND LOWER(TRIM(sei.product_name)) = LOWER(TRIM(p.product_name))
            )
          )
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

NOTIFY pgrst, 'reload schema';
