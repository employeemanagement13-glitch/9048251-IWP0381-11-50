-- ============================================================================
-- MDOS v60 — Implied Products System: is_implied category flag,
--             linked_rgb_product_id on products, waybills & waybill_items tables,
--             and rebuilt warehouse_standard_levels view.
-- ============================================================================

-- 1. Add is_implied flag to product_categories
ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS is_implied BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Add linked_rgb_product_id to products (links an Implied product to its RGB filler)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS linked_rgb_product_id UUID REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_linked_rgb ON products(linked_rgb_product_id)
  WHERE linked_rgb_product_id IS NOT NULL;

-- 3. Create waybills table (SAP dispatch records)
CREATE TABLE IF NOT EXISTS waybills (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL DEFAULT current_tenant_id()
                                REFERENCES tenants(id) ON DELETE CASCADE,
  date          DATE          NOT NULL DEFAULT current_date,
  sap_waybill   TEXT          NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waybills_tenant_date ON waybills(tenant_id, date);

ALTER TABLE waybills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waybills_owner_all ON waybills;
CREATE POLICY waybills_owner_all ON waybills FOR ALL
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP TRIGGER IF EXISTS trg_waybills_updated_at ON waybills;
CREATE TRIGGER trg_waybills_updated_at
  BEFORE UPDATE ON waybills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. Create waybill_items table
CREATE TABLE IF NOT EXISTS waybill_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL DEFAULT current_tenant_id()
                                REFERENCES tenants(id) ON DELETE CASCADE,
  waybill_id    UUID          NOT NULL REFERENCES waybills(id) ON DELETE CASCADE,
  product_id    UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_code  TEXT,
  product_name  TEXT          NOT NULL,
  quantity      NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waybill_items_waybill  ON waybill_items(waybill_id);
CREATE INDEX IF NOT EXISTS idx_waybill_items_product  ON waybill_items(tenant_id, product_id);

ALTER TABLE waybill_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waybill_items_owner_all ON waybill_items;
CREATE POLICY waybill_items_owner_all ON waybill_items FOR ALL
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 5. Rebuild warehouse_standard_levels view
--    Logic for each product:
--      total_qty = sell_in arrivals + stock_report_entries - sale_entry_lines (positive deduction)
--                  - waybill_items (only for is_implied products)
--                  - damaged_stock
--    For Implied products:
--      sale_entry_lines.qty is stored as NEGATIVE (e.g. -20).
--      SUM(sel.qty) with negative values = subtracts a negative = adds back to stock.
--      So: total_qty includes the implied empties returning from outlets.
--    Waybill dispatch DECREASES implied product stock (dispatched to Coke factory).

DROP VIEW IF EXISTS warehouse_standard_levels CASCADE;

CREATE VIEW warehouse_standard_levels WITH (security_invoker = TRUE) AS
SELECT
  pc.tenant_id,
  pc.id                                    AS category_id,
  pc.title                                 AS category_title,
  pc.set_un_case,
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
      AND ds.status <> 'adjusted'
  ), 0)                                    AS flappy
FROM product_categories pc
JOIN products p ON p.category_id = pc.id
WHERE p.active = TRUE;

-- 6. Enable realtime on new tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'waybills'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE waybills;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'waybill_items'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE waybill_items;
    END IF;
  END IF;
END $$;
