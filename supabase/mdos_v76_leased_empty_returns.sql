-- ============================================================================
-- MDOS v76 — Multiple dated returns per leased empty line
-- ============================================================================

CREATE TABLE IF NOT EXISTS leased_empty_returns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lease_id      UUID NOT NULL REFERENCES leased_empties(id) ON DELETE CASCADE,
  lease_item_id UUID NOT NULL REFERENCES leased_empty_items(id) ON DELETE CASCADE,
  return_date   DATE NOT NULL,
  quantity      NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  is_legacy     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leased_empty_returns_lease
  ON leased_empty_returns(tenant_id, lease_id);
CREATE INDEX IF NOT EXISTS idx_leased_empty_returns_item_date
  ON leased_empty_returns(tenant_id, lease_item_id, return_date);

ALTER TABLE leased_empty_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leased_empty_returns_owner_all ON leased_empty_returns;
CREATE POLICY leased_empty_returns_owner_all ON leased_empty_returns FOR ALL
  USING (tenant_id = (SELECT current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()));

-- Backfill: one return row per existing returned_qty so reports stay the same.
-- No returned_date → return on lease date, flagged legacy (old net-on-lease behaviour).
INSERT INTO leased_empty_returns (tenant_id, lease_id, lease_item_id, return_date, quantity, is_legacy)
SELECT
  lei.tenant_id,
  lei.lease_id,
  lei.id,
  CASE
    WHEN lei.returned_date IS NOT NULL THEN lei.returned_date
    ELSE COALESCE(le.date, CURRENT_DATE)
  END,
  lei.returned_qty,
  (lei.returned_date IS NULL)
FROM leased_empty_items lei
JOIN leased_empties le ON le.id = lei.lease_id
WHERE COALESCE(lei.returned_qty, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM leased_empty_returns ler WHERE ler.lease_item_id = lei.id
  );

-- Outstanding as of CURRENT_DATE using return rows (legacy columns as fallback).
CREATE OR REPLACE FUNCTION leased_empty_outstanding(
  item_id uuid,
  qty numeric,
  ret numeric,
  ret_date date
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(0,
    COALESCE(qty, 0) - COALESCE(
      (SELECT SUM(ler.quantity)
       FROM leased_empty_returns ler
       WHERE ler.lease_item_id = item_id
         AND ler.return_date <= CURRENT_DATE),
      CASE
        WHEN COALESCE(ret, 0) <= 0 THEN 0
        WHEN ret_date IS NULL OR ret_date <= CURRENT_DATE THEN ret
        ELSE 0
      END
    )
  );
$$;

-- Keep old 3-arg signature for any leftover callers (legacy columns only).
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
      SELECT SUM(leased_empty_outstanding(lei.id, lei.quantity, lei.returned_qty, lei.returned_date))
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
      SELECT SUM(leased_empty_outstanding(lei.id, lei.quantity, lei.returned_qty, lei.returned_date))
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
        SELECT SUM(leased_empty_outstanding(lei.id, lei.quantity, lei.returned_qty, lei.returned_date))
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

