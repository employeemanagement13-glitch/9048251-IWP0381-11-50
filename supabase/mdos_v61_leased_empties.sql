-- ============================================================================
-- MDOS v61 — Leased Empties System: leased_empties and leased_empty_items
-- ============================================================================

CREATE TABLE IF NOT EXISTS leased_empties (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL DEFAULT current_tenant_id()
                                REFERENCES tenants(id) ON DELETE CASCADE,
  date          DATE          NOT NULL DEFAULT current_date,
  shop_id       UUID          REFERENCES shops(id) ON DELETE CASCADE,
  outlet_code   TEXT          NOT NULL,
  outlet_name   TEXT          NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leased_empties_tenant_date ON leased_empties(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_leased_empties_shop ON leased_empties(tenant_id, shop_id);

ALTER TABLE leased_empties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leased_empties_owner_all ON leased_empties;
CREATE POLICY leased_empties_owner_all ON leased_empties FOR ALL
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP TRIGGER IF EXISTS trg_leased_empties_updated_at ON leased_empties;
CREATE TRIGGER trg_leased_empties_updated_at
  BEFORE UPDATE ON leased_empties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS leased_empty_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL DEFAULT current_tenant_id()
                                REFERENCES tenants(id) ON DELETE CASCADE,
  lease_id      UUID          NOT NULL REFERENCES leased_empties(id) ON DELETE CASCADE,
  product_id    UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_code  TEXT,
  product_name  TEXT          NOT NULL,
  quantity      NUMERIC(12,2) NOT NULL DEFAULT 0,
  returned_qty  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leased_empty_items_lease ON leased_empty_items(lease_id);
CREATE INDEX IF NOT EXISTS idx_leased_empty_items_product ON leased_empty_items(tenant_id, product_id);

ALTER TABLE leased_empty_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leased_empty_items_owner_all ON leased_empty_items;
CREATE POLICY leased_empty_items_owner_all ON leased_empty_items FOR ALL
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================================
-- Sync Warehouse Standard Levels with Leased Empties (net: quantity - returned_qty)
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
      WHERE sio.tenant_id = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status IN ('stock_arrived','on_credit','billed')
    ), 0)
    + COALESCE((
      SELECT SUM(sre.ph_case)
      FROM stock_report_entries sre
      WHERE sre.tenant_id  = pc.tenant_id
        AND sre.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(sel.qty)
      FROM sale_entry_lines sel
      JOIN sale_entries se ON se.id = sel.sale_entry_id
      WHERE se.tenant_id  = pc.tenant_id
        AND sel.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(wi.quantity)
      FROM waybill_items wi
      JOIN waybills w ON w.id = wi.waybill_id
      WHERE w.tenant_id  = pc.tenant_id
        AND wi.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(GREATEST(0, lei.quantity - lei.returned_qty))
      FROM leased_empty_items lei
      WHERE lei.tenant_id = pc.tenant_id
        AND lei.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id = pc.tenant_id
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
      WHERE sio.tenant_id = pc.tenant_id
        AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
        AND sio.status IN ('stock_arrived','on_credit','billed')
    ), 0)
    + COALESCE((
      SELECT SUM(sre.ph_case)
      FROM stock_report_entries sre
      WHERE sre.tenant_id  = pc.tenant_id
        AND sre.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(sel.qty)
      FROM sale_entry_lines sel
      JOIN sale_entries se ON se.id = sel.sale_entry_id
      WHERE se.tenant_id  = pc.tenant_id
        AND sel.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(wi.quantity)
      FROM waybill_items wi
      JOIN waybills w ON w.id = wi.waybill_id
      WHERE w.tenant_id  = pc.tenant_id
        AND wi.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(GREATEST(0, lei.quantity - lei.returned_qty))
      FROM leased_empty_items lei
      WHERE lei.tenant_id = pc.tenant_id
        AND lei.product_id = p.id
    ), 0)
    - COALESCE((
      SELECT SUM(ds.quantity) FROM damaged_stock ds
      WHERE ds.tenant_id = pc.tenant_id
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
        WHERE sio.tenant_id = pc.tenant_id
          AND LOWER(TRIM(sil_p.product_name)) = LOWER(TRIM(p.product_name))
          AND sio.status IN ('stock_arrived','on_credit','billed')
      ), 0)
      + COALESCE((
        SELECT SUM(sre.ph_case)
        FROM stock_report_entries sre
        WHERE sre.tenant_id  = pc.tenant_id
          AND sre.product_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(sel.qty)
        FROM sale_entry_lines sel
        JOIN sale_entries se ON se.id = sel.sale_entry_id
        WHERE se.tenant_id  = pc.tenant_id
          AND sel.product_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(wi.quantity)
        FROM waybill_items wi
        JOIN waybills w ON w.id = wi.waybill_id
        WHERE w.tenant_id  = pc.tenant_id
          AND wi.product_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(GREATEST(0, lei.quantity - lei.returned_qty))
        FROM leased_empty_items lei
        WHERE lei.tenant_id = pc.tenant_id
          AND lei.product_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(ds.quantity) FROM damaged_stock ds
        WHERE ds.tenant_id = pc.tenant_id
          AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
      ), 0)
    ) * COALESCE(pc.set_un_case, 1)
  )                                        AS unit_case,
  COALESCE((
    SELECT SUM(ds.quantity) FROM damaged_stock ds
    WHERE ds.tenant_id = pc.tenant_id
      AND LOWER(TRIM(ds.product_name)) = LOWER(TRIM(p.product_name))
  ), 0)                                    AS damaged_qty
FROM products p
LEFT JOIN product_categories pc ON pc.id = p.category_id
WHERE p.active = TRUE;
