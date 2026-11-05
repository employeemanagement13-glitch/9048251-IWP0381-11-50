-- ============================================================================
-- MDOS v72 — Sold empties FK rebuild + warehouse empties outflows
--
-- 1. Recreate sold_empties so tenant_id always references tenants(id).
--    v71 CREATE TABLE IF NOT EXISTS left a broken table in place if it
--    already existed from a partial run.
-- 2. Rebuild warehouse_standard_levels so waybills/leases match by product
--    id OR name, and sold empties leave warehouse remaining.
-- ============================================================================

DROP TABLE IF EXISTS sold_empty_items CASCADE;
DROP TABLE IF EXISTS sold_empties CASCADE;

CREATE TABLE sold_empties (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date          DATE          NOT NULL DEFAULT current_date,
  shop_id       UUID          REFERENCES shops(id) ON DELETE SET NULL,
  outlet_code   TEXT          NOT NULL,
  outlet_name   TEXT          NOT NULL,
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_sold_empties_tenant_date ON sold_empties(tenant_id, date);
CREATE INDEX idx_sold_empties_shop ON sold_empties(tenant_id, shop_id);

ALTER TABLE sold_empties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sold_empties_owner_all ON sold_empties;
CREATE POLICY sold_empties_owner_all ON sold_empties FOR ALL
  USING  (tenant_id = (SELECT current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()));

DROP TRIGGER IF EXISTS trg_sold_empties_updated_at ON sold_empties;
CREATE TRIGGER trg_sold_empties_updated_at
  BEFORE UPDATE ON sold_empties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sold_empty_items (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sold_empty_id  UUID          NOT NULL REFERENCES sold_empties(id) ON DELETE CASCADE,
  product_id     UUID          REFERENCES products(id) ON DELETE SET NULL,
  product_code   TEXT,
  product_name   TEXT          NOT NULL,
  quantity       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_sold_empty_items_sold ON sold_empty_items(sold_empty_id);
CREATE INDEX idx_sold_empty_items_product ON sold_empty_items(tenant_id, product_id);

ALTER TABLE sold_empty_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sold_empty_items_owner_all ON sold_empty_items;
CREATE POLICY sold_empty_items_owner_all ON sold_empty_items FOR ALL
  USING  (tenant_id = (SELECT current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()));

GRANT ALL ON TABLE sold_empties TO authenticated, service_role;
GRANT ALL ON TABLE sold_empty_items TO authenticated, service_role;

-- ============================================================================
-- warehouse_standard_levels: waybill/lease by id OR name, plus sold empties
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
      SELECT SUM(GREATEST(0, lei.quantity - lei.returned_qty))
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
      SELECT SUM(GREATEST(0, lei.quantity - lei.returned_qty))
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
        SELECT SUM(GREATEST(0, lei.quantity - lei.returned_qty))
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
