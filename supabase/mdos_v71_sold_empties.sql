-- ============================================================================
-- MDOS v71 — Sold Empties: sold_empties and sold_empty_items
-- Recording sold empties on /inventory/empties-movements was failing because
-- these tables were referenced in code but never created.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sold_empties (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL DEFAULT current_tenant_id()
                                REFERENCES tenants(id) ON DELETE CASCADE,
  date          DATE          NOT NULL DEFAULT current_date,
  shop_id       UUID          REFERENCES shops(id) ON DELETE SET NULL,
  outlet_code   TEXT          NOT NULL,
  outlet_name   TEXT          NOT NULL,
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sold_empties_tenant_date ON sold_empties(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_sold_empties_shop ON sold_empties(tenant_id, shop_id);

ALTER TABLE sold_empties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sold_empties_owner_all ON sold_empties;
CREATE POLICY sold_empties_owner_all ON sold_empties FOR ALL
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP TRIGGER IF EXISTS trg_sold_empties_updated_at ON sold_empties;
CREATE TRIGGER trg_sold_empties_updated_at
  BEFORE UPDATE ON sold_empties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sold_empty_items (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL DEFAULT current_tenant_id()
                                 REFERENCES tenants(id) ON DELETE CASCADE,
  sold_empty_id  UUID          NOT NULL REFERENCES sold_empties(id) ON DELETE CASCADE,
  product_id     UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_code   TEXT,
  product_name   TEXT          NOT NULL,
  quantity       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sold_empty_items_sold ON sold_empty_items(sold_empty_id);
CREATE INDEX IF NOT EXISTS idx_sold_empty_items_product ON sold_empty_items(tenant_id, product_id);

ALTER TABLE sold_empty_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sold_empty_items_owner_all ON sold_empty_items;
CREATE POLICY sold_empty_items_owner_all ON sold_empty_items FOR ALL
  USING  (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

NOTIFY pgrst, 'reload schema';
