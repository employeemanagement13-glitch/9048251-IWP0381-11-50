-- ============================================================================
-- MDOS v22 (FIXED) — Expense head tables: Bills, Entertainment, Petty Cash,
-- Penalties.
--
-- ERROR THIS FIXES:
--   ERROR: 42P01: relation "user_tenants" does not exist
--
-- WHY IT HAPPENED:
--   The original RLS policies looked up the caller's tenant via:
--     (SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() LIMIT 1)
--   but "user_tenants" was never part of this schema. Every other table in
--   the MDOS database (shops, invoices, empties_log, etc. — see
--   fix_tenant_access_control.sql and mdos_v9.1_consolidated.sql) resolves
--   the caller's tenant through the existing current_tenant_id() function
--   (backed by the Clerk JWT claim), combined with is_tenant_enabled() to
--   also respect a tenant's access_enabled flag.
--
-- FIX:
--   - Replace the bad subquery with (SELECT current_tenant_id()), matching
--     the pattern used everywhere else in the schema.
--   - Add is_tenant_enabled() to the policy, and add WITH CHECK (missing in
--     the original — needed so inserts/updates are also enforced, not just
--     reads), matching every other tenant-scoped table.
--   - Give tenant_id a DEFAULT of current_tenant_id(), matching the pattern
--     applied to every operational table (see v8 FIX 10 / v9.1 S2-S9), so
--     inserts don't need to pass tenant_id explicitly and can't violate RLS
--     by omission.
--   No other behavior (columns, constraints, table shape) is changed.
-- ============================================================================

-- ─── expense_bills ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_bills (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  bill_name  TEXT NOT NULL,
  month      TEXT NOT NULL,
  year       TEXT NOT NULL,
  amount     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE expense_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_expense_bills" ON expense_bills;
CREATE POLICY "tenant_expense_bills" ON expense_bills
  FOR ALL
  TO authenticated
  USING ( tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()) )
  WITH CHECK ( tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()) );

-- ─── expense_entertainment ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_entertainment (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  year        TEXT NOT NULL,
  description TEXT NOT NULL,
  amount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE expense_entertainment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_expense_entertainment" ON expense_entertainment;
CREATE POLICY "tenant_expense_entertainment" ON expense_entertainment
  FOR ALL
  TO authenticated
  USING ( tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()) )
  WITH CHECK ( tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()) );

-- ─── expense_petty ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_petty (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  year        TEXT NOT NULL,
  description TEXT NOT NULL,
  amount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE expense_petty ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_expense_petty" ON expense_petty;
CREATE POLICY "tenant_expense_petty" ON expense_petty
  FOR ALL
  TO authenticated
  USING ( tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()) )
  WITH CHECK ( tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()) );

-- ─── expense_penalties ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_penalties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL DEFAULT current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  year        TEXT NOT NULL,
  description TEXT NOT NULL,
  reason      TEXT,
  amount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE expense_penalties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_expense_penalties" ON expense_penalties;
CREATE POLICY "tenant_expense_penalties" ON expense_penalties
  FOR ALL
  TO authenticated
  USING ( tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()) )
  WITH CHECK ( tenant_id = (SELECT current_tenant_id()) AND (SELECT is_tenant_enabled()) );

-- ============================================================================
-- END OF FIX
-- ============================================================================