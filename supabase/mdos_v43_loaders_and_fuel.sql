CREATE TABLE IF NOT EXISTS loaders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  loader_id   UUID REFERENCES employees(id) ON DELETE CASCADE,
  number      TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loaders_tenant ON loaders(tenant_id);
ALTER TABLE loaders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loaders_owner_all ON loaders;
CREATE POLICY loaders_owner_all ON loaders FOR ALL
  TO authenticated
  USING  (tenant_id = (SELECT current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()));

ALTER TABLE fuel_entries
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT DEFAULT 'delivery',
  ALTER COLUMN initial_reading DROP NOT NULL,
  ALTER COLUMN final_reading DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
