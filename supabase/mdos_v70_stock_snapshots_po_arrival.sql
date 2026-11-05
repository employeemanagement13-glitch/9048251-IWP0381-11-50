-- mdos_v70_stock_snapshots_po_arrival.sql
-- Ensures stock_snapshots table exists and supports 'po_arrival' as triggered_by value.
-- Safe to run multiple times (all statements use IF NOT EXISTS / IF EXISTS guards).
--
-- Why: The nightly pg_cron snapshot never runs on localhost, making Opening Stock = Rs. 0
-- during testing. This migration ensures the table is present so that the new
-- snapshotWarehouseValue() server action (called on sell_in stock_arrived) can write
-- a snapshot immediately after each PO arrival — keeping the Income Statement accurate
-- on both localhost and production.

-- 1. Create table if it doesn't already exist (production may have it already)
CREATE TABLE IF NOT EXISTS stock_snapshots (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_date    DATE        NOT NULL,
  total_cost_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_qty        INTEGER,
  triggered_by     TEXT        DEFAULT 'auto',   -- 'auto' | 'manual' | 'po_arrival'
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, snapshot_date)
);

-- 2. Enable RLS (idempotent)
ALTER TABLE stock_snapshots ENABLE ROW LEVEL SECURITY;

-- 3. Owner policy — tenant can read/write only their own snapshots
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stock_snapshots'
      AND policyname = 'stock_snapshots_owner_all'
  ) THEN
    CREATE POLICY stock_snapshots_owner_all
      ON stock_snapshots
      FOR ALL
      USING (tenant_id = current_tenant_id());
  END IF;
END $$;

-- 4. Index for the common query pattern: latest snapshot < fromDate per tenant
CREATE INDEX IF NOT EXISTS idx_stock_snapshots_tenant_date
  ON stock_snapshots (tenant_id, snapshot_date DESC);

NOTIFY pgrst, 'reload schema';
