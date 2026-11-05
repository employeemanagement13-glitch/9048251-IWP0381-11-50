CREATE TABLE IF NOT EXISTS discount_configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shop_id       uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  from_date     date NOT NULL,
  to_date       date NOT NULL,
  given_by_type text NOT NULL CHECK (given_by_type IN ('owner', 'preseller')),
  preseller_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discount_config_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_config_id uuid NOT NULL REFERENCES discount_configs(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sale_rate         numeric(12,2) NOT NULL DEFAULT 0,
  discounted_rate   numeric(12,2) NOT NULL DEFAULT 0
);

ALTER TABLE discount_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_config_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_discount_configs" ON discount_configs
  USING (tenant_id = current_tenant_id());
CREATE POLICY "tenant_discount_config_products" ON discount_config_products
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_discount_configs_tenant_shop ON discount_configs(tenant_id, shop_id);
CREATE INDEX IF NOT EXISTS idx_discount_configs_dates ON discount_configs(from_date, to_date);
CREATE INDEX IF NOT EXISTS idx_discount_config_products_config ON discount_config_products(discount_config_id);

NOTIFY pgrst, 'reload schema';
